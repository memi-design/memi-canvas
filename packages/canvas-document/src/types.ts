import type {
  CanvasDocument,
  CanvasNode,
  CanvasNodeInput,
  CanvasOperation,
  CoverageHealth,
  EvidenceLevel,
} from "@memi/protocol";

export type {
  CanvasDocument,
  CanvasNode,
  CanvasOperation,
  CoverageHealth,
  EvidenceLevel,
};

export interface CreateCanvasDocumentInput {
  readonly id: string;
  readonly projectId: string;
}

export interface PrepareNodeCreateInput {
  readonly id: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly node: CanvasNodeInput;
}

export interface ScreenMatrixCell {
  readonly nodeId: string;
  readonly operationId: string;
  readonly routeId: string;
  readonly stateId: string;
  readonly coverageCellId: string;
  readonly viewport: {
    readonly name: "desktop" | "tablet" | "mobile";
    readonly width: number;
    readonly height: number;
  };
  readonly evidenceLevel: EvidenceLevel;
  readonly coverageHealth: Exclude<CoverageHealth, "blocked">;
}

export interface ScreenMatrixInput {
  readonly actorId: string;
  readonly occurredAt: string;
  readonly cells: readonly ScreenMatrixCell[];
}

export interface CanvasMaterialization {
  readonly document: CanvasDocument;
  readonly operations: readonly CanvasOperation[];
}
