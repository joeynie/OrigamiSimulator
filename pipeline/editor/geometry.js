import ear from "../node_modules/rabbit-ear/module/index.js";

export const DRAW_MODE_META = {
  axiom1: { label: "公理1", hint: "两点成线" },
  axiom3: { label: "公理3", hint: "线折到线" },
};

export const PAPER_POLYGON = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

const guideValues = [25, 50, 75];
const boundaryLabels = {
  top: "上边",
  right: "右边",
  bottom: "下边",
  left: "左边",
};

function svgPointToEar(point) {
  return [point.x / 100, (100 - point.y) / 100];
}

function earPointToSvg([x, y]) {
  return { x: x * 100, y: 100 - y * 100 };
}

function segmentToVecLine(segment) {
  if (!segment) {
    return null;
  }
  const [start, end] = segment.map(svgPointToEar);
  const vector = [end[0] - start[0], end[1] - start[1]];
  const length = Math.hypot(vector[0], vector[1]);
  if (!length) {
    return null;
  }
  return { origin: start, vector };
}

function clipVecLineToPaper(line) {
  const clipped = ear.math.clipLineConvexPolygon(PAPER_POLYGON, line);
  return clipped?.map(earPointToSvg) ?? null;
}

export function extendSegmentToPaper(segment) {
  return clipVecLineToPaper(segmentToVecLine(segment));
}

function boundarySegment(edge) {
  switch (edge) {
    case "top":
      return [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    case "right":
      return [{ x: 100, y: 0 }, { x: 100, y: 100 }];
    case "bottom":
      return [{ x: 0, y: 100 }, { x: 100, y: 100 }];
    case "left":
      return [{ x: 0, y: 0 }, { x: 0, y: 100 }];
    default:
      return null;
  }
}

function guideSegment(axis, value) {
  if (!guideValues.includes(value)) {
    return null;
  }
  return axis === "vertical"
    ? [{ x: value, y: 0 }, { x: value, y: 100 }]
    : [{ x: 0, y: value }, { x: 100, y: value }];
}

function clampSolutionIndex(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function normalizeLineRef(lineRef) {
  if (!lineRef || typeof lineRef !== "object") {
    return null;
  }

  if (lineRef.kind === "boundary" && boundaryLabels[lineRef.edge]) {
    return { kind: "boundary", edge: lineRef.edge };
  }

  if (
    lineRef.kind === "guide"
    && (lineRef.axis === "vertical" || lineRef.axis === "horizontal")
    && guideValues.includes(Number(lineRef.value))
  ) {
    return {
      kind: "guide",
      axis: lineRef.axis,
      value: Number(lineRef.value),
    };
  }

  if (lineRef.kind === "crease" && typeof lineRef.creaseId === "string" && lineRef.creaseId) {
    return { kind: "crease", creaseId: lineRef.creaseId };
  }

  return null;
}

export function makeLineRefKey(lineRef) {
  if (!lineRef) {
    return "";
  }
  if (lineRef.kind === "boundary") {
    return `boundary:${lineRef.edge}`;
  }
  if (lineRef.kind === "guide") {
    return `guide:${lineRef.axis}:${lineRef.value}`;
  }
  if (lineRef.kind === "crease") {
    return `crease:${lineRef.creaseId}`;
  }
  return "";
}

export function listStaticLineCandidates() {
  return [
    ...["top", "right", "bottom", "left"].map((edge) => ({
      ref: { kind: "boundary", edge },
      label: boundaryLabels[edge],
      segment: boundarySegment(edge),
    })),
    ...guideValues.flatMap((value) => [
      {
        ref: { kind: "guide", axis: "vertical", value },
        label: value === 50 ? "竖向中线" : `竖向 ${value}% 线`,
        segment: guideSegment("vertical", value),
      },
      {
        ref: { kind: "guide", axis: "horizontal", value },
        label: value === 50 ? "横向中线" : `横向 ${value}% 线`,
        segment: guideSegment("horizontal", value),
      },
    ]),
  ];
}

export function createCreaseResolver(steps, getPoint) {
  const creaseLookup = new Map();
  const creaseCache = new Map();
  const lineCache = new Map();
  const resolving = new Set();

  steps.forEach((step, stepIndex) => {
    step.creases.forEach((crease, creaseIndex) => {
      creaseLookup.set(crease.id, { step, stepIndex, crease, creaseIndex });
    });
  });

  function resolveLineRefSegment(lineRef) {
    const normalized = normalizeLineRef(lineRef);
    const key = makeLineRefKey(normalized);
    if (!key) {
      return null;
    }
    if (lineCache.has(key)) {
      return lineCache.get(key);
    }

    let segment = null;
    if (normalized.kind === "boundary") {
      segment = boundarySegment(normalized.edge);
    } else if (normalized.kind === "guide") {
      segment = guideSegment(normalized.axis, normalized.value);
    } else if (normalized.kind === "crease") {
      segment = resolveCreaseSegment(creaseLookup.get(normalized.creaseId)?.crease);
    }

    if (segment) {
      lineCache.set(key, segment);
    }
    return segment;
  }

  function resolveLineRefLine(lineRef) {
    return segmentToVecLine(resolveLineRefSegment(lineRef));
  }

  function resolveAxiom3Segment(crease) {
    const [firstRef, secondRef] = crease.lineRefs ?? [];
    const firstLine = resolveLineRefLine(firstRef);
    const secondLine = resolveLineRefLine(secondRef);
    if (!firstLine || !secondLine) {
      return null;
    }

    const solutions = (ear.axiom.axiom3InPolygon(PAPER_POLYGON, firstLine, secondLine) ?? [])
      .map((line, index) => ({
        index,
        segment: clipVecLineToPaper(line),
      }))
      .filter((solution) => solution.segment);

    if (!solutions.length) {
      return null;
    }

    const preferredIndex = clampSolutionIndex(crease.solutionIndex);
    return solutions.find((solution) => solution.index === preferredIndex)?.segment ?? solutions[0].segment;
  }

  function resolveCreaseSegment(crease) {
    if (!crease) {
      return null;
    }
    if (creaseCache.has(crease.id)) {
      return creaseCache.get(crease.id);
    }
    if (resolving.has(crease.id)) {
      return null;
    }

    resolving.add(crease.id);
    let segment = null;

    if (crease.mode === "axiom3") {
      segment = resolveAxiom3Segment(crease);
    } else {
      const start = getPoint?.(crease.startId);
      const end = getPoint?.(crease.endId);
      if (start && end && crease.startId !== crease.endId) {
        segment = [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ];
      }
    }

    resolving.delete(crease.id);
    if (segment) {
      creaseCache.set(crease.id, segment);
    }
    return segment;
  }

  return {
    creaseLookup,
    resolveCreaseSegment,
    resolveLineRefSegment,
    resolveLineRefLine,
    getCreaseMeta: (creaseId) => creaseLookup.get(creaseId) ?? null,
  };
}

export function lineRefLabel(lineRef, resolver) {
  const normalized = normalizeLineRef(lineRef);
  if (!normalized) {
    return "未定义参考线";
  }
  if (normalized.kind === "boundary") {
    return boundaryLabels[normalized.edge];
  }
  if (normalized.kind === "guide") {
    const axisLabel = normalized.axis === "vertical" ? "竖向" : "横向";
    return normalized.value === 50 ? `${axisLabel}中线` : `${axisLabel} ${normalized.value}% 线`;
  }

  const meta = resolver?.getCreaseMeta(normalized.creaseId);
  if (!meta) {
    return "折痕";
  }
  return `步骤 ${meta.stepIndex + 1} 折痕 ${meta.creaseIndex + 1}`;
}

export function buildAxiom3Solutions(firstRef, secondRef, resolver, pointer) {
  const firstLine = resolver.resolveLineRefLine(firstRef);
  const secondLine = resolver.resolveLineRefLine(secondRef);
  if (!firstLine || !secondLine) {
    return { solutions: [], selectedIndex: 0 };
  }

  const solutions = (ear.axiom.axiom3InPolygon(PAPER_POLYGON, firstLine, secondLine) ?? [])
    .map((line, index) => ({
      index,
      segment: clipVecLineToPaper(line),
    }))
    .filter((solution) => solution.segment);

  if (!solutions.length) {
    return { solutions: [], selectedIndex: 0 };
  }

  const selectedOffset = pointer
    ? solutions.reduce((bestOffset, solution, index, array) =>
      distanceToSegment(pointer, solution.segment) < distanceToSegment(pointer, array[bestOffset].segment)
        ? index
        : bestOffset, 0)
    : 0;

  return {
    solutions,
    selectedIndex: solutions[selectedOffset]?.index ?? 0,
  };
}

export function intersectSegments(firstSegment, secondSegment, epsilon = 1e-6) {
  if (!firstSegment || !secondSegment) {
    return null;
  }

  const [a, b] = firstSegment;
  const [c, d] = secondSegment;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= epsilon) {
    return null;
  }

  const delta = { x: c.x - a.x, y: c.y - a.y };
  const t = (delta.x * s.y - delta.y * s.x) / denominator;
  const u = (delta.x * r.y - delta.y * r.x) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) {
    return null;
  }

  return {
    x: a.x + t * r.x,
    y: a.y + t * r.y,
  };
}

export function distanceToSegment(point, segment) {
  if (!point || !segment) {
    return Number.POSITIVE_INFINITY;
  }

  const [start, end] = segment;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const closestX = start.x + dx * t;
  const closestY = start.y + dy * t;
  return Math.hypot(point.x - closestX, point.y - closestY);
}
