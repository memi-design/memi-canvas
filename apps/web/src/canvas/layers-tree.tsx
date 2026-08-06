import {
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import { EditorIcon, type EditorIconName } from "./icons.js";
import { descendantNodeIds } from "./layer-hierarchy.js";
import type { WorkbenchNode } from "./model.js";

const expansionSeparator = "\u0001";

export interface LayerMoveRequest {
  readonly index: number;
  readonly nodeId: string;
  readonly parentId: string | null;
}

/**
 * Adds selection-required tree branches without scheduling an update when they
 * are already expanded. Tree indexes are deliberately reconstructed from
 * imported documents, so their object identity is not a state-update signal.
 */
export function mergeExpansionIds(
  current: ReadonlySet<string>,
  required: readonly string[],
): ReadonlySet<string> {
  let next: Set<string> | undefined;
  for (const id of required) {
    if (!current.has(id)) {
      next ??= new Set(current);
      next.add(id);
    }
  }
  return next ?? current;
}

export function Layers({
  nodes,
  onMove,
  selectedNodeId,
  onSelect,
}: {
  readonly nodes: readonly WorkbenchNode[];
  readonly onMove?: (move: LayerMoveRequest) => void;
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
  const draftIds = useMemo(
    () => new Set(draftNodes.map(({ id }) => id)),
    [draftNodes],
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
      const draftBranches: string[] = [];
      let current = selectedNode;
      const seen = new Set<string>();
      while (
        current !== undefined &&
        draftIds.has(current.id) &&
        !seen.has(current.id)
      ) {
        seen.add(current.id);
        if ((childrenByParentId.get(current.id)?.length ?? 0) > 0) {
          draftBranches.push(`draft-${current.id}`);
        }
        current =
          current.parentId === null
            ? undefined
            : nodesById.get(current.parentId);
      }
      return ["drafts", ...draftBranches];
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
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const requiredExpansionSignature = [...requiredExpansionIds()]
    .sort()
    .join(expansionSeparator);

  useEffect(() => {
    setExpanded((current) => {
      return mergeExpansionIds(
        current,
        requiredExpansionSignature.length === 0
          ? []
          : requiredExpansionSignature.split(expansionSeparator),
      );
    });
  }, [requiredExpansionSignature]);

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

  const editableContainerKinds = new Set<WorkbenchNode["kind"]>([
    "Component",
    "DraftFrame",
    "Frame",
    "Group",
    "Section",
  ]);
  const sourceAuthorityKinds = new Set<WorkbenchNode["kind"]>([
    "CodeFrame",
    "ReferenceFrame",
    "RoutePlaceholder",
  ]);
  const hierarchyAllowsMove = (node: WorkbenchNode): boolean => {
    const seen = new Set<string>();
    let current: WorkbenchNode | undefined = node;
    while (current !== undefined) {
      if (
        seen.has(current.id) ||
        current.locked ||
        current.source !== undefined ||
        sourceAuthorityKinds.has(current.kind)
      ) {
        return false;
      }
      seen.add(current.id);
      current =
        current.parentId === null
          ? undefined
          : nodesById.get(current.parentId);
    }
    return true;
  };
  const acceptsChildren = (node: WorkbenchNode): boolean =>
    editableContainerKinds.has(node.kind) && hierarchyAllowsMove(node);
  const isAncestorOf = (ancestorId: string, nodeId: string): boolean => {
    const seen = new Set<string>();
    let current = nodesById.get(nodeId);
    while (current !== undefined && !seen.has(current.id)) {
      if (current.id === ancestorId) return true;
      seen.add(current.id);
      current =
        current.parentId === null
          ? undefined
          : nodesById.get(current.parentId);
    }
    return false;
  };
  const requestMove = (move: LayerMoveRequest, message: string): void => {
    onMove?.(move);
    setMoveAnnouncement(message);
  };
  const siblingNodes = (parentId: string | null): readonly WorkbenchNode[] =>
    nodes.filter((candidate) => candidate.parentId === parentId);
  const dropMove = (
    event: DragEvent<HTMLLIElement>,
    target: WorkbenchNode,
  ): LayerMoveRequest | null => {
    const sourceId =
      draggedNodeId ?? event.dataTransfer.getData("text/plain") ?? null;
    const source = sourceId === null ? undefined : nodesById.get(sourceId);
    if (
      source === undefined ||
      source.id === target.id ||
      !hierarchyAllowsMove(source) ||
      isAncestorOf(source.id, target.id)
    ) {
      return null;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const offset =
      bounds.height <= 0 ? 0.5 : (event.clientY - bounds.top) / bounds.height;
    if (acceptsChildren(target) && offset >= 0.25 && offset <= 0.75) {
      return {
        index: siblingNodes(target.id).filter(({ id }) => id !== source.id)
          .length,
        nodeId: source.id,
        parentId: target.id,
      };
    }
    const siblings = siblingNodes(target.parentId).filter(
      ({ id }) => id !== source.id,
    );
    const targetIndex = siblings.findIndex(({ id }) => id === target.id);
    if (targetIndex < 0) return null;
    return {
      index: targetIndex + (offset > 0.5 ? 1 : 0),
      nodeId: source.id,
      parentId: target.parentId,
    };
  };
  const draftDragProps = (node: WorkbenchNode) => {
    const movable = onMove !== undefined && hierarchyAllowsMove(node);
    return {
      draggable: movable,
      onDragEnd: () => setDraggedNodeId(null),
      onDragOver: (event: DragEvent<HTMLLIElement>) => {
        if (dropMove(event, node) === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      },
      onDragStart: (event: DragEvent<HTMLLIElement>) => {
        if (!movable) {
          event.preventDefault();
          return;
        }
        setDraggedNodeId(node.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", node.id);
      },
      onDrop: (event: DragEvent<HTMLLIElement>) => {
        const move = dropMove(event, node);
        setDraggedNodeId(null);
        if (move === null) return;
        event.preventDefault();
        event.stopPropagation();
        requestMove(move, `Moved ${move.nodeId} near ${node.name}`);
      },
    };
  };

  const handleDraftMoveKey = (
    event: KeyboardEvent<HTMLLIElement>,
    node: WorkbenchNode,
  ): boolean => {
    if (!event.altKey || !hierarchyAllowsMove(node) || onMove === undefined) {
      return false;
    }
    const siblings = siblingNodes(node.parentId);
    const currentIndex = siblings.findIndex(({ id }) => id === node.id);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const nextIndex =
        currentIndex + (event.key === "ArrowUp" ? -1 : 1);
      if (nextIndex < 0 || nextIndex >= siblings.length) return true;
      event.preventDefault();
      requestMove(
        { index: nextIndex, nodeId: node.id, parentId: node.parentId },
        `${node.name} moved ${event.key === "ArrowUp" ? "up" : "down"}`,
      );
      return true;
    }
    if (event.key === "ArrowRight") {
      const previous = siblings[currentIndex - 1];
      if (previous === undefined || !acceptsChildren(previous)) return true;
      event.preventDefault();
      requestMove(
        {
          index: siblingNodes(previous.id).length,
          nodeId: node.id,
          parentId: previous.id,
        },
        `${node.name} moved into ${previous.name}`,
      );
      return true;
    }
    if (event.key === "ArrowLeft" && node.parentId !== null) {
      const parent = nodesById.get(node.parentId);
      if (parent === undefined || !hierarchyAllowsMove(parent)) return true;
      const parentSiblings = siblingNodes(parent.parentId);
      const parentIndex = parentSiblings.findIndex(({ id }) => id === parent.id);
      event.preventDefault();
      requestMove(
        {
          index: parentIndex + 1,
          nodeId: node.id,
          parentId: parent.parentId,
        },
        `${node.name} moved out of ${parent.name}`,
      );
      return true;
    }
    return false;
  };

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
  const renderDraftBranch = (node: WorkbenchNode): React.ReactNode => {
    const children = (childrenByParentId.get(node.id) ?? []).filter(
      (candidate) => draftIds.has(candidate.id),
    );
    const branchId = `draft-${node.id}`;
    const isExpanded = expanded.has(branchId);
    const movable = onMove !== undefined && hierarchyAllowsMove(node);
    const common = {
      "aria-keyshortcuts": movable
        ? "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight"
        : undefined,
      "aria-label": nodeAriaLabel(node),
      "aria-selected": node.id === selectedNodeId,
      ...draftDragProps(node),
      key: node.id,
      onFocus: () => setFocusedItemId(node.id),
      role: "treeitem" as const,
      tabIndex: node.id === focusedItemId ? 0 : -1,
    };
    if (children.length === 0) {
      return (
        <li
          {...common}
          className="layer-leaf"
          onClick={() => onSelect(node.id)}
          onKeyDown={(event) => {
            if (!handleDraftMoveKey(event, node)) handleLeafKeyDown(event, node);
          }}
        >
          <span className="layer-row-icon">
            <EditorIcon name={layerIcon(node)} size={14} />
          </span>
          <span className="layer-row-label">{layerLabel(node)}</span>
          {node.locked ? (
            <span className="layer-row-state" title="Locked">
              <EditorIcon name="lock" size={12} />
            </span>
          ) : null}
        </li>
      );
    }
    return (
      <li
        {...common}
        aria-expanded={isExpanded}
        className="layer-group layer-node-branch"
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (handleDraftMoveKey(event, node)) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node.id);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            if (!isExpanded) toggle(branchId);
            else {
              event.currentTarget
                .querySelector<HTMLElement>(
                  ':scope > [role="group"] > [role="treeitem"]',
                )
                ?.focus();
            }
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            if (isExpanded) toggle(branchId);
            else {
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
        }}
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
          {node.locked ? (
            <span className="layer-row-state" title="Locked">
              <EditorIcon name="lock" size={12} />
            </span>
          ) : null}
        </div>
        {isExpanded ? (
          <ul className="layer-group-children" role="group">
            {children.map(renderDraftBranch)}
          </ul>
        ) : null}
      </li>
    );
  };
  const draftRootNodes = draftNodes.filter(
    (node) => node.parentId === null || !draftIds.has(node.parentId),
  );

  return (
    <>
      <p aria-live="polite" className="canvas-visually-hidden" role="status">
        {moveAnnouncement}
      </p>
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
            () => draftRootNodes.map(renderDraftBranch),
            "frame",
          )
        : null}
      </ul>
    </>
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
