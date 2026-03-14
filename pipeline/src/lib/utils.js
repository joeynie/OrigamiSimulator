const CREASE_ASSIGNMENTS = new Set(["M", "m", "V", "v", "F", "f", "U", "u"]);

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function ensureCreaseIds(fold, nextCreaseId = 0) {
  if (!fold.edges_crease_id) {
    fold.edges_crease_id = Array(fold.edges_vertices.length).fill(null);
  }
  while (fold.edges_crease_id.length < fold.edges_vertices.length) {
    fold.edges_crease_id.push(null);
  }
  for (let i = 0; i < fold.edges_assignment.length; i += 1) {
    if (!CREASE_ASSIGNMENTS.has(fold.edges_assignment[i])) continue;
    if (fold.edges_crease_id[i]) continue;
    fold.edges_crease_id[i] = `c${nextCreaseId}`;
    nextCreaseId += 1;
  }
  return nextCreaseId;
}

export function toXYZ(vertex) {
  return [vertex[0], vertex[1], vertex[2] ?? 0];
}

export function easeInOut(progress) {
  return 0.5 - 0.5 * Math.cos(Math.PI * progress);
}

export function weightedChoice(items, rng = Math.random) {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight <= 0) return null;
  let sample = rng() * totalWeight;
  for (const item of items) {
    sample -= item.weight;
    if (sample <= 0) return item.value;
  }
  return items[items.length - 1]?.value ?? null;
}

export function makeStepId(prefix, index) {
  return `${prefix}_${String(index + 1).padStart(2, "0")}`;
}

export function countActiveCreases(fold) {
  return fold.edges_assignment.filter((assignment) => CREASE_ASSIGNMENTS.has(assignment)).length;
}
