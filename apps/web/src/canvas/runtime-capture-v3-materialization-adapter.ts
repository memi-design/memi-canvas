import {
  CanvasAssetIdSchema,
  ArtifactIdSchema,
  CanvasDocumentV3Schema,
  CanvasNodeV3Schema,
  CanvasPageIdSchema,
  EditableReconstructionIdSchema,
  RuntimeEvidenceIdSchema,
  SourceAnchorV2Schema,
  type CanvasDocumentV3,
  type CanvasNodeV3,
  type CanvasOperationV3,
  type CanvasPageId,
  type CanvasSingleActionIntentV3,
  type EditableReconstructionId,
  type RuntimeEvidenceId,
} from "@memi/protocol";
import {
  CanvasDocumentV3PersistenceAdapter,
  mapLegacyCanvasIdV2,
  prepareCanvasOperationV3,
} from "@memi/canvas-document";
import { hashCanonicalValue } from "@memi/canonical-json";

import {
  RuntimeCaptureScreenV1Schema,
  type RuntimeCaptureScreenV1,
} from "./runtime-capture-canonical-types.js";

const SYSTEM_ACTOR = "runtime-capture-v3-materializer";
const MAX_CAPTURE_LAYERS_PER_OPERATION = 995;

export interface RuntimeCaptureMaterializationV3Input {
  readonly evidenceArtifacts: Readonly<{
    fixtureFingerprint: string;
    geometryArtifactId: string;
    hierarchyArtifactId: string;
    reconstructionArtifactId: string | null;
    screenshotArtifactId: string;
    stableFrameHash: string;
    verified: boolean;
  }>;
  readonly expectedDocumentRevision: number;
  readonly manifest: RuntimeCaptureScreenV1;
  readonly pageId: string;
  readonly placement?: Readonly<{ x: number; y: number }>;
  readonly reconstructionFidelity?: Readonly<{
    diffArtifactId: string | null;
    maximumGeometryDelta: number | null;
    ssim: number | null;
    status: "verified" | "needs-review";
  }>;
}

export interface RuntimeCaptureMaterializationPlanV3 {
  readonly assetId: string;
  readonly evidenceId: RuntimeEvidenceId;
  readonly frameId: string;
  readonly layerNodeIds: Readonly<Record<string, string>>;
  readonly manifestHash: string;
  readonly operation: CanvasOperationV3;
  readonly reconstructionId: EditableReconstructionId;
  readonly referenceId: string;
}

export interface RuntimeCaptureMaterializationResultV3 {
  readonly changed: true;
  readonly persistence: CanvasDocumentV3PersistenceAdapter;
  readonly plan: RuntimeCaptureMaterializationPlanV3;
}

function immutable<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);
  Object.values(value as object).forEach((child) => immutable(child, seen));
  return Object.freeze(value);
}

function mappedBody(seed: string): string {
  return mapLegacyCanvasIdV2("node", seed).canonicalId.slice(4);
}

function canonicalId(prefix: "art" | "ast" | "evd" | "rec", seed: string): string {
  return `${prefix}_${mappedBody(seed)}`;
}

function captureMarker(captureId: string): string {
  return `runtime-capture:${captureId}`;
}

function parseAnchor(
  value: string,
  instrumentedSymbol?: string | null,
): Readonly<{ path: string; symbol: string }> {
  const separator = value.lastIndexOf("#");
  if (separator > 0 && separator < value.length - 1) {
    return immutable({
      path: value.slice(0, separator),
      symbol: value.slice(separator + 1),
    });
  }
  if (value.length === 0 || !instrumentedSymbol) {
    throw new Error(
      "Runtime capture source anchors require a relative path and component identity.",
    );
  }
  return immutable({
    path: value,
    symbol: instrumentedSymbol,
  });
}

function defaultLayout(): CanvasNodeV3["layout"] {
  return immutable({
    alignCounter: "start",
    alignPrimary: "start",
    gap: 0,
    mode: "none",
    padding: { bottom: 0, left: 0, right: 0, top: 0 },
    sizingHorizontal: "fixed",
    sizingVertical: "fixed",
    wrap: false,
  });
}

function layerLayout(
  layer: RuntimeCaptureScreenV1["layers"][number],
): CanvasNodeV3["layout"] {
  const layout = layer.layout;
  if (layout === undefined) {
    return defaultLayout();
  }
  return immutable({
    alignCounter: layout.align ?? "start",
    alignPrimary: layout.justify ?? "start",
    gap: layout.gap ?? 0,
    mode:
      layout.flex?.direction === "row"
        ? "horizontal"
        : layout.flex?.direction === "column"
          ? "vertical"
          : "none",
    padding: layout.padding ?? { bottom: 0, left: 0, right: 0, top: 0 },
    sizingHorizontal: "fixed",
    sizingVertical: "fixed",
    wrap: layout.flex?.wrap ?? false,
  });
}

function layerKind(
  kind: RuntimeCaptureScreenV1["layers"][number]["kind"],
): CanvasNodeV3["kind"] {
  return {
    "component-instance": "group",
    frame: "frame",
    group: "group",
    icon: "vector",
    image: "image",
    shape: "rectangle",
    text: "text",
  }[kind] as CanvasNodeV3["kind"];
}

function orderedLayers(capture: RuntimeCaptureScreenV1) {
  const children = new Map<string | null, RuntimeCaptureScreenV1["layers"]>();
  for (const layer of capture.layers) {
    const parentId = layer.parentLayerId ?? null;
    children.set(parentId, [...(children.get(parentId) ?? []), layer]);
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

function identityFor(document: CanvasDocumentV3, capture: RuntimeCaptureScreenV1) {
  const base = `${document.id}:runtime-capture:${capture.captureId}`;
  const byLayerId = Object.fromEntries(
    capture.layers.map((layer) => [
      layer.layerId,
      mapLegacyCanvasIdV2("node", `${base}:layer:${layer.layerId}`).canonicalId,
    ]),
  );
  const bySemanticKey = Object.fromEntries(
    capture.layers.map((layer) => [
      layer.semanticKey,
      requiredId(byLayerId, layer.layerId),
    ]),
  );
  return immutable({
    assetId: CanvasAssetIdSchema.parse(canonicalId("ast", `${base}:asset`)),
    byLayerId,
    bySemanticKey,
    evidenceId: RuntimeEvidenceIdSchema.parse(
      canonicalId("evd", `${base}:evidence`),
    ),
    frameId: mapLegacyCanvasIdV2("node", `${base}:screen`).canonicalId,
    reconstructionId: EditableReconstructionIdSchema.parse(
      canonicalId("rec", `${base}:reconstruction`),
    ),
    referenceId: mapLegacyCanvasIdV2("node", `${base}:reference`).canonicalId,
  });
}

function requiredId(ids: Readonly<Record<string, string>>, key: string): string {
  const id = ids[key];
  if (id === undefined) {
    throw new Error(`Runtime capture identity is missing for ${key}.`);
  }
  return id;
}

function layerNode(
  capture: RuntimeCaptureScreenV1,
  pageId: CanvasPageId,
  frameId: string,
  layer: RuntimeCaptureScreenV1["layers"][number],
  byLayerId: Readonly<Record<string, string>>,
  evidenceId: RuntimeEvidenceId,
): CanvasNodeV3 {
  const parentLayer =
    layer.parentLayerId === undefined
      ? undefined
      : capture.layers.find(({ layerId }) => layerId === layer.parentLayerId);
  const anchor = parseAnchor(
    layer.source.sourceAnchor,
    layer.source.exportName ??
      layer.source.componentId ??
      layer.source.astPath[1],
  );
  const kind = layerKind(layer.kind);
  const solidColor =
    kind === "text"
      ? (layer.style.textColor ?? layer.style.fill)
      : layer.style.fill;
  const fills =
    layer.kind === "image"
      ? [
          {
            artifactId: layer.content.imageRef ?? capture.artifact.artifactId,
            scaleMode: "fill" as const,
            type: "image" as const,
          },
        ]
      : solidColor === undefined
        ? []
        : [{ color: solidColor, type: "solid" as const }];
  return CanvasNodeV3Schema.parse({
    childIds: [],
    componentBinding: null,
    componentId: null,
    content:
      kind === "image"
        ? {
            alt: layer.name,
            artifactId: layer.content.imageRef ?? capture.artifact.artifactId,
            type: "image",
          }
        : null,
    geometry: { height: layer.geometry.height, width: layer.geometry.width },
    id: requiredId(byLayerId, layer.layerId),
    instanceOverrides: {},
    kind,
    layout: layerLayout(layer),
    name: layer.name,
    pageId,
    parentId:
      layer.parentLayerId === undefined
        ? frameId
        : requiredId(byLayerId, layer.parentLayerId),
    provenance: null,
    referenceBinding: null,
    sourceAnchor: SourceAnchorV2Schema.parse({
      astPath: layer.source.astPath,
      componentIdentity:
        layer.source.componentId ?? layer.source.exportName ?? null,
      contentHash: layer.source.sourceContentHash,
      dirtyFingerprint: capture.repository.dirtyFileFingerprint,
      path: anchor.path,
      range: layer.source.range,
      runtimeEvidenceRefs: [evidenceId, captureMarker(capture.captureId)],
      sourceRevision: capture.repository.revision,
      symbol: anchor.symbol,
    }),
    sourceBinding: null,
    style: {
      cornerRadii: Array(4).fill(layer.geometry.cornerRadius ?? 0),
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
            ...(layer.style.fontSize === undefined || layer.style.fontSize <= 0
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
            ...(layer.style.textAlign === undefined
              ? {}
              : { textAlign: layer.style.textAlign }),
          }
        : null,
    transform: {
      rotation: layer.geometry.rotation,
      scaleX: 1,
      scaleY: 1,
      x: layer.geometry.x - (parentLayer?.geometry.x ?? 0),
      y: layer.geometry.y - (parentLayer?.geometry.y ?? 0),
    },
  });
}

function frameNode(
  capture: RuntimeCaptureScreenV1,
  pageId: CanvasPageId,
  frameId: string,
  manifestHash: string,
  placement: Readonly<{ x: number; y: number }>,
): CanvasNodeV3 {
  return CanvasNodeV3Schema.parse({
    childIds: [],
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
    pageId,
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
    transform: { rotation: 0, scaleX: 1, scaleY: 1, ...placement },
  });
}

function referenceNode(
  capture: RuntimeCaptureScreenV1,
  pageId: CanvasPageId,
  referenceId: string,
  screenshotArtifactId: string,
): CanvasNodeV3 {
  const sourceAnchors = [
    ...new Set([
      capture.binding.sourceAnchor,
      ...(capture.evidence.sourceAnchors ?? []),
      ...capture.layers.map(({ source }) => source.sourceAnchor),
    ]),
  ];
  const componentIds = [
    ...new Set([
      ...(capture.evidence.componentIds ?? []),
      ...capture.layers.flatMap(({ source }) =>
        source.componentId === null || source.componentId === undefined
          ? []
          : [source.componentId],
      ),
    ]),
  ];
  return CanvasNodeV3Schema.parse({
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
    pageId,
    parentId: null,
    provenance: null,
    referenceBinding: {
      ...(capture.evidence.accessibilitySnapshotRef === undefined
        ? {}
        : { accessibilitySnapshotRef: capture.evidence.accessibilitySnapshotRef }),
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
      fills: [{ artifactId: screenshotArtifactId, scaleMode: "fill", type: "image" }],
      locked: true,
      opacity: 1,
      strokes: [],
      visible: false,
    },
    text: null,
    transform: { rotation: 0, scaleX: 1, scaleY: 1, x: 0, y: 0 },
  });
}

function assertAvailable(
  document: CanvasDocumentV3,
  ids: ReturnType<typeof identityFor>,
): void {
  const collisions = [
    ids.frameId,
    ids.referenceId,
    ...Object.values(ids.byLayerId),
  ].filter((id) => document.nodesById[id] !== undefined);
  if (
    collisions.length > 0 ||
    document.assetsById[ids.assetId] !== undefined ||
    document.evidenceById[ids.evidenceId] !== undefined ||
    document.reconstructionsById[ids.reconstructionId] !== undefined
  ) {
    throw new Error(
      `Runtime capture materialization identity already exists or collides: ${[
        ...collisions,
        ids.assetId,
        ids.evidenceId,
        ids.reconstructionId,
      ].join(", ")}.`,
    );
  }
}

export function prepareRuntimeCaptureMaterializationV3(
  untrustedDocument: CanvasDocumentV3,
  input: RuntimeCaptureMaterializationV3Input,
): RuntimeCaptureMaterializationPlanV3 {
  const document = CanvasDocumentV3Schema.parse(untrustedDocument);
  const capture = RuntimeCaptureScreenV1Schema.parse(input.manifest);
  const pageId = CanvasPageIdSchema.parse(input.pageId);
  if (document.revision !== input.expectedDocumentRevision) {
    throw new Error(
      `Runtime capture expected revision ${input.expectedDocumentRevision} but the document is at revision ${document.revision}.`,
    );
  }
  if (document.pagesById[pageId]?.kind !== "imported") {
    throw new Error("Runtime captures can only materialize on an imported page.");
  }
  if (capture.layers.length > MAX_CAPTURE_LAYERS_PER_OPERATION) {
    throw new Error(
      `Runtime capture exceeds the ${MAX_CAPTURE_LAYERS_PER_OPERATION}-layer atomic operation limit.`,
    );
  }
  const manifestHash = hashCanonicalValue(capture);
  const ids = identityFor(document, capture);
  assertAvailable(document, ids);
  const evidenceArtifacts = immutable({
    fixtureFingerprint: input.evidenceArtifacts.fixtureFingerprint,
    geometryArtifactId: ArtifactIdSchema.parse(
      input.evidenceArtifacts.geometryArtifactId,
    ),
    hierarchyArtifactId: ArtifactIdSchema.parse(
      input.evidenceArtifacts.hierarchyArtifactId,
    ),
    reconstructionArtifactId: ArtifactIdSchema.nullable().parse(
      input.evidenceArtifacts.reconstructionArtifactId,
    ),
    screenshotArtifactId: ArtifactIdSchema.parse(
      input.evidenceArtifacts.screenshotArtifactId,
    ),
    stableFrameHash: input.evidenceArtifacts.stableFrameHash,
    verified: input.evidenceArtifacts.verified,
  });
  const reconstructionFidelity =
    input.reconstructionFidelity === undefined
      ? immutable({
          diffArtifactId: null,
          maximumGeometryDelta:
            capture.reconstructionFidelity?.geometryWithinOnePoint === true
              ? 1
              : null,
          ssim:
            capture.reconstructionFidelity?.screenshotHiddenSsim ?? null,
          status: "needs-review" as const,
        })
      : immutable({
          diffArtifactId: ArtifactIdSchema.nullable().parse(
            input.reconstructionFidelity.diffArtifactId,
          ),
          maximumGeometryDelta:
            input.reconstructionFidelity.maximumGeometryDelta,
          ssim: input.reconstructionFidelity.ssim,
          status: input.reconstructionFidelity.status,
        });
  const scale =
    capture.binding.viewport.scale ??
    capture.artifact.width / capture.binding.viewport.width;
  const frame = frameNode(
    capture,
    pageId,
    ids.frameId,
    manifestHash,
    input.placement ?? { x: 0, y: 0 },
  );
  const reference = referenceNode(
    capture,
    pageId,
    ids.referenceId,
    evidenceArtifacts.screenshotArtifactId,
  );
  const layers = orderedLayers(capture).map((layer) => ({
    layer,
    node: layerNode(
      capture,
      pageId,
      ids.frameId,
      layer,
      ids.byLayerId,
      ids.evidenceId,
    ),
  }));
  const confidenceByNodeId = Object.fromEntries(
    [frame, ...layers.map(({ node }) => node)].map((node) => [
      node.id,
      {
        basis:
          node.id === frame.id
            ? ["runtime-geometry" as const, "runtime-hierarchy" as const]
            : ["runtime-geometry" as const, "source-anchor" as const],
        score: 1,
      },
    ]),
  );
  const actions: readonly CanvasSingleActionIntentV3[] = [
    {
      type: "asset.define",
      payload: {
        assetId: ids.assetId,
        next: {
          artifactId: evidenceArtifacts.screenshotArtifactId,
          contentHash: capture.artifact.hash,
          height: capture.artifact.height,
          id: ids.assetId,
          kind: "image",
          mimeType: capture.artifact.kind,
          name: capture.artifact.alt || capture.screenName,
          width: capture.artifact.width,
        },
      },
    },
    {
      type: "evidence.define",
      payload: {
        evidenceId: ids.evidenceId,
        next: {
          applicationId: capture.app.productId,
          capturedAt: capture.capturedAt,
          fixtureFingerprint: evidenceArtifacts.fixtureFingerprint,
          geometryArtifactId: evidenceArtifacts.geometryArtifactId,
          hierarchyArtifactId: evidenceArtifacts.hierarchyArtifactId,
          id: ids.evidenceId,
          reconstructionArtifactId: evidenceArtifacts.reconstructionArtifactId,
          route: capture.binding.normalizedPath,
          scenarioId: capture.captureId,
          schemaVersion: 1,
          screenshotArtifactId: evidenceArtifacts.screenshotArtifactId,
          sourceRevision: capture.repository.revision,
          state: capture.binding.stateId,
          verification: {
            rejectionReasons: [],
            stableFrameHashes: [
              evidenceArtifacts.stableFrameHash,
              evidenceArtifacts.stableFrameHash,
            ],
            status: evidenceArtifacts.verified ? "verified" : "captured",
          },
          viewport: {
            logicalHeight: capture.binding.viewport.height,
            logicalWidth: capture.binding.viewport.width,
            name: capture.binding.viewport.name,
            pixelHeight: capture.artifact.height,
            pixelWidth: capture.artifact.width,
            scale,
          },
        },
      },
    },
    {
      type: "node.create",
      payload: {
        index: document.pagesById[pageId].rootIds.length,
        node: frame,
        parentId: null,
      },
    },
    {
      type: "node.create",
      payload: {
        index: document.pagesById[pageId].rootIds.length + 1,
        node: reference,
        parentId: null,
      },
    },
    ...layers.map(({ layer, node }) => ({
      type: "node.create" as const,
      payload: {
        index: capture.layers
          .filter(({ parentLayerId }) => parentLayerId === layer.parentLayerId)
          .findIndex(({ layerId }) => layerId === layer.layerId),
        node,
        parentId: node.parentId,
      },
    })),
    {
      type: "reconstruction.define",
      payload: {
        reconstructionId: ids.reconstructionId,
        next: {
          confidenceByNodeId,
          editableRootIds: [frame.id],
          evidenceId: ids.evidenceId,
          fidelity: reconstructionFidelity,
          id: ids.reconstructionId,
          pageId,
          schemaVersion: 1,
        },
      },
    },
  ];
  const operation = prepareCanvasOperationV3(document, {
    action: { payload: { actions }, type: "atomic.batch" },
    actor: "system",
    actorId: SYSTEM_ACTOR,
    id: mapLegacyCanvasIdV2(
      "operation",
      `${document.id}:runtime-capture-v3:${capture.captureId}:${document.stateHash}:${manifestHash}`,
    ).canonicalId,
    label: `Import runtime capture ${capture.screenName}`,
    occurredAt: capture.capturedAt,
  });
  return immutable({
    assetId: ids.assetId,
    evidenceId: ids.evidenceId,
    frameId: ids.frameId,
    layerNodeIds: ids.bySemanticKey,
    manifestHash,
    operation,
    reconstructionId: ids.reconstructionId,
    referenceId: ids.referenceId,
  });
}

export async function materializeRuntimeCaptureV3(
  persistence: CanvasDocumentV3PersistenceAdapter,
  input: RuntimeCaptureMaterializationV3Input,
): Promise<RuntimeCaptureMaterializationResultV3> {
  const plan = prepareRuntimeCaptureMaterializationV3(
    persistence.document,
    input,
  );
  const nextPersistence = await persistence.commit(plan.operation);
  return immutable({ changed: true as const, persistence: nextPersistence, plan });
}
