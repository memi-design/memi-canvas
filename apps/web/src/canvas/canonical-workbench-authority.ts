import type {
  CanvasDocumentV2,
  CanvasNodeV2,
  OperationId,
} from "@memi/protocol";
import {
  hashCanvasDocumentV2,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";

import {
  createCanonicalCanvasStore,
  type CanvasHistoryEntryV2,
  type CanonicalCanvasStore,
} from "./canonical-canvas-store.js";
import {
  migrateLegacyCanvasState,
  type LegacyCanvasMigrationReceipt,
} from "./canvas-state-migration.js";
import {
  createSelectionState,
  type SelectionState,
  type WorkbenchNode,
} from "./model.js";
import { workbenchTextAppearance } from "./workbench-text-style.js";
import { parseCanvasPath } from "./canvas-path.js";
import type { CommandActor, CommandTrace } from "./command-bus.js";
import {
  applyWorkbenchProjectionActions,
  diffCanonicalWorkbenchDocuments,
  type WorkbenchProjectionAction,
} from "./canonical-workbench-diff.js";
import {
  createLegacyWorkbenchProjection,
  type LegacyWorkbenchProjection,
} from "./legacy-workbench-projection.js";

export interface CanonicalWorkbenchHistory {
  readonly future: readonly CanvasHistoryEntryV2[];
  readonly past: readonly CanvasHistoryEntryV2[];
}

export interface CanonicalWorkbenchSnapshot {
  readonly document: CanvasDocumentV2;
  readonly history: CanonicalWorkbenchHistory;
  readonly nodes: readonly WorkbenchNode[];
  readonly revision: number;
  readonly selection: SelectionState;
}

export interface CanonicalWorkbenchCommit {
  readonly actor: CommandActor;
  readonly label: string;
  readonly nodes: readonly WorkbenchNode[];
  readonly selection: SelectionState;
  readonly targetIds: readonly string[];
}

export interface CanonicalWorkbenchActionCommit {
  readonly actions: readonly WorkbenchProjectionAction[];
  readonly actor: CommandActor;
  readonly label: string;
  readonly selection: SelectionState;
  readonly targetIds: readonly string[];
}

export interface CanonicalWorkbenchResult {
  readonly trace: CommandTrace;
}

export interface CanonicalWorkbenchAuthority {
  commit(mutation: CanonicalWorkbenchCommit): CanonicalWorkbenchResult;
  commitActions(
    mutation: CanonicalWorkbenchActionCommit,
  ): CanonicalWorkbenchResult;
  createRootNode(input: {
    readonly actor: CommandActor;
    readonly label: string;
    readonly node: WorkbenchNode;
  }): CanonicalWorkbenchResult;
  getSnapshot(): CanonicalWorkbenchSnapshot;
  redo(): CanonicalWorkbenchResult | null;
  setSelection(selection: SelectionState): void;
  subscribe(listener: () => void): () => void;
  undo(): CanonicalWorkbenchResult | null;
}

function migration(
  scene: LegacyWorkbenchProjection,
  documentId: string,
  projectId: string,
  projectionOnly = false,
) {
  const result = migrateLegacyCanvasState(scene, {
    legacyDocumentId: documentId,
    legacyProjectId: projectId,
    projectionOnly,
  });
  if (!result.ok) {
    throw new Error(
      `Canonical canvas migration failed: ${result.issues.join(" ")}`,
    );
  }
  return result;
}

function normalizedInitialDocument(
  document: CanvasDocumentV2,
  revision: number,
): CanvasDocumentV2 {
  const candidate = {
    ...document,
    operationCursor: null,
    revision,
  };
  return Object.freeze({
    ...candidate,
    stateHash: hashCanvasDocumentV2(candidate),
  });
}

function reverseNodeIds(
  nodeIds: Readonly<Record<string, string>>,
): ReadonlyMap<string, string> {
  return new Map(
    Object.entries(nodeIds).map(([legacyId, canonicalId]) => [
      canonicalId,
      legacyId,
    ]),
  );
}

function projectedKind(node: CanvasNodeV2): WorkbenchNode["kind"] {
  if (node.referenceBinding !== null) {
    return "ReferenceFrame";
  }
  if (node.sourceBinding !== null) {
    return node.sourceBinding.captureState === "placeholder"
      ? "RoutePlaceholder"
      : "CodeFrame";
  }
  if (
    node.kind === "frame" &&
    (node.provenance !== null || node.content?.type === "frame")
  ) {
    return "DraftFrame";
  }
  if (
    node.kind === "image" &&
    node.content?.type === "image" &&
    node.content.dataUri !== undefined
  ) {
    return "Image";
  }
  const kinds = {
    arrow: "Arrow",
    component: "Component",
    connector: "Line",
    ellipse: "Ellipse",
    frame: "Frame",
    group: "Group",
    image: "Rectangle",
    instance: "ComponentInstance",
    "imported-source-frame": "CodeFrame",
    line: "Line",
    rectangle: "Rectangle",
    section: "Section",
    sticky: "Comment",
    text: "Text",
    vector: "Vector",
  } as const;
  return kinds[node.kind];
}

function projectedNodes(
  document: CanvasDocumentV2,
  legacyIds: ReadonlyMap<string, string>,
  metadataByNodeId: LegacyCanvasMigrationReceipt["legacyMetadataByNodeId"],
): readonly WorkbenchNode[] {
  const positionCache = new Map<string, { readonly x: number; readonly y: number }>();
  const absolutePosition = (
    node: CanvasNodeV2,
  ): { readonly x: number; readonly y: number } => {
    const cached = positionCache.get(node.id);
    if (cached !== undefined) {
      return cached;
    }
    const parent =
      node.parentId === null ? undefined : document.nodesById[node.parentId];
    const parentPosition =
      parent === undefined ? { x: 0, y: 0 } : absolutePosition(parent);
    const position = {
      x: parentPosition.x + node.transform.x,
      y: parentPosition.y + node.transform.y,
    };
    positionCache.set(node.id, position);
    return position;
  };
  const ordered: CanvasNodeV2[] = [];
  const visit = (id: string): void => {
    const node = document.nodesById[id];
    if (node === undefined) {
      return;
    }
    ordered.push(node);
    node.childIds.forEach(visit);
  };
  document.rootIds.forEach(visit);
  return ordered.map((node) => {
    const fill = node.style.fills.find((paint) => paint.type === "solid");
    const stroke = node.style.strokes.find((paint) => paint.type === "solid");
    const legacyId = legacyIds.get(node.id) ?? node.id;
    const parentId =
      node.parentId === null
        ? null
        : legacyIds.get(node.parentId) ?? node.parentId;
    const nullableRepositoryFields = <
      Value extends {
        readonly captureState?: "captured" | "placeholder" | null;
        readonly dirtyFileFingerprint: string | null;
        readonly repositoryDirty: boolean | null;
        readonly sourceContentHash: string | null;
        readonly sourceFingerprint?: string | null;
      },
    >(
      value: Value,
    ) => {
      const {
        captureState,
        dirtyFileFingerprint,
        repositoryDirty,
        sourceContentHash,
        sourceFingerprint,
        ...required
      } = value;
      return {
        ...required,
        ...(captureState === null || captureState === undefined
          ? {}
          : { captureState }),
        ...(dirtyFileFingerprint === null
          ? {}
          : { dirtyFileFingerprint }),
        ...(repositoryDirty === null ? {} : { repositoryDirty }),
        ...(sourceContentHash === null ? {} : { sourceContentHash }),
        ...(sourceFingerprint === null || sourceFingerprint === undefined
          ? {}
          : { sourceFingerprint }),
      };
    };
    const component =
      node.componentBinding === null
        ? undefined
        : {
            atomicLevel: node.componentBinding.atomicLevel,
            classification: node.componentBinding.classification,
            componentId: node.componentBinding.componentId,
            componentName: node.componentBinding.componentName,
            editable: node.componentBinding.editable,
            ...(node.componentBinding.masterNodeId === null
              ? {}
              : {
                  masterId:
                    legacyIds.get(node.componentBinding.masterNodeId) ??
                    node.componentBinding.masterNodeId,
                }),
            props: node.componentBinding.props,
            role: node.componentBinding.role,
            source: {
              repositoryRevision:
                node.componentBinding.source.repositoryRevision,
              sourceAnchor: node.componentBinding.source.sourceAnchor,
              ...(node.componentBinding.source.exportName === null
                ? {}
                : { exportName: node.componentBinding.source.exportName }),
              ...(node.componentBinding.source.repositoryDirty === null
                ? {}
                : {
                    repositoryDirty:
                      node.componentBinding.source.repositoryDirty,
                  }),
              ...(node.componentBinding.source.sourceContentHash === null
                ? {}
                : {
                    sourceContentHash:
                      node.componentBinding.source.sourceContentHash,
                  }),
            },
            ...(node.componentBinding.variant === null
              ? {}
              : { variant: node.componentBinding.variant }),
          };
    return {
      id: legacyId,
      kind:
        metadataByNodeId[node.id]?.legacyKind === "Slice"
          ? "Slice"
          : projectedKind(node),
      name: node.name,
      parentId,
      position: absolutePosition(node),
      size: {
        height: node.geometry.height,
        width: node.geometry.width,
      },
      layout: structuredClone(node.layout),
      hidden: !node.style.visible,
      locked: node.style.locked,
      rotation: node.transform.rotation,
      opacity: node.style.opacity,
      cornerRadii: node.style.cornerRadii,
      ...(node.style.effects === undefined
        ? {}
        : { effects: node.style.effects.map((effect) => ({ ...effect })) }),
      ...(node.style.strokeWeight === undefined
        ? {}
        : { strokeWeight: node.style.strokeWeight }),
      ...(node.style.strokeAlign === undefined
        ? {}
        : { strokeAlign: node.style.strokeAlign }),
      ...(fill?.type === "solid" ? { fill: fill.color } : {}),
      ...(stroke?.type === "solid" ? { stroke: stroke.color } : {}),
      ...(node.text === null
        ? node.content?.type === "note"
          ? { text: node.content.body }
          : typeof node.componentBinding?.props.label === "string"
            ? { text: node.componentBinding.props.label }
            : {}
        : {
            text: node.text.characters,
            ...workbenchTextAppearance(node.text),
          }),
      ...(component === undefined
        ? {}
        : { component: structuredClone(component) }),
      ...(node.content?.type === "frame"
        ? { frameContent: node.content.value }
        : {}),
      ...(node.content?.type === "vector"
        ? { path: parseCanvasPath(node.content.pathData) }
        : {}),
      ...(node.content?.type === "image" &&
      node.content.dataUri !== undefined &&
      node.content.byteLength !== undefined &&
      node.content.height !== undefined &&
      node.content.width !== undefined
        ? {
            image: {
              alt: node.content.alt,
              byteLength: node.content.byteLength,
              height: node.content.height,
              mimeType: "image/png" as const,
              src: node.content.dataUri,
              width: node.content.width,
            },
          }
        : {}),
      ...(node.provenance === null
        ? {}
        : { provenance: nullableRepositoryFields(node.provenance) }),
      ...(node.referenceBinding === null
        ? {}
        : { reference: structuredClone(node.referenceBinding) }),
      ...(node.sourceBinding === null
        ? {}
        : { source: nullableRepositoryFields(node.sourceBinding) }),
      ...(metadataByNodeId[node.id]?.semanticBaseline === undefined
        ? {}
        : {
            semanticBaseline:
              metadataByNodeId[node.id]?.semanticBaseline,
          }),
    } as WorkbenchNode;
  });
}

/**
 * Read-only renderer projection for a canonical V2-shaped page. The mutation
 * authority remains outside this helper; callers only receive WorkbenchNodes
 * for the existing renderer while a V3 session is being introduced.
 */
export function projectCanvasDocumentV2ToWorkbenchNodes(
  document: CanvasDocumentV2,
): readonly WorkbenchNode[] {
  return projectedNodes(document, new Map(), {});
}

function legacySelection(
  canonical: SelectionState,
  legacyIds: ReadonlyMap<string, string>,
): SelectionState {
  const map = (id: string | null): string | null =>
    id === null ? null : legacyIds.get(id) ?? id;
  return createSelectionState(
    canonical.selectedIds.map((id) => legacyIds.get(id) ?? id),
    {
      editingId: map(canonical.editingId),
      focusedId: map(canonical.focusedId),
    },
  );
}

function canonicalSelection(
  legacy: SelectionState,
  nodeIds: Readonly<Record<string, string>>,
): SelectionState {
  const map = (id: string | null): string | null =>
    id === null ? null : nodeIds[id] ?? id;
  return {
    anchorId: map(legacy.anchorId),
    editingId: map(legacy.editingId),
    focusedId: map(legacy.focusedId),
    selectedIds: legacy.selectedIds.map((id) => nodeIds[id] ?? id),
  };
}

function trace(
  actor: CommandActor,
  commandId: string,
  label: string,
  targetIds: readonly string[],
  beforeRevision: number,
  afterRevision: number,
  undoOf?: string,
): CommandTrace {
  return {
    actor,
    commandId,
    label,
    targetIds,
    beforeRevision,
    afterRevision,
    durationMs: 0,
    result: "applied",
    ...(undoOf === undefined ? {} : { undoOf }),
  };
}

export function createCanonicalWorkbenchAuthority(input: {
  readonly documentId: string;
  readonly projectId: string;
  readonly scene: LegacyWorkbenchProjection;
}): CanonicalWorkbenchAuthority {
  const migrated = migration(input.scene, input.documentId, input.projectId);
  let nodeIds: Readonly<Record<string, string>> = {
    ...migrated.receipt.nodeIds,
  };
  let legacyIds = reverseNodeIds(nodeIds);
  let metadataByNodeId = {
    ...migrated.receipt.legacyMetadataByNodeId,
  };
  let transientSelection: SelectionState | null = null;
  let operationSequence = 1;
  const listeners = new Set<() => void>();
  const allocate = (reason: string) =>
    mapLegacyCanvasIdV2(
      "operation",
      `${input.documentId}:canonical-workbench:${operationSequence++}:${reason}`,
    ).canonicalId as OperationId;
  const store: CanonicalCanvasStore = createCanonicalCanvasStore({
    allocateHistoryOperation: (direction, entry) => ({
      actor: "human",
      actorId: "memi-workbench",
      id: allocate(`${direction}:${entry.id}`),
      occurredAt: new Date().toISOString(),
    }),
    document: normalizedInitialDocument(
      migrated.document,
      input.scene.revision,
    ),
    selection: migrated.selection,
  });

  const snapshot = (): CanonicalWorkbenchSnapshot => {
    const canonical = store.getSnapshot();
    const history = store.getHistorySnapshot();
    return {
      document: canonical.document,
      history,
      nodes: projectedNodes(
        canonical.document,
        legacyIds,
        metadataByNodeId,
      ),
      revision: canonical.document.revision,
      selection:
        transientSelection ??
        legacySelection(canonical.selection, legacyIds),
    };
  };
  let cachedSnapshot = snapshot();
  const refresh = (): void => {
    cachedSnapshot = snapshot();
    listeners.forEach((listener) => listener());
  };
  store.subscribe(refresh);

  const authority: CanonicalWorkbenchAuthority = {
    commitActions(mutation) {
      return authority.commit({
        actor: mutation.actor,
        label: mutation.label,
        nodes: applyWorkbenchProjectionActions(
          authority.getSnapshot().nodes,
          mutation.actions,
        ),
        selection: mutation.selection,
        targetIds: mutation.targetIds,
      });
    },
    createRootNode(request) {
      if (request.node.parentId !== null) {
        throw new Error(
          "Direct canonical creation currently requires a root canvas node.",
        );
      }
      const existingCanonicalId = nodeIds[request.node.id];
      if (
        existingCanonicalId !== undefined &&
        store.getSnapshot().document.nodesById[existingCanonicalId] !==
          undefined
      ) {
        throw new Error(`Canvas node already exists: ${request.node.id}`);
      }

      const before = store.getSnapshot().document;
      const candidate = migration(
        createLegacyWorkbenchProjection({
          nodes: [request.node],
          revision: before.revision + 1,
          selectedNodeId: request.node.id,
        }),
        input.documentId,
        input.projectId,
        true,
      );
      const canonicalId = candidate.receipt.nodeIds[request.node.id];
      const canonicalNode =
        canonicalId === undefined
          ? undefined
          : candidate.document.nodesById[canonicalId];
      if (canonicalId === undefined || canonicalNode === undefined) {
        throw new Error(
          `Direct canonical creation could not map ${request.node.id}.`,
        );
      }

      const operation = prepareCanvasOperationV2(before, {
        action: {
          payload: {
            index: before.rootIds.length,
            node: canonicalNode,
            parentId: null,
          },
          type: "node.create",
        },
        actor: request.actor,
        actorId: "memi-workbench",
        id: allocate(request.label),
        occurredAt: new Date().toISOString(),
      });
      const selectionAfter = createSelectionState([canonicalId]);
      const result = store.dispatch(operation, {
        historyLabel: request.label,
        selectionAfter,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }

      nodeIds = { ...nodeIds, ...candidate.receipt.nodeIds };
      legacyIds = reverseNodeIds(nodeIds);
      metadataByNodeId = {
        ...metadataByNodeId,
        ...candidate.receipt.legacyMetadataByNodeId,
      };
      transientSelection = null;
      refresh();
      return {
        trace: trace(
          request.actor,
          operation.id,
          request.label,
          [request.node.id],
          before.revision,
          result.revision,
        ),
      };
    },
    commit(mutation) {
      const beforeRevision = store.getSnapshot().document.revision;
      // Transitional UI boundary: legacy WorkbenchNode inputs are validated
      // and diffed here, but only the resulting V2 operations enter history.
      // Pointer previews remain ephemeral and never cross this boundary.
      const desiredScene = createLegacyWorkbenchProjection({
        nodes: mutation.nodes,
        revision: beforeRevision + 1,
        selectedNodeId: mutation.selection.anchorId,
      });
      const desired = migration(
        desiredScene,
        input.documentId,
        input.projectId,
        true,
      );
      nodeIds = { ...nodeIds, ...desired.receipt.nodeIds };
      legacyIds = reverseNodeIds(nodeIds);
      metadataByNodeId = {
        ...metadataByNodeId,
        ...desired.receipt.legacyMetadataByNodeId,
      };
      const actions = diffCanonicalWorkbenchDocuments(
        store.getSnapshot().document,
        desired.document,
      );
      const selectionAfter = canonicalSelection(
        mutation.selection,
        nodeIds,
      );
      if (actions.length === 0) {
        transientSelection = null;
        store.setSelection(selectionAfter);
        refresh();
        return {
          trace: trace(
            mutation.actor,
            allocate(`${mutation.label}:no-change`),
            mutation.label,
            mutation.targetIds,
            beforeRevision,
            beforeRevision,
          ),
        };
      }
      const operation = prepareCanvasOperationV2(store.getSnapshot().document, {
        action: {
          payload: {
            actions,
          },
          type: "atomic.batch",
        },
        actor: mutation.actor,
        actorId: "memi-workbench",
        id: allocate(mutation.label),
        occurredAt: new Date().toISOString(),
      });
      const result = store.dispatch(operation, {
        historyLabel: mutation.label,
        selectionAfter,
      });
      if (!result.ok) {
        throw new Error(result.message);
      }
      transientSelection = null;
      refresh();
      return {
        trace: trace(
          mutation.actor,
          operation.id,
          mutation.label,
          mutation.targetIds,
          beforeRevision,
          result.revision,
        ),
      };
    },
    getSnapshot: () => cachedSnapshot,
    redo() {
      const beforeRevision = store.getSnapshot().document.revision;
      const entry = store.getHistorySnapshot().future[0];
      const result = store.redo();
      if (!result.ok || result.changed === false || entry === undefined) {
        return null;
      }
      transientSelection = null;
      refresh();
      return {
        trace: trace(
          entry.operation.actor,
          entry.operation.id,
          entry.label,
          entry.operation.targetIds.map((id) => legacyIds.get(id) ?? id),
          beforeRevision,
          result.revision,
        ),
      };
    },
    setSelection(selection) {
      const canonical = canonicalSelection(selection, nodeIds);
      const document = store.getSnapshot().document;
      if (
        canonical.selectedIds.some(
          (id) => document.nodesById[id] === undefined,
        )
      ) {
        transientSelection = createSelectionState(selection.selectedIds, {
          editingId: selection.editingId,
          focusedId: selection.focusedId,
        });
        refresh();
        return;
      }
      transientSelection = null;
      store.setSelection(canonical);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    undo() {
      const entry = store.getHistorySnapshot().past.at(-1);
      if (entry === undefined) {
        return null;
      }
      const beforeRevision = store.getSnapshot().document.revision;
      const result = store.undo();
      if (!result.ok || result.changed === false) {
        return null;
      }
      transientSelection = null;
      refresh();
      return {
        trace: trace(
          entry.operation.actor,
          entry.operation.id,
          `Undo ${entry.label}`,
          entry.operation.targetIds.map((id) => legacyIds.get(id) ?? id),
          beforeRevision,
          result.revision,
          entry.operation.id,
        ),
      };
    },
  };
  return Object.freeze(authority);
}
