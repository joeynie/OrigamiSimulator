import { readFileSync } from "fs";
import { extname, resolve } from "path";
import { DOMParser } from "@xmldom/xmldom";
import ear from "rabbit-ear";
import { ensureCreaseIds } from "../lib/utils.js";

ear.window = { DOMParser };

function loadSvgFold(assetPath) {
  const svgText = readFileSync(assetPath, "utf8");
  return ear.convert.svgToFold(svgText, {
    fast: false,
    boundary: true,
  });
}

function loadJsonFold(assetPath) {
  return JSON.parse(readFileSync(assetPath, "utf8"));
}

export function loadFoldFromAsset(assetPath) {
  const absolutePath = resolve(assetPath);
  const extension = extname(absolutePath).toLowerCase();
  let fold;
  if (extension === ".svg") {
    fold = loadSvgFold(absolutePath);
  } else if (extension === ".fold" || extension === ".json") {
    fold = loadJsonFold(absolutePath);
  } else {
    throw new Error(`Unsupported asset type for template generation: ${absolutePath}`);
  }
  const nextCreaseId = ensureCreaseIds(fold, 0);
  return {
    fold,
    nextCreaseId,
    absolutePath,
  };
}
