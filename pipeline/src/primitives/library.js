export function buildPrimitiveCatalog() {
  return [
    {
      op: "book_fold",
      axis: "vertical",
      ratio: 0.5,
      assignment: "V",
      weight: 4,
    },
    {
      op: "book_fold",
      axis: "horizontal",
      ratio: 0.5,
      assignment: "V",
      weight: 4,
    },
    {
      op: "diagonal_fold",
      diagonal: "main",
      assignment: "V",
      weight: 2,
    },
    {
      op: "diagonal_fold",
      diagonal: "anti",
      assignment: "V",
      weight: 2,
    },
    {
      op: "corner_fold",
      corner: "top_left",
      target: [0.5, 0.5],
      assignment: "V",
      weight: 2,
    },
    {
      op: "corner_fold",
      corner: "top_right",
      target: [0.5, 0.5],
      assignment: "V",
      weight: 2,
    },
  ];
}

export function buildPrimitiveWeights(config, catalog) {
  return catalog.map((primitive) => ({
    value: primitive,
    weight: config.primitiveWeights[primitive.op] ?? primitive.weight ?? 1,
  }));
}
