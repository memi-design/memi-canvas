import {
  MAX_CANONICAL_BYTES,
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  validateCanvasMaterializationPlan,
  validateProductWorkspace,
  type CanvasMaterializationPlan,
  type ProductWorkspace,
} from "@memi/product-import";
import {
  CanvasOperationCommittedEventSchema,
  ContentHashSchema,
  ProjectIdSchema,
  type CanvasOperationCommittedEvent,
  type ProjectId,
} from "@memi/protocol";

import {
  parseWorkspaceDocumentation,
  type WorkspaceCaptureStatus,
  type WorkspaceDocumentation,
  type WorkspaceScreen,
} from "./schema.js";

export interface CanonicalCanvasReplay {
  readonly projectId: ProjectId;
  readonly lastSequence: number;
  readonly lastEventHash: string | null;
  readonly events: readonly CanvasOperationCommittedEvent[];
}

export interface WorkspaceDocumentationProjectionInput {
  readonly workspace: ProductWorkspace;
  readonly plan: CanvasMaterializationPlan;
  readonly canonicalReplay: CanonicalCanvasReplay;
}

function assertExactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    Reflect.ownKeys(value).length !== keys.length ||
    keys.length !== wanted.length ||
    keys.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} contains missing or unknown fields.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      throw new TypeError(`${label} accepts only enumerable data fields.`);
    }
  }
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicate identities.`);
  }
}

function validateCanonicalReplay(
  value: CanonicalCanvasReplay,
  plan: CanvasMaterializationPlan,
): CanonicalCanvasReplay {
  assertExactKeys(
    value,
    ["projectId", "lastSequence", "lastEventHash", "events"],
    "Canonical canvas replay",
  );
  const projectId = ProjectIdSchema.parse(value.projectId);
  if (!Array.isArray(value.events)) {
    throw new TypeError("Canonical canvas replay events must be an array.");
  }
  const events = value.events.map((event) =>
    CanvasOperationCommittedEventSchema.parse(event),
  );
  if (
    !Number.isSafeInteger(value.lastSequence) ||
    value.lastSequence < 0 ||
    value.lastSequence !== events.length
  ) {
    throw new Error("Canonical canvas replay sequence is invalid.");
  }
  const lastEventHash =
    value.lastEventHash === null
      ? null
      : ContentHashSchema.parse(value.lastEventHash);
  if (
    projectId !== plan.projectId ||
    lastEventHash !== (events.at(-1)?.eventHash ?? null) ||
    events.length > plan.entries.length
  ) {
    throw new Error("Canonical canvas replay head is not bound to the plan.");
  }
  unique(events.map((event) => event.id), "Canonical trace events");
  unique(
    events.map((event) => event.commandId),
    "Canonical trace commands",
  );
  unique(
    events.map((event) => event.operationId),
    "Canonical trace operations",
  );
  for (const [index, event] of events.entries()) {
    const entry = plan.entries[index];
    if (
      entry === undefined ||
      event.projectId !== plan.projectId ||
      event.target.id !== plan.documentId ||
      event.sequence !== index + 1 ||
      event.previousEventHash !== (events[index - 1]?.eventHash ?? null) ||
      event.operationId !== entry.operationId ||
      event.operationActionDigest !== entry.actionDigest ||
      event.expectedBeforeHash !== entry.expectedBeforeHash ||
      event.resultingHash !== entry.resultingHash ||
      event.appliedRevision !== entry.ordinal + 1
    ) {
      throw new Error(
        "Canonical canvas replay does not exactly map to plan order.",
      );
    }
  }
  return {
    projectId,
    lastSequence: events.length,
    lastEventHash,
    events,
  };
}

function captureStatus(
  cell: ProductWorkspace["coverageCells"][number],
): WorkspaceCaptureStatus {
  if (cell.health === "blocked") {
    return "blocked";
  }
  if (
    cell.evidenceLevel === "observed" ||
    cell.evidenceLevel === "verified"
  ) {
    return "observed";
  }
  if (cell.evidenceLevel === "inferred") {
    return "inferred";
  }
  return "unavailable";
}

function screenFor(
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
  eventsByOperation: ReadonlyMap<string, CanvasOperationCommittedEvent>,
  index: number,
): WorkspaceScreen {
  const cell = workspace.coverageCells[index]!;
  const route = workspace.routes.find(
    (candidate) => candidate.id === cell.routeId,
  )!;
  const state = workspace.states.find(
    (candidate) => candidate.id === cell.stateId,
  )!;
  const entry = plan.entries.find(
    (candidate) => candidate.coverageCellId === cell.id,
  );
  const event =
    entry === undefined
      ? undefined
      : eventsByOperation.get(entry.operationId);
  const traceRef =
    event === undefined
      ? null
      : {
          sequence: event.sequence,
          eventId: event.id,
          eventHash: event.eventHash,
          operationId: event.operationId,
        };
  const status =
    entry === undefined
      ? "unmaterialized"
      : event === undefined
        ? "planned-not-committed"
        : "committed";
  return {
    id: cell.id,
    route: {
      id: route.id,
      displayName: route.displayName,
      path: route.path,
    },
    state: {
      id: state.id,
      name: state.name,
      kind: state.kind,
      provenance: state.provenance,
    },
    viewport: { ...cell.viewport } as WorkspaceScreen["viewport"],
    context: {
      role: cell.role,
      theme: cell.theme,
      locale: cell.locale,
      fixture: cell.fixture,
    },
    capture: {
      status: captureStatus(cell),
      ...(cell.reason === undefined ? {} : { reason: cell.reason }),
      evidenceArtifactIds: [...cell.evidenceArtifactIds],
      ...(cell.evidenceHash === undefined
        ? {}
        : { evidenceHash: cell.evidenceHash }),
    },
    materialization: {
      status,
      nodeId: entry?.nodeId ?? null,
      operationId: entry?.operationId ?? null,
      traceRef,
    },
  };
}

function documentationBody(
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
  replay: CanonicalCanvasReplay,
): Omit<WorkspaceDocumentation, "documentationDigest"> {
  const eventsByOperation = new Map(
    replay.events.map((event) => [event.operationId, event] as const),
  );
  const screens = workspace.coverageCells.map((_cell, index) =>
    screenFor(workspace, plan, eventsByOperation, index),
  );
  const materialization = screens.map(
    (screen) => screen.materialization.status,
  );
  const captures = screens.map((screen) => screen.capture.status);
  const occurrences = (values: readonly string[], status: string): number =>
    values.filter((value) => value === status).length;
  const product = workspace.productTruth;
  return {
    schemaVersion: 1,
    kind: "workspace-documentation",
    sourceBindings: {
      workspaceDigest: workspace.workspaceDigest,
      planId: plan.planId,
      planDigest: plan.planDigest,
      documentId: plan.documentId,
      sourceRevision: workspace.sourceRevision,
      sourceContentFingerprint: workspace.sourceContentFingerprint,
      compilerFingerprint: workspace.compilerFingerprint,
      projectionIntegrityDigests: {
        ...workspace.projectionIntegrityDigests,
      },
    },
    project: {
      id: workspace.projectId,
      importMode: product.importMode,
      source: structuredClone(product.source),
      ...("framework" in product
        ? { framework: structuredClone(product.framework) }
        : {}),
      dimensions: structuredClone(product.dimensions),
    },
    screens,
    flows: workspace.flows.map((flow) => ({
      id: flow.id,
      name: flow.name,
      status: "declared",
      observationStatus: "not-observed",
      steps: flow.steps.map((step) => ({ ...step })),
    })),
    designSystem: {
      tokens: workspace.designTokens.map((token) => ({
        name: token.name,
        cssVariable: token.cssVariable,
        sourceFile: token.sourceFile,
        status: "declared",
      })),
      components: {
        status: "unavailable",
        items: [],
      },
    },
    trace: {
      projectId: replay.projectId,
      lastSequence: replay.lastSequence,
      lastEventHash: replay.lastEventHash,
      refs: replay.events.map((event) => ({
        sequence: event.sequence,
        eventId: event.id,
        eventHash: event.eventHash,
        previousEventHash: event.previousEventHash,
        operationId: event.operationId,
        commandId: event.commandId,
        resultingHash: event.resultingHash,
      })),
    },
    coverage: {
      routes: workspace.routes.length,
      states: workspace.states.length,
      screenCells: screens.length,
      captures: {
        unavailable: occurrences(captures, "unavailable"),
        observed: occurrences(captures, "observed"),
        inferred: occurrences(captures, "inferred"),
        blocked: occurrences(captures, "blocked"),
      },
      materialization: {
        planned:
          occurrences(materialization, "committed") +
          occurrences(materialization, "planned-not-committed"),
        committed: occurrences(materialization, "committed"),
        plannedNotCommitted: occurrences(
          materialization,
          "planned-not-committed",
        ),
        unmaterialized: occurrences(
          materialization,
          "unmaterialized",
        ),
      },
      flows: {
        declared: workspace.flows.length,
        observed: 0,
      },
      tokens: {
        declared: workspace.designTokens.length,
      },
      components: {
        available: 0,
        status: "unavailable",
      },
    },
    abstentions: [
      {
        authority: "visual-verification",
        status: "unavailable",
        reason: "runtime-replay-is-not-visual-verification",
      },
      {
        authority: "flow-observation",
        status: "unavailable",
        reason: "workspace-flows-are-declarations-only",
      },
      {
        authority: "component-inventory",
        status: "unavailable",
        reason: "workspace-has-no-component-authority",
      },
      {
        authority: "token-value-rendering",
        status: "unavailable",
        reason: "declared-token-values-are-not-rendering-authority",
      },
    ],
  };
}

export function projectWorkspaceDocumentation(
  input: WorkspaceDocumentationProjectionInput,
): WorkspaceDocumentation {
  assertExactKeys(
    input,
    ["workspace", "plan", "canonicalReplay"],
    "Workspace documentation projection input",
  );
  const workspace = validateProductWorkspace(input.workspace);
  const plan = validateCanvasMaterializationPlan(input.plan, workspace);
  const replay = validateCanonicalReplay(input.canonicalReplay, plan);
  const body = documentationBody(workspace, plan, replay);
  return parseWorkspaceDocumentation({
    ...body,
    documentationDigest: hashCanonicalValue(body),
  });
}

export function serializeWorkspaceDocumentation(
  input: WorkspaceDocumentation,
): string {
  const documentation = parseWorkspaceDocumentation(input);
  const text = `${canonicalJson(documentation)}\n`;
  if (Buffer.byteLength(text, "utf8") > MAX_CANONICAL_BYTES) {
    throw new RangeError(
      `Workspace documentation exceeds ${MAX_CANONICAL_BYTES} bytes.`,
    );
  }
  return text;
}
