import { makeStepId } from "../lib/utils.js";

export function compileRecipeToActions(recipe, config) {
  return recipe.map((step, index) => ({
    step_id: makeStepId(step.op, index),
    op: step.op,
    crease_ids: step.crease_ids,
    edge_indices: step.edge_indices,
    end_actuation: 1,
    ...config.defaultAction,
    ...(step.actionOverrides || {}),
    meta: {
      primitive: step,
    },
  }));
}
