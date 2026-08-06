import type { WorkbenchIntentReceiptV3 } from "./workbench-v3-intents.js";
import { DEFAULT_WORKBENCH_LAYOUT, type WorkbenchNode } from "./model.js";
import {
  canvasTextFromWorkbench,
  textAppearanceChanged,
} from "./workbench-text-style.js";

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
    options?: Readonly<{ readonly selectedIds?: readonly string[] }>,
  ) => unknown;
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
  const groups: Exclude<
    WorkbenchIntentReceiptV3,
    { readonly kind: "batch" }
  >[] = [];
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
      left.opacity !== right.opacity ||
      left.hidden !== right.hidden ||
      left.locked !== right.locked,
  );
  if (moved.length) groups.push({ kind: "move", nodes: moved });
  if (resized.length) groups.push({ kind: "resize", nodes: resized });
  if (styled.length) groups.push({ kind: "style", nodes: styled });
  const names = changed((left, right) => left.name !== right.name);
  const text = changed((left, right) => {
    if (left.kind !== "Text" || right.kind !== "Text") return false;
    return (
      left.text !== right.text ||
      textAppearanceChanged(left, right)
    );
  });
  const layout = changed((left, right) => !equal(left.layout, right.layout));
  names.forEach((node) => groups.push({
    kind: "node.name",
    nodeId: node.id,
    next: node.name,
  }));
  text.forEach((node) => groups.push({
    kind: "node.text",
    nodeId: node.id,
    next: canvasTextFromWorkbench(node),
  }));
  layout.forEach((node) => groups.push({
    kind: "node.layout",
    nodeId: node.id,
    next: node.layout ?? DEFAULT_WORKBENCH_LAYOUT,
  }));
  changed((left, right) => !equal(left.component, right.component))
    .filter((node) => node.component?.classification === "master")
    .forEach((node) => groups.push({ kind: "component.update", node }));
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
      const after = projected(mutation);
      const receipt = receiptFor(before, after);
      if (receipt === null) return;
      const pending = input.commitIntentReceipt(mutation.label, receipt, {
        selectedIds: mutation.targetIds,
      });
      if (
        pending !== null &&
        typeof pending === "object" &&
        "then" in pending &&
        typeof pending.then === "function"
      ) {
        const targets = new Set(mutation.targetIds);
        input.setPreview(input.projectNodes.map((node) =>
          targets.has(node.id) ? mutation.update(node) : node
        ));
        // The V3 bridge owns reporting the original persistence failure. `finally`
        // mirrors that rejection onto a new promise, so consume only that derived
        // promise after cleanup to avoid an unhandled-rejection event in the UI.
        void Promise.resolve(pending)
          .finally(() => input.setPreview(null))
          .catch(() => undefined);
      } else {
        input.setPreview(null);
      }
    },
  });
}
