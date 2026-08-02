import { AuthoringTextField } from "./authoring-field.js";
import {
  componentOverrideKeys,
  resetAllComponentOverrides,
  resetComponentOverride,
  type ComponentOverrideKey,
} from "./component-model.js";
import { EditorIcon } from "./icons.js";
import type {
  ComponentInstanceBinding,
  WorkbenchNode,
} from "./model.js";

function ComponentPreviewItems({
  items,
}: {
  readonly items: NonNullable<ComponentInstanceBinding["props"]["items"]>;
}) {
  return (
    <span className="component-preview__items">
      {items.map((item, index) => (
        <span
          className="component-preview__item"
          key={`${item.label}-${index}`}
        >
          {item.icon ? (
            <span aria-hidden="true" className="component-preview__icon">
              <SourceComponentIcon name={item.icon} />
            </span>
          ) : null}
          <span className="component-preview__item-copy">
            <strong>{item.label}</strong>
            {item.supportingText ? (
              <small>{item.supportingText}</small>
            ) : null}
          </span>
          {item.status || item.value ? (
            <span className="component-preview__item-meta">
              {item.status ? <small>{item.status}</small> : null}
              {item.value ? <strong>{item.value}</strong> : null}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

export type ComponentNodeChange = (
  label: string,
  update: (node: WorkbenchNode) => WorkbenchNode,
) => void;

function SourceComponentIcon({ name }: { readonly name: string }) {
  const normalized = name.toLowerCase();
  let glyph: React.ReactNode;
  if (normalized === "search") {
    glyph = (
      <>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4 4" />
      </>
    );
  } else if (normalized === "bell") {
    glyph = (
      <>
        <path d="M6 16h12l-1.5-2.5V10a4.5 4.5 0 0 0-9 0v3.5L6 16Z" />
        <path d="M10 19h4" />
      </>
    );
  } else if (normalized === "user") {
    glyph = (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
      </>
    );
  } else if (normalized === "dollar-sign") {
    glyph = (
      <>
        <path d="M12 3v18" />
        <path d="M16 7.5c-1-1-2.2-1.5-4-1.5-2.2 0-4 1.2-4 3s1.5 2.6 4 3 4 1.2 4 3-1.8 3-4 3c-1.8 0-3-.5-4-1.5" />
      </>
    );
  } else if (normalized === "grid") {
    glyph = (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </>
    );
  } else if (
    normalized === "basketballicon" ||
    normalized === "basketball"
  ) {
    glyph = (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M4.5 9h15M4.5 15h15M9 4.5c3 3 3 12 0 15M15 4.5c-3 3-3 12 0 15" />
      </>
    );
  } else if (normalized === "users") {
    glyph = (
      <>
        <circle cx="9" cy="9" r="3" />
        <circle cx="17" cy="10" r="2" />
        <path d="M3.5 19a5.5 5.5 0 0 1 11 0M14 16a4 4 0 0 1 6 3" />
      </>
    );
  } else if (normalized === "message-square") {
    glyph = <path d="M5 5h14v11H9l-4 3V5Z" />;
  } else {
    glyph = <path d="M12 5v14M5 12h14" />;
  }
  return (
    <svg
      aria-hidden="true"
      data-source-icon={name}
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width="16"
    >
      {glyph}
    </svg>
  );
}

function completeComponentBinding(
  node: WorkbenchNode,
): ComponentInstanceBinding | undefined {
  const candidate: Partial<ComponentInstanceBinding> | undefined =
    node.component;
  if (
    candidate === undefined ||
    typeof candidate.atomicLevel !== "string" ||
    typeof candidate.componentId !== "string" ||
    typeof candidate.componentName !== "string" ||
    typeof candidate.classification !== "string" ||
    candidate.editable === undefined ||
    candidate.props === undefined ||
    typeof candidate.role !== "string" ||
    candidate.source === undefined
  ) {
    return undefined;
  }
  return node.component;
}

// Atomic Design: molecule — safe, editable preview of a known component role.
// Labels and icon names are React text; source files never become executable HTML.
export function ComponentPreview({
  node,
}: {
  readonly node: WorkbenchNode;
}) {
  const component = completeComponentBinding(node);
  if (component === undefined) {
    return <span>{node.text ?? node.name}</span>;
  }

  const label = component.props.label ?? node.text ?? node.name;
  const iconPreview =
    component.props.icon === undefined ? null : (
      <span aria-hidden="true" className="component-preview__icon">
        <SourceComponentIcon name={component.props.icon} />
      </span>
    );
  const shared = {
    backgroundColor: node.fill,
    height: "100%",
    width: "100%",
  } as const;
  const metadata = {
    "data-component-classification": component.classification,
    "data-component-id": component.componentId,
    "data-testid": `component-preview-${component.role}`,
  } as const;

  if (component.role === "button" || component.role === "badge") {
    return (
      <span
        {...metadata}
        className={`component-preview component-preview--${component.role}`}
        style={{
          ...shared,
          alignItems: "center",
          borderRadius: component.role === "badge" ? 999 : 10,
          display: "flex",
          fontWeight: 500,
          justifyContent: "center",
          padding: component.role === "badge" ? "4px 10px" : "0 16px",
        }}
      >
        {iconPreview}
        <span className="component-preview__label">{label}</span>
      </span>
    );
  }

  if (component.role === "tab-item" || component.role === "tab-bar") {
    return (
      <span
        {...metadata}
        className={`component-preview component-preview--${component.role}`}
        style={{
          alignItems: "center",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          position: "relative",
          width: "100%",
        }}
      >
        {iconPreview}
        <span className="component-preview__label">{label}</span>
        {component.props.selected ? (
          <span
            aria-hidden="true"
            className="component-preview__indicator"
            style={{
              backgroundColor: node.fill,
              borderRadius: 999,
              bottom: 0,
              height: 3,
              left: "16%",
              position: "absolute",
              right: "16%",
            }}
          />
        ) : null}
      </span>
    );
  }

  if (component.role === "input") {
    return (
      <span
        {...metadata}
        className="component-preview component-preview--input"
        style={{
          alignItems: "center",
          border: `1px solid ${node.fill ?? "currentColor"}`,
          borderRadius: 8,
          display: "flex",
          height: "100%",
          padding: "0 12px",
          width: "100%",
        }}
      >
        {iconPreview}
        <span className="component-preview__label">
          {component.props.placeholder ?? label}
        </span>
      </span>
    );
  }

  if (component.role === "header") {
    return (
      <span
        {...metadata}
        className="component-preview component-preview--header"
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${node.fill ?? "currentColor"}`,
          display: "flex",
          height: "100%",
          justifyContent: "space-between",
          padding: "0 16px",
          width: "100%",
        }}
      >
        <span>
          <strong className="component-preview__label">{label}</strong>
          {component.props.supportingText ? (
            <small>{component.props.supportingText}</small>
          ) : null}
        </span>
        {iconPreview}
      </span>
    );
  }

  if (component.role === "screen-shell") {
    return (
      <span
        {...metadata}
        className="component-preview component-preview--screen-shell"
        style={{
          backgroundColor: node.fill,
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
          width: "100%",
        }}
      >
        <span
          aria-hidden="true"
          className="component-preview__status-bar"
          style={{ height: 20, opacity: 0.4 }}
        />
        <strong className="component-preview__label">{label}</strong>
        <span
          aria-hidden="true"
          className="component-preview__content"
          style={{ flex: 1 }}
        />
        <span
          aria-hidden="true"
          className="component-preview__bottom-nav"
          style={{ borderTop: "1px solid currentColor", height: 52 }}
        />
      </span>
    );
  }

  return (
    <span
      {...metadata}
      className="component-preview component-preview--card"
      style={{
        ...shared,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        justifyContent: "space-between",
        overflow: "hidden",
        padding: 16,
        textAlign: "left",
      }}
    >
      <span
        aria-hidden="true"
        className="component-preview__accent"
        style={{
          backgroundColor: "currentColor",
          borderRadius: 999,
          height: 3,
          opacity: 0.35,
          width: 36,
        }}
      />
      <span className="component-preview__heading">
        <span className="component-preview__label">{label}</span>
        {component.props.status || component.props.value ? (
          <span className="component-preview__meta">
            {component.props.status ? (
              <small>{component.props.status}</small>
            ) : null}
            {component.props.value ? (
              <strong>{component.props.value}</strong>
            ) : null}
          </span>
        ) : null}
      </span>
      {component.props.supportingText ? (
        <small>{component.props.supportingText}</small>
      ) : null}
      {component.props.items ? (
        <ComponentPreviewItems items={component.props.items} />
      ) : (
        <span aria-hidden="true" className="component-preview__details">
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

export function ComponentInspectorMetadata({
  node,
}: {
  readonly node: WorkbenchNode;
}) {
  const component = completeComponentBinding(node);
  if (component === undefined) {
    return null;
  }
  return (
    <>
      <p>
        {component.classification === "master" ? "Master" : "Instance"} ·{" "}
        {component.atomicLevel} · {component.role}
      </p>
      <p>
        {component.componentName}
        {component.variant ? ` · ${component.variant}` : ""}
      </p>
      <p>
        {component.source.sourceAnchor}
        {component.source.exportName
          ? ` · ${component.source.exportName}`
          : ""}
      </p>
      <p>Revision {component.source.repositoryRevision}</p>
      {component.source.repositoryDirty ? (
        <p>Component source state: dirty workspace snapshot</p>
      ) : null}
      {component.source.sourceContentHash ? (
        <p>Component content: {component.source.sourceContentHash}</p>
      ) : null}
      {component.classification === "instance" && component.masterId ? (
        <p>Master: {component.masterId}</p>
      ) : null}
    </>
  );
}

export function ComponentInspectorFields({
  node,
  onChange,
}: {
  readonly node: WorkbenchNode;
  readonly onChange: ComponentNodeChange;
}) {
  const component = completeComponentBinding(node);
  if (component === undefined) {
    return null;
  }

  const updateText = (
    property: "label" | "icon",
    label: string,
    value: string,
  ) => {
    onChange(label, (current) => {
      if (current.component === undefined) {
        return current;
      }
      return {
        ...current,
        component: {
          ...current.component,
          props: { ...current.component.props, [property]: value },
        },
      };
    });
  };
  const updateVariant = (variant: string) => {
    onChange(`Change ${node.name} variant`, (current) => {
      if (current.component === undefined) {
        return current;
      }
      return {
        ...current,
        component: { ...current.component, variant },
      };
    });
  };
  const resetOverride = (key: ComponentOverrideKey, label: string) => {
    onChange(label, (current) => {
      if (current.component === undefined) {
        return current;
      }
      return {
        ...current,
        component: resetComponentOverride(current.component, key),
      };
    });
  };
  const overrideKeys = componentOverrideKeys(component);
  const isOverridden = (key: ComponentOverrideKey) =>
    overrideKeys.includes(key);
  const resetButton = (key: ComponentOverrideKey, label: string) =>
    isOverridden(key) ? (
      <button
        aria-label={`Reset ${label.toLowerCase()} override`}
        className="inspector-icon-button"
        onClick={() =>
          resetOverride(key, `Reset ${node.name} ${label.toLowerCase()}`)
        }
        title={`Reset ${label.toLowerCase()} override`}
        type="button"
      >
        <EditorIcon name="undo" size={13} />
      </button>
    ) : null;

  return (
    <>
      {component.classification === "instance" ? (
        <div className="inspector-override-summary">
          <span>
            {overrideKeys.length}{" "}
            {overrideKeys.length === 1 ? "override" : "overrides"}
          </span>
          <button
            aria-label="Reset all overrides"
            disabled={overrideKeys.length === 0}
            onClick={() =>
              onChange(`Reset ${node.name} overrides`, (current) => {
                if (current.component === undefined) {
                  return current;
                }
                return {
                  ...current,
                  component: resetAllComponentOverrides(current.component),
                };
              })
            }
            type="button"
          >
            Reset all
          </button>
        </div>
      ) : null}
      {component.editable.variant ? (
        <div className="inspector-property-with-action">
          <AuthoringTextField
            label="Variant"
            onCommit={updateVariant}
            value={component.variant ?? ""}
          />
          {resetButton("variant", "Variant")}
        </div>
      ) : null}
      {component.editable.label ? (
        <div className="inspector-property-with-action">
          <AuthoringTextField
            label="Component label"
            onCommit={(value) =>
              updateText("label", `Edit ${node.name} label`, value)
            }
            value={component.props.label ?? node.text ?? ""}
          />
          {resetButton("label", "Component label")}
        </div>
      ) : null}
      {component.editable.icon ? (
        <div className="inspector-property-with-action">
          <AuthoringTextField
            label="Icon"
            onCommit={(value) =>
              updateText("icon", `Edit ${node.name} icon`, value)
            }
            value={component.props.icon ?? ""}
          />
          {resetButton("icon", "Icon")}
        </div>
      ) : null}
      {component.editable.selected ? (
        <div className="inspector-property-with-action">
          <label className="canvas-property canvas-property--toggle">
            <span>Selected</span>
            <input
              aria-label="Selected"
              checked={component.props.selected ?? false}
              onChange={(event) => {
                const selected = event.currentTarget.checked;
                onChange(`Change ${node.name} selection`, (current) => {
                  if (current.component === undefined) {
                    return current;
                  }
                  return {
                    ...current,
                    component: {
                      ...current.component,
                      props: { ...current.component.props, selected },
                    },
                  };
                });
              }}
              type="checkbox"
            />
          </label>
          {resetButton("selected", "Selected")}
        </div>
      ) : null}
    </>
  );
}
