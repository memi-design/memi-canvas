import type { CSSProperties } from "react";
import type { CanvasEffectV2 } from "@memi/protocol";

function dropShadow(effect: CanvasEffectV2): string | null {
  if (effect.type !== "drop-shadow") return null;
  return `${effect.offsetX}px ${effect.offsetY}px ${effect.blur}px ${effect.spread}px ${effect.color}`;
}

/** Pure renderer projection; effect data remains canonical in CanvasStyleV2. */
export function workbenchEffectStyle(
  effects: readonly CanvasEffectV2[] | undefined,
): Pick<CSSProperties, "boxShadow" | "filter"> {
  if (effects === undefined) return {};
  const shadows = effects.flatMap((effect) => {
    const value = dropShadow(effect);
    return value === null ? [] : [value];
  });
  const blur = effects.find(
    (effect): effect is Extract<CanvasEffectV2, { type: "layer-blur" }> =>
      effect.type === "layer-blur",
  );
  return {
    ...(shadows.length === 0 ? {} : { boxShadow: shadows.join(", ") }),
    ...(blur === undefined || blur.radius === 0
      ? {}
      : { filter: `blur(${blur.radius}px)` }),
  };
}
