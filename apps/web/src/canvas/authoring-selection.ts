import type { WorkbenchLayout, WorkbenchNode } from "./model.js";

export type SharedAuthoringValue<T> =
  | { readonly kind: "shared"; readonly value: T }
  | { readonly kind: "mixed" }
  | { readonly kind: "unavailable" };

export interface SharedAuthoringProperties {
  readonly cornerRadii: SharedAuthoringValue<
    readonly [number, number, number, number] | undefined
  >;
  readonly fill: SharedAuthoringValue<string | undefined>;
  readonly effects: SharedAuthoringValue<WorkbenchNode["effects"]>;
  readonly gap: SharedAuthoringValue<number | undefined>;
  readonly height: SharedAuthoringValue<number>;
  readonly layoutMode: SharedAuthoringValue<
    WorkbenchLayout["mode"] | undefined
  >;
  readonly opacity: SharedAuthoringValue<number>;
  readonly padding: SharedAuthoringValue<
    WorkbenchLayout["padding"] | undefined
  >;
  readonly rotation: SharedAuthoringValue<number>;
  readonly stroke: SharedAuthoringValue<string | undefined>;
  readonly strokeWeight: SharedAuthoringValue<number | undefined>;
  readonly text: SharedAuthoringValue<string | undefined>;
  readonly fontFamily: SharedAuthoringValue<string | undefined>;
  readonly fontSize: SharedAuthoringValue<number | undefined>;
  readonly fontWeight: SharedAuthoringValue<number | undefined>;
  readonly letterSpacing: SharedAuthoringValue<number | undefined>;
  readonly lineHeight: SharedAuthoringValue<number | undefined>;
  readonly textAlign: SharedAuthoringValue<
    WorkbenchNode["textAlign"]
  >;
  readonly width: SharedAuthoringValue<number>;
  readonly x: SharedAuthoringValue<number>;
  readonly y: SharedAuthoringValue<number>;
}

export interface AuthoringSelectionTransaction {
  readonly label: string;
  readonly targetIds: readonly string[];
  readonly update: (node: WorkbenchNode) => WorkbenchNode;
}

export function createAuthoringSelectionTransaction(
  label: string,
  nodes: readonly WorkbenchNode[],
  update: (node: WorkbenchNode) => WorkbenchNode,
): AuthoringSelectionTransaction {
  const targetIds = Object.freeze([...new Set(nodes.map(({ id }) => id))]);
  return Object.freeze({
    label,
    targetIds,
    update,
  });
}

function equalValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => equalValue(value, right[index]))
    );
  }
  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null
  ) {
    const leftRecord = left as Readonly<Record<string, unknown>>;
    const rightRecord = right as Readonly<Record<string, unknown>>;
    const keys = Object.keys(leftRecord);
    return (
      keys.length === Object.keys(rightRecord).length &&
      keys.every((key) => equalValue(leftRecord[key], rightRecord[key]))
    );
  }
  return false;
}

function sharedValue<T>(
  nodes: readonly WorkbenchNode[],
  read: (node: WorkbenchNode) => T,
): SharedAuthoringValue<T> {
  const first = nodes[0];
  if (first === undefined) {
    return { kind: "unavailable" };
  }
  const value = read(first);
  return nodes.slice(1).every((node) => equalValue(read(node), value))
    ? { kind: "shared", value }
    : { kind: "mixed" };
}

/**
 * Pure selection projection for a future multi-node inspector. The workbench
 * can consume this without giving the inspector ownership of selection state.
 */
export function sharedAuthoringProperties(
  nodes: readonly WorkbenchNode[],
): SharedAuthoringProperties {
  return {
    cornerRadii: sharedValue(nodes, (node) => node.cornerRadii),
    effects: sharedValue(nodes, (node) => node.effects),
    fill: sharedValue(nodes, (node) => node.fill),
    gap: sharedValue(nodes, (node) => node.layout?.gap),
    height: sharedValue(nodes, (node) => node.size.height),
    layoutMode: sharedValue(nodes, (node) => node.layout?.mode),
    opacity: sharedValue(nodes, (node) => node.opacity ?? 1),
    padding: sharedValue(nodes, (node) => node.layout?.padding),
    rotation: sharedValue(nodes, (node) => node.rotation ?? 0),
    stroke: sharedValue(nodes, (node) => node.stroke),
    strokeWeight: sharedValue(nodes, (node) => node.strokeWeight),
    text: sharedValue(nodes, (node) => node.text),
    fontFamily: sharedValue(nodes, (node) => node.fontFamily),
    fontSize: sharedValue(nodes, (node) => node.fontSize),
    fontWeight: sharedValue(nodes, (node) => node.fontWeight),
    letterSpacing: sharedValue(nodes, (node) => node.letterSpacing),
    lineHeight: sharedValue(nodes, (node) => node.lineHeight),
    textAlign: sharedValue(nodes, (node) => node.textAlign),
    width: sharedValue(nodes, (node) => node.size.width),
    x: sharedValue(nodes, (node) => node.position.x),
    y: sharedValue(nodes, (node) => node.position.y),
  };
}
