import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  nodeAuthority,
  type ComponentInstanceBinding,
  type WorkbenchNode,
} from "./model.js";
import { CanvasNodeView, Inspector } from "./parts.js";

const source: ComponentInstanceBinding["source"] = {
  repositoryRevision: "a6ce2458",
  sourceAnchor: "src/components/Button.tsx",
  sourceContentHash: "sha256:button-source",
  exportName: "Button",
};

function componentNode(
  role: ComponentInstanceBinding["role"],
  text = "Follow",
): WorkbenchNode {
  return {
    id: `component-${role}`,
    kind: "ComponentInstance",
    name: `${role} component`,
    parentId: null,
    position: { x: 120, y: 160 },
    size: { width: role === "card" ? 280 : 132, height: 44 },
    locked: false,
    hidden: false,
    fill: "#13E889",
    text,
    component: {
      atomicLevel: role === "card" ? "molecule" : "atom",
      componentId: `buzzr-${role}`,
      componentName: `${role} component`,
      classification: "instance",
      editable: {
        icon: true,
        label: true,
        selected: role === "tab-item",
        variant: true,
      },
      masterId: `buzzr-${role}-master`,
      props: {
        ...(role === "button" ? { icon: "plus" } : {}),
        label: text,
        selected: role === "tab-item",
        ...(role === "card"
          ? { supportingText: "A semantic card description" }
          : {}),
      },
      role,
      source,
      variant: "default",
    },
  };
}

describe("editable component instances", () => {
  it("retains source provenance and master/component classification", () => {
    const node = componentNode("button");

    expect(node.kind).toBe("ComponentInstance");
    expect(node.component).toEqual({
      atomicLevel: "atom",
      componentId: "buzzr-button",
      componentName: "button component",
      classification: "instance",
      editable: {
        icon: true,
        label: true,
        selected: false,
        variant: true,
      },
      masterId: "buzzr-button-master",
      props: {
        icon: "plus",
        label: "Follow",
        selected: false,
      },
      role: "button",
      source,
      variant: "default",
    });
    expect(nodeAuthority(node)).toBe("design system component");
  });

  it.each([
    "button",
    "tab-bar",
    "tab-item",
    "card",
    "input",
    "badge",
    "header",
    "screen-shell",
  ] as const)(
    "renders a safe %s structure without interpreting label markup",
    (role) => {
      const hostileLabel = '<img src=x onerror="alert(1)">';
      render(
        <CanvasNodeView
          node={componentNode(role, hostileLabel)}
          onPointerDown={vi.fn()}
          onResizePointerDown={vi.fn()}
          onSelect={vi.fn()}
          selected
        />,
      );

      const preview = screen.getByTestId(`component-preview-${role}`);
      expect(preview.textContent).toContain(hostileLabel);
      expect(preview.querySelector("img")).toBeNull();
      expect(preview.getAttribute("data-component-classification")).toBe(
        "instance",
      );
      expect(
        screen.getByRole("button", {
          name: `Resize ${role} component southeast`,
        }),
      ).toBeTruthy();
      if (role === "button") {
        expect(preview.textContent).not.toContain("plus");
        expect(
          preview.querySelector('[data-source-icon="plus"]'),
        ).toBeTruthy();
      }
    },
  );

  it("distinguishes a component master from an instance", () => {
    const node = componentNode("button");
    const component = node.component!;
    const master: WorkbenchNode = {
      ...node,
      component: {
        atomicLevel: component.atomicLevel,
        componentId: component.componentId,
        componentName: component.componentName,
        classification: "master",
        editable: component.editable,
        props: component.props,
        role: component.role,
        source: component.source,
        ...(component.variant ? { variant: component.variant } : {}),
      },
    };

    render(
      <Inspector
        node={master}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onDetach={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByText("Master · atom · button")).toBeTruthy();
    expect(within(inspector).queryByText(/Master: /)).toBeNull();
  });

  it("immutably edits icon and selected instance properties", () => {
    const onChange = vi.fn();
    const node = componentNode("tab-item", "Games");
    render(
      <Inspector
        node={node}
        onChange={onChange}
        onDelete={vi.fn()}
        onDetach={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    const inspector = screen.getByRole("region", { name: "Inspector" });
    const iconField = within(inspector).getByRole("textbox", {
      name: "Icon",
    });
    fireEvent.change(iconField, { target: { value: "activity" } });
    fireEvent.blur(iconField);
    fireEvent.click(
      within(inspector).getByRole("checkbox", { name: "Selected" }),
    );

    const withIcon = onChange.mock.calls[0]?.[1](node);
    const deselected = onChange.mock.calls[1]?.[1](node);
    expect(withIcon.component.props.icon).toBe("activity");
    expect(deselected.component.props.selected).toBe(false);
    expect(withIcon.component).not.toBe(node.component);
    expect(deselected.component).not.toBe(node.component);
    expect(node.component?.props.icon).toBeUndefined();
    expect(node.component?.props.selected).toBe(true);
  });

  it("exposes explicit instance overrides and resets them immutably", () => {
    const onChange = vi.fn();
    const node = componentNode("button");
    render(
      <Inspector
        node={node}
        onChange={onChange}
        onDelete={vi.fn()}
        onDetach={vi.fn()}
        onDuplicate={vi.fn()}
      />,
    );

    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(
      within(inspector).getByText("4 overrides", { exact: true }),
    ).toBeTruthy();
    fireEvent.click(
      within(inspector).getByRole("button", {
        name: "Reset component label override",
      }),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    const resetLabel = onChange.mock.calls[0]?.[1](node);
    expect(resetLabel.component.props).toEqual({
      icon: "plus",
      selected: false,
    });
    expect(node.component?.props.label).toBe("Follow");

    fireEvent.click(
      within(inspector).getByRole("button", { name: "Reset all overrides" }),
    );
    const resetAll = onChange.mock.calls[1]?.[1](node);
    expect(resetAll.component.props).toEqual({});
    expect(resetAll.component.variant).toBeUndefined();
  });

  it("fails closed instead of crashing on an incomplete imported binding", () => {
    const node = {
      ...componentNode("button"),
      component: {
        componentId: "legacy-button",
        classification: "instance",
        role: "button",
      },
    } as unknown as WorkbenchNode;

    render(
      <>
        <CanvasNodeView
          node={node}
          onPointerDown={vi.fn()}
          onResizePointerDown={vi.fn()}
          onSelect={vi.fn()}
          selected
        />
        <Inspector
          node={node}
          onChange={vi.fn()}
          onDelete={vi.fn()}
          onDetach={vi.fn()}
          onDuplicate={vi.fn()}
        />
      </>,
    );

    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(within(inspector).getByText("button component")).toBeTruthy();
    expect(within(inspector).getByText("Design system component")).toBeTruthy();
    expect(
      screen.queryByRole("textbox", { name: "Component label" }),
    ).toBeNull();
  });

  it("edits label, fill, and bounds while exposing source provenance", () => {
    const onChange = vi.fn();
    const onOpenSource = vi.fn();
    const onOpenSourceInCursor = vi.fn();
    const node = componentNode("button");
    render(
      <Inspector
        node={node}
        onChange={onChange}
        onDelete={vi.fn()}
        onDetach={vi.fn()}
        onDuplicate={vi.fn()}
        onOpenSource={onOpenSource}
        onOpenSourceInCursor={onOpenSourceInCursor}
      />,
    );

    const inspector = screen.getByRole("region", { name: "Inspector" });
    expect(
      within(inspector).getByRole("group", { name: "Component" }),
    ).toBeTruthy();
    expect(
      within(inspector).getByRole("group", { name: "Appearance" }),
    ).toBeTruthy();
    expect(
      within(inspector).getByRole("group", { name: "Position" }),
    ).toBeTruthy();
    expect(
      within(inspector).getByRole("group", { name: "Layout" }),
    ).toBeTruthy();
    expect(
      within(inspector).getByText("Design system component"),
    ).toBeTruthy();
    expect(within(inspector).getByText("Instance · atom · button")).toBeTruthy();
    expect(
      within(inspector).getByText("src/components/Button.tsx · Button"),
    ).toBeTruthy();
    expect(
      within(inspector).getByText("Revision a6ce2458"),
    ).toBeTruthy();
    fireEvent.click(
      within(inspector).getByRole("button", { name: "Open in VS Code" }),
    );
    expect(onOpenSource).toHaveBeenCalledWith("src/components/Button.tsx");
    fireEvent.click(
      within(inspector).getByRole("button", { name: "Open in Cursor" }),
    );
    expect(onOpenSourceInCursor).toHaveBeenCalledWith(
      "src/components/Button.tsx",
    );

    const componentLabel = within(inspector).getByRole("textbox", {
      name: "Component label",
    });
    fireEvent.change(componentLabel, { target: { value: "Following" } });
    fireEvent.blur(componentLabel);
    const variant = within(inspector).getByRole("textbox", {
      name: "Variant",
    });
    fireEvent.change(variant, { target: { value: "secondary" } });
    fireEvent.blur(variant);
    const fill = within(inspector).getByRole("textbox", {
      name: "Fill color",
    });
    fireEvent.change(fill, { target: { value: "#FFFFFF" } });
    fireEvent.blur(fill);
    const width = within(inspector).getByRole("spinbutton", {
      name: "Width",
    });
    fireEvent.change(width, { target: { value: "240" } });
    fireEvent.blur(width);

    expect(onChange).toHaveBeenCalledTimes(4);
    const relabeled = onChange.mock.calls[0]?.[1](node);
    expect(relabeled.component.props.label).toBe("Following");
    expect(relabeled.component).not.toBe(node.component);
    expect(node.component?.props.label).toBe("Follow");
    expect(onChange.mock.calls[1]?.[1](node).component.variant).toBe(
      "secondary",
    );
    expect(onChange.mock.calls[2]?.[1](node).fill).toBe("#FFFFFF");
    expect(onChange.mock.calls[3]?.[1](node).size.width).toBe(240);
  });
});
