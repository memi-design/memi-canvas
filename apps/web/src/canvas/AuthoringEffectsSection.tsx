import type { CanvasEffectV2 } from "@memi/protocol";

import {
  AuthoringNumberField,
  AuthoringTextField,
} from "./authoring-field.js";
import type { WorkbenchNode } from "./model.js";

type NodeUpdate = (node: WorkbenchNode) => WorkbenchNode;
type DropShadow = Extract<CanvasEffectV2, { type: "drop-shadow" }>;
type LayerBlur = Extract<CanvasEffectV2, { type: "layer-blur" }>;

const DEFAULT_SHADOW: DropShadow = Object.freeze({
  blur: 12,
  color: "oklch(0% 0 0 / 32%)",
  offsetX: 0,
  offsetY: 4,
  spread: 0,
  type: "drop-shadow",
});

function effectOf<Type extends CanvasEffectV2["type"]>(
  effects: readonly CanvasEffectV2[] | undefined,
  type: Type,
): Extract<CanvasEffectV2, { type: Type }> | undefined {
  return effects?.find(
    (effect): effect is Extract<CanvasEffectV2, { type: Type }> =>
      effect.type === type,
  );
}

function replaceEffect(
  node: WorkbenchNode,
  effect: CanvasEffectV2 | null,
  type: CanvasEffectV2["type"],
): WorkbenchNode {
  const retained = (node.effects ?? []).filter(
    (candidate) => candidate.type !== type,
  );
  const effects = effect === null ? retained : [...retained, effect];
  const { effects: _effects, ...withoutEffects } = node;
  return effects.length === 0
    ? withoutEffects
    : { ...withoutEffects, effects };
}

function shadowUpdate(
  property: keyof Omit<DropShadow, "type">,
  value: number | string,
): NodeUpdate {
  return (node) => {
    const current = effectOf(node.effects, "drop-shadow") ?? DEFAULT_SHADOW;
    return replaceEffect(
      node,
      { ...current, [property]: value },
      "drop-shadow",
    );
  };
}

function blurUpdate(radius: number): NodeUpdate {
  return (node) =>
    replaceEffect(
      node,
      radius === 0 ? null : ({ radius, type: "layer-blur" } satisfies LayerBlur),
      "layer-blur",
    );
}

// Atomic Design: molecule — bounded visual effects authored through V3 style operations.
export function AuthoringEffectsSection({
  commitChange,
  effects,
  mixed,
  previewChange,
  selectionLabel,
}: {
  readonly commitChange: (label: string, update: NodeUpdate) => void;
  readonly effects: readonly CanvasEffectV2[] | undefined;
  readonly mixed: boolean;
  readonly previewChange: (label: string, update: NodeUpdate) => void;
  readonly selectionLabel: string;
}) {
  const blur = effectOf(effects, "layer-blur")?.radius ?? 0;
  const shadow = effectOf(effects, "drop-shadow");
  const updateShadowNumber = (
    label: string,
    property: "blur" | "offsetX" | "offsetY" | "spread",
    value: number,
    preview: boolean,
  ) => {
    const update = shadowUpdate(property, value);
    const command = `Change ${selectionLabel} ${label.toLowerCase()}`;
    (preview ? previewChange : commitChange)(command, update);
  };

  return (
    <fieldset aria-label="Effects" className="inspector-section">
      <legend>Effects</legend>
      <div className="inspector-property-grid">
        <AuthoringNumberField
          label="Layer blur"
          minimum={0}
          mixed={mixed}
          onCommit={(value) =>
            commitChange(`Change ${selectionLabel} layer blur`, blurUpdate(value))
          }
          onPreview={(value) =>
            previewChange(`Change ${selectionLabel} layer blur`, blurUpdate(value))
          }
          value={blur}
        />
        {(
          [
            ["Shadow X", "offsetX", shadow?.offsetX ?? DEFAULT_SHADOW.offsetX],
            ["Shadow Y", "offsetY", shadow?.offsetY ?? DEFAULT_SHADOW.offsetY],
            ["Shadow blur", "blur", shadow?.blur ?? 0],
            ["Shadow spread", "spread", shadow?.spread ?? DEFAULT_SHADOW.spread],
          ] as const
        ).map(([label, property, value]) => (
          <AuthoringNumberField
            key={property}
            label={label}
            {...(property === "blur" ? { minimum: 0 } : {})}
            mixed={mixed}
            onCommit={(next) =>
              updateShadowNumber(label, property, next, false)
            }
            onPreview={(next) =>
              updateShadowNumber(label, property, next, true)
            }
            value={value}
          />
        ))}
      </div>
      <AuthoringTextField
        label="Shadow color"
        mixed={mixed}
        onCommit={(value) => {
          const color = value.trim();
          if (color.length === 0 || color.length > 160) return;
          commitChange(
            `Change ${selectionLabel} shadow color`,
            shadowUpdate("color", color),
          );
        }}
        value={shadow?.color ?? DEFAULT_SHADOW.color}
      />
    </fieldset>
  );
}
