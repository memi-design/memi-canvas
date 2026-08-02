export type AtomicDesignLevel =
  | "atom"
  | "molecule"
  | "organism"
  | "template"
  | "page";

export type ComponentPreviewRole =
  | "button"
  | "tab-bar"
  | "tab-item"
  | "card"
  | "input"
  | "badge"
  | "header"
  | "screen-shell";

export interface ComponentSourceProvenance {
  readonly repositoryRevision: string;
  readonly repositoryDirty?: boolean;
  readonly sourceAnchor: string;
  readonly sourceContentHash?: string;
  readonly exportName?: string;
}

export interface ComponentPreviewItem {
  readonly icon?: string;
  readonly label: string;
  readonly status?: string;
  readonly supportingText?: string;
  readonly value?: string;
}

export interface ComponentInstanceBinding {
  readonly atomicLevel: AtomicDesignLevel;
  readonly componentId: string;
  readonly componentName: string;
  readonly classification: "master" | "instance";
  readonly editable: {
    readonly label: boolean;
    readonly icon: boolean;
    readonly selected: boolean;
    readonly variant: boolean;
  };
  readonly masterId?: string;
  readonly props: {
    readonly label?: string;
    readonly icon?: string;
    readonly selected?: boolean;
    readonly supportingText?: string;
    readonly placeholder?: string;
    readonly status?: string;
    readonly value?: string;
    readonly items?: readonly ComponentPreviewItem[];
  };
  readonly role: ComponentPreviewRole;
  readonly source: ComponentSourceProvenance;
  readonly variant?: string;
}

export type ComponentOverrideKey =
  | keyof ComponentInstanceBinding["props"]
  | "variant";

export function componentOverrideKeys(
  component: ComponentInstanceBinding,
): readonly ComponentOverrideKey[] {
  if (component.classification !== "instance") {
    return [];
  }
  return [
    ...Object.keys(component.props),
    ...(component.variant === undefined ? [] : ["variant"]),
  ] as ComponentOverrideKey[];
}

export function resetComponentOverride(
  component: ComponentInstanceBinding,
  key: ComponentOverrideKey,
): ComponentInstanceBinding {
  if (component.classification !== "instance") {
    return component;
  }
  if (key === "variant") {
    const { variant: _variant, ...withoutVariant } = component;
    return withoutVariant;
  }
  const { [key]: _removed, ...props } = component.props;
  return { ...component, props };
}

export function resetAllComponentOverrides(
  component: ComponentInstanceBinding,
): ComponentInstanceBinding {
  if (component.classification !== "instance") {
    return component;
  }
  const { variant: _variant, ...withoutVariant } = component;
  return { ...withoutVariant, props: {} };
}

/**
 * Resolves a component instance for rendering without writing inherited
 * values back into its explicit override map. This distinction is what lets a
 * later master edit propagate while user-authored instance values remain
 * stable and resettable.
 */
export function resolveComponentInstanceBinding(
  master: ComponentInstanceBinding,
  instance: ComponentInstanceBinding,
): ComponentInstanceBinding {
  if (
    master.classification !== "master" ||
    instance.classification !== "instance" ||
    master.componentId !== instance.componentId ||
    instance.masterId === undefined
  ) {
    return instance;
  }
  const resolvedVariant = instance.variant ?? master.variant;
  const resolved = {
    ...master,
    classification: "instance" as const,
    masterId: instance.masterId,
    props: { ...master.props, ...instance.props },
  };
  if (resolvedVariant === undefined) {
    const { variant: _variant, ...withoutVariant } = resolved;
    return withoutVariant;
  }
  return { ...resolved, variant: resolvedVariant };
}
