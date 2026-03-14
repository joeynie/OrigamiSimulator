import ear from "../node_modules/rabbit-ear/module/index.js";
import { assignmentFlatFoldAngle, invertAssignment } from "../node_modules/rabbit-ear/module/fold/spec.js";
import { includeS } from "../node_modules/rabbit-ear/module/math/compare.js";
import { pointsToLine2 } from "../node_modules/rabbit-ear/module/math/convert.js";
import { faceContainingPoint, facesContainingPoint } from "../node_modules/rabbit-ear/module/graph/faces/facePoint.js";
import { makeFacesWinding } from "../node_modules/rabbit-ear/module/graph/faces/winding.js";
import { mergeNextmaps } from "../node_modules/rabbit-ear/module/graph/maps.js";
import { splitLineIntoEdges } from "../node_modules/rabbit-ear/module/graph/split/splitLine.js";
import { splitEdge } from "../node_modules/rabbit-ear/module/graph/split/splitEdge.js";
import { splitFace } from "../node_modules/rabbit-ear/module/graph/split/splitFace.js";
import { makeVerticesCoords3DFolded } from "../node_modules/rabbit-ear/module/graph/vertices/folded.js";
import { createCreaseResolver, normalizeLineRef } from "./geometry.js";

export const DEFAULT_FRAMES_PER_STEP = 32;

function makeId(prefix) {
  const token = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);
  return `${prefix}-${token}`;
}

function clampFramesPerStep(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FRAMES_PER_STEP;
}

function toXYZ(vertex) {
  return [vertex[0], vertex[1], vertex[2] ?? 0];
}

function cloneFaces(graph) {
  return (graph.faces_vertices ?? []).map((face) => [...face]);
}

function captureFrame(graph, frameIndex, stepIndex, localFrame, label) {
  let vertices;
  try {
    vertices = makeVerticesCoords3DFolded(graph).map(toXYZ);
  } catch (error) {
    vertices = (graph.vertices_coords ?? []).map(toXYZ);
  }

  return {
    frame_index: frameIndex,
    step_index: stepIndex,
    local_frame: localFrame,
    label,
    faces_vertices: cloneFaces(graph),
    vertices,
  };
}

function remapCreaseEdges(creaseEdges, edgeMap = []) {
  const nextMap = new Map();
  creaseEdges.forEach((edges, creaseId) => {
    const remapped = new Set();
    edges.forEach((edgeIndex) => {
      const nextEdges = edgeMap[edgeIndex] ?? [edgeIndex];
      nextEdges.forEach((nextEdge) => remapped.add(nextEdge));
    });
    nextMap.set(creaseId, remapped);
  });
  return nextMap;
}

function collectEdgesForCreases(creaseEdges, creaseIds) {
  const edges = new Set();
  creaseIds.forEach((creaseId) => {
    creaseEdges.get(creaseId)?.forEach((edgeIndex) => edges.add(edgeIndex));
  });
  return edges;
}

function svgSegmentToEarSegment(segment) {
  return segment.map((point) => [point.x / 100, (100 - point.y) / 100]);
}

function pointBetween(first, second, t) {
  return {
    x: first.x + (second.x - first.x) * t,
    y: first.y + (second.y - first.y) * t,
  };
}

function pickTransferFace(graph, point, probe, vector) {
  const exactPoint = [point.x, point.y];
  const probePoint = [probe.x, probe.y];
  const directFace = faceContainingPoint(graph, probePoint, vector);
  if (directFace !== undefined) {
    return directFace;
  }
  return facesContainingPoint(graph, probePoint)[0]
    ?? facesContainingPoint(graph, exactPoint)[0];
}

function buildReplaySegment(graph, segment) {
  if (!graph.faces_vertices?.length) {
    return { segment: svgSegmentToEarSegment(segment) };
  }

  const cpSegment = svgSegmentToEarSegment(segment);
  const [start, end] = cpSegment;
  const vector = [end[0] - start[0], end[1] - start[1]];
  const startProbe = pointBetween(segment[0], segment[1], 0.01);
  const endProbe = pointBetween(segment[1], segment[0], 0.01);
  const verticesCoordsFolded = ear.graph.makeVerticesCoordsFolded(graph);
  const foldedGraph = { ...graph, vertices_coords: verticesCoordsFolded };

  const startFace = pickTransferFace(
    graph,
    { x: start[0], y: start[1] },
    { x: startProbe.x / 100, y: (100 - startProbe.y) / 100 },
    vector,
  );
  const endFace = pickTransferFace(
    graph,
    { x: end[0], y: end[1] },
    { x: endProbe.x / 100, y: (100 - endProbe.y) / 100 },
    vector,
  );

  if (startFace === undefined || endFace === undefined) {
    return { segment: cpSegment };
  }

  const foldedStart = ear.graph.transferPointInFaceBetweenGraphs(graph, foldedGraph, startFace, start);
  const foldedEnd = ear.graph.transferPointInFaceBetweenGraphs(graph, foldedGraph, endFace, end);
  if (!foldedStart || !foldedEnd) {
    return { segment: cpSegment };
  }

  return {
    segment: [foldedStart, foldedEnd],
    verticesCoordsFolded,
  };
}

function normalizeScopeFaceIds(scopeFaceIds) {
  return Array.from(new Set((scopeFaceIds ?? [])
    .filter((faceId) => Number.isInteger(faceId) && faceId >= 0)))
    .sort((a, b) => a - b);
}

function faceCentroid(graph, faceId, verticesCoords = graph.vertices_coords) {
  const vertices = graph.faces_vertices?.[faceId] ?? [];
  if (!vertices.length) {
    return null;
  }
  const coords = vertices
    .map((vertex) => verticesCoords?.[vertex])
    .filter((point) => Array.isArray(point));
  if (!coords.length) {
    return null;
  }
  const sum = coords.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + (point[2] ?? 0)], [0, 0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length, sum[2] / coords.length];
}

function segmentVertexPoint(foldedGraph, foldedSegments, vertexIndex) {
  return foldedSegments.vertices?.[vertexIndex]?.point
    ?? foldedGraph.vertices_coords?.[vertexIndex]
    ?? null;
}

function segmentPointsKey(points) {
  const sorted = [...points].sort((first, second) =>
    first[0] - second[0] || first[1] - second[1]);
  return sorted
    .map((point) => `${point[0].toFixed(6)},${point[1].toFixed(6)}`)
    .join("|");
}

function visibleSegmentChoices(graph, foldedGraph, foldedSegments, allowedFaceIds) {
  const allowedSet = allowedFaceIds ? new Set(normalizeScopeFaceIds(allowedFaceIds)) : null;
  const folded3D = makeVerticesCoords3DFolded(graph);
  const folded3DGraph = { ...graph, vertices_coords: folded3D };
  const groups = new Map();

  (foldedSegments.edges_face ?? []).forEach((faceId, segmentIndex) => {
    if (!Number.isInteger(faceId) || faceId < 0) {
      return;
    }
    if (allowedSet && !allowedSet.has(faceId)) {
      return;
    }

    const vertexIds = foldedSegments.edges_vertices?.[segmentIndex];
    if (!Array.isArray(vertexIds) || vertexIds.length !== 2) {
      return;
    }

    const points = vertexIds.map((vertexIndex) => segmentVertexPoint(foldedGraph, foldedSegments, vertexIndex));
    if (points.some((point) => !Array.isArray(point))) {
      return;
    }

    const midpoint = [
      (points[0][0] + points[1][0]) / 2,
      (points[0][1] + points[1][1]) / 2,
    ];
    const foldedPoint3D = ear.graph.transferPointInFaceBetweenGraphs(
      foldedGraph,
      folded3DGraph,
      faceId,
      midpoint,
    );
    const z = foldedPoint3D?.[2] ?? Number.NEGATIVE_INFINITY;
    const centroid2D = faceCentroid(graph, faceId) ?? [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const key = segmentPointsKey(points);
    const candidate = {
      faceId,
      segmentIndex,
      z,
      centroid2D,
    };
    const current = groups.get(key);
    if (
      !current
      || candidate.z > current.z
      || (candidate.z === current.z
        && (candidate.centroid2D[0] < current.centroid2D[0]
          || (candidate.centroid2D[0] === current.centroid2D[0]
            && (candidate.centroid2D[1] < current.centroid2D[1]
              || (candidate.centroid2D[1] === current.centroid2D[1]
                && candidate.faceId < current.faceId)))))
    ) {
      groups.set(key, candidate);
    }
  });

  return [...groups.values()].sort((first, second) => first.segmentIndex - second.segmentIndex);
}

function chooseScopeFaces(graph, foldedGraph, foldedSegments, faceIds) {
  const normalized = normalizeScopeFaceIds(faceIds);
  if (normalized.length <= 1) {
    return normalized;
  }

  return normalizeScopeFaceIds(
    visibleSegmentChoices(graph, foldedGraph, foldedSegments, normalized)
      .map((choice) => choice.faceId),
  );
}

function replayLineInfo(graph, replaySegment) {
  const verticesCoordsFolded = replaySegment.verticesCoordsFolded ?? ear.graph.makeVerticesCoordsFolded(graph);
  const foldedGraph = { ...graph, vertices_coords: verticesCoordsFolded };
  const line = pointsToLine2(replaySegment.segment[0], replaySegment.segment[1]);
  const foldedSegments = splitLineIntoEdges(foldedGraph, line, includeS, replaySegment.segment);
  return {
    verticesCoordsFolded,
    foldedGraph,
    foldedSegments,
  };
}

export function captureCreaseScope(graph, resolver, crease) {
  if (crease.assignment === "F") {
    return [];
  }

  const segment = resolver.resolveCreaseSegment(crease);
  if (!segment) {
    return [];
  }

  const replaySegment = buildReplaySegment(graph, segment);
  const { foldedGraph, foldedSegments } = replayLineInfo(graph, replaySegment);
  return chooseScopeFaces(graph, foldedGraph, foldedSegments, foldedSegments?.edges_face);
}

function identityReplayChanges(graph) {
  return {
    edges: {
      map: graph.edges_vertices.map((_, index) => [index]),
      new: [],
      reassigned: [],
    },
    faces: {
      map: graph.faces_vertices.map((_, index) => [index]),
      new: [],
    },
  };
}

function pointAlongEdge(graph, edgeIndex, parameter) {
  const [startIndex, endIndex] = graph.edges_vertices[edgeIndex];
  const start = graph.vertices_coords[startIndex];
  const end = graph.vertices_coords[endIndex];
  return [
    start[0] + (end[0] - start[0]) * parameter,
    start[1] + (end[1] - start[1]) * parameter,
  ];
}

function ensureVertexForScopedSegment(graph, foldedGraph, foldedSegments, vertexIndex, replayState) {
  const info = foldedSegments.vertices?.[vertexIndex];
  if (!info) {
    return undefined;
  }

  if (info.vertex !== undefined) {
    return info.vertex;
  }

  if (info.edge !== undefined) {
    if (replayState.oldEdgeNewVertex[info.edge] !== undefined) {
      return replayState.oldEdgeNewVertex[info.edge];
    }
    const currentEdge = replayState.edgeMap[info.edge]?.[0];
    if (currentEdge === undefined) {
      return undefined;
    }
    const point = pointAlongEdge(graph, currentEdge, info.b);
    const result = splitEdge(graph, currentEdge, point);
    if (result?.vertex === undefined) {
      return undefined;
    }
    replayState.edgeMap = mergeNextmaps(replayState.edgeMap, result.edges?.map ?? []);
    replayState.oldEdgeNewVertex[info.edge] = result.vertex;
    return result.vertex;
  }

  if (info.face !== undefined && info.point) {
    const currentFace = replayState.faceMap[info.face]?.[0];
    if (currentFace === undefined) {
      return undefined;
    }
    const point = ear.graph.transferPointInFaceBetweenGraphs(foldedGraph, graph, currentFace, info.point);
    if (!point) {
      return undefined;
    }
    const vertex = graph.vertices_coords.length;
    graph.vertices_coords[vertex] = point;
    return vertex;
  }

  return undefined;
}

function applyScopedReplayCrease(graph, replaySegment, assignment, scopeFaceIds) {
  const { verticesCoordsFolded, foldedGraph, foldedSegments } = replayLineInfo(graph, replaySegment);
  if (!foldedSegments?.edges_vertices?.length) {
    return ear.graph.foldSegment(
      graph,
      replaySegment.segment,
      assignment,
      undefined,
      verticesCoordsFolded,
    );
  }

  const scopeSet = new Set(normalizeScopeFaceIds(scopeFaceIds));
  if (!scopeSet.size) {
    return ear.graph.foldSegment(
      graph,
      replaySegment.segment,
      assignment,
      undefined,
      verticesCoordsFolded,
    );
  }

  const facesWinding = makeFacesWinding(foldedGraph);
  const foldAngle = assignmentFlatFoldAngle[assignment] || 0;
  const oppositeAssignment = invertAssignment(assignment);
  const oppositeFoldAngle = foldAngle === 0 ? 0 : -foldAngle;
  const replayState = {
    edgeMap: graph.edges_vertices.map((_, index) => [index]),
    faceMap: graph.faces_vertices.map((_, index) => [index]),
    oldEdgeNewVertex: {},
  };
  const semanticFaceMap = graph.faces_vertices.map((_, index) => [index]);
  const newEdges = [];
  const newFaces = [];
  const visibleSegments = visibleSegmentChoices(graph, foldedGraph, foldedSegments, scopeFaceIds);
  if (!visibleSegments.length) {
    return identityReplayChanges(graph);
  }

  visibleSegments.forEach(({ faceId: originalFace, segmentIndex }) => {
    const currentFace = replayState.faceMap[originalFace]?.[0];
    if (currentFace === undefined) {
      return;
    }

    const segmentVertices = foldedSegments.edges_vertices[segmentIndex]
      .map((vertexIndex) =>
        ensureVertexForScopedSegment(graph, foldedGraph, foldedSegments, vertexIndex, replayState));
    if (segmentVertices.some((vertex) => vertex === undefined) || segmentVertices[0] === segmentVertices[1]) {
      return;
    }

    const scopedAssignment = facesWinding[originalFace] ? assignment : oppositeAssignment;
    const scopedFoldAngle = facesWinding[originalFace] ? foldAngle : oppositeFoldAngle;
    const result = splitFace(graph, currentFace, segmentVertices, scopedAssignment, scopedFoldAngle);
    if (result?.edge === undefined) {
      return;
    }

    newEdges.push(result.edge);
    if (result.faces?.new?.length) {
      newFaces.push(...result.faces.new);
    }
    if (result.faces?.map) {
      replayState.faceMap = mergeNextmaps(replayState.faceMap, result.faces.map);
    }
    semanticFaceMap[originalFace] = [...(replayState.faceMap[originalFace] ?? [])];
  });

  return {
    edges: {
      map: replayState.edgeMap,
      new: newEdges,
      reassigned: [],
    },
    faces: {
      map: semanticFaceMap,
      new: newFaces,
    },
  };
}

export function applyReplayCrease(graph, resolver, crease) {
  if (crease.assignment === "F") {
    return null;
  }

  const segment = resolver.resolveCreaseSegment(crease);
  if (!segment) {
    return null;
  }

  const replaySegment = buildReplaySegment(graph, segment);
  return applyScopedReplayCrease(graph, replaySegment, crease.assignment, crease.scopeFaceIds);
}

function normalizeCrease(crease = {}) {
  const mode = crease.mode === "axiom3" ? "axiom3" : "axiom1";
  const assignment = ["M", "V", "F"].includes(crease.assignment) ? crease.assignment : "V";
  return {
    id: crease.id || makeId("crease"),
    mode,
    startId: mode === "axiom1" ? crease.startId : undefined,
    endId: mode === "axiom1" ? crease.endId : undefined,
    lineRefs: mode === "axiom3"
      ? (crease.lineRefs ?? []).map(normalizeLineRef).filter(Boolean).slice(0, 2)
      : [],
    solutionIndex: mode === "axiom3" && Number.isInteger(crease.solutionIndex) && crease.solutionIndex >= 0
      ? crease.solutionIndex
      : 0,
    assignment,
    scopeFaceIds: normalizeScopeFaceIds(crease.scopeFaceIds),
  };
}

export function createBlankProject(name = "untitled") {
  return normalizeProject({
    name,
    settings: {
      framesPerStep: DEFAULT_FRAMES_PER_STEP,
    },
    steps: [
      {
        name: "步骤 1",
        creases: [],
      },
    ],
  });
}

export function normalizeProject(project = {}) {
  const settings = {
    framesPerStep: clampFramesPerStep(project.settings?.framesPerStep),
  };

  const steps = (project.steps ?? []).map((step, stepIndex) => ({
    id: step.id || makeId("step"),
    name: step.name?.trim() || `步骤 ${stepIndex + 1}`,
    creases: (step.creases ?? []).map(normalizeCrease),
  }));

  return {
    name: project.name?.trim() || "untitled",
    settings,
    steps: steps.length
      ? steps
      : [
          {
            id: makeId("step"),
            name: "步骤 1",
            creases: [],
          },
        ],
  };
}

export function buildSequentialTrajectory(projectInput, options = {}) {
  const project = normalizeProject(projectInput);
  const framesPerStep = clampFramesPerStep(options.framesPerStep ?? project.settings.framesPerStep);
  const resolver = createCreaseResolver(project.steps, options.getPoint);
  const graph = ear.graph.square();
  const frames = [];
  let frameIndex = 0;
  let creaseEdges = new Map();

  frames.push(captureFrame(graph.clone(), frameIndex, -1, 0, "start"));
  frameIndex += 1;

  project.steps.forEach((step, stepIndex) => {
    const stepCreaseIds = [];

    step.creases.forEach((crease) => {
      crease.scopeFaceIds = captureCreaseScope(graph, resolver, crease);
      const changes = applyReplayCrease(graph, resolver, crease);

      creaseEdges = remapCreaseEdges(creaseEdges, changes?.edges?.map);
      const newEdges = new Set([
        ...(changes?.edges?.new ?? []),
        ...(changes?.edges?.reassigned ?? []),
      ]);

      if (!newEdges.size) {
        return;
      }

      creaseEdges.set(crease.id, newEdges);
      stepCreaseIds.push(crease.id);
    });

    const activeEdges = collectEdgesForCreases(creaseEdges, stepCreaseIds);
    const fullAngles = ear.graph.makeEdgesFoldAngle(graph);

    for (let localFrame = 0; localFrame < framesPerStep; localFrame += 1) {
      const alpha = framesPerStep === 1 ? 1 : localFrame / (framesPerStep - 1);
      const frameGraph = graph.clone();
      frameGraph.edges_foldAngle = fullAngles.map((angle, edgeIndex) =>
        activeEdges.has(edgeIndex) ? angle * alpha : angle,
      );

      frames.push(captureFrame(frameGraph, frameIndex, stepIndex, localFrame, step.name));
      frameIndex += 1;
    }
  });

  return {
    format_version: 3,
    generator: "Rabbit Ear forward sequential",
    project_name: project.name,
    metadata: {
      step_count: project.steps.length,
      frame_count: frames.length,
      frames_per_step: framesPerStep,
      dynamic_topology: true,
    },
    frames,
  };
}
