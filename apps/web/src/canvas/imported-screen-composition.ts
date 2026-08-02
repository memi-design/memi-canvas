import {
  provenanceFromSource,
  type ReferenceBinding,
  type WorkbenchNode,
} from "./model.js";

export interface ImportedMobileCapture {
  readonly accessibilitySnapshotRef: string;
  readonly alt: string;
  readonly appVersion: string;
  readonly assetPath: string;
  readonly authority: string;
  readonly capturedAt: string;
  readonly componentIds: readonly string[];
  readonly gitSha: string;
  readonly height: number;
  readonly id: string;
  readonly routeId: string;
  readonly screenId: string;
  readonly screenshotSha256: string;
  readonly sourceAnchors: readonly string[];
  readonly sourceUrl: string;
  readonly width: number;
  readonly reconstructionFidelity?: {
    readonly geometryWithinOnePoint: boolean;
    readonly screenshotHiddenSsim: number;
    readonly verifiedAt: string;
  };
}

export interface ImportedMobileScreenInput {
  readonly capture: ImportedMobileCapture;
  readonly frame: WorkbenchNode;
  readonly semanticNodes: readonly WorkbenchNode[];
}

export interface ImportedScreenReconstructionMetadata {
  readonly evidenceNodeId: string;
  readonly layers: Readonly<Record<string, {
    readonly confidence: number;
    readonly evidenceRefs: readonly string[];
  }>>;
  readonly reviewStatus: "needs-review" | "verified";
  readonly screenId: string;
}

export interface ImportedScreenComposition {
  readonly nodes: readonly WorkbenchNode[];
  readonly reconstruction: ImportedScreenReconstructionMetadata;
}

export function semanticOverlayVisualSignature(
  node: WorkbenchNode,
): string {
  const componentProps =
    node.component === undefined
      ? null
      : {
          icon: node.component.props.icon ?? null,
          items:
            node.component.props.items?.map((item) => ({
              icon: item.icon ?? null,
              label: item.label,
              status: item.status ?? null,
              supportingText: item.supportingText ?? null,
              value: item.value ?? null,
            })) ?? null,
          label: node.component.props.label ?? null,
          placeholder: node.component.props.placeholder ?? null,
          selected: node.component.props.selected ?? null,
          status: node.component.props.status ?? null,
          supportingText:
            node.component.props.supportingText ?? null,
          value: node.component.props.value ?? null,
        };
  return JSON.stringify({
    componentProps,
    componentVariant: node.component?.variant ?? null,
    fill: node.fill ?? null,
    frameContent: node.frameContent ?? null,
    path: node.path ?? null,
    position: node.position,
    size: node.size,
    stroke: node.stroke ?? null,
    text: node.component === undefined ? node.text ?? null : null,
  });
}

function assertComposition(input: ImportedMobileScreenInput): void {
  const { capture, frame, semanticNodes } = input;
  if (
    frame.kind !== "CodeFrame" ||
    frame.source?.viewport.name !== "mobile"
  ) {
    throw new Error(
      "Imported mobile composition requires a source-backed mobile CodeFrame.",
    );
  }
  if (
    capture.screenId !== frame.id ||
    capture.routeId !== frame.source.routeId
  ) {
    throw new Error(
      "Imported mobile capture does not match the source screen identity.",
    );
  }
  if (!capture.assetPath.startsWith("/imports/")) {
    throw new Error(
      "Imported mobile capture assetPath must begin with /imports/.",
    );
  }
  if (
    !Number.isFinite(capture.width) ||
    !Number.isFinite(capture.height) ||
    capture.width <= 0 ||
    capture.height <= 0 ||
    !/^[a-f0-9]{64}$/u.test(capture.screenshotSha256)
  ) {
    throw new Error("Imported mobile capture evidence is invalid.");
  }

  const ids = [frame.id, capture.id, ...semanticNodes.map(({ id }) => id)];
  if (new Set(ids).size !== ids.length) {
    throw new Error("Imported screen node identities must be unique.");
  }
  const parentById = new Map<string, string | null>([
    [frame.id, frame.parentId],
    ...semanticNodes.map(
      (node) => [node.id, node.parentId] as const,
    ),
  ]);
  for (const node of semanticNodes) {
    if (node.kind === "ReferenceFrame" || node.locked) {
      throw new Error(
        "Imported semantic overlays must remain editable layers.",
      );
    }
    const seen = new Set<string>();
    let parentId = node.parentId;
    while (parentId !== frame.id) {
      if (
        parentId === null ||
        seen.has(parentId) ||
        !parentById.has(parentId)
      ) {
        throw new Error(
          `Imported semantic hierarchy is invalid at ${node.id}.`,
        );
      }
      seen.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }
}

function referenceBinding(
  capture: ImportedMobileCapture,
): ReferenceBinding {
  return {
    alt: capture.alt,
    appVersion: capture.appVersion,
    authority: capture.authority,
    accessibilitySnapshotRef: capture.accessibilitySnapshotRef,
    capturedAt: capture.capturedAt,
    captureId: capture.id,
    componentIds: [...capture.componentIds],
    contentHash: `sha256:${capture.screenshotSha256}`,
    sourceUrl: capture.sourceUrl,
    sourceAnchors: [...capture.sourceAnchors],
    sourceRevision: capture.gitSha,
    src: capture.assetPath,
  };
}

function reviewStatus(
  capture: ImportedMobileCapture,
): ImportedScreenReconstructionMetadata["reviewStatus"] {
  const fidelity = capture.reconstructionFidelity;
  return fidelity?.geometryWithinOnePoint === true &&
    fidelity.screenshotHiddenSsim >= 0.985
    ? "verified"
    : "needs-review";
}

export function composeImportedMobileScreenWithEvidence({
  capture,
  frame,
  semanticNodes,
}: ImportedMobileScreenInput): ImportedScreenComposition {
  assertComposition({ capture, frame, semanticNodes });
  const scaleX = capture.width / frame.size.width;
  const scaleY = capture.height / frame.size.height;
  const composedFrame: WorkbenchNode = {
    ...frame,
    size: { height: capture.height, width: capture.width },
    source: {
      ...frame.source!,
      viewport: {
        height: capture.height,
        name: "mobile",
        width: capture.width,
      },
    },
  };
  const provenance = {
    ...provenanceFromSource(composedFrame.source!),
    captureState: "captured" as const,
  };
  const reference: WorkbenchNode = {
    hidden: true,
    id: capture.id,
    kind: "ReferenceFrame",
    locked: true,
    name: `${frame.name} runtime reference`,
    parentId: null,
    position: { ...composedFrame.position },
    provenance,
    reference: referenceBinding(capture),
    size: { ...composedFrame.size },
  };
  const overlays = semanticNodes.map((node) => {
    const scaled = {
      ...node,
      position: {
        x:
          composedFrame.position.x +
          (node.position.x - frame.position.x) * scaleX,
        y:
          composedFrame.position.y +
          (node.position.y - frame.position.y) * scaleY,
      },
      size: {
        height: node.size.height * scaleY,
        width: node.size.width * scaleX,
      },
      ...(node.path === undefined
        ? {}
        : {
            path: node.path.map(({ x, y }) => ({
              x: x * scaleX,
              y: y * scaleY,
            })),
          }),
      ...(node.source === undefined
        ? {}
        : {
            source: {
              ...node.source,
              viewport: {
                height: capture.height,
                name: "mobile" as const,
                width: capture.width,
              },
            },
          }),
    };
    return {
      ...scaled,
      ...(scaled.component !== undefined ||
      scaled.provenance !== undefined ||
      scaled.source !== undefined
        ? {}
        : { provenance }),
    };
  });
  return Object.freeze({
    nodes: Object.freeze([composedFrame, reference, ...overlays]),
    reconstruction: Object.freeze({
      evidenceNodeId: capture.id,
      layers: Object.freeze(Object.fromEntries(
        overlays.map((node) => [
          node.id,
          Object.freeze({
            confidence: 1,
            evidenceRefs: Object.freeze([
              capture.id,
              `sha256:${capture.screenshotSha256}`,
            ]),
          }),
        ]),
      )),
      reviewStatus: reviewStatus(capture),
      screenId: frame.id,
    }),
  });
}

export function composeImportedMobileScreen(
  input: ImportedMobileScreenInput,
): readonly WorkbenchNode[] {
  return composeImportedMobileScreenWithEvidence(input).nodes;
}
