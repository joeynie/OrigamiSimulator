import { countActiveCreases } from "../lib/utils.js";

export function validateGeneratedState(previousState, nextState, targetSteps) {
  if (!nextState.accepted) {
    return { valid: false, reason: nextState.reason };
  }
  if (countActiveCreases(nextState.fold) <= countActiveCreases(previousState.fold)) {
    return { valid: false, reason: "crease_count_did_not_increase" };
  }
  if (nextState.primitive.crease_ids.length === 0) {
    return { valid: false, reason: "primitive_created_no_addressable_creases" };
  }
  if (previousState.recipe.length >= targetSteps) {
    return { valid: false, reason: "step_budget_exhausted" };
  }
  return { valid: true };
}
