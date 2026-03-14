import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { normalizeSvgProject, stepEdgeSet } from "../editor/svg_step_pipeline.js";

function parseArgs(argv) {
  const options = {
    project: "",
    json: false,
    strict: false,
    failOnEmptyGroup: false,
    failOnDuplicateEdge: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--project" || token === "-p") {
      options.project = argv[i + 1] ?? "";
      i += 1;
    } else if (token === "--json") {
      options.json = true;
    } else if (token === "--strict") {
      options.strict = true;
      options.failOnEmptyGroup = true;
      options.failOnDuplicateEdge = true;
    } else if (token === "--fail-on-empty-group") {
      options.failOnEmptyGroup = true;
    } else if (token === "--fail-on-duplicate-edge") {
      options.failOnDuplicateEdge = true;
    } else if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${token}`);
    }
  }

  if (!options.project) {
    throw new Error("Missing required --project <path>");
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node pipeline/scripts/validate_svg_sequence.js --project <svg_project.json> [options]\n\nOptions:\n  -p, --project <path>            SVG sequence project JSON\n      --json                      Print JSON report\n      --strict                    Enable all failure checks\n      --fail-on-empty-group       Fail when a creaseGroup maps to zero edges\n      --fail-on-duplicate-edge    Fail when one edge belongs to multiple creaseGroups\n  -h, --help                      Show help\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function uniqueInts(values = []) {
  return Array.from(new Set(values.filter((value) => Number.isInteger(value) && value >= 0))).sort((a, b) => a - b);
}

function validateProject(projectInput, options) {
  const project = normalizeSvgProject(projectInput);
  const groups = project.creaseGroups ?? [];
  const steps = project.steps ?? [];
  const foldEdges = project.fold?.edges_vertices?.length ?? 0;

  const creaseIdSet = new Set(groups.map((group) => group.id));
  const edgeOwners = new Map();
  const groupIssues = [];
  const edgeConflicts = [];

  groups.forEach((group) => {
    const edges = uniqueInts(group.edgeIndices);
    if (!edges.length) {
      groupIssues.push({
        type: "empty_edge_indices",
        creaseId: group.id,
        label: group.label,
      });
    }

    edges.forEach((edgeIndex) => {
      if (edgeIndex >= foldEdges) {
        groupIssues.push({
          type: "edge_out_of_range",
          creaseId: group.id,
          edgeIndex,
          foldEdgeCount: foldEdges,
        });
        return;
      }
      if (!edgeOwners.has(edgeIndex)) {
        edgeOwners.set(edgeIndex, []);
      }
      edgeOwners.get(edgeIndex).push(group.id);
    });
  });

  edgeOwners.forEach((owners, edgeIndex) => {
    if (owners.length > 1) {
      edgeConflicts.push({
        edgeIndex,
        creaseIds: owners,
      });
    }
  });

  const stepReports = steps.map((step, stepIndex) => {
    const unknownCreaseIds = (step.creaseIds ?? []).filter((creaseId) => !creaseIdSet.has(creaseId));
    const resolvedCreaseIds = (step.creaseIds ?? []).filter((creaseId) => creaseIdSet.has(creaseId));
    const edgeAngles = stepEdgeSet(project, stepIndex, 1);
    const activeEdges = Array.from(edgeAngles.keys()).sort((a, b) => a - b);

    return {
      stepIndex,
      stepName: step.name,
      creaseCount: resolvedCreaseIds.length,
      creaseIds: resolvedCreaseIds,
      unknownCreaseIds,
      activeEdgeCount: activeEdges.length,
      activeEdges,
    };
  });

  const summary = {
    project: project.name,
    hasFold: Boolean(project.fold),
    foldEdgeCount: foldEdges,
    creaseGroupCount: groups.length,
    stepCount: steps.length,
    emptyGroupCount: groupIssues.filter((issue) => issue.type === "empty_edge_indices").length,
    conflictEdgeCount: edgeConflicts.length,
    unknownStepCreaseRefCount: stepReports.reduce((count, step) => count + step.unknownCreaseIds.length, 0),
  };

  const failures = [];
  if (!project.fold) {
    failures.push({ type: "missing_fold", message: "project.fold is empty" });
  }
  if (options.failOnEmptyGroup && summary.emptyGroupCount > 0) {
    failures.push({
      type: "empty_group",
      message: "some creaseGroups map to zero edges",
      count: summary.emptyGroupCount,
    });
  }
  if (options.failOnDuplicateEdge && summary.conflictEdgeCount > 0) {
    failures.push({
      type: "duplicate_edge_owner",
      message: "some edges are assigned to multiple creaseGroups",
      count: summary.conflictEdgeCount,
    });
  }
  if (summary.unknownStepCreaseRefCount > 0) {
    failures.push({
      type: "unknown_crease_reference",
      message: "some step.creaseIds reference missing creaseGroups",
      count: summary.unknownStepCreaseRefCount,
    });
  }

  return {
    summary,
    failures,
    groupIssues,
    edgeConflicts,
    steps: stepReports,
  };
}

function printReport(report) {
  console.log(`project: ${report.summary.project}`);
  console.log(`fold edges: ${report.summary.foldEdgeCount}`);
  console.log(`crease groups: ${report.summary.creaseGroupCount}, steps: ${report.summary.stepCount}`);
  console.log(`empty groups: ${report.summary.emptyGroupCount}, edge conflicts: ${report.summary.conflictEdgeCount}, unknown refs: ${report.summary.unknownStepCreaseRefCount}`);

  if (report.failures.length) {
    console.log("\nfailures:");
    report.failures.forEach((failure) => {
      console.log(`  - ${failure.type}: ${failure.message}`);
    });
  }

  if (report.groupIssues.length) {
    console.log("\ngroup issues:");
    report.groupIssues.forEach((issue) => {
      if (issue.type === "empty_edge_indices") {
        console.log(`  - ${issue.type}: ${issue.creaseId} (${issue.label ?? ""})`);
      } else {
        console.log(`  - ${issue.type}: ${issue.creaseId} edge=${issue.edgeIndex}`);
      }
    });
  }

  if (report.edgeConflicts.length) {
    console.log("\nedge conflicts:");
    report.edgeConflicts.forEach((conflict) => {
      console.log(`  - edge ${conflict.edgeIndex}: ${conflict.creaseIds.join(", ")}`);
    });
  }

  console.log("\nsteps:");
  report.steps.forEach((step) => {
    console.log(`  [${step.stepIndex}] ${step.stepName} creases=${step.creaseCount} activeEdges=${step.activeEdgeCount}`);
    if (step.unknownCreaseIds.length) {
      console.log(`    unknown crease ids: ${step.unknownCreaseIds.join(", ")}`);
    }
  });
}

function main() {
  try {
    const options = parseArgs(process.argv);
    const projectPath = path.resolve(process.cwd(), options.project);
    const project = readJson(projectPath);
    const report = validateProject(project, options);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printReport(report);
    }

    process.exit(report.failures.length ? 1 : 0);
  } catch (error) {
    console.error(`validate_svg_sequence failed: ${error?.message || error}`);
    process.exit(2);
  }
}

main();
