import type {
  CanvasDocumentId,
  CanvasNodeId,
  CapturePlan,
  ContentHash,
  CoverageLedger,
  CoverageCellId,
  CoverageHealth,
  EvidenceLevel,
  DesignSystemManifest,
  FlowManifest,
  FrameAuthority,
  FrameKind,
  OperationId,
  ProjectId,
  ProductManifest,
  RouteManifest,
  RouteId,
  StateId,
  StateManifest,
} from "@memi/protocol";

type CaptureStatus = CapturePlan["cells"][number]["status"];

export interface ProjectionIntegrityDigests {
  readonly product: ContentHash;
  readonly route: ContentHash;
  readonly state: ContentHash;
  readonly flow: ContentHash;
  readonly designSystem: ContentHash;
  readonly capture: ContentHash;
  readonly coverage: ContentHash;
}

export type WorkspaceRoute = RouteManifest["routes"][number];
export type WorkspaceState = StateManifest["states"][number];
export type WorkspaceFlow = FlowManifest["flows"][number];
export type WorkspaceFlowStep = WorkspaceFlow["steps"][number];
export type WorkspaceDesignToken = DesignSystemManifest["tokens"][number];
export type WorkspaceCaptureCell = CapturePlan["cells"][number];
export type WorkspaceCoverageCell = CoverageLedger["cells"][number];

type RepositorySource = Extract<
  ProductManifest,
  { importMode: "repository" | "storybook" }
>["source"];
type StaticSource = Extract<
  ProductManifest,
  { importMode: "static-build" | "screenshot-folder" }
>["source"];
type Framework = Extract<
  ProductManifest,
  { framework: unknown }
>["framework"];

export interface ProductTruthProjection {
  readonly schemaVersion: 1;
  readonly projectId: ProjectId;
  readonly importMode: ProductManifest["importMode"];
  readonly source:
    | Omit<RepositorySource, "root">
    | Omit<StaticSource, "root">
    | { readonly kind: "running-url"; readonly loopbackOrigin: string }
    | { readonly kind: "blank" };
  readonly framework?: Framework;
  readonly dimensions: ProductManifest["dimensions"];
}

export interface ProductWorkspace {
  readonly schemaVersion: 1;
  readonly workspaceDigest: ContentHash;
  readonly projectId: ProjectId;
  readonly sourceRevision: string;
  readonly sourceContentFingerprint: ContentHash;
  readonly compilerFingerprint: ContentHash;
  readonly productTruth: ProductTruthProjection;
  readonly flowSourceFile: string;
  readonly capturePlanId: CapturePlan["id"];
  readonly captureBudgets: CapturePlan["budgets"];
  readonly projectionIntegrityDigests: ProjectionIntegrityDigests;
  readonly routes: readonly WorkspaceRoute[];
  readonly states: readonly WorkspaceState[];
  readonly flows: readonly WorkspaceFlow[];
  readonly designTokens: readonly WorkspaceDesignToken[];
  readonly captureCells: readonly WorkspaceCaptureCell[];
  readonly coverageCells: readonly WorkspaceCoverageCell[];
  readonly counts: {
    readonly routes: number;
    readonly states: number;
    readonly coverageCells: number;
    readonly designTokens: number;
    readonly flows: number;
    readonly blockedCells: number;
  };
}

export interface CanvasMaterializationEntry {
  readonly ordinal: number;
  readonly coverageCellId: CoverageCellId;
  readonly routeId: RouteId;
  readonly stateId: StateId;
  readonly viewport: {
    readonly name: "desktop" | "tablet" | "mobile";
    readonly width: number;
    readonly height: number;
  };
  readonly nodeId: CanvasNodeId;
  readonly operationId: OperationId;
  readonly evidenceLevel: EvidenceLevel;
  readonly coverageHealth: Exclude<CoverageHealth, "blocked">;
  readonly frameKind: FrameKind;
  readonly frameAuthority: FrameAuthority;
  readonly expectedBeforeHash: ContentHash;
  readonly resultingHash: ContentHash;
  readonly actionDigest: ContentHash;
}

export interface CanvasUnmaterializedEntry {
  readonly ordinal: number;
  readonly coverageCellId: CoverageCellId;
  readonly captureStatus: CaptureStatus;
  readonly coverageHealth: CoverageHealth;
  readonly reason: string;
}

export interface CanvasMaterializationPlan {
  readonly schemaVersion: 1;
  readonly planId: `mpl_${string}`;
  readonly planDigest: ContentHash;
  readonly projectId: ProjectId;
  readonly documentId: CanvasDocumentId;
  readonly actorId: "memi-import-pipeline";
  readonly occurredAt: string;
  readonly workspaceDigest: ContentHash;
  readonly sourceContentFingerprint: ContentHash;
  readonly compilerFingerprint: ContentHash;
  readonly projectionIntegrityDigests: ProjectionIntegrityDigests;
  readonly initialDocument: {
    readonly revision: 0;
    readonly stateHash: ContentHash;
  };
  readonly entries: readonly CanvasMaterializationEntry[];
  readonly unmaterializedEntries: readonly CanvasUnmaterializedEntry[];
  readonly finalDocument: {
    readonly revision: number;
    readonly stateHash: ContentHash;
    readonly operationCursor: OperationId | null;
  };
  readonly counts: {
    readonly coverageCells: number;
    readonly materializedCells: number;
    readonly blockedCells: number;
    readonly unmaterializedCells: number;
  };
}

export interface CreateCanvasMaterializationPlanOptions {
  readonly documentId?: string;
  readonly actorId: string;
  readonly occurredAt: string;
}
