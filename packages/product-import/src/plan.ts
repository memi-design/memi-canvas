import {
  applyCanvasOperation,
  createCanvasDocument,
  prepareNodeCreateOperation,
  type CanvasDocument,
  type CanvasOperation,
} from "@memi/canvas-document";
import {
  CanvasDocumentIdSchema,
  CanvasNodeIdSchema,
  ContentHashSchema,
  CoverageCellIdSchema,
  IsoTimestampSchema,
  OperationIdSchema,
  ProjectIdSchema,
  RouteIdSchema,
  StateIdSchema,
} from "@memi/protocol";

import {
  assertExactKeys,
  assertUnique,
  deepFreeze,
  hashValue,
  roleSeparatedId,
} from "./shared.js";
import type {
  CanvasMaterializationEntry,
  CanvasMaterializationPlan,
  CanvasUnmaterializedEntry,
  CreateCanvasMaterializationPlanOptions,
  ProductWorkspace,
  WorkspaceCoverageCell,
} from "./types.js";
import { validateProductWorkspace } from "./workspace.js";

const ACTOR_ID = "memi-import-pipeline" as const;
const PLAN_ID_PATTERN = /^mpl_[0-9A-HJKMNP-TV-Z]{26}$/u;
const COLUMN_X = {
  desktop: 0,
  tablet: 1540,
  mobile: 2474,
} as const;
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
} as const;
const MATERIALIZABLE_STATUSES = new Set([
  "planned",
  "queued",
  "capturing",
  "verified",
  "partial",
]);

function deriveDocumentId(workspace: ProductWorkspace): string {
  return roleSeparatedId("doc", "canvas-document", {
    projectId: workspace.projectId,
    sourceContentFingerprint: workspace.sourceContentFingerprint,
    compilerFingerprint: workspace.compilerFingerprint,
    projectionIntegrityDigests: workspace.projectionIntegrityDigests,
  });
}

function planIdentity(plan: CanvasMaterializationPlan): object {
  return {
    projectId: plan.projectId,
    documentId: plan.documentId,
    actorId: plan.actorId,
    workspaceDigest: plan.workspaceDigest,
    sourceContentFingerprint: plan.sourceContentFingerprint,
    compilerFingerprint: plan.compilerFingerprint,
    projectionIntegrityDigests: plan.projectionIntegrityDigests,
  };
}

function derivePlanId(identity: object): `mpl_${string}` {
  return roleSeparatedId(
    "mpl",
    "canvas-materialization-plan",
    identity,
  ) as `mpl_${string}`;
}

function deriveNodeId(
  documentId: string,
  entry: Pick<
    CanvasMaterializationEntry,
    "coverageCellId" | "routeId" | "stateId" | "viewport"
  >,
): ReturnType<typeof CanvasNodeIdSchema.parse> {
  return CanvasNodeIdSchema.parse(
    roleSeparatedId("nod", "coverage-cell-node", {
      documentId,
      coverageCellId: entry.coverageCellId,
      routeId: entry.routeId,
      stateId: entry.stateId,
      viewport: entry.viewport,
    }),
  );
}

function deriveOperationId(
  documentId: string,
  entry: Pick<
    CanvasMaterializationEntry,
    "coverageCellId" | "routeId" | "stateId" | "viewport" | "ordinal"
  >,
): ReturnType<typeof OperationIdSchema.parse> {
  return OperationIdSchema.parse(
    roleSeparatedId("opn", "coverage-cell-operation", {
      documentId,
      coverageCellId: entry.coverageCellId,
      routeId: entry.routeId,
      stateId: entry.stateId,
      viewport: entry.viewport,
      ordinal: entry.ordinal,
    }),
  );
}

function entryOperation(
  document: CanvasDocument,
  entry: Pick<
    CanvasMaterializationEntry,
    | "ordinal"
    | "coverageCellId"
    | "routeId"
    | "stateId"
    | "viewport"
    | "nodeId"
    | "operationId"
    | "evidenceLevel"
    | "coverageHealth"
    | "frameKind"
    | "frameAuthority"
  >,
  actorId: string,
  occurredAt: string,
): CanvasOperation {
  return prepareNodeCreateOperation(document, {
    id: entry.operationId,
    actorId,
    occurredAt,
    node: {
      id: entry.nodeId,
      kind: entry.frameKind,
      authority: entry.frameAuthority,
      evidenceLevel: entry.evidenceLevel,
      coverageHealth: entry.coverageHealth,
      parentId: null,
      position: {
        x: COLUMN_X[entry.viewport.name],
        y: Math.floor(entry.ordinal / 3) * 1240,
      },
      size: {
        width: entry.viewport.width,
        height: entry.viewport.height,
      },
      viewport: { ...entry.viewport },
      source: {
        routeId: entry.routeId,
        stateId: entry.stateId,
        coverageCellId: entry.coverageCellId,
      },
    },
  });
}

function assertProjectionIntegrityDigests(value: unknown): void {
  assertExactKeys(
    value,
    ["product", "route", "state", "flow", "designSystem", "capture", "coverage"],
    "Projection integrity digests",
  );
  for (const hash of Object.values(value)) {
    ContentHashSchema.parse(hash);
  }
}

function assertViewport(value: unknown): void {
  assertExactKeys(value, ["name", "width", "height"], "Plan viewport");
  if (!(value.name === "desktop" || value.name === "tablet" || value.name === "mobile")) {
    throw new Error("Plan viewport name is invalid.");
  }
  const expected = VIEWPORTS[value.name];
  if (value.width !== expected.width || value.height !== expected.height) {
    throw new Error("Plan viewport dimensions are invalid.");
  }
}

function validateEntryShape(entry: CanvasMaterializationEntry): void {
  assertExactKeys(
    entry,
    [
      "ordinal",
      "coverageCellId",
      "routeId",
      "stateId",
      "viewport",
      "nodeId",
      "operationId",
      "evidenceLevel",
      "coverageHealth",
      "frameKind",
      "frameAuthority",
      "expectedBeforeHash",
      "resultingHash",
      "actionDigest",
    ],
    "Canvas materialization entry",
  );
  if (!Number.isSafeInteger(entry.ordinal) || entry.ordinal < 0) {
    throw new Error("Materialization ordinal must be a nonnegative safe integer.");
  }
  CoverageCellIdSchema.parse(entry.coverageCellId);
  RouteIdSchema.parse(entry.routeId);
  StateIdSchema.parse(entry.stateId);
  CanvasNodeIdSchema.parse(entry.nodeId);
  OperationIdSchema.parse(entry.operationId);
  assertViewport(entry.viewport);
  if (
    entry.frameKind !== "code-frame" ||
    entry.frameAuthority !== "product-source" ||
    entry.evidenceLevel === null
  ) {
    throw new Error("Materialized import entries must preserve product-source truth.");
  }
  ContentHashSchema.parse(entry.expectedBeforeHash);
  ContentHashSchema.parse(entry.resultingHash);
  ContentHashSchema.parse(entry.actionDigest);
}

function withoutPlanDigest(
  plan: CanvasMaterializationPlan,
): Omit<CanvasMaterializationPlan, "planDigest"> {
  const { planDigest: _planDigest, ...body } = plan;
  return body;
}

function compileValidatedOperations(
  plan: CanvasMaterializationPlan,
): {
  readonly operations: readonly CanvasOperation[];
  readonly document: CanvasDocument;
} {
  let document = createCanvasDocument({
    id: plan.documentId,
    projectId: plan.projectId,
  });
  const operations: CanvasOperation[] = [];
  for (const entry of plan.entries) {
    const operation = entryOperation(
      document,
      entry,
      plan.actorId,
      plan.occurredAt,
    );
    if (
      operation.id !== entry.operationId ||
      operation.expectedBeforeHash !== entry.expectedBeforeHash ||
      operation.resultingHash !== entry.resultingHash ||
      operation.actionDigest !== entry.actionDigest
    ) {
      throw new Error("Materialization operation chain does not match its plan entry.");
    }
    operations.push(operation);
    document = applyCanvasOperation(document, operation);
  }
  return { operations, document };
}

export function validateCanvasMaterializationPlan(
  plan: CanvasMaterializationPlan,
  untrustedWorkspace: ProductWorkspace,
): CanvasMaterializationPlan {
  const workspace = validateProductWorkspace(untrustedWorkspace);
  assertExactKeys(
    plan,
    [
      "schemaVersion",
      "planId",
      "planDigest",
      "projectId",
      "documentId",
      "actorId",
      "occurredAt",
      "workspaceDigest",
      "sourceContentFingerprint",
      "compilerFingerprint",
      "projectionIntegrityDigests",
      "initialDocument",
      "entries",
      "unmaterializedEntries",
      "finalDocument",
      "counts",
    ],
    "Canvas materialization plan",
  );
  if (plan.schemaVersion !== 1 || !PLAN_ID_PATTERN.test(plan.planId)) {
    throw new Error("Canvas materialization plan identity is invalid.");
  }
  ProjectIdSchema.parse(plan.projectId);
  CanvasDocumentIdSchema.parse(plan.documentId);
  if (plan.actorId !== ACTOR_ID) {
    throw new Error(`Canvas materialization actor must be ${ACTOR_ID}.`);
  }
  IsoTimestampSchema.parse(plan.occurredAt);
  ContentHashSchema.parse(plan.workspaceDigest);
  ContentHashSchema.parse(plan.sourceContentFingerprint);
  ContentHashSchema.parse(plan.compilerFingerprint);
  assertProjectionIntegrityDigests(plan.projectionIntegrityDigests);
  assertExactKeys(plan.initialDocument, ["revision", "stateHash"], "Initial document");
  assertExactKeys(
    plan.finalDocument,
    ["revision", "stateHash", "operationCursor"],
    "Final document",
  );
  assertExactKeys(
    plan.counts,
    ["coverageCells", "materializedCells", "blockedCells", "unmaterializedCells"],
    "Materialization counts",
  );
  ContentHashSchema.parse(plan.initialDocument.stateHash);
  ContentHashSchema.parse(plan.finalDocument.stateHash);
  if (plan.finalDocument.operationCursor !== null) {
    OperationIdSchema.parse(plan.finalDocument.operationCursor);
  }
  if (!Array.isArray(plan.entries)) {
    throw new TypeError("Materialization entries must be an array.");
  }
  plan.entries.forEach(validateEntryShape);
  if (!Array.isArray(plan.unmaterializedEntries)) {
    throw new TypeError("Unmaterialized entries must be an array.");
  }
  for (const entry of plan.unmaterializedEntries) {
    assertExactKeys(
      entry,
      ["ordinal", "coverageCellId", "captureStatus", "coverageHealth", "reason"],
      "Unmaterialized entry",
    );
    const unmaterialized = entry as unknown as CanvasUnmaterializedEntry;
    CoverageCellIdSchema.parse(unmaterialized.coverageCellId);
    if (
      !Number.isSafeInteger(unmaterialized.ordinal) ||
      unmaterialized.ordinal < 0
    ) {
      throw new Error("Unmaterialized ordinal is invalid.");
    }
    if (unmaterialized.reason.trim().length === 0) {
      throw new Error("Unmaterialized reason is required.");
    }
  }
  assertUnique(plan.entries.map((entry) => entry.coverageCellId), "Coverage cell");
  assertUnique(plan.entries.map((entry) => entry.nodeId), "Canvas node");
  assertUnique(plan.entries.map((entry) => entry.operationId), "Canvas operation");
  if (
    plan.entries.some(
      (entry, index) =>
        index > 0 && entry.ordinal <= plan.entries[index - 1]!.ordinal,
    )
  ) {
    throw new Error("Materialization entries must remain in canonical order.");
  }
  if (
    plan.entries.some(
      (entry) =>
        entry.nodeId !== deriveNodeId(plan.documentId, entry) ||
        entry.operationId !==
          deriveOperationId(plan.documentId, entry),
    )
  ) {
    throw new Error("Materialization entry identifier derivation is invalid.");
  }
  if (
    plan.workspaceDigest !== workspace.workspaceDigest ||
    plan.projectId !== workspace.projectId ||
    plan.sourceContentFingerprint !== workspace.sourceContentFingerprint ||
    plan.compilerFingerprint !== workspace.compilerFingerprint ||
    JSON.stringify(plan.projectionIntegrityDigests) !==
      JSON.stringify(workspace.projectionIntegrityDigests)
  ) {
    throw new Error("Plan does not bind the supplied workspace.");
  }
  const identity = planIdentity(plan);
  if (plan.planId !== derivePlanId(identity)) {
    throw new Error("Materialization plan handle is invalid.");
  }
  const initial = createCanvasDocument({
    id: plan.documentId,
    projectId: plan.projectId,
  });
  if (
    plan.initialDocument.revision !== 0 ||
    plan.initialDocument.stateHash !== initial.stateHash
  ) {
    throw new Error("Materialization plan initial document is invalid.");
  }
  const { document } = compileValidatedOperations(plan);
  const expectedCursor = plan.entries.at(-1)?.operationId ?? null;
  if (
    plan.finalDocument.revision !== document.revision ||
    plan.finalDocument.stateHash !== document.stateHash ||
    plan.finalDocument.operationCursor !== expectedCursor
  ) {
    throw new Error("Materialization plan final document is invalid.");
  }
  if (
    !Object.values(plan.counts).every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    plan.counts.materializedCells !== plan.entries.length ||
    plan.counts.unmaterializedCells !==
      plan.counts.coverageCells - plan.counts.materializedCells ||
    plan.counts.unmaterializedCells !== plan.unmaterializedEntries.length ||
    plan.entries.some((entry) => entry.ordinal >= plan.counts.coverageCells)
  ) {
    throw new Error("Materialization plan coverage counts are invalid.");
  }
  const expectedMaterialized: Array<{
    readonly ordinal: number;
    readonly coverageCellId: string;
    readonly routeId: string;
    readonly stateId: string;
    readonly viewport: {
      readonly name: string;
      readonly width: number;
      readonly height: number;
    };
    readonly evidenceLevel: string;
    readonly coverageHealth: string;
    readonly frameKind: string;
    readonly frameAuthority: "product-source";
  }> = [];
  const expectedUnmaterialized: CanvasUnmaterializedEntry[] = [];
  for (const [ordinal, cell] of workspace.coverageCells.entries()) {
    const capture = workspace.captureCells[ordinal]!;
    if (
      MATERIALIZABLE_STATUSES.has(capture.status) &&
      cell.health !== "blocked"
    ) {
      if (cell.evidenceLevel === null || cell.frameKind === null) {
        throw new Error("Materialized workspace truth is incomplete.");
      }
      expectedMaterialized.push({
        ordinal,
        coverageCellId: cell.id,
        routeId: cell.routeId,
        stateId: cell.stateId,
        viewport: {
          name: cell.viewport.name,
          width: cell.viewport.width,
          height: cell.viewport.height,
        },
        evidenceLevel: cell.evidenceLevel,
        coverageHealth: cell.health,
        frameKind: cell.frameKind,
        frameAuthority: "product-source",
      });
    } else {
      const reason = capture.reason ?? cell.reason;
      if (reason === undefined) {
        throw new Error("Unmaterialized workspace truth requires a reason.");
      }
      expectedUnmaterialized.push({
        ordinal,
        coverageCellId: cell.id,
        captureStatus: capture.status,
        coverageHealth: cell.health,
        reason,
      });
    }
  }
  if (
    JSON.stringify(
      plan.entries.map((entry) => ({
        ordinal: entry.ordinal,
        coverageCellId: entry.coverageCellId,
        routeId: entry.routeId,
        stateId: entry.stateId,
        viewport: entry.viewport,
        evidenceLevel: entry.evidenceLevel,
        coverageHealth: entry.coverageHealth,
        frameKind: entry.frameKind,
        frameAuthority: entry.frameAuthority,
      })),
    ) !== JSON.stringify(expectedMaterialized) ||
    JSON.stringify(plan.unmaterializedEntries) !==
      JSON.stringify(expectedUnmaterialized) ||
    plan.counts.coverageCells !== workspace.coverageCells.length ||
    plan.counts.materializedCells !== expectedMaterialized.length ||
    plan.counts.unmaterializedCells !== expectedUnmaterialized.length ||
    plan.counts.blockedCells !==
      workspace.coverageCells.filter((cell) => cell.health === "blocked").length
  ) {
    throw new Error("Plan materialized and unmaterialized sets differ from workspace truth.");
  }
  if (plan.planDigest !== hashValue(withoutPlanDigest(plan))) {
    throw new Error("Materialization plan digest is invalid.");
  }
  return plan;
}

function entryFromCell(
  document: CanvasDocument,
  cell: WorkspaceCoverageCell,
  ordinal: number,
  actorId: string,
  occurredAt: string,
): {
  readonly entry: CanvasMaterializationEntry;
  readonly operation: CanvasOperation;
} {
  if (
    cell.frameKind !== "code-frame" ||
    cell.evidenceLevel === null ||
    cell.health === "blocked"
  ) {
    throw new Error("Only nonblocked code-frame truth may be materialized.");
  }
  const source = {
    ordinal,
    coverageCellId: cell.id,
    routeId: cell.routeId,
    stateId: cell.stateId,
    viewport: {
      name: cell.viewport.name as "desktop" | "tablet" | "mobile",
      width: cell.viewport.width,
      height: cell.viewport.height,
    },
  };
  const base = {
    ...source,
    nodeId: deriveNodeId(document.id, source),
    operationId: deriveOperationId(document.id, source),
    evidenceLevel: cell.evidenceLevel,
    coverageHealth: cell.health,
    frameKind: cell.frameKind,
    frameAuthority: "product-source" as const,
  };
  const operation = entryOperation(document, base, actorId, occurredAt);
  return {
    entry: {
      ...base,
      expectedBeforeHash: operation.expectedBeforeHash,
      resultingHash: operation.resultingHash,
      actionDigest: operation.actionDigest,
    },
    operation,
  };
}

export function createCanvasMaterializationPlan(
  untrustedWorkspace: ProductWorkspace,
  options: CreateCanvasMaterializationPlanOptions,
): CanvasMaterializationPlan {
  const workspace = validateProductWorkspace(untrustedWorkspace);
  if (options.actorId !== ACTOR_ID) {
    throw new Error(`Canvas materialization actor must be ${ACTOR_ID}.`);
  }
  IsoTimestampSchema.parse(options.occurredAt);
  const documentId = CanvasDocumentIdSchema.parse(
    options.documentId ?? deriveDocumentId(workspace),
  );
  const identity = {
    schemaVersion: 1 as const,
    planId: "" as `mpl_${string}`,
    projectId: workspace.projectId,
    documentId,
    actorId: ACTOR_ID,
    occurredAt: options.occurredAt,
    workspaceDigest: workspace.workspaceDigest,
    sourceContentFingerprint: workspace.sourceContentFingerprint,
    compilerFingerprint: workspace.compilerFingerprint,
    projectionIntegrityDigests: workspace.projectionIntegrityDigests,
    initialDocument: { revision: 0 as const, stateHash: "" as never },
    entries: [],
    unmaterializedEntries: [],
    finalDocument: { revision: 0, stateHash: "" as never, operationCursor: null },
    counts: { coverageCells: 0, materializedCells: 0, blockedCells: 0, unmaterializedCells: 0 },
    planDigest: "" as never,
  };
  const planId = derivePlanId(planIdentity(identity as CanvasMaterializationPlan));
  let document = createCanvasDocument({
    id: documentId,
    projectId: workspace.projectId,
  });
  const entries: CanvasMaterializationEntry[] = [];
  const unmaterializedEntries: CanvasUnmaterializedEntry[] = [];
  for (const [ordinal, cell] of workspace.coverageCells.entries()) {
    const capture = workspace.captureCells[ordinal]!;
    if (
      !MATERIALIZABLE_STATUSES.has(capture.status) ||
      cell.health === "blocked"
    ) {
      const reason = capture.reason ?? cell.reason;
      if (reason === undefined) {
        throw new Error("Unmaterialized workspace truth requires a reason.");
      }
      unmaterializedEntries.push({
        ordinal,
        coverageCellId: cell.id,
        captureStatus: capture.status,
        coverageHealth: cell.health,
        reason,
      });
      continue;
    }
    const next = entryFromCell(
      document,
      cell,
      ordinal,
      ACTOR_ID,
      options.occurredAt,
    );
    entries.push(next.entry);
    document = applyCanvasOperation(document, next.operation);
  }
  const blockedCells = workspace.coverageCells.filter(
    (cell) => cell.health === "blocked",
  ).length;
  const body: Omit<CanvasMaterializationPlan, "planDigest"> = {
    schemaVersion: 1,
    planId,
    projectId: workspace.projectId,
    documentId,
    actorId: ACTOR_ID,
    occurredAt: options.occurredAt,
    workspaceDigest: workspace.workspaceDigest,
    sourceContentFingerprint: workspace.sourceContentFingerprint,
    compilerFingerprint: workspace.compilerFingerprint,
    projectionIntegrityDigests: workspace.projectionIntegrityDigests,
    initialDocument: {
      revision: 0,
      stateHash: createCanvasDocument({
        id: documentId,
        projectId: workspace.projectId,
      }).stateHash,
    },
    entries,
    unmaterializedEntries,
    finalDocument: {
      revision: document.revision,
      stateHash: document.stateHash,
      operationCursor: document.operationCursor,
    },
    counts: {
      coverageCells: workspace.coverageCells.length,
      materializedCells: entries.length,
      blockedCells,
      unmaterializedCells: unmaterializedEntries.length,
    },
  };
  const plan: CanvasMaterializationPlan = {
    ...body,
    planDigest: hashValue(body),
  };
  validateCanvasMaterializationPlan(plan, workspace);
  return deepFreeze(plan);
}

export function compileCanvasOperations(
  untrustedPlan: CanvasMaterializationPlan,
  untrustedWorkspace: ProductWorkspace,
): readonly CanvasOperation[] {
  const plan = validateCanvasMaterializationPlan(
    untrustedPlan,
    untrustedWorkspace,
  );
  return deepFreeze(
    compileValidatedOperations(plan).operations.map((operation) =>
      structuredClone(operation),
    ),
  );
}
