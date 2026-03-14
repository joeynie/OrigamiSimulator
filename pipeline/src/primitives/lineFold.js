import ear from "rabbit-ear";
import { deepClone, ensureCreaseIds } from "../lib/utils.js";

function makeLineForPrimitive(spec) {
  switch (spec.op) {
    case "book_fold":
      if (spec.axis === "vertical") {
        return { vector: [0, 1], origin: [spec.ratio, 0.5] };
      }
      if (spec.axis === "horizontal") {
        return { vector: [1, 0], origin: [0.5, spec.ratio] };
      }
      throw new Error(`Unsupported book fold axis: ${spec.axis}`);
    case "diagonal_fold":
      if (spec.diagonal === "main") {
        return { vector: [1, 1], origin: [0.5, 0.5] };
      }
      if (spec.diagonal === "anti") {
        return { vector: [1, -1], origin: [0.5, 0.5] };
      }
      throw new Error(`Unsupported diagonal fold: ${spec.diagonal}`);
    case "corner_fold": {
      const corners = {
        top_left: [0, 1],
        top_right: [1, 1],
        bottom_left: [0, 0],
        bottom_right: [1, 0],
      };
      const corner = corners[spec.corner];
      if (!corner) throw new Error(`Unsupported corner fold corner: ${spec.corner}`);
      const target = [spec.target[0], spec.target[1]];
      const mid = [(corner[0] + target[0]) / 2, (corner[1] + target[1]) / 2];
      const dx = target[0] - corner[0];
      const dy = target[1] - corner[1];
      return { vector: [-dy, dx], origin: mid };
    }
    default:
      throw new Error(`Unsupported primitive op: ${spec.op}`);
  }
}

export function applyLineFoldPrimitive(state, primitiveSpec) {
  const fold = deepClone(state.fold);
  const line = makeLineForPrimitive(primitiveSpec);
  const changes = ear.graph.foldLine(fold, line, primitiveSpec.assignment ?? "V");

  if (!changes?.edges?.new?.length) {
    return { accepted: false, reason: "primitive_did_not_create_new_crease" };
  }

  const nextCreaseId = ensureCreaseIds(fold, state.nextCreaseId);
  const newCreaseIds = changes.edges.new
    .map((edgeIndex) => fold.edges_crease_id[edgeIndex])
    .filter(Boolean);

  return {
    accepted: true,
    fold,
    nextCreaseId,
    primitive: {
      ...primitiveSpec,
      new_edge_indices: changes.edges.new,
      crease_ids: newCreaseIds,
    },
  };
}
