import type { Point } from "./model.js";

export function serializeCanvasPath(points: readonly Point[]): string {
  return points
    .map(
      ({ x, y }, index) =>
        `${index === 0 ? "M" : "L"} ${x} ${y}`,
    )
    .join(" ");
}

export function parseCanvasPath(pathData: string): readonly Point[] {
  const coordinates =
    pathData.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/giu)?.map(Number) ??
    [];
  const points: Point[] = [];
  for (let index = 0; index + 1 < coordinates.length; index += 2) {
    const x = coordinates[index];
    const y = coordinates[index + 1];
    if (
      x !== undefined &&
      y !== undefined &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    ) {
      points.push({ x, y });
    }
  }
  return points;
}
