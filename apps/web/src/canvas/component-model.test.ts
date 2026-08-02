import { describe, expect, it } from "vitest";

import {
  componentOverrideKeys,
  resolveComponentInstanceBinding,
  resetAllComponentOverrides,
  resetComponentOverride,
  type ComponentInstanceBinding,
} from "./component-model.js";
import { resolveComponentInstance, type WorkbenchNode } from "./model.js";

function master(
  props: ComponentInstanceBinding["props"],
  variant = "default",
): ComponentInstanceBinding {
  return {
    atomicLevel: "molecule",
    classification: "master",
    componentId: "local:document:card",
    componentName: "Card",
    editable: {
      icon: true,
      label: true,
      selected: true,
      variant: true,
    },
    props,
    role: "card",
    source: {
      repositoryRevision: "local:document",
      sourceAnchor: "canvas://document/card",
    },
    variant,
  };
}

function instance(): ComponentInstanceBinding {
  return {
    ...master({}),
    classification: "instance",
    masterId: "card-master",
    props: {
      label: "Instance title",
      selected: false,
    },
    variant: "featured",
  };
}

describe("component master propagation", () => {
  it("uses the shared resolver in the production WorkbenchNode projection", () => {
    const definition = {
      ...master({ label: "Updated master", supportingText: "Detail" }),
      componentName: "Renamed Card",
    };
    const masterNode: WorkbenchNode = {
      hidden: false,
      id: "card-master",
      kind: "Component",
      locked: false,
      name: "Card master",
      parentId: null,
      position: { x: 0, y: 0 },
      size: { height: 80, width: 180 },
      component: definition,
    };
    const instanceNode: WorkbenchNode = {
      hidden: false,
      id: "card-instance",
      kind: "ComponentInstance",
      locked: false,
      name: "Card instance",
      parentId: null,
      position: { x: 240, y: 0 },
      size: { height: 80, width: 180 },
      component: instance(),
    };

    const resolved = resolveComponentInstance(instanceNode, [
      masterNode,
      instanceNode,
    ]);

    expect(resolved.component).toMatchObject({
      classification: "instance",
      componentName: "Renamed Card",
      masterId: "card-master",
      props: {
        label: "Instance title",
        selected: false,
        supportingText: "Detail",
      },
      variant: "featured",
    });
    expect(instanceNode.component?.componentName).toBe("Card");
  });

  it("enumerates and resets explicit overrides without mutating masters", () => {
    const binding = instance();
    const definition = master({ label: "Master" });

    expect(componentOverrideKeys(binding)).toEqual([
      "label",
      "selected",
      "variant",
    ]);
    const { variant: _variant, ...bindingWithoutVariant } = binding;
    expect(componentOverrideKeys(bindingWithoutVariant)).toEqual([
      "label",
      "selected",
    ]);
    expect(componentOverrideKeys(definition)).toEqual([]);
    expect(resetComponentOverride(binding, "variant")).toEqual({
      ...binding,
      variant: undefined,
    });
    expect(resetComponentOverride(definition, "label")).toBe(definition);
    expect(resetAllComponentOverrides(binding)).toEqual({
      ...binding,
      props: {},
      variant: undefined,
    });
    expect(resetAllComponentOverrides(definition)).toBe(definition);
  });

  it("propagates master changes while preserving explicit instance overrides", () => {
    const binding = instance();
    const updatedMaster = master({
      icon: "sparkles",
      label: "Updated master title",
      selected: true,
      supportingText: "Updated master detail",
    }, "quiet");

    const resolved = resolveComponentInstanceBinding(updatedMaster, binding);

    expect(resolved).toMatchObject({
      classification: "instance",
      masterId: "card-master",
      props: {
        icon: "sparkles",
        label: "Instance title",
        selected: false,
        supportingText: "Updated master detail",
      },
      variant: "featured",
    });
    expect(binding.props).toEqual({
      label: "Instance title",
      selected: false,
    });
    expect(updatedMaster.props.label).toBe("Updated master title");
  });

  it("uses the latest master value after an explicit override is reset", () => {
    const binding = resetComponentOverride(instance(), "label");
    const updatedMaster = master({
      label: "Latest master title",
      supportingText: "Latest detail",
    });

    expect(
      resolveComponentInstanceBinding(updatedMaster, binding).props,
    ).toEqual({
      label: "Latest master title",
      selected: false,
      supportingText: "Latest detail",
    });
  });

  it("fails closed for unrelated or malformed master-instance pairs", () => {
    const binding = instance();
    const unrelated = {
      ...master({ label: "Wrong component" }),
      componentId: "local:document:other",
    };

    expect(resolveComponentInstanceBinding(unrelated, binding)).toBe(binding);
    expect(
      resolveComponentInstanceBinding(binding, binding),
    ).toBe(binding);

    const { masterId: _masterId, ...withoutMasterId } = binding;
    expect(
      resolveComponentInstanceBinding(master({ label: "Master" }), withoutMasterId),
    ).toBe(withoutMasterId);
  });

  it("omits variant when neither master nor instance defines one", () => {
    const definition = master({ label: "Master" });
    const { variant: _masterVariant, ...masterWithoutVariant } = definition;
    const binding = instance();
    const { variant: _instanceVariant, ...instanceWithoutVariant } = binding;

    expect(
      resolveComponentInstanceBinding(
        masterWithoutVariant,
        instanceWithoutVariant,
      ),
    ).not.toHaveProperty("variant");
  });
});
