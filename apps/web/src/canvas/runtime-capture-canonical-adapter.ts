import {
  CanvasDocumentV2Schema,
  CanvasNodeV2Schema,
  SourceAnchorV2Schema,
  type CanvasActionIntentV2,
  type CanvasDocumentV2,
  type CanvasNodeV2,
  type CanvasOperationV2,
} from "@memi/protocol";
import {
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV2,
} from "@memi/canvas-document";
import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";

import type { CanonicalCanvasStore } from "./canonical-canvas-store.js";
import {
  EditableReconstructionV1Schema,
  RuntimeCaptureScreenV1Schema,
  type EditableReconstructionV1,
  type RuntimeCaptureScreenV1,
} from "./runtime-capture-canonical-types.js";

export type { RuntimeCaptureScreenV1 };

type SingleAction = Exclude<
  CanvasActionIntentV2,
  { readonly type: "atomic.batch" }
>;

export interface RuntimeCaptureCanonicalPlan {
  readonly frameId: string;
  readonly layerNodeIds: Readonly<Record<string, string>>;
  readonly manifestHash: string;
  readonly operation: CanvasOperationV2 | null;
  readonly reconstruction: EditableReconstructionV1;
  readonly referenceId: string;
}

export type RuntimeCaptureCanonicalResult =
  | {
      readonly changed: boolean;
      readonly frameId: string;
      readonly layerNodeIds: Readonly<Record<string, string>>;
      readonly manifestHash: string;
      readonly ok: true;
      readonly reconstruction: EditableReconstructionV1;
      readonly referenceId: string;
      readonly revision: number;
    }
  | {
      readonly code:
        | "invalid-capture"
        | "stale-document"
        | "store-rejected";
      readonly message: string;
      readonly ok: false;
    };

const SYSTEM_ACTOR = "runtime-capture-adapter";

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const object = value as object;
  if (seen.has(object)) {
    return value;
  }
  seen.add(object);
  Object.values(object).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function captureMarker(captureId: string): string {
  return `runtime-capture:${captureId}`;
}

function parseAnchor(value: string): {
  readonly path: string;
  readonly symbol: string;
} {
  const separator = value.lastIndexOf("#");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(
      "Runtime capture source anchors must use relative/path.tsx#Symbol.",
    );
  }
  return {
    path: value.slice(0, separator),
    symbol: value.slice(separator + 1),
  };
}

function nodeIds(
  document: CanvasDocumentV2,
  capture: RuntimeCaptureScreenV1,
) {
  const frameId = mapLegacyCanvasIdV2(
    "node",
    `${document.id}:runtime-capture:${capture.captureId}:screen`,
  ).canonicalId;
  const byLayerId: Readonly<Record<string, string>> = Object.fromEntries(
    capture.layers.map((layer) => [
      layer.layerId,
      mapLegacyCanvasIdV2(
        "node",
        `${document.id}:runtime-capture:${capture.captureId}:layer:${layer.layerId}`,
      ).canonicalId,
    ]),
  );
  const bySemanticKey: Readonly<Record<string, string>> = Object.fromEntries(
    capture.layers.map((layer) => [
      layer.semanticKey,
      requiredId(byLayerId, layer.layerId),
    ]),
  );
  return {
    byLayerId,
    bySemanticKey: deepFreeze(bySemanticKey),
    frameId,
    referenceId: mapLegacyCanvasIdV2(
      "node",
      `${document.id}:runtime-capture:${capture.captureId}:reference`,
    ).canonicalId,
  };
}

function requiredId(
  ids: Readonly<Record<string, string>>,
  key: string,
): string {
  const id = ids[key];
  if (id === undefined) {
    throw new Error(`Runtime capture identity is missing for ${key}.`);
  }
  return id;
}

function defaultLayout(): CanvasNodeV2["layout"] {
  return {
    alignCounter: "start",
    alignPrimary: "start",
    gap: 0,
    mode: "none",
    padding: { bottom: 0, left: 0, right: 0, top: 0 },
    sizingHorizontal: "fixed",
    sizingVertical: "fixed",
    wrap: false,
  };
}

function layerKind(
  kind: RuntimeCaptureScreenV1["layers"][number]["kind"],
): CanvasNodeV2["kind"] {
  const kinds = {
    "component-instance": "group",
    frame: "frame",
    group: "group",
    icon: "vector",
    image: "image",
    shape: "rectangle",
    text: "text",
  } as const;
  return kinds[kind];
}

function layerLayout(
  layer: RuntimeCaptureScreenV1["layers"][number],
): CanvasNodeV2["layout"] {
  const layout = layer.layout;
  if (layout === undefined) {
    return defaultLayout();
  }
  const mode =
    layout.flex?.direction === "row"
      ? "horizontal"
      : layout.flex?.direction === "column"
        ? "vertical"
        : "none";
  return {
    alignCounter: layout.align ?? "start",
    alignPrimary: layout.justify ?? "start",
    gap: layout.gap ?? 0,
    mode,
    padding:
      layout.padding ?? { bottom: 0, left: 0, right: 0, top: 0 },
    sizingHorizontal: "fixed",
    sizingVertical: "fixed",
    wrap: layout.flex?.wrap ?? false,
  };
}

function orderedLayers(capture: RuntimeCaptureScreenV1) {
  const children = new Map<string | null, RuntimeCaptureScreenV1["layers"]>();
  for (const layer of capture.layers) {
    const parent = layer.parentLayerId ?? null;
    children.set(parent, [...(children.get(parent) ?? []), layer]);
  }
  const ordered: RuntimeCaptureScreenV1["layers"][number][] = [];
  const visit = (parentId: string | null): void => {
    for (const layer of children.get(parentId) ?? []) {
      ordered.push(layer);
      visit(layer.layerId);
    }
  };
  visit(null);
  if (ordered.length !== capture.layers.length) {
    throw new Error("Runtime capture layer hierarchy is not traversable.");
  }
  return ordered;
}

function layerNodes(
  capture: RuntimeCaptureScreenV1,
  frameId: string,
  byLayerId: Readonly<Record<string, string>>,
): ReadonlyMap<string, CanvasNodeV2> {
  const layersById = new Map(
    capture.layers.map((layer) => [layer.layerId, layer] as const),
  );
  const marker = captureMarker(capture.captureId);
  return new Map(
    capture.layers.map((layer) => {
      const parent =
        layer.parentLayerId === undefined
          ? undefined
          : layersById.get(layer.parentLayerId);
      const anchor = parseAnchor(layer.source.sourceAnchor);
      const kind = layerKind(layer.kind);
      const solidColor =
        kind === "text"
          ? (layer.style.textColor ?? layer.style.fill)
          : layer.style.fill;
      const fills =
        layer.kind === "image"
          ? [
              {
                artifactId:
                  layer.content.imageRef ?? capture.artifact.artifactId,
                scaleMode: "fill" as const,
                type: "image" as const,
              },
            ]
          : solidColor !== undefined
            ? [
                {
                  color: solidColor,
                  type: "solid" as const,
                },
              ]
            : [];
      const node = CanvasNodeV2Schema.parse({
        childIds: capture.layers
          .filter(({ parentLayerId }) => parentLayerId === layer.layerId)
          .map(({ layerId }) => requiredId(byLayerId, layerId)),
        componentBinding: null,
        componentId: null,
        content:
          kind === "image"
            ? {
                alt: layer.name,
                artifactId:
                  layer.content.imageRef ?? capture.artifact.artifactId,
                type: "image",
              }
            : null,
        geometry: {
          height: layer.geometry.height,
          width: layer.geometry.width,
        },
        id: requiredId(byLayerId, layer.layerId),
        instanceOverrides: {},
        kind,
        layout: layerLayout(layer),
        name: layer.name,
        parentId:
          layer.parentLayerId === undefined
            ? frameId
            : requiredId(byLayerId, layer.parentLayerId),
        provenance: null,
        referenceBinding: null,
        sourceAnchor: SourceAnchorV2Schema.parse({
          astPath: layer.source.astPath,
          componentIdentity:
            layer.source.componentId ??
            layer.source.exportName ??
            null,
          contentHash: layer.source.sourceContentHash,
          dirtyFingerprint: capture.repository.dirtyFileFingerprint,
          path: anchor.path,
          range: layer.source.range,
          runtimeEvidenceRefs: [
            capture.artifact.artifactId,
            marker,
          ],
          sourceRevision: capture.repository.revision,
          symbol: anchor.symbol,
        }),
        sourceBinding: null,
        style: {
          cornerRadii: [
            layer.geometry.cornerRadius ?? 0,
            layer.geometry.cornerRadius ?? 0,
            layer.geometry.cornerRadius ?? 0,
            layer.geometry.cornerRadius ?? 0,
          ],
          fills,
          locked: false,
          opacity: layer.style.opacity ?? 1,
          strokes:
            layer.style.stroke === undefined
              ? []
              : [{ color: layer.style.stroke, type: "solid" }],
          visible: true,
        },
        text:
          kind === "text"
            ? {
                autoResize: "width-height",
                characters: layer.content.text ?? "",
                ...(layer.style.fontFamily === undefined
                  ? {}
                  : { fontFamily: layer.style.fontFamily }),
                ...(layer.style.fontSize === undefined ||
                layer.style.fontSize <= 0
                  ? {}
                  : { fontSize: layer.style.fontSize }),
                ...(layer.style.fontWeight === undefined
                  ? {}
                  : { fontWeight: Math.min(900, layer.style.fontWeight) }),
                ...(layer.style.letterSpacing === undefined
                  ? {}
                  : { letterSpacing: layer.style.letterSpacing }),
                ...(layer.style.lineHeight === undefined ||
                layer.style.lineHeight <= 0
                  ? {}
                  : { lineHeight: layer.style.lineHeight }),
              }
            : null,
        transform: {
          rotation: layer.geometry.rotation,
          scaleX: 1,
          scaleY: 1,
          x: layer.geometry.x - (parent?.geometry.x ?? 0),
          y: layer.geometry.y - (parent?.geometry.y ?? 0),
        },
      });
      return [layer.layerId, node] as const;
    }),
  );
}

function rootNode(
  capture: RuntimeCaptureScreenV1,
  frameId: string,
  childIds: readonly string[],
  manifestHash: string,
  transform: CanvasNodeV2["transform"],
): CanvasNodeV2 {
  return CanvasNodeV2Schema.parse({
    childIds,
    componentBinding: null,
    componentId: null,
    content: {
      format: "plain-text",
      type: "frame",
      value: `${captureMarker(capture.captureId)}:${manifestHash}`,
    },
    geometry: {
      height: capture.binding.viewport.height,
      width: capture.binding.viewport.width,
    },
    id: frameId,
    instanceOverrides: {},
    kind: "imported-source-frame",
    layout: defaultLayout(),
    name: capture.screenName,
    parentId: null,
    provenance: null,
    referenceBinding: null,
    sourceAnchor: null,
    sourceBinding: {
      captureState: "captured",
      coverageCellId: capture.binding.coverageCellId,
      dirtyFileFingerprint: capture.repository.dirtyFileFingerprint,
      repositoryDirty: capture.repository.dirty,
      repositoryRevision: capture.repository.revision,
      routeId: capture.binding.routeId,
      sourceAnchor: capture.binding.sourceAnchor,
      sourceContentHash: capture.binding.sourceContentHash,
      sourceFingerprint: capture.repository.sourceFingerprint,
      stateId: capture.binding.stateId,
      viewport: {
        height: capture.binding.viewport.height,
        name: capture.binding.viewport.name,
        width: capture.binding.viewport.width,
      },
    },
    style: {
      cornerRadii: [0, 0, 0, 0],
      fills: [],
      locked: false,
      opacity: 1,
      strokes: [],
      visible: true,
    },
    text: null,
    transform,
  });
}

function referenceNode(
  capture: RuntimeCaptureScreenV1,
  referenceId: string,
): CanvasNodeV2 {
  const sourceAnchors = [
    ...new Set([
      capture.binding.sourceAnchor,
      ...(capture.evidence.sourceAnchors ?? []),
      ...capture.layers.map(({ source }) => source.sourceAnchor),
    ]),
  ];
  const componentIds = [
    ...new Set(
      [
        ...(capture.evidence.componentIds ?? []),
        ...capture.layers.flatMap(({ source }) =>
          source.componentId === null ||
          source.componentId === undefined
            ? []
            : [source.componentId],
        ),
      ],
    ),
  ];
  return CanvasNodeV2Schema.parse({
    childIds: [],
    componentBinding: null,
    componentId: null,
    content: null,
    geometry: {
      height: capture.binding.viewport.height,
      width: capture.binding.viewport.width,
    },
    id: referenceId,
    instanceOverrides: {},
    kind: "imported-source-frame",
    layout: defaultLayout(),
    name: `${capture.screenName} runtime reference`,
    parentId: null,
    provenance: null,
    referenceBinding: {
      ...(capture.evidence.accessibilitySnapshotRef === undefined
        ? {}
        : {
            accessibilitySnapshotRef:
              capture.evidence.accessibilitySnapshotRef,
          }),
      alt: capture.artifact.alt,
      appVersion: capture.app.appVersion,
      authority: "Local capture",
      captureId: capture.captureId,
      ...(componentIds.length === 0 ? {} : { componentIds }),
      contentHash: capture.artifact.hash,
      capturedAt: capture.capturedAt,
      sourceAnchors,
      sourceRevision: capture.repository.revision,
      sourceUrl: capture.artifact.sourceUrl ?? capture.artifact.src,
      src: capture.artifact.src,
    },
    sourceAnchor: null,
    sourceBinding: null,
    style: {
      cornerRadii: [0, 0, 0, 0],
      fills: [
        {
          artifactId: capture.artifact.artifactId,
          scaleMode: "fill",
          type: "image",
        },
      ],
      locked: true,
      opacity: 1,
      strokes: [],
      visible: false,
    },
    text: null,
    transform: {
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      x: 0,
      y: 0,
    },
  });
}

function reconstructionMetadata(
  capture: RuntimeCaptureScreenV1,
  ids: ReturnType<typeof nodeIds>,
): EditableReconstructionV1 {
  const fidelity = capture.reconstructionFidelity;
  const verified =
    fidelity?.geometryWithinOnePoint === true &&
    fidelity.screenshotHiddenSsim >= 0.985;
  return EditableReconstructionV1Schema.parse({
    captureId: capture.captureId,
    evidenceNodeId: ids.referenceId,
    frameId: ids.frameId,
    geometryWithinOnePoint:
      fidelity?.geometryWithinOnePoint ?? null,
    layers: Object.fromEntries(capture.layers.map((layer) => [
      layer.semanticKey,
      {
        confidence: 1,
        evidenceRefs: [
          capture.artifact.artifactId,
          captureMarker(capture.captureId),
        ],
        nodeId: requiredId(ids.byLayerId, layer.layerId),
      },
    ])),
    reviewStatus: verified ? "verified" : "needs-review",
    screenshotHiddenSsim:
      fidelity?.screenshotHiddenSsim ?? null,
  });
}

function provenance(node: CanvasNodeV2) {
  return {
    provenance: node.provenance,
    referenceBinding: node.referenceBinding,
    sourceBinding: node.sourceBinding,
  };
}

function ownedLayer(node: CanvasNodeV2, marker: string): boolean {
  return (
    node.sourceAnchor?.runtimeEvidenceRefs.includes(marker) === true ||
    (node.referenceBinding?.captureId !== undefined &&
      marker === captureMarker(node.referenceBinding.captureId))
  );
}

function postorderManagedNodes(
  document: CanvasDocumentV2,
  root: CanvasNodeV2,
  marker: string,
): readonly CanvasNodeV2[] {
  const managed: CanvasNodeV2[] = [];
  const visit = (node: CanvasNodeV2, insideManaged: boolean): void => {
    const isManaged = ownedLayer(node, marker);
    if (insideManaged && !isManaged) {
      throw new Error(
        `Runtime capture reimport cannot delete unmanaged child ${node.id}.`,
      );
    }
    for (const childId of node.childIds) {
      const child = document.nodesById[childId];
      if (child === undefined) {
        throw new Error(`Runtime capture hierarchy is corrupt at ${childId}.`);
      }
      visit(child, insideManaged || isManaged);
    }
    if (isManaged) {
      managed.push(node);
    }
  };
  for (const childId of root.childIds) {
    const child = document.nodesById[childId];
    if (child !== undefined) {
      visit(child, false);
    }
  }
  return managed;
}

function rootUpdateActions(
  current: CanvasNodeV2,
  desired: CanvasNodeV2,
): SingleAction[] {
  const actions: SingleAction[] = [];
  if (
    current.name !== desired.name ||
    current.kind !== desired.kind
  ) {
    actions.push({
      payload: {
        next: { kind: desired.kind, name: desired.name },
        nodeId: current.id,
      },
      type: "node.identity",
    });
  }
  const values = [
    ["node.geometry", current.geometry, desired.geometry],
    ["node.style", current.style, desired.style],
    ["node.content", current.content, desired.content],
    ["node.provenance", provenance(current), provenance(desired)],
  ] as const;
  for (const [type, prior, next] of values) {
    if (!equal(prior, next)) {
      actions.push({
        payload: { next, nodeId: current.id },
        type,
      } as SingleAction);
    }
  }
  return actions;
}

function assertOwnedRoot(
  root: CanvasNodeV2,
  capture: RuntimeCaptureScreenV1,
): void {
  const marker = captureMarker(capture.captureId);
  if (
    root.kind !== "imported-source-frame" ||
    root.sourceBinding?.routeId !== capture.binding.routeId ||
    root.sourceBinding.stateId !== capture.binding.stateId ||
    root.content?.type !== "frame" ||
    !root.content.value.startsWith(`${marker}:`)
  ) {
    throw new Error(
      "Runtime capture identity collides with a non-capture canvas node.",
    );
  }
}

export function prepareRuntimeCaptureCanonicalOperation(
  untrustedDocument: CanvasDocumentV2,
  untrustedCapture: RuntimeCaptureScreenV1,
  options: {
    readonly placement?: { readonly x: number; readonly y: number };
  } = {},
): RuntimeCaptureCanonicalPlan {
  const document = CanvasDocumentV2Schema.parse(untrustedDocument);
  const capture = RuntimeCaptureScreenV1Schema.parse(untrustedCapture);
  const manifestHash = hashCanonicalValue(capture);
  const ids = nodeIds(document, capture);
  const ordered = orderedLayers(capture);
  const desiredLayers = layerNodes(capture, ids.frameId, ids.byLayerId);
  const desiredReference = referenceNode(
    capture,
    ids.referenceId,
  );
  const reconstruction = reconstructionMetadata(capture, ids);
  const desiredManaged = new Map<string, CanvasNodeV2>([
    ["__runtime_reference__", desiredReference],
    ...desiredLayers,
  ]);
  const rootChildren = capture.layers
    .filter(({ parentLayerId }) => parentLayerId === undefined)
    .map(({ layerId }) => requiredId(ids.byLayerId, layerId));
  const currentRoot = document.nodesById[ids.frameId];
  const transform =
    currentRoot?.transform ?? {
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      x: options.placement?.x ?? 0,
      y: options.placement?.y ?? 0,
    };
  const marker = captureMarker(capture.captureId);
  const currentHierarchyManaged =
    currentRoot === undefined
      ? []
      : postorderManagedNodes(document, currentRoot, marker);
  const currentReference = document.nodesById[ids.referenceId];
  const currentManaged = [
    ...currentHierarchyManaged,
    ...(currentReference === undefined ||
    currentHierarchyManaged.some(({ id }) => id === currentReference.id)
      ? []
      : [currentReference]),
  ];
  const managedIds = new Set<string>(
    currentManaged.map(({ id }) => id),
  );
  const unmanagedRootChildren =
    currentRoot?.childIds.filter((id) => !managedIds.has(id)) ?? [];
  const desiredRoot = rootNode(
    capture,
    ids.frameId,
    [...rootChildren, ...unmanagedRootChildren],
    manifestHash,
    transform,
  );
  const desiredIds = new Set(
    [...desiredManaged.values()].map(({ id }) => id),
  );
  const desiredById = new Map(
    [...desiredManaged.values()].map((node) => [node.id, node] as const),
  );
  const layersMatch =
    currentRoot !== undefined &&
    currentManaged.length === desiredManaged.size &&
    currentManaged.every((node) => {
      const desired = desiredById.get(node.id);
      return desired !== undefined && equal(node, desired);
    }) &&
    desiredIds.size === managedIds.size &&
    [...desiredIds].every((id) => managedIds.has(id)) &&
    equal(currentRoot.childIds, desiredRoot.childIds);
  const actions: SingleAction[] = [];

  if (currentRoot === undefined) {
    for (const node of desiredManaged.values()) {
      const collision = document.nodesById[node.id];
      if (collision !== undefined) {
        throw new Error(
          `Runtime capture layer identity collides with ${collision.id}.`,
        );
      }
    }
    actions.push({
      payload: {
        index: document.rootIds.length,
        node: { ...desiredRoot, childIds: [] },
        parentId: null,
      },
      type: "node.create",
    });
  } else {
    assertOwnedRoot(currentRoot, capture);
    if (!layersMatch) {
      actions.push(
        ...currentManaged.map(
          (node): SingleAction => ({
            payload: { nodeId: node.id },
            type: "node.delete",
          }),
        ),
      );
    }
    actions.push(...rootUpdateActions(currentRoot, desiredRoot));
  }

  if (currentRoot === undefined || !layersMatch) {
    const currentUnmanagedIds = new Set(
      Object.keys(document.nodesById).filter((id) => !managedIds.has(id)),
    );
    actions.push({
      payload: {
        index:
          currentRoot === undefined
            ? document.rootIds.length + 1
            : Math.max(
                0,
                document.rootIds.findIndex((id) => id === ids.frameId) + 1,
              ),
        node: { ...desiredReference, childIds: [] },
        parentId: null,
      },
      type: "node.create",
    });
    for (const layer of ordered) {
      const node = desiredLayers.get(layer.layerId);
      if (node === undefined) {
        throw new Error(`Runtime capture layer ${layer.layerId} is missing.`);
      }
      if (
        currentRoot !== undefined &&
        currentUnmanagedIds.has(node.id)
      ) {
        throw new Error(
          `Runtime capture layer identity collides with ${node.id}.`,
        );
      }
      const siblingIndex = capture.layers
        .filter(
          ({ parentLayerId }) =>
            parentLayerId === layer.parentLayerId,
        )
        .findIndex(({ layerId }) => layerId === layer.layerId);
      actions.push({
        payload: {
          index:
            layer.parentLayerId === undefined
              ? siblingIndex
              : siblingIndex,
          node: { ...node, childIds: [] },
          parentId: node.parentId,
        },
        type: "node.create",
      });
    }
  }

  if (actions.length === 0) {
    return deepFreeze({
      frameId: ids.frameId,
      layerNodeIds: ids.bySemanticKey,
      manifestHash,
      operation: null,
      reconstruction,
      referenceId: ids.referenceId,
    });
  }
  const operationId = mapLegacyCanvasIdV2(
    "operation",
    `${document.id}:runtime-capture:${capture.captureId}:${document.stateHash}:${manifestHash}`,
  ).canonicalId;
  const operation = prepareCanvasOperationV2(document, {
    action: {
      payload: { actions },
      type: "atomic.batch",
    },
    actor: "system",
    actorId: SYSTEM_ACTOR,
    id: operationId,
    occurredAt: capture.capturedAt,
  });
  return deepFreeze({
    frameId: ids.frameId,
    layerNodeIds: ids.bySemanticKey,
    manifestHash,
    operation,
    reconstruction,
    referenceId: ids.referenceId,
  });
}

export function applyRuntimeCaptureToCanonicalStore(
  store: CanonicalCanvasStore,
  input: {
    readonly expectedDocumentRevision: number;
    readonly manifest: RuntimeCaptureScreenV1;
    readonly placement?: { readonly x: number; readonly y: number };
  },
): RuntimeCaptureCanonicalResult {
  const current = store.getSnapshot().document;
  if (current.revision !== input.expectedDocumentRevision) {
    return deepFreeze({
      code: "stale-document",
      message:
        `Runtime capture expected revision ${input.expectedDocumentRevision} ` +
        `but the document is at revision ${current.revision}.`,
      ok: false,
    });
  }
  try {
    const plan = prepareRuntimeCaptureCanonicalOperation(
      current,
      input.manifest,
      input.placement === undefined
        ? {}
        : { placement: input.placement },
    );
    if (plan.operation === null) {
      return deepFreeze({
        changed: false,
        frameId: plan.frameId,
        layerNodeIds: plan.layerNodeIds,
        manifestHash: plan.manifestHash,
        ok: true,
        reconstruction: plan.reconstruction,
        referenceId: plan.referenceId,
        revision: current.revision,
      });
    }
    const result = store.dispatch(plan.operation, {
      historyLabel: `Import runtime capture ${input.manifest.screenName}`,
    });
    if (!result.ok) {
      return deepFreeze({
        code: "store-rejected",
        message: result.message,
        ok: false,
      });
    }
    return deepFreeze({
      changed: result.changed !== false,
      frameId: plan.frameId,
      layerNodeIds: plan.layerNodeIds,
      manifestHash: plan.manifestHash,
      ok: true,
      reconstruction: plan.reconstruction,
      referenceId: plan.referenceId,
      revision: result.revision,
    });
  } catch (error) {
    return deepFreeze({
      code: "invalid-capture",
      message:
        error instanceof Error
          ? error.message
          : "Runtime capture import failed.",
      ok: false,
    });
  }
}
