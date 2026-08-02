import {
  ImportJobSnapshotSchemaV2,
  ProjectIdSchema,
  RuntimeCaptureScreenV1Schema,
  type CaptureArtifactV2,
  type CaptureScenarioV2,
  type ImportJobSnapshotV2,
  type RuntimeCaptureLayerV1,
  type RuntimeCaptureScreenV1,
} from "@memi/protocol";

import type {
  CanvasWorkbenchProject,
  ReferenceBinding,
  WorkbenchNode,
} from "../../canvas/model.js";
import {
  provenanceFromSource,
  type SourceBinding,
} from "../../canvas/model.js";
import { createRepositoryCanvasProject } from "./repository-workbench.js";
import { assertSafeReferenceSourceUrl } from "../../canvas/reference-security.js";
import type { RepositoryImportManifest } from "./repository-import.js";
import { isSafeCaptureArtifactUrl } from "./repository-artifact-url.js";
import { repositoryCaptureProjectId } from "./repository-capture-runtime.js";
import type { RepositoryReconstructionReview } from "./repository-reconstruction-review.js";

const SAFE_LOCAL_PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;
const SCREEN_GAP = 96;

function isSafeProjectId(value: string): boolean {
  return (
    SAFE_LOCAL_PROJECT_ID.test(value) ||
    ProjectIdSchema.safeParse(value).success
  );
}

export type CaptureArtifactReference = Pick<
  ReferenceBinding,
  "alt" | "capturedAt" | "sourceUrl" | "src"
> &
  Readonly<{
    reconstruction?: RuntimeCaptureScreenV1 | undefined;
    reconstructionReview?: RepositoryReconstructionReview | undefined;
  }>;

export interface CapturedRepositoryProjectInput {
  readonly artifactReference: (
    artifact: CaptureArtifactV2,
  ) => CaptureArtifactReference;
  readonly harnessId: string;
  readonly job: ImportJobSnapshotV2;
  readonly manifest: RepositoryImportManifest;
  readonly projectId: string;
}

type RepositoryConfidenceBasis =
  RepositoryReconstructionReview["confidenceBySemanticKey"][string]["basis"][number];

export interface RepositoryEditableReconstruction {
  readonly confidence: number;
  readonly confidenceByNodeId: Readonly<
    Record<
      string,
      Readonly<{
        basis: readonly RepositoryConfidenceBasis[];
        score: number;
      }>
    >
  >;
  readonly differenceOverlayNodeId: string | null;
  readonly differenceOverlayVisible: boolean;
  readonly evidenceArtifactId: string;
  readonly evidenceNodeId: string;
  readonly fidelity: Readonly<{
    diffArtifactId: string | null;
    evaluatedAt: string | null;
    maximumGeometryDelta: number | null;
    ssim: number | null;
  }> | null;
  readonly frameId: string;
  readonly reviewStatus: "needs-review" | "verified";
  readonly scenarioId: string;
}

export interface RepositoryCaptureFailureCard {
  readonly code: string;
  readonly id: string;
  readonly message: string;
  readonly remediation: string;
  readonly retryable: boolean;
  readonly route: string;
  readonly sourcePath: string | null;
  readonly state: string;
}

export interface StreamingRepositoryCanvasProject extends CanvasWorkbenchProject {
  readonly failureCards: readonly RepositoryCaptureFailureCard[];
  readonly importState: {
    readonly sequence: number;
    readonly state: "importing" | "ready" | "needs-attention" | "cancelled";
  };
  readonly reconstructions: readonly RepositoryEditableReconstruction[];
}

function columns(manifest: RepositoryImportManifest): number {
  return manifest.platform === "react-web" ? 2 : 5;
}

function screenName(
  manifest: RepositoryImportManifest,
  scenario: CaptureScenarioV2,
): string {
  const match = manifest.screens.find(
    ({ route, sourcePath }) =>
      route === scenario.route ||
      sourcePath === scenario.sourceAnchor?.relativePath,
  );
  if (match !== undefined) {
    return scenario.state === "default"
      ? match.name
      : `${match.name} · ${scenario.state}`;
  }
  return scenario.state === "default"
    ? scenario.route
    : `${scenario.route} · ${scenario.state}`;
}

function sourceBinding(
  manifest: RepositoryImportManifest,
  scenario: CaptureScenarioV2,
  index: number,
  captured: boolean,
): SourceBinding {
  return {
    ...(captured ? { captureState: "captured" as const } : {}),
    coverageCellId: `repository-capture-${index + 1}`,
    repositoryDirty: manifest.dirty,
    repositoryRevision: manifest.revision,
    routeId: scenario.route,
    sourceAnchor:
      scenario.sourceAnchor?.relativePath ?? `capture-scenarios/${scenario.id}`,
    ...(scenario.sourceAnchor === null
      ? {}
      : { sourceContentHash: scenario.sourceAnchor.contentHash }),
    stateId: scenario.state,
    viewport: {
      height: scenario.viewport.height,
      name: manifest.platform === "react-web" ? "desktop" : "mobile",
      width: scenario.viewport.width,
    },
  };
}

function position(
  scenario: CaptureScenarioV2,
  index: number,
  screenColumns: number,
) {
  return {
    x: (index % screenColumns) * (scenario.viewport.width + SCREEN_GAP),
    y:
      Math.floor(index / screenColumns) *
      (scenario.viewport.height + SCREEN_GAP),
  };
}

function assertReconstructionAuthority(
  input: CapturedRepositoryProjectInput,
  scenario: CaptureScenarioV2,
  artifact: CaptureArtifactV2,
  rawCapture: RuntimeCaptureScreenV1,
): RuntimeCaptureScreenV1 {
  const capture = RuntimeCaptureScreenV1Schema.parse(rawCapture);
  if (
    capture.captureId !== artifact.id ||
    capture.artifact.artifactId !== artifact.screenshotArtifactId ||
    capture.artifact.hash !== artifact.screenshotHash ||
    capture.artifact.width !== artifact.dimensions.width ||
    capture.artifact.height !== artifact.dimensions.height
  ) {
    throw new Error(
      "Editable reconstruction does not match its runtime screenshot evidence.",
    );
  }
  if (
    capture.repository.rootPath !== input.manifest.rootPath ||
    capture.repository.revision !== input.manifest.revision ||
    capture.repository.revision !== artifact.sourceRevision ||
    capture.binding.routeId !== scenario.route ||
    capture.binding.stateId !== scenario.state
  ) {
    throw new Error(
      "Editable reconstruction does not match the repository scenario authority.",
    );
  }
  return capture;
}

function layerLayout(
  layer: RuntimeCaptureLayerV1,
): WorkbenchNode["layout"] {
  if (layer.layout === undefined) return undefined;
  const direction = layer.layout.flex?.direction;
  return {
    alignCounter: layer.layout.align ?? "start",
    alignPrimary: layer.layout.justify ?? "start",
    gap: layer.layout.gap ?? 0,
    mode:
      direction === "row"
        ? "horizontal"
        : direction === "column"
          ? "vertical"
          : "none",
    padding: layer.layout.padding ?? {
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    },
    sizingHorizontal: "fixed",
    sizingVertical: "fixed",
    wrap: layer.layout.flex?.wrap ?? false,
  };
}

function layerKind(layer: RuntimeCaptureLayerV1): WorkbenchNode["kind"] {
  switch (layer.kind) {
    case "frame":
      return "Frame";
    case "group":
      return "Group";
    case "text":
      return "Text";
    case "image":
      return layer.content.imageRef === undefined ? "Rectangle" : "Image";
    case "component-instance":
      return "Group";
    case "icon":
      return "Vector";
    case "shape":
      return "Rectangle";
  }
}

function artifactSource(
  screenshotSource: string,
  artifactId: NonNullable<RuntimeCaptureLayerV1["content"]["imageRef"]>,
): string {
  return screenshotSource.startsWith("memi-artifact://localhost/")
    ? `memi-artifact://localhost/${artifactId}`
    : `/imports/artifacts/${artifactId}.png`;
}

function semanticLayerNodes(
  input: CapturedRepositoryProjectInput,
  scenario: CaptureScenarioV2,
  artifact: CaptureArtifactV2,
  frame: WorkbenchNode,
  resolved: CaptureArtifactReference,
): readonly WorkbenchNode[] {
  if (resolved.reconstruction === undefined) return [];
  const capture = assertReconstructionAuthority(
    input,
    scenario,
    artifact,
    resolved.reconstruction,
  );
  const nodeIdByLayerId = new Map(
    capture.layers.map((layer, index) => [
      layer.layerId,
      `repository-semantic-${scenario.id}-${index}`,
    ]),
  );
  const layersById = new Map(
    capture.layers.map((layer) => [layer.layerId, layer]),
  );
  const positionByLayerId = new Map<string, { x: number; y: number }>();
  const resolving = new Set<string>();
  const absolutePosition = (
    layer: RuntimeCaptureLayerV1,
  ): { x: number; y: number } => {
    const existing = positionByLayerId.get(layer.layerId);
    if (existing !== undefined) return existing;
    if (resolving.has(layer.layerId)) {
      throw new Error("Semantic reconstruction contains a layer cycle.");
    }
    resolving.add(layer.layerId);
    const parent =
      layer.parentLayerId === undefined
        ? undefined
        : layersById.get(layer.parentLayerId);
    const parentPosition =
      parent === undefined ? frame.position : absolutePosition(parent);
    const next = {
      x: parentPosition.x + layer.geometry.x,
      y: parentPosition.y + layer.geometry.y,
    };
    resolving.delete(layer.layerId);
    positionByLayerId.set(layer.layerId, next);
    return next;
  };

  return Object.freeze(
    capture.layers.map((layer) => {
      const sourcePath = layer.source.sourceAnchor.split("#")[0];
      const sourceAnchor =
        sourcePath === undefined || sourcePath.length === 0
          ? scenario.sourceAnchor?.relativePath ??
            `capture-scenarios/${scenario.id}`
          : sourcePath;
      const fill =
        layer.kind === "text"
          ? layer.style.textColor ?? layer.style.fill
          : layer.style.fill;
      const layout = layerLayout(layer);
      const imageRef = layer.content.imageRef;
      const source: SourceBinding = {
        captureState: "captured",
        coverageCellId: layer.semanticKey,
        repositoryDirty: capture.repository.dirty,
        repositoryRevision: capture.repository.revision,
        routeId: layer.source.routeId ?? scenario.route,
        sourceAnchor,
        sourceContentHash: layer.source.sourceContentHash,
        stateId: layer.source.stateId ?? scenario.state,
        viewport: {
          height: scenario.viewport.height,
          name:
            input.manifest.platform === "react-web" ? "desktop" : "mobile",
          width: scenario.viewport.width,
        },
      };
      return Object.freeze({
        ...(layer.geometry.cornerRadius === undefined
          ? {}
          : {
              cornerRadii: [
                layer.geometry.cornerRadius,
                layer.geometry.cornerRadius,
                layer.geometry.cornerRadius,
                layer.geometry.cornerRadius,
              ] as const,
            }),
        ...(fill === undefined ? {} : { fill }),
        hidden: false,
        id: nodeIdByLayerId.get(layer.layerId)!,
        ...(imageRef === undefined
          ? {}
          : {
              image: {
                alt: layer.name,
                byteLength: 0,
                height: layer.geometry.height,
                mimeType: "image/png" as const,
                src: artifactSource(resolved.src, imageRef),
                width: layer.geometry.width,
              },
            }),
        kind: layerKind(layer),
        ...(layout === undefined ? {} : { layout }),
        locked: false,
        name: layer.name,
        opacity: layer.style.opacity ?? 1,
        parentId:
          layer.parentLayerId === undefined
            ? frame.id
            : nodeIdByLayerId.get(layer.parentLayerId)!,
        position: absolutePosition(layer),
        rotation: layer.geometry.rotation,
        semanticBaseline: JSON.stringify({
          content: layer.content,
          geometry: layer.geometry,
          style: layer.style,
        }),
        size: {
          height: layer.geometry.height,
          width: layer.geometry.width,
        },
        source,
        ...(layer.style.stroke === undefined
          ? {}
          : { stroke: layer.style.stroke }),
        ...(layer.content.text === undefined
          ? {}
          : { text: layer.content.text }),
      } satisfies WorkbenchNode);
    }),
  );
}

function reconstructionNodes(
  input: CapturedRepositoryProjectInput,
  scenario: CaptureScenarioV2,
  artifact: CaptureArtifactV2,
  index: number,
): {
  readonly difference: WorkbenchNode | null;
  readonly evidence: WorkbenchNode;
  readonly frame: WorkbenchNode;
  readonly layers: readonly WorkbenchNode[];
  readonly reconstruction: RepositoryEditableReconstruction;
} {
  const resolved = input.artifactReference(artifact);
  if (!isSafeCaptureArtifactUrl(resolved.src, artifact.screenshotArtifactId)) {
    throw new Error(
      "Runtime screenshots must resolve through an authenticated artifact identity.",
    );
  }
  assertSafeReferenceSourceUrl(resolved.sourceUrl);
  const source = sourceBinding(input.manifest, scenario, index, true);
  const frameId = `repository-reconstruction-${scenario.id}`;
  const evidenceNodeId = `repository-evidence-${scenario.id}`;
  const differenceOverlayNodeId =
    resolved.reconstructionReview?.fidelity.diffArtifactId === null ||
    resolved.reconstructionReview === undefined
      ? null
      : `repository-difference-${scenario.id}`;
  const frame: WorkbenchNode = {
    fill: "var(--studio-surface-canvas)",
    hidden: false,
    id: frameId,
    kind: "Frame",
    locked: false,
    name: screenName(input.manifest, scenario),
    parentId: null,
    position: position(scenario, index, columns(input.manifest)),
    provenance: provenanceFromSource(source),
    size: {
      height: scenario.viewport.height,
      width: scenario.viewport.width,
    },
    stroke: "var(--studio-border-strong)",
  };
  const evidence = Object.freeze({
    hidden: true,
    id: evidenceNodeId,
    kind: "ReferenceFrame",
    locked: true,
    name: `${screenName(input.manifest, scenario)} evidence`,
    parentId: null,
    position: Object.freeze({ ...frame.position }),
    reference: Object.freeze({
      alt: resolved.alt,
      capturedAt: resolved.capturedAt,
      sourceUrl: resolved.sourceUrl,
      src: resolved.src,
      ...(artifact.hierarchyArtifactId === null
        ? {}
        : {
            accessibilitySnapshotRef: artifact.hierarchyArtifactId,
          }),
      appVersion: input.manifest.revision,
      authority: "local-runtime-capture",
      captureId: artifact.id,
      contentHash: artifact.screenshotHash,
      sourceRevision: artifact.sourceRevision,
    }),
    size: Object.freeze({ ...frame.size }),
  } satisfies WorkbenchNode);
  const layers = semanticLayerNodes(
    input,
    scenario,
    artifact,
    frame,
    resolved,
  );
  const fallbackConfidence =
    resolved.reconstruction !== undefined
      ? 1
      : artifact.geometryArtifactId !== null &&
          artifact.hierarchyArtifactId !== null
        ? 0.75
        : 0.35;
  const confidenceByNodeId = Object.freeze(
    Object.fromEntries(
      resolved.reconstruction?.layers.map((layer, layerIndex) => {
        const reviewed =
          resolved.reconstructionReview?.confidenceBySemanticKey[
            layer.semanticKey
          ];
        const confidence = reviewed ?? {
          basis: ["inferred" as const],
          score:
            artifact.geometryArtifactId !== null &&
            artifact.hierarchyArtifactId !== null
              ? 0.75
              : 0.5,
        };
        return [
          `repository-semantic-${scenario.id}-${layerIndex}`,
          Object.freeze({
            basis: Object.freeze([...confidence.basis]),
            score: confidence.score,
          }),
        ];
      }) ?? [],
    ),
  );
  const reviewedAllLayers =
    resolved.reconstruction !== undefined &&
    resolved.reconstruction.layers.length > 0 &&
    resolved.reconstruction.layers.every(
      ({ semanticKey }) =>
        resolved.reconstructionReview?.confidenceBySemanticKey[semanticKey] !==
        undefined,
    );
  const reviewStatus =
    resolved.reconstructionReview?.fidelity.status === "verified" &&
    reviewedAllLayers
      ? "verified"
      : "needs-review";
  const reviewedScores = Object.values(confidenceByNodeId).map(
    ({ score }) => score,
  );
  const confidence =
    resolved.reconstructionReview === undefined || reviewedScores.length === 0
      ? fallbackConfidence
      : Math.min(...reviewedScores);
  const difference =
    differenceOverlayNodeId === null ||
    resolved.reconstructionReview?.fidelity.diffArtifactId === null ||
    resolved.reconstructionReview === undefined
      ? null
      : Object.freeze({
          hidden: true,
          id: differenceOverlayNodeId,
          kind: "ReferenceFrame" as const,
          locked: true,
          name: `${screenName(input.manifest, scenario)} difference`,
          parentId: null,
          position: { ...frame.position },
          reference: {
            alt: `${screenName(input.manifest, scenario)} difference overlay`,
            appVersion: input.manifest.revision,
            authority: "local-runtime-difference",
            capturedAt: resolved.capturedAt,
            captureId:
              resolved.reconstructionReview.fidelity.diffArtifactId,
            sourceRevision: artifact.sourceRevision,
            sourceUrl: resolved.sourceUrl,
            src: artifactSource(
              resolved.src,
              resolved.reconstructionReview.fidelity.diffArtifactId,
            ),
          },
          size: { ...frame.size },
        } satisfies WorkbenchNode);
  return Object.freeze({
    difference,
    evidence,
    frame,
    layers,
    reconstruction: Object.freeze({
      confidence,
      confidenceByNodeId,
      differenceOverlayNodeId,
      differenceOverlayVisible: false,
      evidenceArtifactId: artifact.screenshotArtifactId,
      evidenceNodeId,
      fidelity:
        resolved.reconstructionReview === undefined
          ? null
          : Object.freeze({
              diffArtifactId:
                resolved.reconstructionReview.fidelity.diffArtifactId,
              evaluatedAt:
                resolved.reconstructionReview.fidelity.evaluatedAt,
              maximumGeometryDelta:
                resolved.reconstructionReview.fidelity.maximumGeometryDelta,
              ssim: resolved.reconstructionReview.fidelity.ssim,
            }),
      frameId,
      reviewStatus,
      scenarioId: scenario.id,
    }),
  });
}

function failureCard(
  input: CapturedRepositoryProjectInput,
  scenario: CaptureScenarioV2,
): RepositoryCaptureFailureCard | null {
  const failure = input.job.failures.find(
    ({ scenarioId }) => scenarioId === scenario.id,
  );
  if (failure === undefined) return null;
  return Object.freeze({
    code: failure.code,
    id: `repository-failure-${scenario.id}`,
    message: failure.message.split("\n")[0] ?? failure.message,
    remediation: failure.remediation,
    retryable: failure.retryable,
    route: scenario.route,
    sourcePath: scenario.sourceAnchor?.relativePath ?? null,
    state: scenario.state,
  });
}

function assertTerminal(input: CapturedRepositoryProjectInput): void {
  if (
    input.job.state !== "committed" ||
    input.job.projectId === null ||
    input.job.progress.remaining !== 0
  ) {
    throw new Error(
      "Repository projects remain hidden until every scenario is terminal and the import is durably committed.",
    );
  }
  if (
    input.job.repository.rootPath !== input.manifest.rootPath ||
    input.job.repository.sourceRevision !== input.manifest.revision
  ) {
    throw new Error(
      "Capture evidence does not match the imported repository authority.",
    );
  }
  if (!isSafeProjectId(input.projectId)) {
    throw new Error("The imported project identity is invalid.");
  }
  if (input.projectId !== repositoryCaptureProjectId(input.job)) {
    throw new Error(
      "The imported project identity does not match the durable import job.",
    );
  }
}

function assertProjectAuthority(input: CapturedRepositoryProjectInput): void {
  if (
    input.job.repository.rootPath !== input.manifest.rootPath ||
    input.job.repository.sourceRevision !== input.manifest.revision
  ) {
    throw new Error(
      "Capture evidence does not match the imported repository authority.",
    );
  }
  if (!isSafeProjectId(input.projectId)) {
    throw new Error("The imported project identity is invalid.");
  }
  if (input.projectId !== repositoryCaptureProjectId(input.job)) {
    throw new Error(
      "The imported project identity does not match the durable import job.",
    );
  }
}

function streamedImportState(
  job: ImportJobSnapshotV2,
): StreamingRepositoryCanvasProject["importState"]["state"] {
  if (job.state === "cancelled") return "cancelled";
  if (
    job.state === "failed" ||
    (job.failures.length > 0 &&
      (job.state === "committed" || job.progress.remaining === 0))
  ) {
    return "needs-attention";
  }
  return job.state === "committed" ? "ready" : "importing";
}

export function createStreamingRepositoryCanvasProject(
  rawInput: CapturedRepositoryProjectInput,
): StreamingRepositoryCanvasProject {
  const input = {
    ...rawInput,
    job: ImportJobSnapshotSchemaV2.parse(rawInput.job),
  };
  assertProjectAuthority(input);
  const artifactsByScenario = new Map(
    input.job.artifacts.map((artifact) => [artifact.scenarioId, artifact]),
  );
  const captured = input.job.scenarios.flatMap((scenario, index) => {
    const artifact = artifactsByScenario.get(scenario.id);
    return artifact === undefined
      ? []
      : [reconstructionNodes(input, scenario, artifact, index)];
  });
  const failureCards = input.job.scenarios.flatMap((scenario) => {
    const card = failureCard(input, scenario);
    return card === null ? [] : [card];
  });
  const legacyProjection = createRepositoryCanvasProject(
    input.manifest,
    input.projectId,
    input.harnessId,
  );
  const supportingNodes = legacyProjection.document.nodes.filter(
    ({ kind }) => kind !== "RoutePlaceholder",
  );
  const nodes = [
    ...captured.map(({ frame }) => frame),
    ...captured.flatMap(({ layers }) => layers),
    ...supportingNodes,
    ...captured.flatMap(({ difference }) =>
      difference === null ? [] : [difference],
    ),
    ...captured.map(({ evidence }) => evidence),
  ];
  return Object.freeze({
    ...legacyProjection,
    failureCards: Object.freeze(failureCards),
    importState: Object.freeze({
      sequence: input.job.revision,
      state: streamedImportState(input.job),
    }),
    reconstructions: Object.freeze(
      captured.map(({ reconstruction }) => reconstruction),
    ),
    selectedNodeId: captured[0]?.frame.id ?? nodes[0]?.id ?? null,
    document: {
      ...legacyProjection.document,
      nodes,
    },
    trace: [
      {
        action:
          `Runtime import · ${input.job.progress.captured} captured · ` +
          `${input.job.progress.failed} failed`,
        harnessId: input.harnessId,
        id: `trace-runtime-import-${input.projectId}-${input.job.revision}`,
        targetNodeId: captured[0]?.frame.id ?? nodes[0]?.id ?? input.projectId,
      },
    ],
  });
}

export function setRepositoryDifferenceOverlayVisibility(
  project: StreamingRepositoryCanvasProject,
  scenarioId: string,
  visible: boolean,
): StreamingRepositoryCanvasProject {
  const reconstruction = project.reconstructions.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  if (
    reconstruction === undefined ||
    reconstruction.differenceOverlayNodeId === null ||
    reconstruction.fidelity?.diffArtifactId === null ||
    reconstruction.fidelity === null
  ) {
    throw new Error(
      "The reconstruction has no reviewed difference artifact to display.",
    );
  }
  const evidence = project.document.nodes.find(
    ({ id }) => id === reconstruction.evidenceNodeId,
  );
  if (evidence?.hidden !== true || evidence.locked !== true) {
    throw new Error("Runtime screenshot evidence must remain hidden and locked.");
  }
  const differenceExists = project.document.nodes.some(
    ({ id }) => id === reconstruction.differenceOverlayNodeId,
  );
  if (!differenceExists) {
    throw new Error("The reviewed difference artifact node is missing.");
  }
  const nodes = Object.freeze(
    project.document.nodes.map((node) =>
      node.id === reconstruction.differenceOverlayNodeId
        ? Object.freeze({ ...node, hidden: !visible })
        : node,
    ),
  );
  const reconstructions = Object.freeze(
    project.reconstructions.map((candidate) =>
      candidate.scenarioId === scenarioId
        ? Object.freeze({
            ...candidate,
            differenceOverlayVisible: visible,
          })
        : candidate,
    ),
  );
  return Object.freeze({
    ...project,
    document: Object.freeze({
      ...project.document,
      nodes,
    }),
    reconstructions,
  });
}

export function createCapturedRepositoryCanvasProject(
  rawInput: CapturedRepositoryProjectInput,
): StreamingRepositoryCanvasProject {
  assertTerminal(rawInput);
  return createStreamingRepositoryCanvasProject(rawInput);
}
