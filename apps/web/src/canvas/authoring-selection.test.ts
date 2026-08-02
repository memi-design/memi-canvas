import { describe, expect, it } from "vitest";

import {
  createAuthoringSelectionTransaction,
  sharedAuthoringProperties,
} from "./authoring-selection.js";
import type { WorkbenchNode } from "./model.js";

function rectangle(
  id: string,
  overrides: Partial<WorkbenchNode> = {},
): WorkbenchNode {
  return {
    id,
    kind: "Rectangle",
    name: id,
    parentId: null,
    position: { x: 0, y: 0 },
    size: { height: 100, width: 100 },
    hidden: false,
    locked: false,
    fill: "#ff5470",
    opacity: 1,
    cornerRadii: [8, 8, 8, 8],
    ...overrides,
  };
}

describe("shared authoring properties", () => {
  it("returns shared values while marking only divergent fields as mixed", () => {
    const shared = sharedAuthoringProperties([
      rectangle("one"),
      rectangle("two", { opacity: 0.5 }),
    ]);

    expect(shared.fill).toEqual({ kind: "shared", value: "#ff5470" });
    expect(shared.opacity).toEqual({ kind: "mixed" });
    expect(shared.cornerRadii).toEqual({
      kind: "shared",
      value: [8, 8, 8, 8],
    });
  });

  it("returns unavailable values for an empty selection", () => {
    const shared = sharedAuthoringProperties([]);

    expect(shared.fill).toEqual({ kind: "unavailable" });
    expect(shared.width).toEqual({ kind: "unavailable" });
  });

  it("creates one immutable transaction target set for a selection", () => {
    const one = rectangle("one");
    const two = rectangle("two");
    const transaction = createAuthoringSelectionTransaction(
      "Set selection opacity",
      [one, two, one],
      (node) => ({ ...node, opacity: 0.75 }),
    );

    expect(transaction.label).toBe("Set selection opacity");
    expect(transaction.targetIds).toEqual(["one", "two"]);
    expect(Object.isFrozen(transaction)).toBe(true);
    expect(Object.isFrozen(transaction.targetIds)).toBe(true);
    expect(transaction.update(one)).toMatchObject({ opacity: 0.75 });
    expect(one.opacity).toBe(1);
  });
});
