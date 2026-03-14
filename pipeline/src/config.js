export const generatorConfig = {
  outputDir: new URL("../generated/", import.meta.url),
  templateFile: new URL("../templates/base_library.json", import.meta.url),
  datasetName: "procedural_origami_v0",
  numSamples: 8,
  stepBins: [1, 2, 3],
  maxAttemptsPerSample: 24,
  defaultAction: {
    num_frames: 4,
    hold_frames: 4,
    schedule: "ease_in_out",
    solver_steps_per_frame: 80,
    capture: true,
    include_fold_json: false,
  },
  primitiveWeights: {
    book_fold: 4,
    diagonal_fold: 2,
    corner_fold: 2,
  },
};
