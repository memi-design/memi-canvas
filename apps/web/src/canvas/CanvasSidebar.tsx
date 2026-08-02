import { useState } from "react";

import { EditorIcon, type EditorIconName } from "./icons.js";
import type { WorkbenchNode } from "./model.js";
import { Layers } from "./parts.js";
import { ProductMapPanel } from "./ProductMapPanel.js";
import type { ProductMap } from "./product-map.js";
import "./canvas-sidebar.css";

export interface CanvasPageNavigationItem {
  readonly id: string;
  readonly kind: "imported" | "local";
  readonly name: string;
}

export interface CanvasPageNavigation {
  readonly activePageId: string;
  readonly onCreatePage: () => void;
  readonly onSelectPage: (pageId: string) => void;
  readonly pages: readonly CanvasPageNavigationItem[];
}

export type NavigatorMode =
  | "product-map"
  | "canvases"
  | "layers"
  | "assets";

const navigatorModes: readonly {
  readonly id: NavigatorMode;
  readonly icon: EditorIconName;
  readonly label: string;
}[] = [
  { id: "product-map", icon: "route", label: "Product Map" },
  { id: "canvases", icon: "frame", label: "Canvases" },
  { id: "layers", icon: "layers", label: "Layers" },
  { id: "assets", icon: "square", label: "Assets" },
];

function CanvasesPanel({
  navigation,
}: {
  readonly navigation: CanvasPageNavigation;
}) {
  return (
    <>
      <header className="canvas-navigator__header">
        <div>
          <strong>Canvases</strong>
          <span>{navigation.pages.length}</span>
        </div>
        <button
          aria-label="New canvas"
          onClick={navigation.onCreatePage}
          title="New canvas · ⌘N"
          type="button"
        >
          <EditorIcon name="plus" size={14} />
        </button>
      </header>
      <nav aria-label="Canvases" className="canvas-pages">
        {navigation.pages.map((page) => (
          <button
            aria-label={page.name}
            aria-current={
              page.id === navigation.activePageId ? "page" : undefined
            }
            key={page.id}
            onClick={() => navigation.onSelectPage(page.id)}
            type="button"
          >
            <EditorIcon
              name={page.kind === "imported" ? "route" : "frame"}
              size={14}
            />
            <span>{page.name}</span>
            {page.kind === "imported" ? <small>Source</small> : null}
          </button>
        ))}
      </nav>
      <div className="canvas-navigator__hint">
        <span>New canvas</span>
        <kbd>⌘N</kbd>
      </div>
    </>
  );
}

function LayersPanel({
  nodes,
  onSelectNode,
  selectedNodeId,
}: {
  readonly nodes: readonly WorkbenchNode[];
  readonly onSelectNode: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
}) {
  return (
    <>
      <header className="canvas-navigator__header">
        <div>
          <strong>Layers</strong>
          <span>{nodes.length}</span>
        </div>
      </header>
      {nodes.length === 0 ? (
        <div className="canvas-navigator__empty">
          <EditorIcon name="layers" size={20} />
          <p className="canvas-visually-hidden" role="status">
            No layers
          </p>
        </div>
      ) : (
        <Layers
          nodes={nodes}
          onSelect={onSelectNode}
          selectedNodeId={selectedNodeId}
        />
      )}
    </>
  );
}

function AssetsPanel({
  nodes,
  onSelectNode,
  selectedNodeId,
}: {
  readonly nodes: readonly WorkbenchNode[];
  readonly onSelectNode: (nodeId: string) => void;
  readonly selectedNodeId: string | null;
}) {
  const masters = nodes.filter(
    (node) =>
      node.component?.classification === "master" || node.kind === "Component",
  );
  return (
    <>
      <header className="canvas-navigator__header">
        <div>
          <strong>Assets</strong>
          <span>{masters.length}</span>
        </div>
      </header>
      {masters.length === 0 ? (
        <div className="canvas-navigator__empty">
          <EditorIcon name="square" size={20} />
          <strong>No components</strong>
          <p>Create one from a selection or import a design system.</p>
        </div>
      ) : (
        <>
          <ul aria-label="Source components" className="canvas-assets">
            {masters.map((node) => (
              <li key={node.id}>
                <button
                  aria-pressed={node.id === selectedNodeId}
                  onClick={() => onSelectNode(node.id)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className="canvas-assets__swatch"
                    style={{ backgroundColor: node.fill }}
                  />
                  <span>
                    <strong>{node.name}</strong>
                    <small>
                      {node.component === undefined
                        ? "local draft"
                        : `${node.component.atomicLevel} · ${node.component.variant ?? node.component.role}`}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="canvas-assets__hint">
            Select a master, then press <kbd>⌘D</kbd> to place an instance.
          </p>
        </>
      )}
    </>
  );
}

// Atomic Design: organism — workspace navigation separated from document layers.
export function CanvasSidebar({
  initialMode = "product-map",
  navigation,
  nodes,
  onModeChange,
  onSelectNode,
  productMap,
  selectedNodeId,
}: {
  readonly initialMode?: NavigatorMode;
  readonly navigation: CanvasPageNavigation;
  readonly nodes: readonly WorkbenchNode[];
  readonly onModeChange?: (mode: NavigatorMode) => void;
  readonly onSelectNode: (nodeId: string) => void;
  readonly productMap: ProductMap;
  readonly selectedNodeId: string | null;
}) {
  const [mode, setMode] = useState<NavigatorMode>(initialMode);
  return (
    <aside aria-label="Navigator" className="canvas-navigator">
      <nav aria-label="Workspace views" className="canvas-navigator__rail">
        {navigatorModes.map((item) => (
          <button
            aria-label={item.label}
            aria-pressed={mode === item.id}
            data-tooltip={item.label}
            key={item.id}
            onClick={() => {
              setMode(item.id);
              onModeChange?.(item.id);
            }}
            title={item.label}
            type="button"
          >
            <EditorIcon name={item.icon} size={16} />
          </button>
        ))}
      </nav>
      <section className="canvas-navigator__panel">
        {mode === "product-map" ? (
          <ProductMapPanel
            map={productMap}
            onSelectNode={onSelectNode}
            selectedNodeId={selectedNodeId}
          />
        ) : mode === "canvases" ? (
          <CanvasesPanel navigation={navigation} />
        ) : mode === "layers" ? (
          <LayersPanel
            nodes={nodes}
            onSelectNode={onSelectNode}
            selectedNodeId={selectedNodeId}
          />
        ) : (
          <AssetsPanel
            nodes={nodes}
            onSelectNode={onSelectNode}
            selectedNodeId={selectedNodeId}
          />
        )}
      </section>
    </aside>
  );
}
