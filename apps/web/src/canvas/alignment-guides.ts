import type { Point, WorkbenchNode } from "./model.js";

export interface AlignmentGuides {
  readonly horizontal: readonly number[];
  readonly vertical: readonly number[];
}

interface AlignmentSnapInput {
  readonly delta: Point;
  readonly gridSize?: number;
  readonly movingNodes: readonly WorkbenchNode[];
  readonly sceneNodes: readonly WorkbenchNode[];
  readonly threshold: number;
}

interface AxisAnchors {
  readonly end: number;
  readonly middle: number;
  readonly start: number;
}

function bounds(
  nodes: readonly WorkbenchNode[],
  delta: Point = { x: 0, y: 0 },
) {
  const left = Math.min(...nodes.map((node) => node.position.x + delta.x));
  const top = Math.min(...nodes.map((node) => node.position.y + delta.y));
  const right = Math.max(
    ...nodes.map((node) => node.position.x + node.size.width + delta.x),
  );
  const bottom = Math.max(
    ...nodes.map((node) => node.position.y + node.size.height + delta.y),
  );
  return { bottom, left, right, top };
}

function anchors(start: number, end: number): AxisAnchors {
  return { start, middle: (start + end) / 2, end };
}

function values(input: AxisAnchors): readonly number[] {
  return [input.start, input.middle, input.end];
}

function closestOffset(
  moving: readonly number[],
  targets: readonly number[],
  threshold: number,
): number | null {
  let closest = Number.POSITIVE_INFINITY;
  for (const movingValue of moving) {
    for (const target of targets) {
      const offset = target - movingValue;
      if (
        Math.abs(offset) <= threshold &&
        Math.abs(offset) < Math.abs(closest)
      ) {
        closest = offset;
      }
    }
  }
  return Number.isFinite(closest) ? closest : null;
}

function gridOffset(value: number, gridSize: number | undefined): number {
  return gridSize === undefined ||
    !Number.isFinite(gridSize) ||
    gridSize <= 0
    ? 0
    : Math.round(value / gridSize) * gridSize - value;
}

function matchingGuides(
  moving: readonly number[],
  targets: readonly number[],
  threshold: number,
): readonly number[] {
  return [
    ...new Set(
      targets.filter((target) =>
        moving.some((value) => Math.abs(value - target) <= threshold),
      ),
    ),
  ].sort((left, right) => left - right);
}

function hierarchyRelatedIds(
  movingIds: ReadonlySet<string>,
  sceneNodes: readonly WorkbenchNode[],
): ReadonlySet<string> {
  const relatedIds = new Set(movingIds);
  const nodesById = new Map(sceneNodes.map((node) => [node.id, node]));

  for (const movingId of movingIds) {
    let parentId = nodesById.get(movingId)?.parentId ?? null;
    while (parentId !== null && !relatedIds.has(parentId)) {
      relatedIds.add(parentId);
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }

  let foundDescendant = true;
  while (foundDescendant) {
    foundDescendant = false;
    for (const node of sceneNodes) {
      if (
        !relatedIds.has(node.id) &&
        node.parentId !== null &&
        relatedIds.has(node.parentId)
      ) {
        relatedIds.add(node.id);
        foundDescendant = true;
      }
    }
  }
  return relatedIds;
}

export function computeAlignmentSnap({
  delta,
  gridSize,
  movingNodes,
  sceneNodes,
  threshold,
}: AlignmentSnapInput): {
  readonly delta: Point;
  readonly guides: AlignmentGuides;
} {
  if (movingNodes.length === 0) {
    return {
      delta,
      guides: { horizontal: [], vertical: [] },
    };
  }

  const movingIds = new Set(movingNodes.map(({ id }) => id));
  const relatedIds = hierarchyRelatedIds(movingIds, sceneNodes);
  const targets = sceneNodes.filter(
    (node) => !relatedIds.has(node.id) && !node.hidden,
  );
  if (targets.length === 0) {
    return {
      delta,
      guides: { horizontal: [], vertical: [] },
    };
  }

  const movingBounds = bounds(movingNodes, delta);
  const movingX = values(anchors(movingBounds.left, movingBounds.right));
  const movingY = values(anchors(movingBounds.top, movingBounds.bottom));
  const targetX = targets.flatMap((node) =>
    values(
      anchors(node.position.x, node.position.x + node.size.width),
    ),
  );
  const targetY = targets.flatMap((node) =>
    values(
      anchors(node.position.y, node.position.y + node.size.height),
    ),
  );
  const objectOffsetX = closestOffset(movingX, targetX, threshold);
  const objectOffsetY = closestOffset(movingY, targetY, threshold);
  const snappedDelta = {
    x:
      delta.x +
      (objectOffsetX ??
        gridOffset(movingBounds.left, gridSize)),
    y:
      delta.y +
      (objectOffsetY ??
        gridOffset(movingBounds.top, gridSize)),
  };
  const snappedBounds = bounds(movingNodes, snappedDelta);

  return {
    delta: snappedDelta,
    guides: {
      horizontal: matchingGuides(
        values(anchors(snappedBounds.top, snappedBounds.bottom)),
        targetY,
        0.01,
      ),
      vertical: matchingGuides(
        values(anchors(snappedBounds.left, snappedBounds.right)),
        targetX,
        0.01,
      ),
    },
  };
}
