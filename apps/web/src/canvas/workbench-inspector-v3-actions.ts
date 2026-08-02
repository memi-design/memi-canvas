import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";
import { DEFAULT_WORKBENCH_LAYOUT, type WorkbenchNode } from "./model.js";

export interface InspectorV3Mutation {
  readonly label: string;
  readonly targetIds: readonly string[];
  readonly update: (node: WorkbenchNode) => WorkbenchNode;
}

export interface WorkbenchInspectorV3Actions {
  preview(mutation: InspectorV3Mutation): void;
  commit(mutation: InspectorV3Mutation): void;
  clearPreview(): void;
}

export interface CreateWorkbenchInspectorV3ActionsInput {
  readonly commitIntentReceipt: (
    label: string,
    receipt: WorkbenchIntentReceiptV3,
    options?: Readonly<{ readonly actor: "human" }>,
  ) => void;
  readonly projectNodes: readonly WorkbenchNode[];
  readonly setPreview: (nodes: readonly WorkbenchNode[] | null) => void;
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length &&
      left.every((value, index) => equal(value, right[index]));
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
    return keys.length === Object.keys(rightRecord).length &&
      keys.every((key) => equal(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function receiptFor(
  before: readonly WorkbenchNode[],
  after: readonly WorkbenchNode[],
): WorkbenchIntentReceiptV3 | null {
  const groups: WorkbenchIntentReceiptV3[] = [];
  const changed = (
    predicate: (left: WorkbenchNode, right: WorkbenchNode) => boolean,
  ) => after.filter((node, index) => {
    const prior = before[index];
    return prior !== undefined && predicate(prior, node);
  });
  const moved = changed(
    (left, right) =>
      !equal(left.position, right.position) || left.rotation !== right.rotation,
  );
  const resized = changed((left, right) => !equal(left.size, right.size));
  const styled = changed(
    (left, right) =>
      !equal(left.cornerRadii, right.cornerRadii) ||
      left.fill !== right.fill ||
      left.stroke !== right.stroke ||
      left.strokeAlign !== right.strokeAlign ||
      left.strokeWeight !== right.strokeWeight ||
      left.opacity !== right.opacity,
  );
  if (moved.length) groups.push({ kind: "move", nodes: moved });
  if (resized.length) groups.push({ kind: "resize", nodes: resized });
  if (styled.length) groups.push({ kind: "style", nodes: styled });
  const names = changed((left, right) => left.name !== right.name);
  const text = changed((left, right) => left.kind === "Text" && right.kind === "Text" && left.text !== right.text);
  const layout = changed((left, right) => !equal(left.layout, right.layout));
  names.forEach((node) => groups.push({
    kind: "node.name",
    nodeId: node.id,
    next: node.name,
  }));
  text.forEach((node) => groups.push({
    kind: "node.text",
    nodeId: node.id,
    next: { autoResize: "width-height", characters: node.text ?? node.frameContent ?? node.name },
  } as WorkbenchIntentReceiptV3));
  layout.forEach((node) => groups.push({
    kind: "node.layout",
    nodeId: node.id,
    next: node.layout ?? DEFAULT_WORKBENCH_LAYOUT,
  } as WorkbenchIntentReceiptV3));
  if (!groups.length) return null;
  const only = groups[0];
  return groups.length === 1 && only !== undefined
    ? only
    : { kind: "batch", receipts: groups };
}

/** Inspector bridge: previews are memory-only; commits enqueue one receipt. */
export function createWorkbenchInspectorV3Actions(
  input: CreateWorkbenchInspectorV3ActionsInput,
): WorkbenchInspectorV3Actions {
  const projected = (mutation: InspectorV3Mutation) => {
    const targets = new Set(mutation.targetIds);
    return input.projectNodes.filter((node) => targets.has(node.id)).map(mutation.update);
  };
  return Object.freeze({
    preview(mutation: InspectorV3Mutation) {
      const targets = new Set(mutation.targetIds);
      input.setPreview(input.projectNodes.map((node) =>
        targets.has(node.id) ? mutation.update(node) : node
      ));
    },
    clearPreview() { input.setPreview(null); },
    commit(mutation: InspectorV3Mutation) {
      const before = input.projectNodes.filter((node) => mutation.targetIds.includes(node.id));
      const receipt = receiptFor(before, projected(mutation));
      if (receipt === null) return;
      input.commitIntentReceipt(mutation.label, receipt, { actor: "human" });
      input.setPreview(null);
    },
  });
}
