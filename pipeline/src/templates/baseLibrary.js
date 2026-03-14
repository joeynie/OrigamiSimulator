import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultTemplatePath = resolve(__dirname, "../../templates/base_library.json");

export function loadBaseTemplateLibrary(templatePath = defaultTemplatePath) {
  const raw = readFileSync(templatePath, "utf8");
  return JSON.parse(raw);
}

export { defaultTemplatePath };
