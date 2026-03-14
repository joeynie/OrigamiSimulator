import ear from "rabbit-ear";
import { applyLineFoldPrimitive } from "../primitives/lineFold.js";
import { buildPrimitiveCatalog, buildPrimitiveWeights } from "../primitives/library.js";
import { weightedChoice, ensureCreaseIds } from "../lib/utils.js";
import { validateGeneratedState } from "../validators/basic.js";

function createInitialState(sampleId) {
  const fold = ear.graph.square();
  fold.file_title = `procedural_sample_${sampleId}`;
  fold.frame_title = `procedural_sample_${sampleId}`;
  fold.file_creator = "OrigamiSimulator/pipeline/src";
  fold.file_author = "Codex";
  fold.file_classes = ["singleModel", "generated"];
  const nextCreaseId = ensureCreaseIds(fold, 0);
  return {
    sampleId,
    fold,
    recipe: [],
    nextCreaseId,
  };
}

export function sampleRecipe(config, sampleId, rng = Math.random) {
  const targetSteps = config.stepBins[Math.floor(rng() * config.stepBins.length)];
  const primitiveCatalog = buildPrimitiveCatalog();
  const weightedCatalog = buildPrimitiveWeights(config, primitiveCatalog);

  let state = createInitialState(sampleId);
  let attempts = 0;

  while (state.recipe.length < targetSteps && attempts < config.maxAttemptsPerSample) {
    attempts += 1;
    const primitive = weightedChoice(weightedCatalog, rng);
    if (!primitive) break;

    const candidate = applyLineFoldPrimitive(state, primitive);
    const validation = validateGeneratedState(state, candidate, targetSteps);
    if (!validation.valid) continue;

    state = {
      sampleId,
      fold: candidate.fold,
      recipe: state.recipe.concat([
        {
          ...candidate.primitive,
          edge_indices: candidate.primitive.new_edge_indices,
        },
      ]),
      nextCreaseId: candidate.nextCreaseId,
    };
  }

  return {
    ...state,
    targetSteps,
    attempts,
    complete: state.recipe.length > 0,
  };
}
