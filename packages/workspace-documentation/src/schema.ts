import { z } from "zod";

import { assertPlainDataTree } from "./data.js";
import {
  MAX_WORKSPACE_DOCUMENTATION_BYTES,
  browserCanonicalJson,
  hashBrowserCanonicalValue,
} from "./hash.js";
import { deepFreeze } from "./immutable.js";

const ID_BODY = "[0-9A-HJKMNP-TV-Z]{26}";
const ContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const ProjectIdSchema = z.string().regex(new RegExp(`^prj_${ID_BODY}$`, "u"));
const RouteIdSchema = z.string().regex(new RegExp(`^rte_${ID_BODY}$`, "u"));
const StateIdSchema = z.string().regex(new RegExp(`^sta_${ID_BODY}$`, "u"));
const FlowIdSchema = z.string().regex(new RegExp(`^flw_${ID_BODY}$`, "u"));
const CoverageCellIdSchema = z
  .string()
  .regex(new RegExp(`^cov_${ID_BODY}$`, "u"));
const DocumentIdSchema = z.string().regex(new RegExp(`^doc_${ID_BODY}$`, "u"));
const NodeIdSchema = z.string().regex(new RegExp(`^nod_${ID_BODY}$`, "u"));
const OperationIdSchema = z.string().regex(new RegExp(`^opn_${ID_BODY}$`, "u"));
const EventIdSchema = z.string().regex(new RegExp(`^evt_${ID_BODY}$`, "u"));
const CommandIdSchema = z.string().regex(new RegExp(`^cmd_${ID_BODY}$`, "u"));
const ArtifactIdSchema = z.string().regex(new RegExp(`^art_${ID_BODY}$`, "u"));

const SENSITIVE_TEXT =
  /(?:\/Users\/|\/Volumes\/|file:\/\/|BEGIN [A-Z ]*PRIVATE KEY|authorization|password|api[_-]?key|\bsecret\b|sk-[A-Za-z0-9_-]{16,})/iu;

function safeText(maximum = 2_048) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !SENSITIVE_TEXT.test(value),
      "Sensitive text or host path is not allowed.",
    );
}

const RelativeSourcePathSchema = safeText(1_024).refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    ),
  "Sensitive path must be a contained relative source path.",
);

const DimensionsSchema = z.strictObject({
  roles: z.array(safeText(160)),
  themes: z.array(safeText(160)),
  locales: z.array(safeText(160)),
  flags: z.array(safeText(160)),
  fixtures: z.array(safeText(160)),
});

const ProjectionDigestsSchema = z.strictObject({
  product: ContentHashSchema,
  route: ContentHashSchema,
  state: ContentHashSchema,
  flow: ContentHashSchema,
  designSystem: ContentHashSchema,
  capture: ContentHashSchema,
  coverage: ContentHashSchema,
});

const RepositorySourceSchema = z.strictObject({
  kind: z.literal("repository"),
  revision: z.string().regex(/^[a-f0-9]{40}$/u),
  dirty: z.boolean(),
  dirtyFileFingerprint: ContentHashSchema,
});

const StaticSourceSchema = z.strictObject({
  kind: z.enum(["static-build", "screenshot-folder"]),
  contentFingerprint: ContentHashSchema,
});

const RunningSourceSchema = z.strictObject({
  kind: z.literal("running-url"),
  loopbackOrigin: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      const loopback =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1" ||
        url.hostname === "[::1]";
      return (
        loopback &&
        url.origin === value &&
        url.username === "" &&
        url.password === "" &&
        url.pathname === "/" &&
        url.search === "" &&
        url.hash === ""
      );
    }, "Running source must remain loopback-local."),
});

const ProjectSourceSchema = z.union([
  RepositorySourceSchema,
  StaticSourceSchema,
  RunningSourceSchema,
  z.strictObject({ kind: z.literal("blank") }),
]);

const FrameworkSchema = z.strictObject({
  kind: z.enum([
    "vite-react",
    "nextjs",
    "storybook",
    "static-html",
    "unknown",
  ]),
  confidence: z.enum(["verified", "inferred", "unknown"]),
});

const SourceBindingsSchema = z.strictObject({
  workspaceDigest: ContentHashSchema,
  planId: z.string().regex(new RegExp(`^mpl_${ID_BODY}$`, "u")),
  planDigest: ContentHashSchema,
  documentId: DocumentIdSchema,
  sourceRevision: safeText(160),
  sourceContentFingerprint: ContentHashSchema,
  compilerFingerprint: ContentHashSchema,
  projectionIntegrityDigests: ProjectionDigestsSchema,
});

const ProjectSchema = z.strictObject({
  id: ProjectIdSchema,
  importMode: z.enum([
    "repository",
    "storybook",
    "static-build",
    "running-url",
    "screenshot-folder",
    "blank",
  ]),
  source: ProjectSourceSchema,
  framework: FrameworkSchema.optional(),
  dimensions: DimensionsSchema,
});

const RouteSchema = z.strictObject({
  id: RouteIdSchema,
  displayName: safeText(160),
  path: z
    .string()
    .min(1)
    .max(2_048)
    .startsWith("/")
    .refine(
      (value) => !value.startsWith("//") && !SENSITIVE_TEXT.test(value),
      "Sensitive route path is not allowed.",
    ),
});

const StateSchema = z.strictObject({
  id: StateIdSchema,
  name: safeText(160),
  kind: z.enum([
    "default",
    "loading",
    "empty",
    "error",
    "success",
    "overlay",
    "validation",
    "permission",
  ]),
  provenance: z.enum(["declared", "observed", "inferred"]),
});

const ViewportSchema = z.strictObject({
  name: z.enum(["desktop", "tablet", "mobile"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const CaptureSchema = z.strictObject({
  status: z.enum(["unavailable", "observed", "inferred", "blocked"]),
  reason: safeText(512).optional(),
  evidenceArtifactIds: z.array(ArtifactIdSchema),
  evidenceHash: ContentHashSchema.optional(),
});

const TraceRefSchema = z.strictObject({
  sequence: z.number().int().positive(),
  eventId: EventIdSchema,
  eventHash: ContentHashSchema,
  operationId: OperationIdSchema,
});

const MaterializationSchema = z.strictObject({
  status: z.enum([
    "committed",
    "planned-not-committed",
    "unmaterialized",
  ]),
  nodeId: NodeIdSchema.nullable(),
  operationId: OperationIdSchema.nullable(),
  traceRef: TraceRefSchema.nullable(),
});

const WorkspaceScreenSchema = z.strictObject({
  id: CoverageCellIdSchema,
  route: RouteSchema,
  state: StateSchema,
  viewport: ViewportSchema,
  context: z.strictObject({
    role: safeText(160),
    theme: safeText(160),
    locale: safeText(160),
    fixture: safeText(160),
  }),
  capture: CaptureSchema,
  materialization: MaterializationSchema,
});

const FlowStepSchema = z.strictObject({
  order: z.number().int().positive(),
  routeId: RouteIdSchema,
  stateId: StateIdSchema,
  trigger: safeText(128),
  assertion: safeText(128),
});

const WorkspaceFlowSchema = z.strictObject({
  id: FlowIdSchema,
  name: safeText(160),
  status: z.literal("declared"),
  observationStatus: z.literal("not-observed"),
  steps: z.array(FlowStepSchema),
});

const DesignSystemSchema = z.strictObject({
  tokens: z.array(
    z.strictObject({
      name: safeText(256),
      cssVariable: z.string().regex(/^--[a-z0-9-]+$/u),
      sourceFile: RelativeSourcePathSchema,
      status: z.literal("declared"),
    }),
  ),
  components: z.strictObject({
    status: z.literal("unavailable"),
    items: z.tuple([]),
  }),
});

const CanonicalTraceReferenceSchema = z.strictObject({
  sequence: z.number().int().positive(),
  eventId: EventIdSchema,
  eventHash: ContentHashSchema,
  previousEventHash: ContentHashSchema.nullable(),
  operationId: OperationIdSchema,
  commandId: CommandIdSchema,
  resultingHash: ContentHashSchema,
});

const TraceSchema = z.strictObject({
  projectId: ProjectIdSchema,
  lastSequence: z.number().int().nonnegative(),
  lastEventHash: ContentHashSchema.nullable(),
  refs: z.array(CanonicalTraceReferenceSchema),
});

const CoverageSchema = z.strictObject({
  routes: z.number().int().nonnegative(),
  states: z.number().int().nonnegative(),
  screenCells: z.number().int().nonnegative(),
  captures: z.strictObject({
    unavailable: z.number().int().nonnegative(),
    observed: z.number().int().nonnegative(),
    inferred: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
  }),
  materialization: z.strictObject({
    planned: z.number().int().nonnegative(),
    committed: z.number().int().nonnegative(),
    plannedNotCommitted: z.number().int().nonnegative(),
    unmaterialized: z.number().int().nonnegative(),
  }),
  flows: z.strictObject({
    declared: z.number().int().nonnegative(),
    observed: z.literal(0),
  }),
  tokens: z.strictObject({
    declared: z.number().int().nonnegative(),
  }),
  components: z.strictObject({
    available: z.literal(0),
    status: z.literal("unavailable"),
  }),
});

const AbstentionSchema = z.strictObject({
  authority: z.enum([
    "visual-verification",
    "flow-observation",
    "component-inventory",
    "token-value-rendering",
  ]),
  status: z.literal("unavailable"),
  reason: safeText(256),
});

const WorkspaceDocumentationValueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("workspace-documentation"),
  documentationDigest: ContentHashSchema,
  sourceBindings: SourceBindingsSchema,
  project: ProjectSchema,
  screens: z.array(WorkspaceScreenSchema),
  flows: z.array(WorkspaceFlowSchema),
  designSystem: DesignSystemSchema,
  trace: TraceSchema,
  coverage: CoverageSchema,
  abstentions: z.array(AbstentionSchema),
});

export type WorkspaceDocumentation = z.infer<
  typeof WorkspaceDocumentationValueSchema
>;
export type WorkspaceScreen = z.infer<typeof WorkspaceScreenSchema>;
export type WorkspaceCaptureStatus = WorkspaceScreen["capture"]["status"];

function count<Value extends string>(
  values: readonly Value[],
  expected: Value,
): number {
  return values.filter((value) => value === expected).length;
}

function assertMaterialization(screen: WorkspaceScreen): void {
  const { status, nodeId, operationId, traceRef } =
    screen.materialization;
  if (status === "unmaterialized") {
    if (nodeId !== null || operationId !== null || traceRef !== null) {
      throw new Error("Unmaterialized screens cannot claim canvas truth.");
    }
    return;
  }
  if (nodeId === null || operationId === null) {
    throw new Error("Planned screens need canonical plan references.");
  }
  if (
    (status === "committed" &&
      (traceRef === null || traceRef.operationId !== operationId)) ||
    (status === "planned-not-committed" && traceRef !== null)
  ) {
    throw new Error("Screen plan and commit status is inconsistent.");
  }
}

function assertCoverage(documentation: WorkspaceDocumentation): void {
  const captures = documentation.screens.map(
    (screen) => screen.capture.status,
  );
  const materialization = documentation.screens.map(
    (screen) => screen.materialization.status,
  );
  const routeIds = new Set(
    documentation.screens.map((screen) => screen.route.id),
  );
  const stateIds = new Set(
    documentation.screens.map((screen) => screen.state.id),
  );
  const planned =
    count(materialization, "committed") +
    count(materialization, "planned-not-committed");
  const captureTotal = Object.values(
    documentation.coverage.captures,
  ).reduce((total, value) => total + value, 0);
  if (
    documentation.coverage.routes !== routeIds.size ||
    documentation.coverage.states !== stateIds.size ||
    documentation.coverage.screenCells !== documentation.screens.length ||
    captureTotal !== captures.length ||
    documentation.coverage.materialization.planned !== planned ||
    documentation.coverage.materialization.committed !==
      count(materialization, "committed") ||
    documentation.coverage.materialization.plannedNotCommitted !==
      count(materialization, "planned-not-committed") ||
    documentation.coverage.materialization.unmaterialized !==
      count(materialization, "unmaterialized") ||
    documentation.coverage.flows.declared !== documentation.flows.length ||
    documentation.coverage.tokens.declared !==
      documentation.designSystem.tokens.length
  ) {
    throw new Error("Workspace documentation counts are inconsistent.");
  }
}

function assertTrace(documentation: WorkspaceDocumentation): void {
  const refs = documentation.trace.refs;
  let pendingPlanEntrySeen = false;
  for (const screen of documentation.screens) {
    if (screen.materialization.status === "unmaterialized") {
      continue;
    }
    if (screen.materialization.status === "planned-not-committed") {
      pendingPlanEntrySeen = true;
    } else if (pendingPlanEntrySeen) {
      throw new Error(
        "Committed screens must be an exact prefix of canonical plan order.",
      );
    }
  }
  if (
    documentation.project.id !== documentation.trace.projectId ||
    documentation.trace.lastSequence !== refs.length ||
    documentation.trace.lastEventHash !== refs.at(-1)?.eventHash &&
      !(refs.length === 0 && documentation.trace.lastEventHash === null)
  ) {
    throw new Error("Workspace documentation trace head is inconsistent.");
  }
  for (const [index, ref] of refs.entries()) {
    if (
      ref.sequence !== index + 1 ||
      ref.previousEventHash !== (refs[index - 1]?.eventHash ?? null)
    ) {
      throw new Error("Workspace documentation trace chain is inconsistent.");
    }
  }
  const committed = documentation.screens
    .filter((screen) => screen.materialization.status === "committed")
    .map((screen) => screen.materialization.traceRef);
  if (
    committed.length !== refs.length ||
    committed.some(
      (ref, index) =>
        ref === null ||
        ref.sequence !== refs[index]?.sequence ||
        ref.eventId !== refs[index]?.eventId ||
        ref.eventHash !== refs[index]?.eventHash ||
        ref.operationId !== refs[index]?.operationId,
    )
  ) {
    throw new Error("Committed screens do not exactly map to canonical trace.");
  }
}

function validateDocumentation(value: unknown): WorkspaceDocumentation {
  assertPlainDataTree(value);
  const result = WorkspaceDocumentationValueSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Workspace documentation is invalid or sensitive: ${result.error.message}`,
    );
  }
  const documentation = value as WorkspaceDocumentation;
  const screenIds = documentation.screens.map((screen) => screen.id);
  if (new Set(screenIds).size !== screenIds.length) {
    throw new Error("Workspace documentation has duplicate screen cells.");
  }
  for (const screen of documentation.screens) {
    assertMaterialization(screen);
  }
  assertCoverage(documentation);
  assertTrace(documentation);
  const { documentationDigest, ...material } = documentation;
  if (documentationDigest !== hashBrowserCanonicalValue(material)) {
    throw new Error("Workspace documentation digest is invalid.");
  }
  const serializedBytes = new TextEncoder().encode(
    browserCanonicalJson(documentation),
  ).byteLength + 1;
  if (serializedBytes > MAX_WORKSPACE_DOCUMENTATION_BYTES) {
    throw new RangeError(
      `Workspace documentation exceeds ${MAX_WORKSPACE_DOCUMENTATION_BYTES} bytes.`,
    );
  }
  return documentation;
}

export const WorkspaceDocumentationSchema =
  z.custom<WorkspaceDocumentation>(
    (value) => {
      try {
        validateDocumentation(value);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Workspace documentation is invalid, unsafe, or sensitive.",
    },
  );

export function parseWorkspaceDocumentation(
  value: unknown,
): WorkspaceDocumentation {
  return deepFreeze(validateDocumentation(value));
}
