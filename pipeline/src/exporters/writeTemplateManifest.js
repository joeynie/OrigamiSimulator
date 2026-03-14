import { mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";

export function writeTemplateManifest(templates, config) {
  const outputDir = fileURLToPath(config.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const manifestPath = join(outputDir, "base_templates.manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        dataset: config.datasetName,
        templates,
      },
      null,
      2,
    ),
  );
  return manifestPath;
}
