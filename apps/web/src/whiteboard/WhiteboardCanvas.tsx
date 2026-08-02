import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { EditorIcon } from "../canvas/icons.js";
import {
  createFrameStateScheduler,
  projectVisibleItems,
  type FrameStateScheduler,
} from "../canvas/canvas-performance.js";
import {
  createStarterWhiteboard,
  itemLabel,
  whiteboardReducer,
  type WhiteboardItem,
  type WhiteboardPoint,
  type WhiteboardState,
} from "./whiteboard-model.js";
import {
  WhiteboardItemGlyph,
  WhiteboardPropertyEditor,
  WhiteboardToolButton,
} from "./whiteboard-controls.js";
import "./whiteboard.css";

export interface WhiteboardCanvasProps {
  readonly initialState?: WhiteboardState;
  readonly onStateChange?: (state: WhiteboardState) => void;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

interface WhiteboardViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface WhiteboardContextMenu {
  readonly x: number;
  readonly y: number;
}

interface WhiteboardDrag {
  readonly itemIds: readonly string[];
  readonly startX: number;
  readonly startY: number;
}

interface WhiteboardPan {
  readonly startX: number;
  readonly startY: number;
  readonly viewport: WhiteboardViewport;
}

function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function positionedStyle(
  item: Exclude<WhiteboardItem, { kind: "connector" }>,
  previewDelta?: WhiteboardPoint,
) {
  return {
    "--whiteboard-x": `${item.position.x + (previewDelta?.x ?? 0)}px`,
    "--whiteboard-y": `${item.position.y + (previewDelta?.y ?? 0)}px`,
    "--whiteboard-width": `${item.size.width}px`,
    "--whiteboard-height": `${item.size.height}px`,
  } as CSSProperties;
}

function nextPosition(itemCount: number): WhiteboardPoint {
  const column = itemCount % 4;
  const row = Math.floor(itemCount / 4) % 4;
  return { x: 128 + column * 216, y: 112 + row * 192 };
}

function connectorGeometry(
  item: Extract<WhiteboardItem, { kind: "connector" }>,
  items: readonly WhiteboardItem[],
) {
  const from = items.find((candidate) => candidate.id === item.fromItemId);
  const to = items.find((candidate) => candidate.id === item.toItemId);
  if (
    from === undefined ||
    from.kind === "connector" ||
    to === undefined ||
    to.kind === "connector"
  ) {
    return undefined;
  }
  return {
    x1: from.position.x + from.size.width / 2,
    y1: from.position.y + from.size.height / 2,
    x2: to.position.x + to.size.width / 2,
    y2: to.position.y + to.size.height / 2,
  };
}

function connectorOptionStyle(
  item: Extract<WhiteboardItem, { kind: "connector" }>,
  items: readonly WhiteboardItem[],
) {
  const geometry = connectorGeometry(item, items);
  if (geometry === undefined) {
    return undefined;
  }
  return {
    "--whiteboard-x": `${(geometry.x1 + geometry.x2) / 2 - 34}px`,
    "--whiteboard-y": `${(geometry.y1 + geometry.y2) / 2 - 12}px`,
    "--whiteboard-width": "68px",
    "--whiteboard-height": "24px",
  } as CSSProperties;
}

// Atomic Design: organism. Owns the whiteboard authoring state and its controls.
export function WhiteboardCanvas({
  initialState,
  onStateChange,
}: WhiteboardCanvasProps) {
  const [state, dispatch] = useReducer(
    whiteboardReducer,
    initialState ?? createStarterWhiteboard(),
  );
  const [contextMenu, setContextMenu] =
    useState<WhiteboardContextMenu | null>(null);
  const [dragDelta, setDragDelta] = useState<WhiteboardPoint | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [viewport, setViewport] = useState<WhiteboardViewport>({
    x: 0,
    y: 0,
    zoom: 1,
  });
  const [viewportSize, setViewportSize] = useState({
    height: 600,
    width: 900,
  });
  const viewportScheduler =
    useRef<FrameStateScheduler<WhiteboardViewport> | null>(null);
  if (viewportScheduler.current === null) {
    viewportScheduler.current = createFrameStateScheduler(setViewport);
  }
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<WhiteboardDrag | null>(null);
  const idSequence = useRef(1);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const panRef = useRef<WhiteboardPan | null>(null);
  const spacePressed = useRef(false);
  const selectedItem = state.items.find(
    (item) => item.id === state.selectedItemIds.at(-1),
  );
  const connectableSelection = useMemo(
    () =>
      state.selectedItemIds.filter((id) =>
        state.items.some(
          (item) => item.id === id && item.kind !== "connector",
        ),
      ),
    [state.items, state.selectedItemIds],
  );
  const selectedGroups = useMemo(
    () =>
      new Set(
        state.items
          .filter((item) => state.selectedItemIds.includes(item.id))
          .map((item) => item.groupId)
          .filter((groupId): groupId is string => groupId !== undefined),
      ),
    [state.items, state.selectedItemIds],
  );

  useEffect(
    () => () => {
      viewportScheduler.current?.cancel();
    },
    [],
  );

  useEffect(() => {
    const element = boardRef.current;
    if (element === null) {
      return;
    }
    const updateSize = (width: number, height: number) => {
      if (width <= 0 || height <= 0) {
        return;
      }
      setViewportSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    };
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      updateSize(bounds.width, bounds.height);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) {
        updateSize(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const uniqueId = (prefix: string) => {
    let id = "";
    do {
      id = `${prefix}-${idSequence.current}`;
      idSequence.current += 1;
    } while (state.items.some((item) => item.id === id));
    return id;
  };

  const createAt = (
    type: "create-sticky" | "create-text" | "create-section",
  ) => {
    dispatch({
      type,
      id: uniqueId(type.replace("create-", "")),
      position: nextPosition(state.items.length),
    });
  };

  const connectSelection = () => {
    const [fromItemId, toItemId] = connectableSelection;
    if (fromItemId !== undefined && toItemId !== undefined) {
      dispatch({
        type: "create-connector",
        id: uniqueId("connector"),
        fromItemId,
        toItemId,
      });
    }
  };

  const groupSelection = () => {
    dispatch({ type: "group-selected", groupId: uniqueId("group") });
  };

  const zoomAt = (
    requestedZoom:
      | number
      | ((currentZoom: number) => number),
    point?: { readonly x: number; readonly y: number },
  ) => {
    const bounds = boardRef.current?.getBoundingClientRect();
    const anchorX = point?.x ?? (bounds?.width ?? 900) / 2;
    const anchorY = point?.y ?? (bounds?.height ?? 600) / 2;
    viewportScheduler.current?.schedule((current) => {
      const nextZoom = clampZoom(
        typeof requestedZoom === "function"
          ? requestedZoom(current.zoom)
          : requestedZoom,
      );
      const worldX = (anchorX - current.x) / current.zoom;
      const worldY = (anchorY - current.y) / current.zoom;
      return {
        x: anchorX - worldX * nextZoom,
        y: anchorY - worldY * nextZoom,
        zoom: nextZoom,
      };
    });
  };

  const fitContent = () => {
    const visibleItems = state.items.filter(
      (
        item,
      ): item is Exclude<WhiteboardItem, { kind: "connector" }> =>
        item.kind !== "connector",
    );
    if (visibleItems.length === 0) {
      viewportScheduler.current?.schedule({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const left = Math.min(...visibleItems.map((item) => item.position.x));
    const top = Math.min(...visibleItems.map((item) => item.position.y));
    const right = Math.max(
      ...visibleItems.map((item) => item.position.x + item.size.width),
    );
    const bottom = Math.max(
      ...visibleItems.map((item) => item.position.y + item.size.height),
    );
    const bounds = boardRef.current?.getBoundingClientRect();
    const width = bounds?.width || 900;
    const height = bounds?.height || 600;
    const padding = 64;
    const zoom = clampZoom(
      Math.min(
        (width - padding * 2) / Math.max(1, right - left),
        (height - padding * 2) / Math.max(1, bottom - top),
      ),
    );
    viewportScheduler.current?.schedule({
      x: (width - (right - left) * zoom) / 2 - left * zoom,
      y: (height - (bottom - top) * zoom) / 2 - top * zoom,
      zoom,
    });
  };

  const selectFromPointer = (
    itemId: string,
    event: MouseEvent<HTMLDivElement>,
  ) => {
    dispatch({
      type: "select",
      itemId,
      additive: event.metaKey || event.ctrlKey || event.shiftKey,
    });
  };

  const handleItemKeyboard = (
    index: number,
    itemId: string,
    event: KeyboardEvent<HTMLDivElement>,
  ) => {
    const lastIndex = visibleItems.length - 1;
    const navigationIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? Math.max(0, index - 1)
            : event.key === "ArrowRight" || event.key === "ArrowDown"
              ? Math.min(lastIndex, index + 1)
              : undefined;
    if (navigationIndex !== undefined) {
      event.preventDefault();
      setFocusIndex(navigationIndex);
      itemRefs.current[navigationIndex]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dispatch({
        type: "select",
        itemId,
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
      });
    }
  };

  const handleBoardKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("input, textarea, [contenteditable='true']") !== null
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && key === "g") {
      event.preventDefault();
      if (event.shiftKey) {
        dispatch({ type: "ungroup-selected" });
      } else if (connectableSelection.length > 1) {
        groupSelection();
      }
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      dispatch({ type: "delete-selected" });
      return;
    }
    if (key === "n") {
      event.preventDefault();
      createAt("create-sticky");
    } else if (key === "t") {
      event.preventDefault();
      createAt("create-text");
    } else if (key === "s") {
      event.preventDefault();
      createAt("create-section");
    } else if (key === "c" && connectableSelection.length === 2) {
      event.preventDefault();
      connectSelection();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomAt((current) => current + ZOOM_STEP);
    } else if (event.key === "-") {
      event.preventDefault();
      zoomAt((current) => current - ZOOM_STEP);
    } else if (event.key === "0") {
      event.preventDefault();
      viewportScheduler.current?.schedule({ x: 0, y: 0, zoom: 1 });
    } else if (event.key === " ") {
      spacePressed.current = true;
    }
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const direction = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomAt((current) => current + direction, {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      return;
    }
    viewportScheduler.current?.schedule((current) => ({
      ...current,
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  };

  const handleBoardPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    setContextMenu(null);
    if (event.button === 1 || (event.button === 0 && spacePressed.current)) {
      event.preventDefault();
      panRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        viewport,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const handleBoardPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan === null) {
      return;
    }
    viewportScheduler.current?.schedule({
      ...pan.viewport,
      x: pan.viewport.x + event.clientX - pan.startX,
      y: pan.viewport.y + event.clientY - pan.startY,
    });
  };

  const finishBoardPan = (event: PointerEvent<HTMLDivElement>) => {
    if (panRef.current !== null) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      viewportScheduler.current?.flush();
      panRef.current = null;
    }
  };

  const beginItemDrag = (
    item: WhiteboardItem,
    event: PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0 || item.kind === "connector") {
      return;
    }
    event.stopPropagation();
    const selected = state.selectedItemIds.includes(item.id)
      ? state.selectedItemIds
      : [item.id];
    dragRef.current = {
      itemIds: selected,
      startX: event.clientX,
      startY: event.clientY,
    };
    setDragDelta({ x: 0, y: 0 });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const updateItemDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null) {
      return;
    }
    setDragDelta({
      x: (event.clientX - drag.startX) / viewport.zoom,
      y: (event.clientY - drag.startY) / viewport.zoom,
    });
  };

  const finishItemDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag !== null && dragDelta !== null) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dispatch({
        type: "move-items",
        itemIds: drag.itemIds,
        delta: dragDelta,
      });
    }
    dragRef.current = null;
    setDragDelta(null);
  };

  const sceneStyle = {
    "--whiteboard-pan-x": `${viewport.x}px`,
    "--whiteboard-pan-y": `${viewport.y}px`,
    "--whiteboard-zoom": String(viewport.zoom),
  } as CSSProperties;
  const visibleItems = projectVisibleItems(
    state.items,
    (item) => {
      if (item.kind !== "connector") {
        return {
          height: item.size.height,
          width: item.size.width,
          x: item.position.x,
          y: item.position.y,
        };
      }
      const geometry = connectorGeometry(item, state.items);
      return geometry === undefined
        ? undefined
        : {
            height: Math.abs(geometry.y2 - geometry.y1),
            width: Math.abs(geometry.x2 - geometry.x1),
            x: Math.min(geometry.x1, geometry.x2),
            y: Math.min(geometry.y1, geometry.y2),
          };
    },
    {
      height: viewportSize.height,
      translationX: viewport.x,
      translationY: viewport.y,
      width: viewportSize.width,
      zoom: viewport.zoom,
    },
    {
      overscan: 128,
      pinnedIds: [
        ...state.selectedItemIds,
        ...(dragRef.current?.itemIds ?? []),
      ],
    },
  );
  const visibleItemIds = new Set(visibleItems.map((item) => item.id));

  return (
    <section aria-label="Memi whiteboard" className="whiteboard-shell">
      <header className="whiteboard-toolbar">
        <h1>{state.title}</h1>
        <div
          aria-label="Whiteboard tools"
          className="whiteboard-tool-group"
          role="toolbar"
        >
          <WhiteboardToolButton
            icon="sticky"
            label="Add sticky note"
            onClick={() => {
              createAt("create-sticky");
            }}
            shortcut="N"
          />
          <WhiteboardToolButton
            icon="text"
            label="Add text note"
            onClick={() => {
              createAt("create-text");
            }}
            shortcut="T"
          />
          <WhiteboardToolButton
            icon="section"
            label="Add section"
            onClick={() => {
              createAt("create-section");
            }}
            shortcut="S"
          />
          <WhiteboardToolButton
            disabled={connectableSelection.length !== 2}
            icon="route"
            label="Connect selected items"
            onClick={connectSelection}
            shortcut="C"
          />
          <span aria-hidden="true" className="whiteboard-tool-divider" />
          <WhiteboardToolButton
            disabled={connectableSelection.length < 2}
            icon="group"
            label="Group selected items"
            onClick={groupSelection}
            shortcut="⌘G"
          />
          <WhiteboardToolButton
            disabled={selectedGroups.size === 0}
            icon="ungroup"
            label="Ungroup selected items"
            onClick={() => {
              dispatch({ type: "ungroup-selected" });
            }}
            shortcut="⇧⌘G"
          />
          <span aria-hidden="true" className="whiteboard-tool-divider" />
          <WhiteboardToolButton
            icon="zoom-out"
            label="Zoom out"
            onClick={() => {
              zoomAt((current) => current - ZOOM_STEP);
            }}
            shortcut="−"
          />
          <output aria-live="polite" className="whiteboard-zoom">
            {Math.round(viewport.zoom * 100)}%
          </output>
          <WhiteboardToolButton
            icon="zoom-in"
            label="Zoom in"
            onClick={() => {
              zoomAt((current) => current + ZOOM_STEP);
            }}
            shortcut="+"
          />
          <WhiteboardToolButton
            icon="fit"
            label="Fit whiteboard content"
            onClick={fitContent}
            shortcut="Shift 1"
          />
        </div>
        <output aria-live="polite" className="whiteboard-revision">
          {state.revision} edits
        </output>
      </header>

      <div className="whiteboard-workspace">
        <div
          aria-label="Whiteboard items"
          aria-multiselectable="true"
          className="whiteboard-board"
          onClick={(event) => {
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest(".whiteboard-item") === null
            ) {
              dispatch({ type: "clear-selection" });
              setContextMenu(null);
            }
          }}
          onKeyDown={handleBoardKeyboard}
          onKeyUp={(event) => {
            if (event.key === " ") {
              spacePressed.current = false;
            }
          }}
          onPointerCancel={finishBoardPan}
          onPointerDown={handleBoardPointerDown}
          onPointerMove={handleBoardPointerMove}
          onPointerUp={finishBoardPan}
          onWheel={handleWheel}
          ref={boardRef}
          role="listbox"
          tabIndex={0}
        >
          <div className="whiteboard-scene" style={sceneStyle}>
            <svg
              aria-hidden="true"
              className="whiteboard-connections"
              viewBox="-100000 -100000 200000 200000"
            >
              {visibleItems
                .filter(
                  (
                    item,
                  ): item is Extract<
                    WhiteboardItem,
                    { kind: "connector" }
                  > => item.kind === "connector",
                )
                .map((connector) => {
                  const geometry = connectorGeometry(connector, state.items);
                  return geometry === undefined ? null : (
                    <line key={connector.id} {...geometry} />
                  );
                })}
            </svg>
            {state.items
              .filter((item) => visibleItemIds.has(item.id))
              .map((item, index) => {
              const selected = state.selectedItemIds.includes(item.id);
              const preview =
                selected && item.kind !== "connector"
                  ? (dragDelta ?? undefined)
                  : undefined;
              const style =
                item.kind === "connector"
                  ? connectorOptionStyle(item, state.items)
                  : positionedStyle(item, preview);
              return (
                <div
                  aria-label={itemLabel(item)}
                  aria-selected={selected}
                  className={`whiteboard-item whiteboard-item-${item.kind}${
                    item.kind === "sticky"
                      ? ` whiteboard-sticky-${item.color}`
                      : ""
                  }`}
                  key={item.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectFromPointer(item.id, event);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!selected) {
                      dispatch({ type: "select", itemId: item.id });
                    }
                    const bounds =
                      boardRef.current?.getBoundingClientRect();
                    setContextMenu({
                      x: event.clientX - (bounds?.left ?? 0),
                      y: event.clientY - (bounds?.top ?? 0),
                    });
                  }}
                  onFocus={() => {
                    setFocusIndex(index);
                  }}
                  onKeyDown={(event) => {
                    handleItemKeyboard(index, item.id, event);
                  }}
                  onPointerCancel={finishItemDrag}
                  onPointerDown={(event) => {
                    beginItemDrag(item, event);
                  }}
                  onPointerMove={updateItemDrag}
                  onPointerUp={finishItemDrag}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  role="option"
                  style={style}
                  tabIndex={focusIndex === index ? 0 : -1}
                >
                  <WhiteboardItemGlyph item={item} />
                </div>
              );
              })}
          </div>
          {contextMenu !== null ? (
            <div
              aria-label="Whiteboard item actions"
              className="whiteboard-context-menu"
              role="menu"
              style={
                {
                  "--whiteboard-menu-x": `${contextMenu.x}px`,
                  "--whiteboard-menu-y": `${contextMenu.y}px`,
                } as CSSProperties
              }
            >
              {connectableSelection.length > 1 ? (
                <button
                  aria-label="Group"
                  onClick={() => {
                    groupSelection();
                    setContextMenu(null);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <EditorIcon name="group" />
                  Group
                  <kbd>⌘G</kbd>
                </button>
              ) : null}
              {selectedGroups.size > 0 ? (
                <button
                  aria-label="Ungroup"
                  onClick={() => {
                    dispatch({ type: "ungroup-selected" });
                    setContextMenu(null);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <EditorIcon name="ungroup" />
                  Ungroup
                  <kbd>⇧⌘G</kbd>
                </button>
              ) : null}
              {connectableSelection.length === 2 ? (
                <button
                  aria-label="Connect"
                  onClick={() => {
                    connectSelection();
                    setContextMenu(null);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <EditorIcon name="route" />
                  Connect
                  <kbd>C</kbd>
                </button>
              ) : null}
              <button
                aria-label="Delete"
                className="whiteboard-menu-danger"
                onClick={() => {
                  dispatch({ type: "delete-selected" });
                  setContextMenu(null);
                }}
                role="menuitem"
                type="button"
              >
                <EditorIcon name="trash" />
                Delete
                <kbd>⌫</kbd>
              </button>
            </div>
          ) : null}
        </div>

        <aside aria-label="Whiteboard properties" className="whiteboard-aside">
          <div className="whiteboard-aside-heading">
            <span>Properties</span>
            <span>{state.selectedItemIds.length} selected</span>
          </div>
          <WhiteboardPropertyEditor dispatch={dispatch} item={selectedItem} />
          <div className="whiteboard-help">
            <strong>Shortcuts</strong>
            <span>N sticky · T text · S section</span>
            <span>C connect · ⌘G group</span>
            <span>Space drag to pan · ⌘ scroll to zoom</span>
          </div>
        </aside>
      </div>
    </section>
  );
}
