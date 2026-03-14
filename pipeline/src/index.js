import { fileURLToPath } from "url";
import { dirname, isAbsolute, resolve } from "path";
import { generatorConfig } from "./config.js";
import { sampleRecipe } from "./sampler/randomWalk.js";
import { writeSampleArtifacts } from "./exporters/writeSample.js";
import { loadBaseTemplateLibrary, defaultTemplatePath } from "./templates/baseLibrary.js";
import { writeTemplateManifest } from "./exporters/writeTemplateManifest.js";
import { compileCompoundTemplateSample } from "./compound/baseCompiler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = true;
    }
  }
  return options;
}

function toFileUrlOrKeep(urlOrPath, fallbackBase) {
  if (urlOrPath instanceof URL) return urlOrPath;
  if (typeof urlOrPath !== "string") return urlOrPath;
  if (urlOrPath.startsWith("file:")) return new URL(urlOrPath);
  const abs = isAbsolute(urlOrPath) ? urlOrPath : resolve(fallbackBase, urlOrPath);
  return new URL(`file:///${abs.replace(/\\/g, "/")}`);
}

function buildRuntimeConfig(cliOptions) {
  const runtime = { ...generatorConfig };
  if (cliOptions["num-samples"]) {
    runtime.numSamples = parseInt(cliOptions["num-samples"], 10);
  }
  if (cliOptions["dataset-name"]) {
    runtime.datasetName = cliOptions["dataset-name"];
  }
  if (cliOptions["output-dir"]) {
    runtime.outputDir = toFileUrlOrKeep(cliOptions["output-dir"], resolve(__dirname, ".."));
  }
  if (cliOptions["template-file"]) {
    runtime.templateFile = toFileUrlOrKeep(cliOptions["template-file"], resolve(__dirname, ".."));
  }
  if (cliOptions.template) {
    runtime.template = cliOptions.template;
  }
  return runtime;
}

function buildSamples(runtimeConfig, templates) {
  const writtenSamples = [];
  if (!runtimeConfig.template) {
    for (let sampleIndex = 0; sampleIndex < runtimeConfig.numSamples; sampleIndex += 1) {
      const sample = sampleRecipe(runtimeConfig, sampleIndex);
      if (!sample.complete) continue;
      writtenSamples.push(sample);
    }
    return writtenSamples;
  }

  const selectedTemplates = runtimeConfig.template === "all"
    ? templates.filter((template) => template.assetSvg)
    : templates.filter((template) => template.id === runtimeConfig.template
      || (template.aliases ?? []).includes(runtimeConfig.template));

  if (!selectedTemplates.length) {
    throw new Error(`No templates matched --template ${runtimeConfig.template}`);
  }

  let sampleIndex = 0;
  for (const template of selectedTemplates) {
    const copies = runtimeConfig.template === "all" ? 1 : runtimeConfig.numSamples;
    for (let localIndex = 0; localIndex < copies; localIndex += 1) {
      try {
        const sample = compileCompoundTemplateSample(templates, template.id, runtimeConfig, sampleIndex);
        sampleIndex += 1;
        if (!sample.complete) continue;
        sample.generationMode = "compound_template";
        writtenSamples.push(sample);
      } catch (error) {
        console.warn(`Skipping template ${template.id}: ${error.message}`);
      }
    }
  }
  return writtenSamples;
}

function main() {
  const cliOptions = parseArgs(process.argv.slice(2));
  const runtimeConfig = buildRuntimeConfig(cliOptions);
  const templateFile = fileURLToPath(runtimeConfig.templateFile ?? defaultTemplatePath);
  const templates = loadBaseTemplateLibrary(templateFile);
  const manifestPath = writeTemplateManifest(templates, runtimeConfig);

  const builtSamples = buildSamples(runtimeConfig, templates);
  const written = builtSamples.map((sample) => writeSampleArtifacts(sample, runtimeConfig));

  console.log(`Generated ${written.length} procedural samples into pipeline/generated/`);
  console.log(`- ${manifestPath}`);
  for (const item of written) {
    console.log(`- ${item.foldPath}`);
    console.log(`  ${item.recipePath}`);
    console.log(`  ${item.actionsPath}`);
    console.log(`  ${item.trajectoryPath}`);
  }
}

main();
