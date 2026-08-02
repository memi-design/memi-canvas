import {
  useEffect, useState, type MouseEvent,
  type PointerEvent,
} from "react";

import { AuthoringPropertySections } from "./AuthoringPropertySections.js";
import { AuthoringTextField } from "./authoring-field.js";
import type { AuthoringSelectionTransaction } from "./authoring-selection.js";
import { CanvasNodeMetadataTag } from "./CanvasNodeMetadataTag.js";
import { EditorIcon, type EditorIconName } from "./icons.js";
import {
  ComponentInspectorFields,
  ComponentInspectorMetadata,
  ComponentPreview,
} from "./component-parts.js";
import { nodeAuthority, type WorkbenchNode } from "./model.js";
import { isSafeReferenceSourceUrl } from "./reference-security.js";
import type { WorkbenchInspectorV3Actions } from "./workbench-inspector-v3-actions.js";
export { Layers } from "./layers-tree.js";

function frameRoute(node: WorkbenchNode): string {
  return node.frameContent?.split("\n")[0] ?? node.source?.routeId ?? "/";
}

// Atomic Design: organism — deterministic low-token preview for source frames.
// It visualizes imported structure without pretending to be a runtime capture.
function SourceFramePreview({ node }: { readonly node: WorkbenchNode }) {
  if (node.kind === "RoutePlaceholder") {
    return (
      <span className="source-frame-preview source-frame-preview--diagnostic">
        <span className="source-frame-preview__topbar">
          <strong>{node.name}</strong>
          <span className="source-frame-preview__status">Import blocked</span>
        </span>
        <span className="source-frame-preview__content">
          <span className="source-frame-preview__eyebrow">
            {frameRoute(node)}
          </span>
          <span className="source-frame-preview__capture">
            <EditorIcon name="route" size={14} />
            <span>
              Legacy placeholder removed. Re-import to capture this runtime
              screen.
            </span>
          </span>
        </span>
      </span>
    );
  }
  return (
    <span className="source-frame-preview">
      <span className="source-frame-preview__topbar">
        <strong>{node.name}</strong>
        <span className="source-frame-preview__status">Live source</span>
      </span>
      <span className="source-frame-preview__content">
        <span className="source-frame-preview__eyebrow">{frameRoute(node)}</span>
        <span className="source-frame-preview__capture">
          <EditorIcon name="route" size={14} />
          <span>Source-linked frame</span>
        </span>
      </span>
    </span>
  );
}

function ShapePreview({ node }: { readonly node: WorkbenchNode }) {
  if (node.kind === "Ellipse") {
    return null;
  }
  if (
    node.kind !== "Line" &&
    node.kind !== "Arrow" &&
    node.kind !== "Vector"
  ) {
    return null;
  }
  const fallbackPath =
    node.kind === "Vector"
      ? [
          { x: 0, y: node.size.height },
          { x: node.size.width * 0.4, y: 0 },
          { x: node.size.width, y: node.size.height * 0.6 },
        ]
      : [
          { x: 0, y: node.size.height / 2 },
          { x: node.size.width, y: node.size.height / 2 },
        ];
  const path = node.path ?? fallbackPath;
  const start = path[0] ?? { x: 0, y: 0 };
  const end = path.at(-1) ?? start;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const arrowWing = (offset: number) => ({
    x: end.x - Math.cos(angle + offset) * 10,
    y: end.y - Math.sin(angle + offset) * 10,
  });
  const upperWing = arrowWing(Math.PI / 6);
  const lowerWing = arrowWing(-Math.PI / 6);
  return (
    <svg
      aria-hidden="true"
      className="canvas-shape-path"
      preserveAspectRatio="none"
      viewBox={`0 0 ${Math.max(1, node.size.width)} ${Math.max(1, node.size.height)}`}
    >
      {node.kind === "Vector" ? (
        <polyline
          data-testid="vector-path"
          fill="none"
          points={path.map(({ x, y }) => `${x},${y}`).join(" ")}
        />
      ) : (
        <line
          data-testid="line-path"
          x1={start.x}
          x2={end.x}
          y1={start.y}
          y2={end.y}
        />
      )}
      {node.kind === "Arrow" ? (
        <path
          d={`M ${upperWing.x} ${upperWing.y} L ${end.x} ${end.y} L ${lowerWing.x} ${lowerWing.y}`}
          data-testid="arrow-head"
          fill="none"
        />
      ) : null}
    </svg>
  );
}

function CanvasNodeContent({ node }: { readonly node: WorkbenchNode }) {
  if (node.kind === "CodeFrame" || node.kind === "RoutePlaceholder") {
    return <SourceFramePreview node={node} />;
  }
  if (node.kind === "ReferenceFrame" && node.reference) {
    return (
      <span className="reference-frame">
        <img
          alt={node.reference.alt}
          draggable={false}
          src={node.reference.src}
        />
        <span>Production reference</span>
      </span>
    );
  }
  if (node.kind === "Image" && node.image) {
    return (
      <img
        alt={node.image.alt}
        className="canvas-pasted-image"
        draggable={false}
        src={node.image.src}
      />
    );
  }
  if (
    node.kind === "Component" ||
    node.kind === "ComponentInstance"
  ) {
    return <ComponentPreview node={node} />;
  }
  if (
    node.kind === "Ellipse" ||
    node.kind === "Line" ||
    node.kind === "Arrow" ||
    node.kind === "Vector"
  ) {
    return <ShapePreview node={node} />;
  }
  if (node.kind === "Text" || node.kind === "Comment") {
    return node.text ?? node.frameContent ?? node.name;
  }
  if (
    node.kind === "DraftFrame" ||
    node.kind === "Frame" ||
    node.kind === "Section"
  ) {
    return node.frameContent ?? null;
  }
  return null;
}

// Atomic Design: atom — a single selectable canvas tool.
export function ToolButton({
  active,
  icon,
  label,
  onSelect,
  shortcut,
}: {
  readonly active: boolean;
  readonly icon: EditorIconName;
  readonly label: string;
  readonly onSelect: () => void;
  readonly shortcut?: string;
}) {
  const title = shortcut === undefined ? label : `${label} · ${shortcut}`;
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className="canvas-tool"
      onClick={onSelect}
      title={title}
      type="button"
    >
      <EditorIcon name={icon} />
    </button>
  );
}

function renderedCornerRadius(node: WorkbenchNode): string {
  if (node.kind === "Ellipse") {
    return "50%";
  }
  const [topLeft, topRight, bottomRight, bottomLeft] =
    node.cornerRadii ?? [0, 0, 0, 0];
  if (
    topLeft === topRight &&
    topLeft === bottomRight &&
    topLeft === bottomLeft
  ) {
    return `${topLeft}px`;
  }
  return `${topLeft}px ${topRight}px ${bottomRight}px ${bottomLeft}px`;
}

type SelectionRole = "frame" | "group" | "object";
type DirectManipulation = "move" | "resize" | null;

function selectionRoleFor(node: WorkbenchNode): SelectionRole {
  if (node.kind === "Group") {
    return "group";
  }
  if (
    node.kind === "CodeFrame" ||
    node.kind === "DraftFrame" ||
    node.kind === "Frame" ||
    node.kind === "Section"
  ) {
    return "frame";
  }
  return "object";
}

// Atomic Design: molecule — one semantic node and its manipulation handle.
export function CanvasNodeView({
  node,
  proposed = false,
  semanticOverlay = false,
  semanticOverride = false,
  selected,
  onPointerDown,
  onResizePointerDown,
  onSelect,
  onContextMenu,
}: {
  readonly node: WorkbenchNode;
  readonly proposed?: boolean;
  readonly semanticOverlay?: boolean;
  readonly semanticOverride?: boolean;
  readonly selected: boolean;
  readonly onPointerDown: (
    node: WorkbenchNode,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onResizePointerDown: (
    node: WorkbenchNode,
    event: PointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onSelect: (nodeId: string, additive: boolean) => void;
  readonly onContextMenu?: (
    node: WorkbenchNode,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
}) {
  const [directManipulation, setDirectManipulation] =
    useState<DirectManipulation>(null);
  const selectionRole = selectionRoleFor(node);

  useEffect(() => {
    if (directManipulation === null) {
      return undefined;
    }
    const clearDirectManipulation = () => setDirectManipulation(null);
    window.addEventListener("pointercancel", clearDirectManipulation);
    window.addEventListener("pointerup", clearDirectManipulation);
    return () => {
      window.removeEventListener("pointercancel", clearDirectManipulation);
      window.removeEventListener("pointerup", clearDirectManipulation);
    };
  }, [directManipulation]);

  useEffect(() => {
    if (!selected || node.locked) {
      setDirectManipulation(null);
    }
  }, [node.locked, selected]);

  if (node.hidden) {
    return null;
  }

  return (
    <div
      className={`canvas-node canvas-node--${node.kind.toLowerCase()}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      data-locked={node.locked}
      data-proposal={proposed}
      data-selected={selected}
      data-semantic-overlay={semanticOverlay}
      data-semantic-override={semanticOverride}
      data-direct-manipulation={directManipulation ?? "false"}
      style={{
        height: node.size.height,
        left: node.position.x,
        opacity: node.opacity ?? 1,
        position: "absolute",
        top: node.position.y,
        transform: `rotate(${node.rotation ?? 0}deg)`,
        transformOrigin: "center",
        width: node.size.width,
      }}
    >
      {selected ? <CanvasNodeMetadataTag node={node} /> : null}
      {selected ? (
        <span
          aria-label={`Selection bounds for ${node.name}`}
          aria-description={`${selectionRole} selection boundary`}
          className={`canvas-node__selection-bounds canvas-node__selection-bounds--${selectionRole}`}
          data-artwork="false"
          data-selection-role={selectionRole}
          role="img"
        >
          <i aria-hidden="true" className="canvas-node__selection-handle canvas-node__selection-handle--nw" />
          <i aria-hidden="true" className="canvas-node__selection-handle canvas-node__selection-handle--ne" />
          <i aria-hidden="true" className="canvas-node__selection-handle canvas-node__selection-handle--se" />
          <i aria-hidden="true" className="canvas-node__selection-handle canvas-node__selection-handle--sw" />
        </span>
      ) : null}
      <button
        aria-disabled={node.locked}
        aria-label={`${node.name} on canvas`}
        aria-pressed={selected}
        className="canvas-node__surface"
        data-stroke-align={node.strokeAlign ?? "inside"}
        onClick={(event) => {
          if (event.detail === 0) {
            onSelect(node.id, event.shiftKey);
          }
        }}
        onContextMenu={(event) => onContextMenu?.(node, event)}
        onPointerDown={(event) => {
          if (!node.locked && event.button !== 2) {
            setDirectManipulation("move");
          }
          onPointerDown(node, event);
        }}
        data-shape-renderer={
          node.kind === "Ellipse"
            ? "ellipse"
            : node.kind === "Line"
              ? "line"
              : node.kind === "Arrow"
                ? "arrow"
                : node.kind === "Vector"
                  ? "vector"
                : undefined
        }
        style={{
          ...((!semanticOverlay || semanticOverride) &&
          (node.kind === "Rectangle" ||
          node.kind === "Ellipse" ||
          node.kind === "DraftFrame" ||
          node.kind === "Frame" ||
          node.kind === "Section" ||
          node.kind === "Component" ||
          node.kind === "ComponentInstance")
            ? {
                backgroundColor: node.fill,
                borderColor: node.stroke,
                borderRadius: renderedCornerRadius(node),
                borderStyle: node.stroke === undefined ? "none" : "solid",
                borderWidth:
                  node.stroke === undefined
                    ? "0px"
                    : `${node.strokeWeight ?? 1}px`,
              }
            : {}),
          ...((!semanticOverlay || semanticOverride) &&
          (node.kind === "Line" ||
          node.kind === "Arrow" ||
          node.kind === "Vector")
            ? { color: node.stroke }
            : {}),
          ...((!semanticOverlay || semanticOverride) &&
          node.kind === "Text"
            ? { color: node.fill }
            : {}),
          height: "100%",
          width: "100%",
        }}
        type="button"
      >
        {semanticOverlay ? (
          <>
            <span aria-hidden="true" className="canvas-semantic-overlay">
              <span>{node.name}</span>
            </span>
            {semanticOverride ? (
              <span
                className="canvas-semantic-override"
                data-testid={`semantic-override-${node.id}`}
              >
                <CanvasNodeContent node={node} />
              </span>
            ) : null}
          </>
        ) : (
          <CanvasNodeContent node={node} />
        )}
      </button>
      {selected && !node.locked ? (
        <button
          aria-label={`Resize ${node.name} southeast`}
          className="canvas-node__resize"
          onPointerDown={(event) => {
            setDirectManipulation("resize");
            onResizePointerDown(node, event);
          }}
          style={{ bottom: 0, position: "absolute", right: 0 }}
          type="button"
        >
          Resize
        </button>
      ) : null}
      {selected && directManipulation !== null ? (
        <span
          aria-label={`${directManipulation === "move" ? "Moving" : "Resizing"} ${node.name}`}
          aria-live="polite"
          className="canvas-node__selection-status"
          data-artwork="false"
          role="status"
        >
          {directManipulation === "move" ? "Moving" : "Resizing"} {node.name}
        </span>
      ) : null}
    </div>
  );
}

// Atomic Design: molecule — direct property editing for the selected node.
export function Inspector({
  node,
  onChange,
  onChangeSelection,
  onDelete,
  onDetach,
  onDuplicate,
  onOpenSource,
  onOpenSourceInCursor,
  onPreview,
  onPreviewSelection,
  selectedNodes,
  v3Actions,
}: {
  readonly node: WorkbenchNode | undefined;
  readonly onChange: (
    label: string,
    update: (node: WorkbenchNode) => WorkbenchNode,
  ) => void;
  readonly onChangeSelection?: (
    transaction: AuthoringSelectionTransaction,
  ) => void;
  readonly onDelete: () => void;
  readonly onDetach: () => void;
  readonly onDuplicate: () => void;
  readonly onOpenSource?: (sourcePath: string) => void;
  readonly onOpenSourceInCursor?: (sourcePath: string) => void;
  readonly onPreview?: (
    update: (node: WorkbenchNode) => WorkbenchNode,
  ) => void;
  readonly onPreviewSelection?: (
    transaction: AuthoringSelectionTransaction,
  ) => void;
  readonly selectedNodes?: readonly WorkbenchNode[];
  readonly v3Actions?: WorkbenchInspectorV3Actions;
}) {
  if (node === undefined) {
    return (
      <section
        aria-label="Inspector"
        className="canvas-panel inspector-panel inspector-panel--empty"
      >
        <h2 className="canvas-visually-hidden">No selection</h2>
        <span aria-label="No selection">
          <EditorIcon name="context" size={16} />
        </span>
      </section>
    );
  }

  if (node.kind === "ReferenceFrame" && node.reference) {
    return (
      <section aria-label="Inspector" className="canvas-panel inspector-panel">
        <h2>{node.name}</h2>
        <p>Production reference</p>
        <p>
          {node.reference.authority} · {node.reference.appVersion}
        </p>
        <p>Captured {node.reference.capturedAt}</p>
        {isSafeReferenceSourceUrl(node.reference.sourceUrl) ? (
          <a
            href={node.reference.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open source evidence
          </a>
        ) : (
          <p>Source evidence link rejected by the local security policy.</p>
        )}
        <p>
          Reference frames are immutable evidence. Create a draft beside this
          screen to design changes without rewriting its authority.
        </p>
      </section>
    );
  }

  const sourceProtected =
    node.kind === "CodeFrame" || node.kind === "RoutePlaceholder";
  const sourcePath =
    node.component?.source?.sourceAnchor ?? node.source?.sourceAnchor;
  const sectionName =
    node.component === undefined ? "Layer" : "Component";
  const commit = (label: string, update: (current: WorkbenchNode) => WorkbenchNode) => {
    if (v3Actions !== undefined) {
      v3Actions.commit({ label, targetIds: (selectedNodes ?? [node]).map(({ id }) => id), update });
      return;
    }
    onChange(label, update);
  };

  return (
    <section aria-label="Inspector" className="canvas-panel inspector-panel">
      <header className="inspector-header">
        <div>
          <h2>{node.name}</h2>
          <span>Kind: {node.kind}</span>
        </div>
        <small>
          {node.component !== undefined
            ? "Design system component"
            : `Authority: ${nodeAuthority(node)}`}
        </small>
      </header>

      <fieldset aria-label={sectionName} className="inspector-section">
        <legend>{sectionName}</legend>
        <AuthoringTextField
          label="Name"
          onCommit={(value) =>
            commit("Rename node", (current) => ({ ...current, name: value }))
          }
          value={node.name}
        />
        {node.kind === "Text" ? (
          <AuthoringTextField
            label="Text content"
            onCommit={(value) =>
              commit(`Edit ${node.name} text`, (current) => ({
                ...current,
                text: value,
              }))
            }
            value={node.text ?? ""}
          />
        ) : null}
        {node.component !== undefined &&
        (v3Actions === undefined ||
          node.component.classification === "master") ? (
          <ComponentInspectorFields node={node} onChange={commit} />
        ) : null}
        {node.component?.classification === "instance" &&
        v3Actions !== undefined ? (
          <p role="status">Component edits require a source proposal.</p>
        ) : null}
        {node.kind === "DraftFrame" && v3Actions === undefined ? (
          <AuthoringTextField
            label="Frame content"
            onCommit={(value) =>
              commit(`Edit ${node.name} content`, (current) => ({
                ...current,
                frameContent: value,
              }))
            }
            value={node.frameContent ?? ""}
          />
        ) : null}
        {node.kind === "DraftFrame" && v3Actions !== undefined ? (
          <>
            <label className="canvas-property">
              <span>Frame content</span>
              <input
                aria-label="Frame content"
                readOnly
                type="text"
                value={node.frameContent ?? ""}
              />
            </label>
            <p role="status">Frame content is read-only in this editor.</p>
          </>
        ) : null}
      </fieldset>

      {sourcePath !== undefined || node.provenance !== undefined ? (
        <fieldset aria-label="Source" className="inspector-section">
          <legend>Source</legend>
          <div className="inspector-source">
            <ComponentInspectorMetadata node={node} />
            {node.source ? <p>{node.source.sourceAnchor}</p> : null}
            {node.source?.repositoryDirty ? (
              <p>Source state: dirty workspace snapshot</p>
            ) : null}
            {node.source?.sourceContentHash ? (
              <p>Content: {node.source.sourceContentHash}</p>
            ) : null}
            {node.provenance ? (
              <p>
                Detached from {node.provenance.sourceAnchor} at{" "}
                {node.provenance.repositoryRevision}
              </p>
            ) : null}
            {node.provenance?.repositoryDirty ? (
              <p>Detached source state: dirty workspace snapshot</p>
            ) : null}
            {sourcePath !== undefined && onOpenSource !== undefined ? (
              <button
                className="inspector-open-source"
                onClick={() => onOpenSource(sourcePath)}
                type="button"
              >
                <EditorIcon name="code" size={14} />
                <span>Open in VS Code</span>
              </button>
            ) : null}
            {sourcePath !== undefined &&
            onOpenSourceInCursor !== undefined ? (
              <button
                className="inspector-open-source"
                onClick={() => onOpenSourceInCursor(sourcePath)}
                type="button"
              >
                <EditorIcon name="code" size={14} />
                <span>Open in Cursor</span>
              </button>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      <AuthoringPropertySections
        node={node}
        onChange={onChange}
        {...(onChangeSelection === undefined
          ? {}
          : { onChangeSelection })}
        {...(onPreview === undefined ? {} : { onPreview })}
        {...(onPreviewSelection === undefined
          ? {}
          : { onPreviewSelection })}
        {...(selectedNodes === undefined ? {} : { selectedNodes })}
        {...(v3Actions === undefined ? {} : { v3Actions })}
      />

      <div aria-label="Selection actions" className="canvas-icon-actions">
        <button
          aria-label="Duplicate selection"
          onClick={onDuplicate}
          title="Duplicate · ⌘D"
          type="button"
        >
          <EditorIcon name="duplicate" />
        </button>
        <button
          aria-label={node.locked ? "Unlock selection" : "Lock selection"}
          onClick={() =>
            commit(
              node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`,
              (current) => ({ ...current, locked: !current.locked }),
            )
          }
          title={node.locked ? "Unlock" : "Lock"}
          type="button"
        >
          <EditorIcon name={node.locked ? "unlock" : "lock"} />
        </button>
        <button
          aria-label={node.hidden ? "Show selection" : "Hide selection"}
          onClick={() =>
            commit(
              node.hidden ? `Show ${node.name}` : `Hide ${node.name}`,
              (current) => ({ ...current, hidden: !current.hidden }),
            )
          }
          title={node.hidden ? "Show" : "Hide"}
          type="button"
        >
          <EditorIcon name="eye" />
        </button>
        <button
          aria-label="Delete selection"
          disabled={sourceProtected}
          onClick={onDelete}
          title={
            sourceProtected
              ? "Detach from source before deleting"
              : "Delete"
          }
          type="button"
        >
          <EditorIcon name="trash" />
        </button>
      </div>
      {node.kind === "CodeFrame" || node.kind === "RoutePlaceholder" ? (
        <button className="canvas-detach" onClick={onDetach} type="button">
          <EditorIcon name="detach" />
          <span>Detach from source</span>
        </button>
      ) : null}
    </section>
  );
}
