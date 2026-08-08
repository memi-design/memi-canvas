import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { WorkbenchNode } from "./model.js";
import { useWorkbenchNodeReservation } from "./useWorkbenchNodeReservation.js";

function rectangle(id: string): WorkbenchNode {
  return {
    hidden: false,
    id,
    kind: "Rectangle",
    locked: false,
    name: id,
    parentId: null,
    position: { x: 0, y: 0 },
    size: { height: 40, width: 60 },
  };
}

describe("workbench node reservation", () => {
  it("survives same-revision rerenders and reconciles on canonical advance", () => {
    const source = rectangle("card");
    const optimistic = [source, rectangle("card-copy-1")];
    const canonical = [source, ...optimistic.slice(1), rectangle("card-copy-2")];
    const { result, rerender } = renderHook(
      ({ nodes, revision }) => useWorkbenchNodeReservation(nodes, revision),
      { initialProps: { nodes: [source], revision: 1 } },
    );

    act(() => result.current.set(optimistic));
    rerender({ nodes: [source], revision: 1 });
    expect(result.current.get()).toEqual(optimistic);

    rerender({ nodes: canonical, revision: 2 });
    expect(result.current.get()).toEqual(canonical);
  });

  it("invalidates delayed work when the owning canvas unmounts", () => {
    const { result, unmount } = renderHook(() =>
      useWorkbenchNodeReservation([rectangle("card")], 1, "page-a"),
    );
    const scope = result.current.getScope();
    expect(result.current.isScopeCurrent(scope)).toBe(true);

    unmount();

    expect(result.current.isScopeCurrent(scope)).toBe(false);
  });
});
