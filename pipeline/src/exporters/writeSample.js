import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { compileRecipeToActions } from "../recipes/compile.js";
import { buildSanityTrajectory } from "./trajectory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function writeSampleArtifacts(sample, config) {
  const outputDir = fileURLToPath(config.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const stem = sample.fold.file_title;
  const recipePath = join(outputDir, `${stem}.recipe.json`);
  const foldPath = join(outputDir, `${stem}.fold`);
  const actionsPath = join(outputDir, `${stem}.actions.json`);
  const trajectoryPath = join(outputDir, `${stem}.trajectory_rabbitear.json`);

  const actions = compileRecipeToActions(sample.recipe, config);
  const trajectory = buildSanityTrajectory(sample.fold, actions);

  writeFileSync(foldPath, JSON.stringify(sample.fold, null, 2));
  writeFileSync(recipePath, JSON.stringify({
    sample_id: sample.sampleId,
    generation_mode: sample.generationMode ?? "random_walk",
    template_id: sample.templateId ?? null,
    template_status: sample.templateStatus ?? null,
    source_asset: sample.sourceAsset ?? null,
    target_steps: sample.targetSteps,
    attempts: sample.attempts,
    semantic_steps: sample.semanticRecipe ?? null,
    steps: sample.recipe,
  }, null, 2));
  writeFileSync(actionsPath, JSON.stringify(actions, null, 2));
  writeFileSync(trajectoryPath, JSON.stringify(trajectory, null, 2));

  return {
    foldPath,
    recipePath,
    actionsPath,
    trajectoryPath,
  };
}
