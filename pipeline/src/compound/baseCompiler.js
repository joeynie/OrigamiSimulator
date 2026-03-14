import { resolve } from "path";
import { deepClone, ensureCreaseIds, makeStepId } from "../lib/utils.js";
import { loadFoldFromAsset } from "./assetFold.js";

const FOLDABLE_ASSIGNMENTS = new Set(["M", "m", "V", "v"]);
const DEFAULT_ANCHORS = {
  tl: [0, 0],
  tr: [1, 0],
  br: [1, 1],
  bl: [0, 1],
  left_inner: [3 / 14, 0.5],
  right_inner: [11 / 14, 0.5],
  top_inner: [0.5, 3 / 14],
  bottom_inner: [0.5, 11 / 14],
};

function buildTemplateLookup(templates) {
  const lookup = new Map();
  for (const template of templates) {
    lookup.set(template.id, template);
    for (const alias of template.aliases ?? []) {
      lookup.set(alias, template);
    }
  }
  return lookup;
}

function getBounds(vertices) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of vertices) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function normalizePoint(point, bounds) {
  const width = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const height = Math.max(bounds.maxY - bounds.minY, 1e-6);
  return [
    (point[0] - bounds.minX) / width,
    (point[1] - bounds.minY) / height,
  ];
}

function makeEdgeSummaries(fold) {
  const bounds = getBounds(fold.vertices_coords);
  const summaries = [];
  for (let edgeIndex = 0; edgeIndex < fold.edges_vertices.length; edgeIndex += 1) {
    const assignment = fold.edges_assignment?.[edgeIndex];
    if (!FOLDABLE_ASSIGNMENTS.has(assignment)) continue;
    const creaseId = fold.edges_crease_id?.[edgeIndex];
    if (!creaseId) continue;
    const [aIndex, bIndex] = fold.edges_vertices[edgeIndex];
    const p0 = normalizePoint(fold.vertices_coords[aIndex], bounds);
    const p1 = normalizePoint(fold.vertices_coords[bIndex], bounds);
    const midpoint = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    summaries.push({
      edgeIndex,
      creaseId,
      assignment,
      p0,
      p1,
      midpoint,
    });
  }
  return summaries;
}

function approximately(value, target, epsilon = 0.03) {
  return Math.abs(value - target) <= epsilon;
}

function pointNear(point, target, epsilon = 0.04) {
  return approximately(point[0], target[0], epsilon) && approximately(point[1], target[1], epsilon);
}

function segmentMatchesAnchors(summary, anchorA, anchorB, epsilon = 0.05) {
  return (
    (pointNear(summary.p0, anchorA, epsilon) && pointNear(summary.p1, anchorB, epsilon)) ||
    (pointNear(summary.p0, anchorB, epsilon) && pointNear(summary.p1, anchorA, epsilon))
  );
}

function collectIds(items) {
  return [...new Set(items.flat().filter(Boolean))];
}

function selectCreaseIds(summaries, predicate) {
  return summaries.filter(predicate).map((summary) => summary.creaseId);
}

function buildLogicalGroups(fold) {
  const summaries = makeEdgeSummaries(fold);
  const anchors = DEFAULT_ANCHORS;

  const groups = {
    cross_vertical: selectCreaseIds(
      summaries,
      (edge) => approximately(edge.p0[0], 0.5) && approximately(edge.p1[0], 0.5),
    ),
    cross_horizontal: selectCreaseIds(
      summaries,
      (edge) => approximately(edge.p0[1], 0.5) && approximately(edge.p1[1], 0.5),
    ),
    diag_main: selectCreaseIds(
      summaries,
      (edge) => approximately(edge.p0[0] - edge.p0[1], 0) && approximately(edge.p1[0] - edge.p1[1], 0),
    ),
    diag_anti: selectCreaseIds(
      summaries,
      (edge) => approximately(edge.p0[0] + edge.p0[1], 1) && approximately(edge.p1[0] + edge.p1[1], 1),
    ),
    top_stub: selectCreaseIds(
      summaries,
      (edge) =>
        approximately(edge.p0[0], 0.5) &&
        approximately(edge.p1[0], 0.5) &&
        edge.midpoint[1] < 0.2,
    ),
    bottom_stub: selectCreaseIds(
      summaries,
      (edge) =>
        approximately(edge.p0[0], 0.5) &&
        approximately(edge.p1[0], 0.5) &&
        edge.midpoint[1] > 0.8,
    ),
    left_stub: selectCreaseIds(
      summaries,
      (edge) =>
        approximately(edge.p0[1], 0.5) &&
        approximately(edge.p1[1], 0.5) &&
        edge.midpoint[0] < 0.2,
    ),
    right_stub: selectCreaseIds(
      summaries,
      (edge) =>
        approximately(edge.p0[1], 0.5) &&
        approximately(edge.p1[1], 0.5) &&
        edge.midpoint[0] > 0.8,
    ),
    center_vertical: selectCreaseIds(
      summaries,
      (edge) =>
        approximately(edge.p0[0], 0.5) &&
        approximately(edge.p1[0], 0.5) &&
        edge.midpoint[1] >= 0.2 &&
        edge.midpoint[1] <= 0.8,
    ),
    center_horizontal: selectCreaseIds(
      summaries,
      (edge) =>
        approximately(edge.p0[1], 0.5) &&
        approximately(edge.p1[1], 0.5) &&
        edge.midpoint[0] >= 0.2 &&
        edge.midpoint[0] <= 0.8,
    ),
    wedge_tl_top: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.tl, anchors.top_inner),
    ),
    wedge_tr_top: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.tr, anchors.top_inner),
    ),
    wedge_tr_right: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.tr, anchors.right_inner),
    ),
    wedge_br_right: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.br, anchors.right_inner),
    ),
    wedge_br_bottom: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.br, anchors.bottom_inner),
    ),
    wedge_bl_bottom: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.bl, anchors.bottom_inner),
    ),
    wedge_bl_left: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.bl, anchors.left_inner),
    ),
    wedge_tl_left: selectCreaseIds(
      summaries,
      (edge) => segmentMatchesAnchors(edge, anchors.tl, anchors.left_inner),
    ),
    left_half: selectCreaseIds(
      summaries,
      (edge) => edge.midpoint[0] < 0.5,
    ),
    right_half: selectCreaseIds(
      summaries,
      (edge) => edge.midpoint[0] > 0.5,
    ),
    top_half: selectCreaseIds(
      summaries,
      (edge) => edge.midpoint[1] < 0.5,
    ),
    bottom_half: selectCreaseIds(
      summaries,
      (edge) => edge.midpoint[1] > 0.5,
    ),
    center_star: selectCreaseIds(
      summaries,
      (edge) =>
        Math.abs(edge.midpoint[0] - 0.5) < 0.22 &&
        Math.abs(edge.midpoint[1] - 0.5) < 0.22,
    ),
    all_foldable: summaries.map((summary) => summary.creaseId),
  };

  groups.cross = collectIds([groups.cross_vertical, groups.cross_horizontal]);
  groups.diagonals = collectIds([groups.diag_main, groups.diag_anti]);
  groups.preliminary_bundle = collectIds([groups.cross, groups.diagonals]);
  groups.waterbomb_bundle = groups.preliminary_bundle;
  groups.kite_front = collectIds([groups.wedge_tl_top, groups.wedge_tr_top]);
  groups.petal_front = collectIds([groups.wedge_tl_left, groups.wedge_tr_right]);
  groups.kite_back = collectIds([groups.wedge_bl_bottom, groups.wedge_br_bottom]);
  groups.petal_back = collectIds([groups.wedge_bl_left, groups.wedge_br_right]);
  groups.frog_split = collectIds([groups.diagonals, groups.cross, groups.center_star]);
  groups.frog_left = collectIds([groups.left_half, groups.center_star]);
  groups.frog_right = collectIds([groups.right_half, groups.center_star]);
  groups.pinwheel_bundle = collectIds([groups.diagonals, groups.center_star, groups.all_foldable]);

  return groups;
}

function withOverrides(step, actionOverrides = {}) {
  return Object.keys(actionOverrides).length > 0
    ? { ...step, actionOverrides }
    : step;
}

function fallbackCreaseIdsForStep(step, logicalGroups) {
  const op = (step.op || "").toLowerCase();
  const side = (step.side || "").toLowerCase();

  if (side === "left") return { creaseIds: logicalGroups.left_half, groupNames: ["left_half"] };
  if (side === "right") return { creaseIds: logicalGroups.right_half, groupNames: ["right_half"] };
  if (side === "top" || side === "front") return { creaseIds: logicalGroups.top_half, groupNames: ["top_half"] };
  if (side === "bottom" || side === "back") return { creaseIds: logicalGroups.bottom_half, groupNames: ["bottom_half"] };

  if (op.includes("collapse")) {
    return { creaseIds: logicalGroups.all_foldable, groupNames: ["all_foldable"] };
  }
  if (op.includes("split")) {
    return { creaseIds: logicalGroups.frog_split, groupNames: ["center_guides"] };
  }
  if (op.includes("squash")) {
    return { creaseIds: logicalGroups.center_star, groupNames: ["center_star"] };
  }
  if (op.includes("pinwheel") || op.includes("windmill")) {
    return { creaseIds: logicalGroups.pinwheel_bundle, groupNames: ["pinwheel_bundle"] };
  }
  return { creaseIds: logicalGroups.all_foldable, groupNames: ["all_foldable"] };
}

function materializeSemanticStep(step, logicalGroups, context, absoluteIndex) {
  const scheduleOverrides = {};
  let creaseIds = [];
  let groupNames = [];

  switch (step.op) {
    case "precrease_cross":
      creaseIds = logicalGroups.cross;
      groupNames = ["cross"];
      scheduleOverrides.num_frames = 6;
      break;
    case "precrease_diagonals":
      creaseIds = logicalGroups.diagonals;
      groupNames = ["diagonals"];
      scheduleOverrides.num_frames = 6;
      break;
    case "collapse_preliminary":
      creaseIds = logicalGroups.preliminary_bundle;
      groupNames = ["preliminary_bundle"];
      scheduleOverrides.num_frames = 8;
      break;
    case "collapse_waterbomb":
      creaseIds = logicalGroups.waterbomb_bundle;
      groupNames = ["waterbomb_bundle"];
      scheduleOverrides.num_frames = 8;
      break;
    case "kite_fold":
      if (step.side === "front") {
        creaseIds = logicalGroups.kite_front;
        groupNames = ["kite_front"];
      } else if (step.side === "back") {
        creaseIds = logicalGroups.kite_back;
        groupNames = ["kite_back"];
      }
      break;
    case "petal_fold":
      if (step.side === "front") {
        creaseIds = logicalGroups.petal_front;
        groupNames = ["petal_front"];
      } else if (step.side === "back") {
        creaseIds = logicalGroups.petal_back;
        groupNames = ["petal_back"];
      }
      scheduleOverrides.num_frames = 8;
      break;
    default:
      ({ creaseIds, groupNames } = fallbackCreaseIdsForStep(step, logicalGroups));
      if (step.op && step.op.toLowerCase().includes("collapse")) {
        scheduleOverrides.num_frames = 8;
      }
      break;
  }

  if (!creaseIds.length) {
    throw new Error(`No crease groups resolved for ${context.template.id}:${step.op}`);
  }

  return withOverrides({
    step_id: makeStepId(step.op, absoluteIndex),
    op: step.op,
    side: step.side,
    crease_ids: [...new Set(creaseIds)],
    semantic_source: context.template.id,
    group_names: groupNames,
    template_path: context.path,
  }, scheduleOverrides);
}

function expandTemplateSteps(template, templateLookup, logicalGroups, stack = [], steps = []) {
  const nextStack = stack.concat(template.id);
  for (const step of template.recipe ?? []) {
    const nestedTemplate = templateLookup.get(step.op);
    if (nestedTemplate) {
      if (nextStack.includes(nestedTemplate.id)) {
        throw new Error(`Template recursion detected: ${nextStack.concat(nestedTemplate.id).join(" -> ")}`);
      }
      expandTemplateSteps(nestedTemplate, templateLookup, logicalGroups, nextStack, steps);
      continue;
    }
    const materialized = materializeSemanticStep(
      step,
      logicalGroups,
      { template, path: nextStack },
      steps.length,
    );
    if (!materialized) {
      throw new Error(`Unsupported semantic op in compound template: ${step.op}`);
    }
    steps.push(materialized);
  }
  return steps;
}

export function compileCompoundTemplateSample(templates, templateId, config, sampleId) {
  const templateLookup = buildTemplateLookup(templates);
  const template = templateLookup.get(templateId);
  if (!template) {
    throw new Error(`Unknown compound template: ${templateId}`);
  }
  if (!template.assetSvg) {
    return {
      sampleId,
      complete: false,
      reason: `template_has_no_asset:${template.id}`,
    };
  }

  const assetPath = resolve(process.cwd(), "..", template.assetSvg);
  const { fold, absolutePath } = loadFoldFromAsset(assetPath);
  const sampleFold = deepClone(fold);
  sampleFold.file_title = `${template.id}_${String(sampleId).padStart(3, "0")}`;
  sampleFold.frame_title = sampleFold.file_title;
  sampleFold.file_creator = "OrigamiSimulator/pipeline compound compiler";
  sampleFold.file_author = "Codex";
  sampleFold.file_classes = ["singleModel", "generated", "compoundTemplate"];
  const nextCreaseId = ensureCreaseIds(sampleFold, 0);

  const logicalGroups = buildLogicalGroups(sampleFold);
  const expandedRecipe = expandTemplateSteps(template, templateLookup, logicalGroups);

  return {
    sampleId,
    fold: sampleFold,
    recipe: expandedRecipe,
    semanticRecipe: template.recipe ?? [],
    templateId: template.id,
    templateStatus: template.status,
    sourceAsset: absolutePath,
    nextCreaseId,
    targetSteps: expandedRecipe.length,
    attempts: 1,
    complete: expandedRecipe.length > 0,
  };
}
