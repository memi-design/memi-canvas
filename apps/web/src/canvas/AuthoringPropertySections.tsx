import { useEffect, useState } from "react";

import {
  AuthoringNumberField,
  AuthoringTextField,
} from "./authoring-field.js";
import { AuthoringColorField } from "./AuthoringColorField.js";
import { AuthoringEffectsSection } from "./AuthoringEffectsSection.js";
import {
  createAuthoringSelectionTransaction,
  sharedAuthoringProperties,
  type AuthoringSelectionTransaction,
  type SharedAuthoringValue,
} from "./authoring-selection.js";
import { EditorIcon } from "./icons.js";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  type WorkbenchLayout,
  type WorkbenchNode,
} from "./model.js";
import "./inspector-authoring.css";
import type { WorkbenchInspectorV3Actions } from "./workbench-inspector-v3-actions.js";

type NodeUpdate = (node: WorkbenchNode) => WorkbenchNode;

export interface AuthoringPropertySectionsProps {
  readonly node: WorkbenchNode;
  readonly onChange: (label: string, update: NodeUpdate) => void;
  readonly onChangeSelection?: (
    transaction: AuthoringSelectionTransaction,
  ) => void;
  readonly onPreview?: (update: NodeUpdate) => void;
  readonly onPreviewSelection?: (
    transaction: AuthoringSelectionTransaction,
  ) => void;
  readonly selectedNodes?: readonly WorkbenchNode[];
  readonly v3Actions?: WorkbenchInspectorV3Actions;
}

function fieldValue<T>(
  property: SharedAuthoringValue<T>,
  fallback: T,
): { readonly mixed: boolean; readonly value: T } {
  return property.kind === "shared"
    ? { mixed: false, value: property.value }
    : { mixed: property.kind === "mixed", value: fallback };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}


function supportsPaint(node: WorkbenchNode): boolean {
  return (
    node.kind !== "CodeFrame" &&
    node.kind !== "RoutePlaceholder" &&
    node.kind !== "ReferenceFrame" &&
    node.kind !== "Group" &&
    node.kind !== "Line" &&
    node.kind !== "Arrow" &&
    node.kind !== "Vector"
  );
}

function supportsLayoutAuthoring(node: WorkbenchNode): boolean {
  return (
    node.kind === "DraftFrame" ||
    node.kind === "Frame" ||
    node.kind === "Component" ||
    node.kind === "ComponentInstance"
  );
}

function layoutWithDefaults(layout: WorkbenchLayout | undefined): WorkbenchLayout {
  return {
    ...DEFAULT_WORKBENCH_LAYOUT,
    ...layout,
    padding: {
      ...DEFAULT_WORKBENCH_LAYOUT.padding,
      ...layout?.padding,
    },
  };
}

// Atomic Design: organism — typed authoring controls shared by every design node.
export function AuthoringPropertySections({
  node,
  onChange,
  onChangeSelection,
  onPreview,
  onPreviewSelection,
  selectedNodes,
  v3Actions,
}: AuthoringPropertySectionsProps) {
  const authoringNodes =
    selectedNodes === undefined || selectedNodes.length === 0
      ? [node]
      : selectedNodes;
  const shared = sharedAuthoringProperties(authoringNodes);
  const selectionLabel =
    authoringNodes.length === 1 ? node.name : `${authoringNodes.length} layers`;
  const commitChange = (label: string, update: NodeUpdate) => {
    if (v3Actions !== undefined) {
      v3Actions.commit({ label, targetIds: authoringNodes.map(({ id }) => id), update });
      return;
    }
    if (onChangeSelection !== undefined) {
      onChangeSelection(
        createAuthoringSelectionTransaction(label, authoringNodes, update),
      );
      return;
    }
    onChange(label, update);
  };
  const previewChange = (label: string, update: NodeUpdate) => {
    if (v3Actions !== undefined) {
      v3Actions.preview({ label, targetIds: authoringNodes.map(({ id }) => id), update });
      return;
    }
    if (onPreviewSelection !== undefined) {
      onPreviewSelection(
        createAuthoringSelectionTransaction(label, authoringNodes, update),
      );
      return;
    }
    onPreview?.(update);
  };
  const radiiProperty = fieldValue(
    shared.cornerRadii,
    node.cornerRadii,
  );
  const radii = radiiProperty.value ?? [0, 0, 0, 0];
  const [independentRadii, setIndependentRadii] = useState(
    () => new Set(radii).size > 1,
  );
  const hasIndependentRadii = new Set(radii).size > 1;
  useEffect(() => {
    setIndependentRadii(hasIndependentRadii);
  }, [hasIndependentRadii, node.id]);
  const paintSupported = authoringNodes.every(supportsPaint);
  const layoutSupported = authoringNodes.every(supportsLayoutAuthoring);
  const layout = layoutWithDefaults(node.layout);
  const x = fieldValue(shared.x, node.position.x);
  const y = fieldValue(shared.y, node.position.y);
  const rotation = fieldValue(shared.rotation, node.rotation ?? 0);
  const width = fieldValue(shared.width, node.size.width);
  const height = fieldValue(shared.height, node.size.height);
  const gap = fieldValue(shared.gap, node.layout?.gap).value ?? layout.gap;
  const gapMixed = shared.gap.kind === "mixed";
  const paddingProperty = fieldValue(shared.padding, node.layout?.padding);
  const padding = paddingProperty.value ?? layout.padding;
  const opacity = fieldValue(shared.opacity, node.opacity ?? 1);
  const fill = fieldValue(shared.fill, node.fill);
  const stroke = fieldValue(shared.stroke, node.stroke);
  const strokeWeight = fieldValue(shared.strokeWeight, node.strokeWeight);
  const effects = fieldValue(shared.effects, node.effects);
  const textSupported = authoringNodes.every(({ kind }) => kind === "Text");
  const fontFamily = fieldValue(
    shared.fontFamily,
    node.fontFamily ?? "Inter Variable",
  );
  const fontSize = fieldValue(shared.fontSize, node.fontSize ?? 16);
  const fontWeight = fieldValue(shared.fontWeight, node.fontWeight ?? 400);
  const letterSpacing = fieldValue(
    shared.letterSpacing,
    node.letterSpacing ?? 0,
  );
  const lineHeight = fieldValue(
    shared.lineHeight,
    node.lineHeight ?? Math.round((node.fontSize ?? 16) * 1.2),
  );
  const textAlign = fieldValue(
    shared.textAlign,
    node.textAlign ?? "left",
  );
  return (
    <>
      <fieldset aria-label="Position" className="inspector-section">
        <legend>Position</legend>
        <div className="inspector-property-grid">
          <AuthoringNumberField
            label="X"
            mixed={x.mixed}
            onCommit={(value) =>
              commitChange(`Move ${selectionLabel}`, (current) => ({
                ...current,
                position: { ...current.position, x: value },
              }))
            }
            onPreview={(value) =>
              previewChange(`Move ${selectionLabel}`, (current) => ({
                ...current,
                position: { ...current.position, x: value },
              }))
            }
            value={x.value}
          />
          <AuthoringNumberField
            label="Y"
            mixed={y.mixed}
            onCommit={(value) =>
              commitChange(`Move ${selectionLabel}`, (current) => ({
                ...current,
                position: { ...current.position, y: value },
              }))
            }
            onPreview={(value) =>
              previewChange(`Move ${selectionLabel}`, (current) => ({
                ...current,
                position: { ...current.position, y: value },
              }))
            }
            value={y.value}
          />
          <AuthoringNumberField
            label="Rotation"
            mixed={rotation.mixed}
            onCommit={(value) =>
              commitChange(`Rotate ${selectionLabel}`, (current) => ({
                ...current,
                rotation: value,
              }))
            }
            onPreview={(value) =>
              previewChange(`Rotate ${selectionLabel}`, (current) => ({
                ...current,
                rotation: value,
              }))
            }
            value={rotation.value}
          />
        </div>
      </fieldset>

      <fieldset aria-label="Layout" className="inspector-section">
        <legend>Layout</legend>
        <div className="inspector-property-grid">
          <AuthoringNumberField
            label="Width"
            minimum={1}
            mixed={width.mixed}
            onCommit={(value) =>
              commitChange(`Resize ${selectionLabel}`, (current) => ({
                ...current,
                size: { ...current.size, width: Math.max(1, value) },
              }))
            }
            onPreview={(value) =>
              previewChange(`Resize ${selectionLabel}`, (current) => ({
                ...current,
                size: { ...current.size, width: Math.max(1, value) },
              }))
            }
            value={width.value}
          />
          <AuthoringNumberField
            label="Height"
            minimum={1}
            mixed={height.mixed}
            onCommit={(value) =>
              commitChange(`Resize ${selectionLabel}`, (current) => ({
                ...current,
                size: { ...current.size, height: Math.max(1, value) },
              }))
            }
            onPreview={(value) =>
              previewChange(`Resize ${selectionLabel}`, (current) => ({
                ...current,
                size: { ...current.size, height: Math.max(1, value) },
              }))
            }
            value={height.value}
          />
          {layoutSupported ? (
            <>
              <AuthoringNumberField
                label="Gap"
                minimum={0}
                mixed={gapMixed}
                onCommit={(value) =>
                  commitChange(`Change ${selectionLabel} gap`, (current) => ({
                    ...current,
                    layout: {
                      ...layoutWithDefaults(current.layout),
                      gap: Math.max(0, value),
                    },
                  }))
                }
                onPreview={(value) =>
                  previewChange(
                    `Change ${selectionLabel} gap`,
                    (current) => ({
                      ...current,
                      layout: {
                        ...layoutWithDefaults(current.layout),
                        gap: Math.max(0, value),
                      },
                    }),
                  )
                }
                value={gap}
              />
              {(["top", "right", "bottom", "left"] as const).map(
                (side) => (
                  <AuthoringNumberField
                    key={side}
                    label={`Padding ${side}`}
                    minimum={0}
                    mixed={paddingProperty.mixed}
                    onCommit={(value) =>
                      commitChange(
                        `Change ${selectionLabel} padding ${side}`,
                        (current) => {
                          const currentLayout = layoutWithDefaults(
                            current.layout,
                          );
                          return {
                            ...current,
                            layout: {
                              ...currentLayout,
                              padding: {
                                ...currentLayout.padding,
                                [side]: Math.max(0, value),
                              },
                            },
                          };
                        },
                      )
                    }
                    onPreview={(value) =>
                      previewChange(
                        `Change ${selectionLabel} padding ${side}`,
                        (current) => {
                          const currentLayout = layoutWithDefaults(
                            current.layout,
                          );
                          return {
                            ...current,
                            layout: {
                              ...currentLayout,
                              padding: {
                                ...currentLayout.padding,
                                [side]: Math.max(0, value),
                              },
                            },
                          };
                        },
                      )
                    }
                    value={padding[side]}
                  />
                ),
              )}
            </>
          ) : null}
        </div>
      </fieldset>

      {textSupported ? (
        <fieldset aria-label="Text" className="inspector-section">
          <legend>Text</legend>
          <AuthoringTextField
            label="Font family"
            mixed={fontFamily.mixed}
            onCommit={(value) => {
              const next = value.trim();
              if (next.length === 0) return;
              commitChange(`Change ${selectionLabel} font family`, (current) => ({
                ...current,
                fontFamily: next,
              }));
            }}
            value={fontFamily.value ?? "Inter Variable"}
          />
          <div className="inspector-property-grid">
            <AuthoringNumberField
              label="Font size"
              minimum={1}
              mixed={fontSize.mixed}
              onCommit={(value) =>
                commitChange(`Change ${selectionLabel} font size`, (current) => ({
                  ...current,
                  fontSize: Math.max(1, value),
                }))
              }
              onPreview={(value) =>
                previewChange(`Change ${selectionLabel} font size`, (current) => ({
                  ...current,
                  fontSize: Math.max(1, value),
                }))
              }
              value={fontSize.value ?? 16}
            />
            <AuthoringNumberField
              label="Font weight"
              minimum={1}
              mixed={fontWeight.mixed}
              onCommit={(value) =>
                commitChange(`Change ${selectionLabel} font weight`, (current) => ({
                  ...current,
                  fontWeight: Math.round(clamp(value, 1, 900)),
                }))
              }
              onPreview={(value) =>
                previewChange(`Change ${selectionLabel} font weight`, (current) => ({
                  ...current,
                  fontWeight: Math.round(clamp(value, 1, 900)),
                }))
              }
              value={fontWeight.value ?? 400}
            />
            <AuthoringNumberField
              label="Line height"
              minimum={1}
              mixed={lineHeight.mixed}
              onCommit={(value) =>
                commitChange(`Change ${selectionLabel} line height`, (current) => ({
                  ...current,
                  lineHeight: Math.max(1, value),
                }))
              }
              onPreview={(value) =>
                previewChange(`Change ${selectionLabel} line height`, (current) => ({
                  ...current,
                  lineHeight: Math.max(1, value),
                }))
              }
              value={lineHeight.value ?? 19}
            />
            <AuthoringNumberField
              label="Letter spacing"
              mixed={letterSpacing.mixed}
              onCommit={(value) =>
                commitChange(`Change ${selectionLabel} letter spacing`, (current) => ({
                  ...current,
                  letterSpacing: clamp(value, -1_000, 1_000),
                }))
              }
              onPreview={(value) =>
                previewChange(`Change ${selectionLabel} letter spacing`, (current) => ({
                  ...current,
                  letterSpacing: clamp(value, -1_000, 1_000),
                }))
              }
              value={letterSpacing.value ?? 0}
            />
            <label className="canvas-property">
              <span>Text alignment</span>
              <select
                aria-label="Text alignment"
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  if (next === "") return;
                  const textAlign = next as NonNullable<WorkbenchNode["textAlign"]>;
                  commitChange(
                    `Change ${selectionLabel} text alignment`,
                    (current) => ({ ...current, textAlign }),
                  );
                }}
                value={textAlign.mixed ? "" : textAlign.value}
              >
                {textAlign.mixed ? <option value="">Mixed</option> : null}
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
              </select>
            </label>
          </div>
        </fieldset>
      ) : null}

      <fieldset aria-label="Appearance" className="inspector-section">
        <legend>Appearance</legend>
        <div className="inspector-property-grid">
          <AuthoringNumberField
            label="Opacity"
            mixed={opacity.mixed}
            onCommit={(value) =>
              commitChange(`Change ${selectionLabel} opacity`, (current) => ({
                ...current,
                opacity: clamp(value, 0, 100) / 100,
              }))
            }
            onPreview={(value) =>
              previewChange(
                `Change ${selectionLabel} opacity`,
                (current) => ({
                  ...current,
                  opacity: clamp(value, 0, 100) / 100,
                }),
              )
            }
            value={Math.round(opacity.value * 100)}
          />
        </div>
        <div className="inspector-subsection-heading">
          <span>Corner radius</span>
          <button
            aria-label={
              independentRadii
                ? "Link corner radii"
                : "Use independent corner radii"
            }
            className="inspector-icon-button"
            onClick={() => {
              if (independentRadii) {
                const next = radii[0];
                if (radii.some((radius) => radius !== next)) {
                  commitChange(
                    `Link ${selectionLabel} corner radii`,
                    (current) => ({
                      ...current,
                      cornerRadii: [next, next, next, next],
                    }),
                  );
                }
              }
              setIndependentRadii((current) => !current);
            }}
            title={
              independentRadii
                ? "Link corner radii"
                : "Use independent corner radii"
            }
            type="button"
          >
            <EditorIcon name="context" size={13} />
          </button>
        </div>
        {independentRadii ? (
          <div className="inspector-property-grid inspector-radii-grid">
            {(
              [
                ["top left", 0],
                ["top right", 1],
                ["bottom right", 2],
                ["bottom left", 3],
              ] as const
            ).map(([label, index]) => (
              <AuthoringNumberField
                key={label}
                label={`Radius ${label}`}
                minimum={0}
                mixed={radiiProperty.mixed}
                onCommit={(value) =>
                  commitChange(
                    `Change ${selectionLabel} ${label} radius`,
                    (current) => {
                      const next = [
                        ...(current.cornerRadii ?? [0, 0, 0, 0]),
                      ] as [number, number, number, number];
                      next[index] = value;
                      return { ...current, cornerRadii: next };
                    },
                  )
                }
                onPreview={(value) =>
                  previewChange(
                    `Change ${selectionLabel} ${label} radius`,
                    (current) => {
                      const next = [
                        ...(current.cornerRadii ?? [0, 0, 0, 0]),
                      ] as [number, number, number, number];
                      next[index] = value;
                      return { ...current, cornerRadii: next };
                    },
                  )
                }
                value={radii[index]}
              />
            ))}
          </div>
        ) : (
          <AuthoringNumberField
            label="Corner radius"
            minimum={0}
            mixed={radiiProperty.mixed}
            onCommit={(value) =>
              commitChange(`Change ${selectionLabel} corner radius`, (current) => ({
                ...current,
                cornerRadii: [value, value, value, value],
              }))
            }
            onPreview={(value) =>
              previewChange(
                `Change ${selectionLabel} corner radius`,
                (current) => ({
                  ...current,
                  cornerRadii: [value, value, value, value],
                }),
              )
            }
            value={radii[0]}
          />
        )}
      </fieldset>

      {paintSupported ? (
        <fieldset aria-label="Fill" className="inspector-section">
          <legend>Fill</legend>
          <AuthoringColorField
            label="Fill color"
            mixed={fill.mixed}
            onChange={(value) =>
              commitChange(`Change ${selectionLabel} fill`, (current) => ({
                ...current,
                fill: value,
              }))
            }
            onPreview={(value) =>
              previewChange(`Change ${selectionLabel} fill`, (current) => ({
                ...current,
                fill: value,
              }))
            }
            value={fill.value ?? "white"}
          />
        </fieldset>
      ) : null}

      <fieldset aria-label="Stroke" className="inspector-section">
        <legend>Stroke</legend>
        <AuthoringColorField
          label="Stroke color"
          mixed={stroke.mixed}
          onChange={(value) =>
            commitChange(`Change ${selectionLabel} stroke`, (current) => ({
              ...current,
              stroke: value,
              strokeWeight: current.strokeWeight ?? 1,
            }))
          }
          onPreview={(value) =>
            previewChange(`Change ${selectionLabel} stroke`, (current) => ({
              ...current,
              stroke: value,
              strokeWeight: current.strokeWeight ?? 1,
            }))
          }
          value={stroke.value ?? "black"}
        />
        <div className="inspector-property-grid">
          <AuthoringNumberField
            label="Stroke weight"
            minimum={0}
            mixed={strokeWeight.mixed}
            onCommit={(value) =>
              commitChange(
                `Change ${selectionLabel} stroke weight`,
                (current) => ({
                  ...current,
                  strokeWeight: Math.max(0, value),
                }),
              )
            }
            onPreview={(value) =>
              previewChange(
                `Change ${selectionLabel} stroke weight`,
                (current) => ({
                  ...current,
                  strokeWeight: Math.max(0, value),
                }),
              )
            }
            value={
              strokeWeight.value ?? (stroke.value === undefined ? 0 : 1)
            }
          />
          <label className="canvas-property">
            <span>Stroke alignment</span>
            <select
              aria-label="Stroke alignment"
              onChange={(event) => {
                const strokeAlign = event.currentTarget.value as
                  | "inside"
                  | "center"
                  | "outside";
                commitChange(
                  `Change ${selectionLabel} stroke alignment`,
                  (current) => ({ ...current, strokeAlign }),
                );
              }}
              value={node.strokeAlign ?? "inside"}
            >
              <option value="inside">Inside</option>
              <option value="center">Center</option>
              <option value="outside">Outside</option>
            </select>
          </label>
        </div>
      </fieldset>

      <AuthoringEffectsSection
        commitChange={commitChange}
        effects={effects.value}
        mixed={effects.mixed}
        previewChange={previewChange}
        selectionLabel={selectionLabel}
      />
    </>
  );
}
