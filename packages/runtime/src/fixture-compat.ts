import type { EffectExecutor } from "./types.js";

export const LEGACY_CANVAS_FIXTURE = Symbol(
  "memi.legacy-canvas-fixture",
);

export type LegacyCanvasFixtureExecutor = EffectExecutor & {
  readonly [LEGACY_CANVAS_FIXTURE]: true;
};

export function isLegacyCanvasFixtureExecutor(
  executor: EffectExecutor,
): executor is LegacyCanvasFixtureExecutor {
  return (
    LEGACY_CANVAS_FIXTURE in executor &&
    executor[LEGACY_CANVAS_FIXTURE] === true
  );
}
