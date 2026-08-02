import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthoringPropertySections } from "./AuthoringPropertySections.js";
import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";
import { createCanonicalWorkbenchAuthority } from "./canonical-workbench-authority.js";
import {
  createSceneState,
  createSelectionState,
  replaceNode,
} from "./model.js";
import { createCanvasAutosave } from "./persistence.js";

function selectPromoPanel(): void {
  const tree = screen.getByRole("tree", { name: "Layers" });
  const drafts = within(tree).getByRole("treeitem", { name: "Drafts" });
  fireEvent.click(drafts.querySelector(".layer-group-row")!);
  fireEvent.click(
    within(tree).getByRole("treeitem", {
      name: /Promo panel.*Rectangle/,
    }),
  );
}

function selectCampaignCard(): void {
  fireEvent.click(
    screen.getByRole("button", { name: "Campaign card on canvas" }),
  );
}

function canvasPromoPanel(): HTMLElement {
  return screen
    .getByRole("button", { name: "Promo panel on canvas" })
    .closest<HTMLElement>("[data-node-id]")!;
}

function commitNumber(label: string, value: string): void {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

beforeEach(() => {
  localStorage.clear();
});

describe("professional authoring properties", () => {
  it("coalesces a numeric field session into one semantic change", () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const node = createSceneState(canvasWorkbenchFixture).nodes.find(
      ({ id }) => id === "node-promo-panel",
    )!;
    render(
      <AuthoringPropertySections
        node={node}
        onChange={onChange}
        onPreview={onPreview}
      />,
    );

    const width = screen.getByLabelText("Width");
    fireEvent.focus(width);
    fireEvent.change(width, { target: { value: "300" } });
    fireEvent.change(width, { target: { value: "304" } });
    fireEvent.change(width, { target: { value: "308" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenCalledTimes(3);
    expect(onPreview.mock.calls[2]?.[0](node).size.width).toBe(308);
    fireEvent.blur(width);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe("Resize Promo panel");
    expect(onChange.mock.calls[0]?.[1](node).size.width).toBe(308);
  });

  it("coalesces a typed color session until the field is committed", () => {
    const onChange = vi.fn();
    const onPreview = vi.fn();
    const node = createSceneState(canvasWorkbenchFixture).nodes.find(
      ({ id }) => id === "node-promo-panel",
    )!;
    render(
      <AuthoringPropertySections
        node={node}
        onChange={onChange}
        onPreview={onPreview}
      />,
    );

    const fill = screen.getByLabelText("Fill color");
    fireEvent.focus(fill);
    fireEvent.change(fill, { target: { value: "#111111" } });
    fireEvent.change(fill, { target: { value: "#222222" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview.mock.calls[1]?.[0](node).fill).toBe("#222222");
    fireEvent.blur(fill);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[1](node).fill).toBe("#222222");
  });

  it("projects mixed selection values and commits one selection transaction", () => {
    const onChange = vi.fn();
    const onChangeSelection = vi.fn();
    const first = createSceneState(canvasWorkbenchFixture).nodes.find(
      ({ id }) => id === "node-promo-panel",
    )!;
    const second = { ...first, id: "node-promo-panel-two", opacity: 0.5 };
    render(
      <AuthoringPropertySections
        node={first}
        onChange={onChange}
        onChangeSelection={onChangeSelection}
        selectedNodes={[first, second]}
      />,
    );

    const opacity = screen.getByLabelText("Opacity") as HTMLInputElement;
    expect(opacity.value).toBe("");
    expect(opacity.placeholder).toBe("Mixed");
    fireEvent.change(opacity, { target: { value: "75" } });
    fireEvent.blur(opacity);

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeSelection).toHaveBeenCalledTimes(1);
    const transaction = onChangeSelection.mock.calls[0]?.[0];
    expect(transaction.targetIds).toEqual([
      "node-promo-panel",
      "node-promo-panel-two",
    ]);
    expect(transaction.update(first).opacity).toBe(0.75);
    expect(transaction.update(second).opacity).toBe(0.75);
  });

  it("supports independent corner radii without destroying the other corners", () => {
    const onChange = vi.fn();
    const node = {
      ...createSceneState(canvasWorkbenchFixture).nodes.find(
        ({ id }) => id === "node-promo-panel",
      )!,
      cornerRadii: [4, 8, 12, 16] as const,
    };
    render(<AuthoringPropertySections node={node} onChange={onChange} />);

    expect(screen.getByLabelText("Radius top left")).toBeTruthy();
    const topRight = screen.getByLabelText("Radius top right");
    fireEvent.change(topRight, { target: { value: "20" } });
    fireEvent.keyDown(topRight, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[1](node).cornerRadii).toEqual([
      4, 20, 12, 16,
    ]);
    expect(
      screen
        .getByRole("button", { name: "Link corner radii" })
        .getAttribute("title"),
    ).toBe("Link corner radii");
  });

  it("resynchronizes the corner mode when the selected node changes externally", () => {
    const onChange = vi.fn();
    const node = createSceneState(canvasWorkbenchFixture).nodes.find(
      ({ id }) => id === "node-promo-panel",
    )!;
    const view = render(
      <AuthoringPropertySections node={node} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Corner radius")).toBeTruthy();

    view.rerender(
      <AuthoringPropertySections
        node={{ ...node, cornerRadii: [4, 8, 12, 16] }}
        onChange={onChange}
      />,
    );

    expect(screen.getByLabelText("Radius top left")).toBeTruthy();
    expect(screen.queryByLabelText("Corner radius")).toBeNull();
  });

  it("keeps a zero-width stroke hidden when only its color changes", () => {
    const onChange = vi.fn();
    const node = {
      ...createSceneState(canvasWorkbenchFixture).nodes.find(
        ({ id }) => id === "node-promo-panel",
      )!,
      stroke: "#111111",
      strokeWeight: 0,
    };
    render(<AuthoringPropertySections node={node} onChange={onChange} />);

    const stroke = screen.getByLabelText("Stroke color");
    fireEvent.change(stroke, { target: { value: "#222222" } });
    fireEvent.blur(stroke);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[1](node)).toMatchObject({
      stroke: "#222222",
      strokeWeight: 0,
    });
  });

  it("authors gap and independent padding sides for eligible containers as undoable commands", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);
    selectPromoPanel();
    expect(screen.queryByLabelText("Gap")).toBeNull();

    selectCampaignCard();
    commitNumber("Gap", "12");
    commitNumber("Padding top", "16");
    commitNumber("Padding right", "20");
    commitNumber("Padding bottom", "24");
    commitNumber("Padding left", "28");

    expect((screen.getByLabelText("Gap") as HTMLInputElement).value).toBe(
      "12",
    );
    expect(
      (screen.getByLabelText("Padding top") as HTMLInputElement).value,
    ).toBe("16");
    expect(
      (screen.getByLabelText("Padding right") as HTMLInputElement).value,
    ).toBe("20");
    expect(
      (screen.getByLabelText("Padding bottom") as HTMLInputElement).value,
    ).toBe("24");
    expect(
      (screen.getByLabelText("Padding left") as HTMLInputElement).value,
    ).toBe("28");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      (screen.getByLabelText("Padding left") as HTMLInputElement).value,
    ).toBe("0");
    expect(
      (screen.getByLabelText("Padding bottom") as HTMLInputElement).value,
    ).toBe("24");
  });

  it("edits transform, appearance, fill, and stroke through structured inspector controls", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);
    selectPromoPanel();
    expect(
      (screen.getByLabelText("Fill swatch") as HTMLInputElement).value,
    ).toBe("#dbeafe");

    commitNumber("Rotation", "15");
    commitNumber("Opacity", "64");
    commitNumber("Corner radius", "18");
    const fillColor = screen.getByLabelText("Fill color");
    fireEvent.change(fillColor, {
      target: { value: "#" },
    });
    expect((fillColor as HTMLInputElement).value).toBe("#");
    expect(
      within(canvasPromoPanel()).getByRole("button", {
        name: "Promo panel on canvas",
      }).style.backgroundColor,
    ).toBe("rgb(219, 234, 254)");
    fireEvent.change(fillColor, {
      target: { value: "#ff5470" },
    });
    fireEvent.blur(fillColor);
    const strokeColor = screen.getByLabelText("Stroke color");
    fireEvent.change(strokeColor, {
      target: { value: "#111111" },
    });
    fireEvent.blur(strokeColor);
    commitNumber("Stroke weight", "3");

    const node = canvasPromoPanel();
    const surface = within(node).getByRole("button", {
      name: "Promo panel on canvas",
    });
    expect(node.style.transform).toBe("rotate(15deg)");
    expect(node.style.opacity).toBe("0.64");
    expect(surface.style.backgroundColor).toBe("rgb(255, 84, 112)");
    expect(surface.style.borderRadius).toBe("18px");
    expect(surface.style.borderColor).toBe("rgb(17, 17, 17)");
    expect(surface.style.borderWidth).toBe("3px");
  });

  it("previews inspector values immediately and commits one history entry on blur", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);
    selectPromoPanel();

    const cornerRadius = screen.getByLabelText("Corner radius");
    fireEvent.change(cornerRadius, { target: { value: "4" } });

    const surface = within(canvasPromoPanel()).getByRole("button", {
      name: "Promo panel on canvas",
    });
    expect(surface.style.borderRadius).toBe("4px");

    fireEvent.blur(cornerRadius);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(surface.style.borderRadius).toBe("0px");
  });

  it("previews a typed stroke weight without concatenating the committed value", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);
    selectPromoPanel();

    const strokeColor = screen.getByLabelText("Stroke color");
    fireEvent.focus(strokeColor);
    fireEvent.change(strokeColor, { target: { value: "#111111" } });
    const strokeWeight = screen.getByLabelText(
      "Stroke weight",
    ) as HTMLInputElement;
    act(() => {
      fireEvent.blur(strokeColor);
      fireEvent.focus(strokeWeight);
    });
    fireEvent.change(strokeWeight, { target: { value: "" } });
    expect(strokeWeight.value).toBe("");
    fireEvent.change(strokeWeight, {
      target: { value: "3" },
    });
    expect(strokeWeight.value).toBe("3");

    const surface = within(canvasPromoPanel()).getByRole("button", {
      name: "Promo panel on canvas",
    });
    expect(surface.style.borderWidth).toBe("3px");
  });

  it("records each completed property edit as an undoable semantic command", () => {
    render(<CanvasWorkbench project={canvasWorkbenchFixture} />);
    selectPromoPanel();

    commitNumber("Corner radius", "12");
    expect(
      within(canvasPromoPanel()).getByRole("button", {
        name: "Promo panel on canvas",
      }).style.borderRadius,
    ).toBe("12px");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      within(canvasPromoPanel()).getByRole("button", {
        name: "Promo panel on canvas",
      }).style.borderRadius,
    ).toBe("0px");
  });

  it("preserves authored properties through canonical operations and local recovery", () => {
    const initial = createSceneState(canvasWorkbenchFixture);
    const authoredNodes = replaceNode(
      initial.nodes,
      "node-promo-panel",
      (node) => ({
        ...node,
        rotation: 12,
        opacity: 0.72,
        cornerRadii: [10, 10, 10, 10] as const,
        layout: {
          alignCounter: "stretch",
          alignPrimary: "center",
          gap: 12,
          mode: "vertical",
          padding: { top: 16, right: 20, bottom: 24, left: 28 },
          sizingHorizontal: "fixed",
          sizingVertical: "fixed",
          wrap: false,
        },
        stroke: "#111111",
        strokeWeight: 2,
        strokeAlign: "inside" as const,
      }),
    );
    const authority = createCanonicalWorkbenchAuthority({
      documentId: canvasWorkbenchFixture.document.id,
      projectId: canvasWorkbenchFixture.id,
      scene: initial,
    });
    authority.commit({
      actor: "human",
      label: "Style Promo panel",
      nodes: authoredNodes,
      selection: createSelectionState(["node-promo-panel"]),
      targetIds: ["node-promo-panel"],
    });

    const snapshot = authority.getSnapshot();
    const projected = snapshot.nodes.find(
      ({ id }) => id === "node-promo-panel",
    );
    const canonical = Object.values(snapshot.document.nodesById).find(
      ({ name }) => name === "Promo panel",
    );
    expect(projected).toMatchObject({
      rotation: 12,
      opacity: 0.72,
      cornerRadii: [10, 10, 10, 10],
      layout: {
        gap: 12,
        padding: { top: 16, right: 20, bottom: 24, left: 28 },
      },
      stroke: "#111111",
      strokeWeight: 2,
      strokeAlign: "inside",
    });
    expect(canonical).toMatchObject({
      transform: { rotation: 12 },
      style: {
        opacity: 0.72,
        cornerRadii: [10, 10, 10, 10],
        strokeWeight: 2,
        strokeAlign: "inside",
      },
      layout: {
        gap: 12,
        padding: { top: 16, right: 20, bottom: 24, left: 28 },
      },
    });

    const autosave = createCanvasAutosave(localStorage);
    const recoveredScene = {
      ...initial,
      nodes: snapshot.nodes,
      selectedNodeId: "node-promo-panel",
    };
    expect(
      autosave.save(canvasWorkbenchFixture, recoveredScene, []),
    ).toBe(true);
    expect(
      autosave
        .load(canvasWorkbenchFixture)
        ?.scene.nodes.find(({ id }) => id === "node-promo-panel"),
    ).toMatchObject({
      rotation: 12,
      opacity: 0.72,
      cornerRadii: [10, 10, 10, 10],
      layout: {
        gap: 12,
        padding: { top: 16, right: 20, bottom: 24, left: 28 },
      },
      strokeWeight: 2,
      strokeAlign: "inside",
    });
  });
});
