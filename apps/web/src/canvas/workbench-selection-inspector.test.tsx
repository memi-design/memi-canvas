import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createSceneState } from "./model.js";
import { Inspector } from "./parts.js";

describe("operation-native selection inspector seam", () => {
  it("coalesces inspector text editing into one operation on commit", () => {
    const node = createSceneState(canvasWorkbenchFixture).nodes.find(
      ({ id }) => id === "node-promo-panel",
    )!;
    const onChange = vi.fn();
    render(
      <Inspector
        node={node}
        onChange={onChange}
        onDelete={() => undefined}
        onDetach={() => undefined}
        onDuplicate={() => undefined}
      />,
    );

    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Promo" } });
    fireEvent.change(name, { target: { value: "Promo card" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(name);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[1](node).name).toBe("Promo card");
  });

  it("forwards the complete selection as one authoring transaction", () => {
    const first = createSceneState(canvasWorkbenchFixture).nodes.find(
      ({ id }) => id === "node-promo-panel",
    )!;
    const second = {
      ...first,
      id: "node-promo-panel-two",
      opacity: 0.5,
    };
    const onChange = vi.fn();
    const onChangeSelection = vi.fn();
    render(
      <Inspector
        node={first}
        onChange={onChange}
        onChangeSelection={onChangeSelection}
        onDelete={() => undefined}
        onDetach={() => undefined}
        onDuplicate={() => undefined}
        selectedNodes={[first, second]}
      />,
    );

    const opacity = screen.getByLabelText("Opacity") as HTMLInputElement;
    expect(opacity.placeholder).toBe("Mixed");
    fireEvent.change(opacity, { target: { value: "75" } });
    fireEvent.blur(opacity);

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeSelection).toHaveBeenCalledTimes(1);
    expect(onChangeSelection.mock.calls[0]?.[0].targetIds).toEqual([
      first.id,
      second.id,
    ]);
  });
});
