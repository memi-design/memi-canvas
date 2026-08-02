import {
  useEffect, useMemo, useState, type MouseEvent,
  type PointerEvent, type KeyboardEvent,
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
import { descendantNodeIds } from "./layer-hierarchy.js";
import { nodeAuthority, type WorkbenchNode } from "./model.js";
import { isSafeReferenceSourceUrl } from "./reference-security.js";
import type { WorkbenchInspectorV3Actions } from "./workbench-inspector-v3-actions.js";

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
        {node.component !== undefined && v3Actions === undefined ? (
          <ComponentInspectorFields node={node} onChange={commit} />
        ) : null}
        {node.component !== undefined && v3Actions !== undefined ? (
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
          <p role="status">Frame-content edits require a source proposal.</p>
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
            onChange(
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
            onChange(
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

// Atomic Design: organism — layer hierarchy and selection state.
export function Layers({
  nodes,
  selectedNodeId,
  onSelect,
}: {
  readonly nodes: readonly WorkbenchNode[];
  readonly selectedNodeId: string | null;
  readonly onSelect: (nodeId: string) => void;
}) {
  const isSourceLinked = (node: WorkbenchNode) =>
    node.source !== undefined || node.provenance !== undefined;
  const sameCaptureScenario = (
    candidate: WorkbenchNode,
    evidence: WorkbenchNode,
  ) => {
    const candidateBinding = candidate.source ?? candidate.provenance;
    const evidenceBinding = evidence.source ?? evidence.provenance;
    if (candidateBinding === undefined || evidenceBinding === undefined) {
      return false;
    }
    if (
      candidateBinding.coverageCellId !== null &&
      evidenceBinding.coverageCellId !== null &&
      candidateBinding.coverageCellId === evidenceBinding.coverageCellId
    ) {
      return true;
    }
    return (
      candidateBinding.routeId !== null &&
      evidenceBinding.routeId !== null &&
      candidateBinding.routeId === evidenceBinding.routeId &&
      candidateBinding.stateId !== null &&
      candidateBinding.stateId === evidenceBinding.stateId
    );
  };
  const treeIndex = useMemo(() => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const childrenByParentId = new Map<string, readonly WorkbenchNode[]>();
    for (const node of nodes) {
      if (node.parentId === null) {
        continue;
      }
      childrenByParentId.set(node.parentId, [
        ...(childrenByParentId.get(node.parentId) ?? []),
        node,
      ]);
    }
    const importedScreenRootIds = new Set<string>();
    for (const node of nodes) {
      const parent =
        node.parentId === null ? undefined : nodesById.get(node.parentId);
      if (
        node.kind === "ReferenceFrame" &&
        node.reference !== undefined &&
        parent?.kind === "CodeFrame"
      ) {
        importedScreenRootIds.add(parent.id);
      }
    }
    for (const evidence of nodes) {
      if (
        evidence.kind !== "ReferenceFrame" ||
        evidence.reference === undefined ||
        evidence.parentId !== null
      ) {
        continue;
      }
      const owner = nodes.find(
        (candidate) =>
          candidate.id !== evidence.id &&
          candidate.parentId === null &&
          candidate.kind !== "ReferenceFrame" &&
          isSourceLinked(candidate) &&
          sameCaptureScenario(candidate, evidence),
      );
      if (owner === undefined) {
        continue;
      }
      importedScreenRootIds.add(owner.id);
      childrenByParentId.set(owner.id, [
        ...(childrenByParentId.get(owner.id) ?? []),
        evidence,
      ]);
    }
    const importedScreenRootByNodeId = new Map<string, string>();
    for (const rootId of importedScreenRootIds) {
      const pending = [rootId];
      while (pending.length > 0) {
        const nodeId = pending.pop();
        if (
          nodeId === undefined ||
          importedScreenRootByNodeId.has(nodeId)
        ) {
          continue;
        }
        importedScreenRootByNodeId.set(nodeId, rootId);
        for (const child of childrenByParentId.get(nodeId) ?? []) {
          pending.push(child.id);
        }
      }
    }
    const namedDesignRoot = nodes.find(
      (node) =>
        node.parentId === null &&
        (node.kind === "Frame" ||
          node.kind === "Group" ||
          node.kind === "Section") &&
        /(?:design system|component library|ui kit)/iu.test(node.name),
    );
    const designRootIds =
      namedDesignRoot === undefined
        ? nodes
            .filter(
              (node) =>
                node.parentId === null && node.kind === "Component",
            )
            .map(({ id }) => id)
        : [namedDesignRoot.id];
    const designIds = new Set(
      designRootIds.flatMap((rootId) => [
        ...descendantNodeIds(nodes, rootId),
      ]),
    );
    return {
      childrenByParentId,
      designIds,
      designRootId: namedDesignRoot?.id,
      importedDescendantIds: new Set(
        [...importedScreenRootByNodeId].flatMap(([nodeId, rootId]) =>
          nodeId === rootId ? [] : [nodeId],
        ),
      ),
      importedScreenRootByNodeId,
      importedScreenRootIds,
      nodesById,
    };
  }, [nodes]);
  const {
    childrenByParentId,
    designIds,
    designRootId,
    importedDescendantIds,
    importedScreenRootByNodeId,
    importedScreenRootIds,
    nodesById,
  } = treeIndex;
  const { designNodes, draftNodes, sourceNodes } = useMemo(
    () => ({
      designNodes: nodes.filter((node) => designIds.has(node.id)),
      draftNodes: nodes.filter(
        (node) =>
          !isSourceLinked(node) &&
          !designIds.has(node.id) &&
          !importedDescendantIds.has(node.id),
      ),
      sourceNodes: nodes.filter(
        (node) =>
          isSourceLinked(node) &&
          !designIds.has(node.id) &&
          !importedDescendantIds.has(node.id),
      ),
    }),
    [designIds, importedDescendantIds, nodes],
  );
  const selectedNode =
    selectedNodeId === null ? undefined : nodesById.get(selectedNodeId);
  const selectedIsDesign =
    selectedNodeId !== null && designIds.has(selectedNodeId);
  const selectedImportedRootId =
    selectedNodeId === null
      ? undefined
      : importedScreenRootByNodeId.get(selectedNodeId);
  const selectedImportedRoot =
    selectedImportedRootId === undefined
      ? undefined
      : nodesById.get(selectedImportedRootId);
  const selectedSource =
    selectedNode?.source ??
    selectedNode?.provenance ??
    selectedImportedRoot?.source ??
    selectedImportedRoot?.provenance;
  const importedExpansionIds = (
    rootId: string | undefined,
    nodeId: string | null,
  ): readonly string[] => {
    if (rootId === undefined || nodeId === null) {
      return [];
    }
    if (nodeId === rootId) {
      return [...importedScreenRootByNodeId]
        .filter(([, candidateRootId]) => candidateRootId === rootId)
        .map(([candidateId]) => candidateId)
        .filter((candidateId) =>
          (childrenByParentId.get(candidateId)?.length ?? 0) > 0,
        )
        .map((candidateId) => `imported-${candidateId}`);
    }
    const branchIds: string[] = [];
    let current = nodesById.get(nodeId);
    while (current !== undefined) {
      if (
        current.id === rootId ||
        (childrenByParentId.get(current.id)?.length ?? 0) > 0
      ) {
        branchIds.push(`imported-${current.id}`);
      }
      if (current.id === rootId || current.parentId === null) {
        break;
      }
      current = nodesById.get(current.parentId);
    }
    return branchIds;
  };
  const requiredExpansionIds = (): readonly string[] => {
    const sourceAnchor = selectedSource?.sourceAnchor;
    if (selectedIsDesign) {
      return ["design-system"];
    }
    if (sourceAnchor === undefined) {
      return ["drafts"];
    }
    return [
      "product-flows",
      `feature-${featureName(sourceAnchor)}`,
      `route-${sourceAnchor}`,
      ...importedExpansionIds(selectedImportedRootId, selectedNodeId),
    ];
  };
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    return new Set(requiredExpansionIds());
  });
  const [focusedItemId, setFocusedItemId] = useState(
    selectedNodeId ?? "product-flows",
  );

  useEffect(() => {
    setExpanded((current) => {
      return new Set([...current, ...requiredExpansionIds()]);
    });
  }, [
    selectedIsDesign,
    selectedImportedRootId,
    selectedNode?.id,
    selectedSource?.sourceAnchor,
    treeIndex,
  ]);

  useEffect(() => {
    if (selectedNodeId !== null) {
      setFocusedItemId(selectedNodeId);
    }
  }, [selectedNodeId]);

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const visibleTreeItems = (item: HTMLElement): readonly HTMLElement[] =>
    Array.from(
      item.closest('[role="tree"]')?.querySelectorAll<HTMLElement>(
        '[role="treeitem"]',
      ) ?? [],
    );

  const focusAdjacentItem = (
    event: KeyboardEvent<HTMLLIElement>,
    direction: "first" | "last" | "next" | "previous",
  ) => {
    const items = visibleTreeItems(event.currentTarget);
    const currentIndex = items.indexOf(event.currentTarget);
    const target =
      direction === "first"
        ? items[0]
        : direction === "last"
          ? items.at(-1)
          : items[currentIndex + (direction === "next" ? 1 : -1)];
    target?.focus();
  };

  const handleLeafKeyDown = (
    event: KeyboardEvent<HTMLLIElement>,
    node: WorkbenchNode,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!(node.kind === "ReferenceFrame" && node.locked)) {
        onSelect(node.id);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusAdjacentItem(
        event,
        event.key === "ArrowDown" ? "next" : "previous",
      );
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusAdjacentItem(event, event.key === "Home" ? "first" : "last");
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.currentTarget.parentElement
        ?.closest<HTMLElement>('[role="treeitem"]')
        ?.focus();
    }
  };

  const nodeAriaLabel = (node: WorkbenchNode) =>
    node.kind === "ReferenceFrame" && node.locked
      ? `${node.name} ${node.kind} Locked reference`
      : `${node.name} ${node.kind}`;

  const renderLeaf = (node: WorkbenchNode) => (
    <li
      aria-disabled={
        node.kind === "ReferenceFrame" && node.locked ? true : undefined
      }
      aria-label={nodeAriaLabel(node)}
      aria-selected={node.id === selectedNodeId}
      className={`layer-leaf${
        node.kind === "ReferenceFrame"
          ? " layer-leaf--reference"
          : ""
      }`}
      key={node.id}
      onClick={() => {
        if (!(node.kind === "ReferenceFrame" && node.locked)) {
          onSelect(node.id);
        }
      }}
      onFocus={() => setFocusedItemId(node.id)}
      onKeyDown={(event) => handleLeafKeyDown(event, node)}
      role="treeitem"
      tabIndex={node.id === focusedItemId ? 0 : -1}
    >
      <span className="layer-row-icon">
        <EditorIcon name={layerIcon(node)} size={14} />
      </span>
      <span className="layer-row-label">{layerLabel(node)}</span>
      {node.kind === "ReferenceFrame" ? (
        <span
          className="layer-row-state layer-row-state--reference"
          title="Locked runtime reference"
        >
          <span>Reference</span>
          <EditorIcon name="lock" size={11} />
        </span>
      ) : node.locked ? (
        <span className="layer-row-state" title="Locked">
          <EditorIcon name="lock" size={12} />
        </span>
      ) : null}
    </li>
  );

  const renderGroup = (
    id: string,
    label: string,
    renderChildren: () => React.ReactNode,
    icon: EditorIconName = "layers",
  ) => {
    const isExpanded = expanded.has(id);
    const handleGroupKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle(id);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (!isExpanded) {
          toggle(id);
        } else {
          event.currentTarget
            .querySelector<HTMLElement>(
              ':scope > [role="group"] > [role="treeitem"]',
            )
            ?.focus();
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isExpanded) {
          toggle(id);
        } else {
          event.currentTarget.parentElement
            ?.closest<HTMLElement>('[role="treeitem"]')
            ?.focus();
        }
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAdjacentItem(
          event,
          event.key === "ArrowDown" ? "next" : "previous",
        );
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusAdjacentItem(event, event.key === "Home" ? "first" : "last");
      }
    };
    return (
      <li
        aria-expanded={isExpanded}
        aria-label={label}
        className="layer-group"
        key={id}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            setFocusedItemId(id);
          }
        }}
        onKeyDown={handleGroupKeyDown}
        role="treeitem"
        tabIndex={id === focusedItemId ? 0 : -1}
      >
        <div
          className="layer-group-row"
          onClick={(event) => {
            event.stopPropagation();
            toggle(id);
          }}
        >
          <EditorIcon
            name={isExpanded ? "chevron-down" : "chevron-right"}
            size={12}
          />
          <EditorIcon name={icon} size={14} />
          <span>{label}</span>
        </div>
        {isExpanded ? (
          <ul className="layer-group-children" role="group">
            {renderChildren()}
          </ul>
        ) : null}
      </li>
    );
  };

  const routesByFeature = Object.entries(
    sourceNodes.reduce<Readonly<Record<string, readonly WorkbenchNode[]>>>(
      (groups, node) => {
        const feature = featureName(
          node.source?.sourceAnchor ?? node.provenance?.sourceAnchor ?? "",
        );
        return {
          ...groups,
          [feature]: [...(groups[feature] ?? []), node],
        };
      },
      {},
    ),
  ).sort(([left], [right]) => left.localeCompare(right));
  const renderDesignBranch = (node: WorkbenchNode): React.ReactNode => {
    const children = (childrenByParentId.get(node.id) ?? []).filter(
      (candidate) => designIds.has(candidate.id),
    );
    return children.length === 0
      ? renderLeaf(node)
      : renderGroup(
          `design-${node.id}`,
          node.name,
          () => children.map(renderDesignBranch),
          layerIcon(node),
        );
  };
  const designRoot =
    designRootId === undefined
      ? undefined
      : nodesById.get(designRootId);
  const renderImportedBranch = (
    node: WorkbenchNode,
  ): React.ReactNode => {
    const children = childrenByParentId.get(node.id) ?? [];
    if (children.length === 0) {
      return renderLeaf(node);
    }
    const branchId = `imported-${node.id}`;
    const isExpanded = expanded.has(branchId);
    const handleKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(node.id);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (!isExpanded) {
          toggle(branchId);
        } else {
          event.currentTarget
            .querySelector<HTMLElement>(
              ':scope > [role="group"] > [role="treeitem"]',
            )
            ?.focus();
        }
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isExpanded) {
          toggle(branchId);
        } else {
          event.currentTarget.parentElement
            ?.closest<HTMLElement>('[role="treeitem"]')
            ?.focus();
        }
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        focusAdjacentItem(
          event,
          event.key === "ArrowDown" ? "next" : "previous",
        );
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        focusAdjacentItem(
          event,
          event.key === "Home" ? "first" : "last",
        );
      }
    };
    return (
      <li
        aria-expanded={isExpanded}
        aria-label={nodeAriaLabel(node)}
        aria-selected={node.id === selectedNodeId}
        className="layer-group layer-node-branch"
        key={node.id}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            setFocusedItemId(node.id);
          }
        }}
        onKeyDown={handleKeyDown}
        role="treeitem"
        tabIndex={node.id === focusedItemId ? 0 : -1}
      >
        <div
          className="layer-group-row"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(node.id);
          }}
        >
          <span
            aria-hidden="true"
            className="layer-branch-toggle"
            onClick={(event) => {
              event.stopPropagation();
              toggle(branchId);
            }}
          >
            <EditorIcon
              name={isExpanded ? "chevron-down" : "chevron-right"}
              size={12}
            />
          </span>
          <EditorIcon name={layerIcon(node)} size={14} />
          <span>{layerLabel(node)}</span>
        </div>
        {isExpanded ? (
          <ul className="layer-group-children" role="group">
            {children.map(renderImportedBranch)}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <ul aria-label="Layers" className="layers-tree" role="tree">
      {designNodes.length > 0
        ? renderGroup(
            "design-system",
            "Design system",
            () =>
              designRoot === undefined
                ? designNodes.map(renderLeaf)
                : [
                    renderLeaf(designRoot),
                    ...designNodes
                      .filter((node) => node.parentId === designRoot.id)
                      .map(renderDesignBranch),
                  ],
            "layers",
          )
        : null}
      {sourceNodes.length > 0
        ? renderGroup(
            "product-flows",
            "Route inventory",
            () =>
              routesByFeature.map(([feature, featureNodes]) =>
                renderGroup(
                  `feature-${feature}`,
                  featureLabel(feature),
                  () =>
                    Object.entries(
                      featureNodes.reduce<
                        Readonly<
                          Record<string, readonly WorkbenchNode[]>
                        >
                      >((routes, node) => {
                        const route =
                          node.source?.sourceAnchor ??
                          node.provenance?.sourceAnchor ??
                          node.id;
                        return {
                          ...routes,
                          [route]: [
                            ...(routes[route] ?? []),
                            node,
                          ],
                        };
                      }, {}),
                    )
                      .sort(([left], [right]) =>
                        left.localeCompare(right),
                      )
                      .map(([route, routeNodes]) =>
                        renderGroup(
                          `route-${route}`,
                          routeLabel(routeNodes[0]),
                          () =>
                            [...routeNodes]
                              .sort((left, right) =>
                                left.name.localeCompare(right.name),
                              )
                              .map((node) =>
                                importedScreenRootIds.has(node.id)
                                  ? renderImportedBranch(node)
                                  : renderLeaf(node),
                              ),
                          "route",
                        ),
                      ),
                  "layers",
                ),
              ),
            "route",
          )
        : null}
      {draftNodes.length > 0
        ? renderGroup(
            "drafts",
            "Drafts",
            () => draftNodes.map(renderLeaf),
            "frame",
          )
        : null}
    </ul>
  );
}

function featureName(sourceAnchor: string): string {
  if (sourceAnchor.includes("(auth)")) {
    return "auth";
  }
  if (sourceAnchor.includes("(tabs)")) {
    return "tabs";
  }
  if (sourceAnchor.includes("(protected)")) {
    return "product";
  }
  return "routes";
}

function featureLabel(feature: string): string {
  const labels: Readonly<Record<string, string>> = {
    auth: "Authentication",
    product: "Product",
    routes: "Routes",
    tabs: "Tabs",
  };
  return labels[feature] ?? feature;
}

function routeLabel(node: WorkbenchNode | undefined): string {
  if (node === undefined) {
    return "Route";
  }
  return node.name.split("/")[0]?.trim() ?? node.name;
}

function layerIcon(node: WorkbenchNode): EditorIconName {
  if (node.kind === "Text") {
    return "text";
  }
  if (node.kind === "Rectangle") {
    return "square";
  }
  if (node.kind === "Ellipse") {
    return "circle";
  }
  if (node.kind === "Line") {
    return "line";
  }
  if (node.kind === "Arrow") {
    return "arrow";
  }
  if (node.kind === "Vector") {
    return "line";
  }
  if (node.kind === "Section") {
    return "section";
  }
  if (node.kind === "Comment") {
    return "context";
  }
  if (node.kind === "ComponentInstance") {
    return "layers";
  }
  if (node.source !== undefined) {
    return "route";
  }
  return "frame";
}

function layerLabel(node: WorkbenchNode): string {
  if (node.source === undefined) {
    return node.name;
  }
  return node.name.split(" / ").at(-1) ?? node.name;
}
