import ear from "../node_modules/rabbit-ear/module/index.js";
import { assignmentFlatFoldAngle } from "../node_modules/rabbit-ear/module/fold/spec.js";
import { makeVerticesCoords3DFolded } from "../node_modules/rabbit-ear/module/graph/vertices/folded.js";

export const DEFAULT_FRAMES_PER_STEP = 32;
const EDGE_EPSILON = 1e-5;
const SVG_ASSIGNMENTS = {
  blue: "V",
  "#0000ff": "V",
  red: "M",
  "#ff0000": "M",
  black: "B",
  "#000000": "B",
  gray: "F",
  grey: "F",
  "#808080": "F",
  "#7f7f7f": "F",
};

function makeId(prefix) {
  const token = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${token}`;
}

function clampFramesPerStep(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRAMES_PER_STEP;
}

function cloneFold(fold = {}) {
  return ear.graph(structuredClone(fold));
}

function toXYZ(vertex) {
  return [vertex[0], vertex[1], vertex[2] ?? 0];
}

function captureFrame(graph, frameIndex, stepIndex, localFrame, label) {
  let vertices;
  try {
    vertices = makeVerticesCoords3DFolded(graph)
      .filter((vertex) => Array.isArray(vertex))
      .map(toXYZ);
  } catch (error) {
    vertices = (graph.vertices_coords ?? [])
      .filter((vertex) => Array.isArray(vertex))
      .map(toXYZ);
  }

  return {
    frame_index: frameIndex,
    step_index: stepIndex,
    local_frame: localFrame,
    label,
    vertices,
  };
}

function normalizeSegment(segment = []) {
  if (!Array.isArray(segment) || segment.length !== 2) {
    return null;
  }
  const points = segment.map((point) => [Number(point[0]), Number(point[1])]);
  if (points.some((point) => point.some((value) => !Number.isFinite(value)))) {
    return null;
  }
  return points;
}

function segmentMidpoint(segment) {
  return [
    (segment[0][0] + segment[1][0]) * 0.5,
    (segment[0][1] + segment[1][1]) * 0.5,
  ];
}

function dot2(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function cross2(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function pointOnSegment(point, segment, epsilon = EDGE_EPSILON) {
  const [start, end] = segment;
  const vector = [end[0] - start[0], end[1] - start[1]];
  const length = Math.hypot(vector[0], vector[1]);
  if (length <= epsilon) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]) <= epsilon;
  }
  const relative = [point[0] - start[0], point[1] - start[1]];
  const distance = Math.abs(cross2(relative, vector)) / length;
  if (distance > epsilon) {
    return false;
  }
  const projection = dot2(relative, vector) / dot2(vector, vector);
  return projection >= -epsilon && projection <= 1 + epsilon;
}

function edgeMatchesSegment(fold, edgeIndex, segment) {
  const vertices = fold.edges_vertices?.[edgeIndex];
  if (!vertices || vertices.length !== 2) {
    return false;
  }
  const edgeSegment = vertices.map((vertexIndex) => fold.vertices_coords?.[vertexIndex]);
  if (edgeSegment.some((point) => !Array.isArray(point))) {
    return false;
  }
  return edgeSegment.every((point) => pointOnSegment(point, segment));
}

function labelForCrease(index) {
  return `C${index + 1}`;
}

function drawableElements(root) {
  const result = [];
  const walk = (node) => {
    if (!node || node.nodeType !== 1) {
      return;
    }
    if (["line", "rect", "polygon", "polyline", "path"].includes(node.nodeName)) {
      result.push(node);
    }
    Array.from(node.childNodes ?? []).forEach(walk);
  };
  walk(root);
  return result;
}

function normalizeColor(value) {
  return (value || "").trim().toLowerCase();
}

function strokeFromElement(element) {
  const direct = normalizeColor(element.getAttribute?.("stroke"));
  if (direct) {
    return direct;
  }
  const style = element.getAttribute?.("style") ?? "";
  const match = style.match(/(?:^|;)\s*stroke\s*:\s*([^;]+)/i);
  return normalizeColor(match?.[1]);
}

function formatSvgNumber(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return Number.parseFloat(normalized.toFixed(12)).toString();
}

function normalizeNumericString(value) {
  if (!value) {
    return value;
  }
  return value.replace(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, (token) => {
    const parsed = Number.parseFloat(token);
    return Number.isFinite(parsed) ? formatSvgNumber(parsed) : token;
  });
}

function normalizeSvgGeometry(svgElement) {
  drawableElements(svgElement).forEach((element) => {
    ["d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height"]
      .forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (value) {
          element.setAttribute(attribute, normalizeNumericString(value));
        }
      });
  });
}

function prepareSvgAssignments(svgElement) {
  normalizeSvgGeometry(svgElement);
  drawableElements(svgElement).forEach((element) => {
    if (element.getAttribute("data-assignment")) {
      return;
    }
    const assignment = SVG_ASSIGNMENTS[strokeFromElement(element)];
    if (assignment) {
      element.setAttribute("data-assignment", assignment);
    }
  });
}

function foldBounds(fold) {
  const vertices = (fold.vertices_coords ?? []).filter((point) => Array.isArray(point));
  const xs = vertices.map((point) => point[0]);
  const ys = vertices.map((point) => point[1]);
  if (!xs.length || !ys.length) {
    return { minX: 0, minY: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function normalizePoint(point, bounds) {
  if (!Array.isArray(point) || point.length < 2) {
    return point;
  }
  const scale = Math.max(bounds.width, bounds.height, 1);
  return [
    (point[0] - bounds.minX) / scale,
    (point[1] - bounds.minY) / scale,
    ...point.slice(2),
  ];
}

function normalizeGraph(graph, bounds) {
  return {
    ...graph,
    vertices_coords: (graph.vertices_coords ?? []).map((point) => (
      Array.isArray(point) ? normalizePoint(point, bounds) : point
    )),
  };
}

export function parseSvgAsset(svgElement, asset = {}) {
  prepareSvgAssignments(svgElement);
  const rawGraphSource = ear.convert.svgEdgeGraph(svgElement);
  const foldSource = ear.convert.svgToFold(svgElement);
  const bounds = foldBounds(foldSource);
  const rawGraph = normalizeGraph(rawGraphSource, bounds);
  const fold = normalizeGraph(foldSource, bounds);
  const creaseGroups = (rawGraph.edges_vertices ?? [])
    .map((edgeVertices, edgeIndex) => ({ edgeVertices, edgeIndex }))
    .filter(({ edgeVertices }) => Array.isArray(edgeVertices) && edgeVertices.length === 2)
    .map(({ edgeVertices, edgeIndex }) => {
      const assignment = rawGraph.edges_assignment?.[edgeIndex] ?? "U";
      const segment = normalizeSegment(edgeVertices.map((vertexIndex) => rawGraph.vertices_coords?.[vertexIndex]));
      if (!segment || !["M", "V", "F"].includes(assignment)) {
        return null;
      }
      const matchingEdges = (fold.edges_vertices ?? [])
        .map((_, foldEdgeIndex) => foldEdgeIndex)
        .filter((foldEdgeIndex) => edgeMatchesSegment(fold, foldEdgeIndex, segment));
      const nonBoundaryMatches = matchingEdges
        .filter((foldEdgeIndex) => (fold.edges_assignment?.[foldEdgeIndex] ?? "U") !== "B");
      const assignmentMatches = nonBoundaryMatches
        .filter((foldEdgeIndex) => (fold.edges_assignment?.[foldEdgeIndex] ?? "U") === assignment);
      return {
        edgeIndex,
        assignment,
        segment,
        edgeIndices: assignmentMatches.length
          ? assignmentMatches
          : (nonBoundaryMatches.length ? nonBoundaryMatches : matchingEdges),
      };
    })
    .filter(Boolean)
    .map(({ edgeIndex, assignment, segment, edgeIndices }, creaseIndex) => ({
      id: `crease-${String(creaseIndex + 1).padStart(3, "0")}`,
      label: labelForCrease(creaseIndex),
      rawIndex: edgeIndex,
      assignment,
      edgeIndices,
      segment,
      labelPoint: segmentMidpoint(segment),
    }));

  return {
    type: "svg-sequence",
    sourceAsset: {
      name: asset.name ?? "",
      path: asset.path ?? "",
    },
    fold,
    creaseGroups,
    bounds: foldBounds(fold),
  };
}

function normalizeCreaseGroup(group = {}, index = 0) {
  return {
    id: group.id || `crease-${String(index + 1).padStart(3, "0")}`,
    label: group.label || labelForCrease(index),
    rawIndex: Number.isInteger(group.rawIndex) ? group.rawIndex : index,
    assignment: group.assignment || "F",
    edgeIndices: Array.from(new Set((group.edgeIndices ?? []).filter((edgeIndex) => Number.isInteger(edgeIndex) && edgeIndex >= 0))),
    segment: normalizeSegment(group.segment) ?? [[0, 0], [0, 0]],
    labelPoint: normalizeSegment([group.labelPoint ?? [0, 0], group.labelPoint ?? [0, 0]])?.[0] ?? [0, 0],
  };
}

function normalizeCreaseGroupsToBounds(groups, bounds) {
  return groups.map((group, index) => {
    const normalized = normalizeCreaseGroup(group, index);
    return {
      ...normalized,
      segment: normalized.segment.map((point) => normalizePoint(point, bounds)),
      labelPoint: normalizePoint(normalized.labelPoint, bounds).slice(0, 2),
    };
  });
}

function normalizeStep(step = {}, index = 0, availableCreaseIds = new Set()) {
  const creaseIds = Array.from(new Set((step.creaseIds ?? []).filter((creaseId) => availableCreaseIds.has(creaseId))));
  return {
    id: step.id || makeId("step"),
    name: step.name?.trim() || `步骤 ${index + 1}`,
    creaseIds,
  };
}

export function createBlankSvgProject(name = "svg_sequence") {
  return {
    type: "svg-sequence",
    name,
    settings: {
      framesPerStep: DEFAULT_FRAMES_PER_STEP,
    },
    sourceAsset: {
      name: "",
      path: "",
    },
    fold: null,
    creaseGroups: [],
    steps: [
      {
        id: makeId("step"),
        name: "步骤 1",
        creaseIds: [],
      },
    ],
  };
}

export function normalizeSvgProject(project = {}) {
  const sourceAsset = {
    name: project.sourceAsset?.name ?? "",
    path: project.sourceAsset?.path ?? "",
  };
  const fold = project.fold ? cloneFold(project.fold) : null;
  const bounds = fold ? foldBounds(fold) : { minX: 0, minY: 0, width: 1, height: 1 };
  const normalizedFold = fold ? normalizeGraph(fold, bounds) : null;
  const creaseGroups = normalizeCreaseGroupsToBounds(project.creaseGroups ?? [], bounds);
  const creaseIds = new Set(creaseGroups.map((group) => group.id));
  const steps = (project.steps ?? []).map((step, index) => normalizeStep(step, index, creaseIds));
  return {
    type: "svg-sequence",
    name: project.name?.trim() || "svg_sequence",
    settings: {
      framesPerStep: clampFramesPerStep(project.settings?.framesPerStep),
    },
    sourceAsset,
    fold: normalizedFold,
    creaseGroups,
    steps: steps.length
      ? steps
      : [{
          id: makeId("step"),
          name: "步骤 1",
          creaseIds: [],
        }],
  };
}

export function mergeSvgProjectWithAsset(projectInput, assetModel) {
  const project = normalizeSvgProject(projectInput);
  const creaseIds = new Set(assetModel.creaseGroups.map((group) => group.id));
  return {
    ...project,
    type: "svg-sequence",
    sourceAsset: assetModel.sourceAsset,
    fold: cloneFold(assetModel.fold),
    creaseGroups: assetModel.creaseGroups.map(normalizeCreaseGroup),
    steps: project.steps.map((step, index) => normalizeStep(step, index, creaseIds)),
  };
}

function creaseGroupMap(project) {
  return new Map((project.creaseGroups ?? []).map((group) => [group.id, group]));
}

export function stepEdgeSet(project, stepLimit, currentStepAlpha = 1) {
  const normalized = normalizeSvgProject(project);
  const groups = creaseGroupMap(normalized);
  const edgeAngles = new Map();

  normalized.steps.forEach((step, stepIndex) => {
    const alpha = stepIndex < stepLimit ? 1 : stepIndex === stepLimit ? currentStepAlpha : 0;
    if (alpha <= 0) {
      return;
    }
    step.creaseIds.forEach((creaseId) => {
      const group = groups.get(creaseId);
      if (!group) {
        return;
      }
      const targetAngle = assignmentFlatFoldAngle[group.assignment] ?? 0;
      group.edgeIndices.forEach((edgeIndex) => {
        edgeAngles.set(edgeIndex, targetAngle * alpha);
      });
    });
  });

  return edgeAngles;
}

export function buildStepGraph(projectInput, stepLimit, currentStepAlpha = 1) {
  const project = normalizeSvgProject(projectInput);
  if (!project.fold) {
    return null;
  }
  const graph = cloneFold(project.fold);
  const edgeAngles = stepEdgeSet(project, stepLimit, currentStepAlpha);
  graph.edges_foldAngle = (graph.edges_vertices ?? []).map((_, edgeIndex) => edgeAngles.get(edgeIndex) ?? 0);
  return graph;
}

export function buildSvgStepTrajectory(projectInput, options = {}) {
  const project = normalizeSvgProject(projectInput);
  if (!project.fold) {
    return {
      format_version: 4,
      generator: "Rabbit Ear svg sequence",
      project_name: project.name,
      metadata: {
        frame_count: 0,
        step_count: 0,
        frames_per_step: clampFramesPerStep(options.framesPerStep ?? project.settings.framesPerStep),
        dynamic_topology: false,
      },
      faces_vertices: [],
      frames: [],
    };
  }

  const framesPerStep = clampFramesPerStep(options.framesPerStep ?? project.settings.framesPerStep);
  const frames = [];
  let frameIndex = 0;

  frames.push(captureFrame(buildStepGraph(project, -1, 0), frameIndex, -1, 0, "start"));
  frameIndex += 1;

  project.steps.forEach((step, stepIndex) => {
    for (let localFrame = 0; localFrame < framesPerStep; localFrame += 1) {
      const alpha = framesPerStep === 1 ? 1 : localFrame / (framesPerStep - 1);
      const graph = buildStepGraph(project, stepIndex, alpha);
      frames.push(captureFrame(graph, frameIndex, stepIndex, localFrame, step.name));
      frameIndex += 1;
    }
  });

  return {
    format_version: 4,
    generator: "Rabbit Ear svg sequence",
    project_name: project.name,
    metadata: {
      frame_count: frames.length,
      step_count: project.steps.length,
      frames_per_step: framesPerStep,
      dynamic_topology: false,
    },
    faces_vertices: structuredClone(project.fold.faces_vertices ?? []),
    frames,
  };
}
