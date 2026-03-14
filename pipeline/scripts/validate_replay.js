import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ear from "../node_modules/rabbit-ear/module/index.js";
import xmldom from "../node_modules/@xmldom/xmldom/lib/index.js";
import { createCreaseResolver } from "../editor/geometry.js";
import { applyReplayCrease, captureCreaseScope, normalizeProject } from "../editor/trajectory.js";
import {
  buildStepGraph,
  buildSvgStepTrajectory,
  createBlankSvgProject,
  mergeSvgProjectWithAsset,
  parseSvgAsset,
} from "../editor/svg_step_pipeline.js";

const GRID_VALUES = [0, 25, 50, 75, 100];
const COLUMN_LABELS = ["A", "B", "C", "D", "E"];
const ROW_LABELS = ["1", "2", "3", "4", "5"];

function parseArgs(argv) {
  const options = {
    project: "",
    expect: "",
    report: "",
    strictScope: true,
    json: false,
    svg: "",
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--project" || token === "-p") {
      options.project = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--expect" || token === "-e") {
      options.expect = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--report" || token === "-r") {
      options.report = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--svg") {
      options.svg = argv[index + 1] ?? "";
      index += 1;
    } else if (token === "--no-strict-scope") {
      options.strictScope = false;
    } else if (token === "--strict-scope") {
      options.strictScope = true;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${token}`);
    }
  }

  if (!options.project && !options.svg) {
    throw new Error("Missing required --project <path>");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node pipeline/scripts/validate_replay.js --project <project.json> [options]\n       node pipeline/scripts/validate_replay.js --svg <asset.svg> [options]\n\nOptions:\n  -p, --project <path>      Project json exported by editor\n      --svg <path>          SVG asset validation mode\n  -e, --expect <path>       Optional expectation json\n  -r, --report <path>       Optional output report json\n      --strict-scope        Fail when changed source faces are outside captured scope (default)\n      --no-strict-scope     Disable strict scope assertion\n      --json                Print machine-readable JSON summary\n  -h, --help                Show this help\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function createGridPoints() {
  const points = [];
  GRID_VALUES.forEach((y, row) => {
    GRID_VALUES.forEach((x, column) => {
      points.push({ id: `${COLUMN_LABELS[column]}${ROW_LABELS[row]}`, x, y });
    });
  });
  return points;
}

const GRID_POINTS = createGridPoints();

function parseDynamicPoint(pointId) {
  if (!pointId || !pointId.startsWith("P:")) {
    return null;
  }
  const [x, y] = pointId.slice(2).split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { id: pointId, x, y, isDynamic: true };
}

function getPoint(pointId) {
  return GRID_POINTS.find((point) => point.id === pointId) ?? parseDynamicPoint(pointId);
}

function normalizeFaceIds(value) {
  return Array.from(new Set((value ?? [])
    .filter((faceId) => Number.isInteger(faceId) && faceId >= 0)))
    .sort((a, b) => a - b);
}

function sameIntArray(first, second) {
  if (first.length !== second.length) {
    return false;
  }
  for (let index = 0; index < first.length; index += 1) {
    if (first[index] !== second[index]) {
      return false;
    }
  }
  return true;
}

function toSet(values) {
  return new Set(values);
}

function isSubsetOf(subsetValues, fullValues) {
  const fullSet = toSet(fullValues);
  return subsetValues.every((value) => fullSet.has(value));
}

function inferChangedSourceFaces(faceMap = []) {
  const changed = [];
  faceMap.forEach((nextFaces, sourceFace) => {
    const faces = normalizeFaceIds(nextFaces);
    if (faces.length !== 1 || faces[0] !== sourceFace) {
      changed.push(sourceFace);
    }
  });
  return changed;
}

function inferTouchedFacesFromEdges(graph, edgeIndices = []) {
  const touched = new Set();
  edgeIndices.forEach((edgeIndex) => {
    const faces = graph.edges_faces?.[edgeIndex] ?? [];
    faces.forEach((faceId) => {
      if (Number.isInteger(faceId) && faceId >= 0) {
        touched.add(faceId);
      }
    });
  });
  return Array.from(touched).sort((a, b) => a - b);
}

function normalizeExpectation(expectationInput) {
  const source = expectationInput ?? {};
  const creases = source.creases ?? {};
  const normalized = {};

  Object.keys(creases).forEach((creaseId) => {
    const expectCrease = creases[creaseId] ?? {};
    normalized[creaseId] = {
      scopeFaceIds: expectCrease.scopeFaceIds ? normalizeFaceIds(expectCrease.scopeFaceIds) : undefined,
      changedSourceFaces: expectCrease.changedSourceFaces
        ? normalizeFaceIds(expectCrease.changedSourceFaces)
        : undefined,
      maxChangedSourceFaces: Number.isInteger(expectCrease.maxChangedSourceFaces)
        ? expectCrease.maxChangedSourceFaces
        : undefined,
      minChangedSourceFaces: Number.isInteger(expectCrease.minChangedSourceFaces)
        ? expectCrease.minChangedSourceFaces
        : undefined,
    };
  });

  return {
    strictScope: source.strictScope,
    creases: normalized,
  };
}

function validateProject(projectInput, expectationInput, options) {
  const project = normalizeProject(projectInput);
  const expectation = normalizeExpectation(expectationInput);
  const strictScope = expectation.strictScope ?? options.strictScope;
  const resolver = createCreaseResolver(project.steps, getPoint);
  const graph = ear.graph.square();

  const report = {
    project: project.name,
    strictScope,
    summary: {
      steps: project.steps.length,
      creases: 0,
      failed: 0,
    },
    steps: [],
  };

  project.steps.forEach((step, stepIndex) => {
    const stepReport = {
      stepIndex,
      stepName: step.name,
      creases: [],
    };

    step.creases.forEach((crease, creaseIndex) => {
      report.summary.creases += 1;

      const scopeFaceIds = captureCreaseScope(graph, resolver, crease);
      const changes = applyReplayCrease(graph, resolver, { ...crease, scopeFaceIds });
      const changedSourceFaces = inferChangedSourceFaces(changes?.faces?.map ?? []);
      const newEdges = [
        ...(changes?.edges?.new ?? []),
        ...(changes?.edges?.reassigned ?? []),
      ];
      const touchedResultFaces = inferTouchedFacesFromEdges(graph, newEdges);

      const expectationForCrease = expectation.creases[crease.id] ?? {};
      const failures = [];

      if (strictScope && !isSubsetOf(changedSourceFaces, scopeFaceIds)) {
        failures.push({
          type: "strict_scope",
          message: "changed source faces exceed captured scope",
          expectedSubsetOf: scopeFaceIds,
          actual: changedSourceFaces,
        });
      }

      if (expectationForCrease.scopeFaceIds && !sameIntArray(scopeFaceIds, expectationForCrease.scopeFaceIds)) {
        failures.push({
          type: "expect_scope",
          message: "captured scopeFaceIds mismatch",
          expected: expectationForCrease.scopeFaceIds,
          actual: scopeFaceIds,
        });
      }

      if (expectationForCrease.changedSourceFaces
        && !sameIntArray(changedSourceFaces, expectationForCrease.changedSourceFaces)) {
        failures.push({
          type: "expect_changed_faces",
          message: "changed source faces mismatch",
          expected: expectationForCrease.changedSourceFaces,
          actual: changedSourceFaces,
        });
      }

      if (expectationForCrease.maxChangedSourceFaces !== undefined
        && changedSourceFaces.length > expectationForCrease.maxChangedSourceFaces) {
        failures.push({
          type: "expect_max_changed_faces",
          message: "changed source faces count is too large",
          expectedMax: expectationForCrease.maxChangedSourceFaces,
          actualCount: changedSourceFaces.length,
          actual: changedSourceFaces,
        });
      }

      if (expectationForCrease.minChangedSourceFaces !== undefined
        && changedSourceFaces.length < expectationForCrease.minChangedSourceFaces) {
        failures.push({
          type: "expect_min_changed_faces",
          message: "changed source faces count is too small",
          expectedMin: expectationForCrease.minChangedSourceFaces,
          actualCount: changedSourceFaces.length,
          actual: changedSourceFaces,
        });
      }

      if (failures.length) {
        report.summary.failed += 1;
      }

      stepReport.creases.push({
        creaseIndex,
        creaseId: crease.id,
        mode: crease.mode,
        assignment: crease.assignment,
        scopeFaceIds,
        changedSourceFaces,
        touchedResultFaces,
        newEdgeCount: newEdges.length,
        failures,
      });
    });

    report.steps.push(stepReport);
  });

  return report;
}

function printTextReport(report) {
  console.log(`project: ${report.project}`);
  console.log(`strictScope: ${report.strictScope}`);
  console.log(`steps: ${report.summary.steps}, creases: ${report.summary.creases}, failed: ${report.summary.failed}`);

  report.steps.forEach((step) => {
    console.log(`\n[step ${step.stepIndex}] ${step.stepName}`);
    step.creases.forEach((crease) => {
      const status = crease.failures.length ? "FAIL" : "OK";
      console.log(
        `  ${status} crease ${crease.creaseIndex} (${crease.creaseId}) `
        + `${crease.mode}/${crease.assignment} scope=${JSON.stringify(crease.scopeFaceIds)} `
        + `changed=${JSON.stringify(crease.changedSourceFaces)} `
        + `touched=${JSON.stringify(crease.touchedResultFaces)} edges=${crease.newEdgeCount}`,
      );
      crease.failures.forEach((failure) => {
        console.log(`    - ${failure.type}: ${failure.message}`);
      });
    });
  });
}

function sanitizeRenderableGraph(graphInput) {
  const vertexMap = new Map();
  const vertices = [];
  const mapVertex = (vertexIndex) => {
    if (vertexMap.has(vertexIndex)) {
      return vertexMap.get(vertexIndex);
    }
    const point = graphInput.vertices_coords?.[vertexIndex];
    if (!Array.isArray(point)) {
      return undefined;
    }
    const nextIndex = vertices.length;
    vertexMap.set(vertexIndex, nextIndex);
    vertices.push(point);
    return nextIndex;
  };

  const edges_vertices = [];
  const edges_assignment = [];
  const edges_foldAngle = [];
  (graphInput.edges_vertices ?? []).forEach((edgeVertices, edgeIndex) => {
    if (!Array.isArray(edgeVertices) || edgeVertices.length !== 2) {
      return;
    }
    const mapped = edgeVertices.map(mapVertex);
    if (mapped.some((value) => value === undefined)) {
      return;
    }
    edges_vertices.push(mapped);
    edges_assignment.push(graphInput.edges_assignment?.[edgeIndex] ?? "U");
    edges_foldAngle.push(graphInput.edges_foldAngle?.[edgeIndex] ?? 0);
  });

  const faces_vertices = (graphInput.faces_vertices ?? [])
    .map((face) => face?.map(mapVertex))
    .filter((face) => Array.isArray(face) && face.length >= 3 && face.every((value) => value !== undefined));

  return ear.graph({
    ...structuredClone(graphInput),
    vertices_coords: vertices,
    edges_vertices,
    edges_assignment,
    edges_foldAngle,
    faces_vertices,
  });
}

function validateSvgAsset(svgPath) {
  ear.window = xmldom;
  const svgText = fs.readFileSync(svgPath, "utf-8");
  const documentNode = new xmldom.DOMParser().parseFromString(svgText, "image/svg+xml");
  const asset = parseSvgAsset(documentNode.documentElement, {
    name: path.basename(svgPath),
    path: svgPath,
  });
  const project = mergeSvgProjectWithAsset(createBlankSvgProject(path.basename(svgPath, ".svg")), asset);
  const graph = buildStepGraph(project, 0, 1);
  const folded = graph.clone().flatFolded();
  const renderable = sanitizeRenderableGraph(folded);
  const svg = ear.svg();
  svg.origami(renderable, {
    viewBox: true,
    strokeWidth: 0.012,
    radius: 0.014,
    padding: 0.08,
  });
  const trajectory = buildSvgStepTrajectory(project, { framesPerStep: 4 });
  return {
    svg: path.basename(svgPath),
    creaseGroups: asset.creaseGroups.length,
    faces: asset.fold.faces_vertices?.length ?? 0,
    edges: asset.fold.edges_vertices?.length ?? 0,
    previewSvgLength: (svg.toString?.() ?? "").length,
    trajectoryFrames: trajectory.frames.length,
  };
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.svg) {
      const svgPath = path.resolve(process.cwd(), options.svg);
      const report = validateSvgAsset(svgPath);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(`svg: ${report.svg}`);
        console.log(`creaseGroups: ${report.creaseGroups}, faces: ${report.faces}, edges: ${report.edges}`);
        console.log(`previewSvgLength: ${report.previewSvgLength}, trajectoryFrames: ${report.trajectoryFrames}`);
      }
      process.exit(0);
    }

    const projectPath = path.resolve(process.cwd(), options.project);
    const expectationPath = options.expect ? path.resolve(process.cwd(), options.expect) : "";
    const reportPath = options.report ? path.resolve(process.cwd(), options.report) : "";

    const project = readJson(projectPath);
    const expectation = expectationPath ? readJson(expectationPath) : {};

    const report = validateProject(project, expectation, options);
    if (reportPath) {
      writeJson(reportPath, report);
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printTextReport(report);
    }

    process.exit(report.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(`validate_replay failed: ${error?.message || error}`);
    process.exit(2);
  }
}

main();
