import { z } from "zod";

import {
  ContainedRelativeSourcePathSchema,
  ContentHashSchema,
  GitRevisionSchema,
  IsoTimestampSchema,
  SafeDisplayLabelSchema,
  SafeRoutePathSchema,
} from "./common.js";
import { ArtifactIdSchema, ProjectIdSchema, WorktreeIdSchema } from "./ids.js";

export const IMPORT_JOB_MAX_BYTES = 262_144;
export const IMPORT_JOB_MAX_SCENARIOS = 500;
const IMPORT_JOB_MAX_APPLICATIONS = 64;
const IMPORT_JOB_MAX_LOGS = 500;
const IMPORT_FAILURE_LOG_TAIL_MAX = 32;
const SORTABLE_ID_BODY = "[0-9A-HJKMNP-TV-Z]{26}";
const HOST_ABSOLUTE_PATH = /^(?:\/|[a-z]:[\\/]|\\\\)/iu;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]*$/u;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codepoint = character.codePointAt(0);
    return (
      codepoint !== undefined &&
      (codepoint <= 0x1f || (codepoint >= 0x7f && codepoint <= 0x9f))
    );
  });
}

function isCanonicalRepositoryPath(value: string): boolean {
  if (!HOST_ABSOLUTE_PATH.test(value) || hasControlCharacter(value)) {
    return false;
  }
  const normalized = value.replace(/\\/gu, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    (segments.length === 1 && /^[a-z]:$/iu.test(segments[0] ?? ""))
  ) {
    return false;
  }
  if (normalized.startsWith("//") && segments.length < 3) {
    return false;
  }
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export const ImportJobIdSchema = z
  .string()
  .regex(new RegExp(`^imp_${SORTABLE_ID_BODY}$`, "u"))
  .brand<"ImportJobId">();
export type ImportJobId = z.infer<typeof ImportJobIdSchema>;

/** Stable draft and committed project identity for a durable import job. */
export function projectIdForImportJob(
  jobId: ImportJobId,
): z.infer<typeof ProjectIdSchema> {
  return ProjectIdSchema.parse(`prj_${jobId.slice(4)}`);
}

export const CaptureScenarioIdSchema = z
  .string()
  .regex(new RegExp(`^csc_${SORTABLE_ID_BODY}$`, "u"))
  .brand<"CaptureScenarioId">();
export type CaptureScenarioId = z.infer<typeof CaptureScenarioIdSchema>;

const PilotScenarioIdsSchema = z
  .array(CaptureScenarioIdSchema)
  .min(1)
  .max(IMPORT_JOB_MAX_SCENARIOS)
  .superRefine((scenarioIds, context) => {
    if (new Set(scenarioIds).size !== scenarioIds.length) {
      context.addIssue({
        code: "custom",
        message: "Pilot capture scenario identities must be unique.",
      });
    }
  });

/**
 * A durable, revision-bound subset selected from the one approved import plan.
 * `null` means the job is scoped to every scenario in that plan.
 */
export const ImportPilotScopeSchemaV1 = z.strictObject({
  sourceRevision: GitRevisionSchema.nullable(),
  scenarioIds: PilotScenarioIdsSchema,
});
export type ImportPilotScopeV1 = z.infer<typeof ImportPilotScopeSchemaV1>;
export const ImportPlanTokenSchema = z
  .string()
  .regex(new RegExp(`^ipl_${SORTABLE_ID_BODY}$`, "u"))
  .brand<"ImportPlanToken">();
export type ImportPlanToken = z.infer<typeof ImportPlanTokenSchema>;

export const ImportPlatformSchema = z.enum([
  "expo-ios",
  "react-web",
  "swiftui",
]);
export type ImportPlatform = z.infer<typeof ImportPlatformSchema>;

export const ImportJobStageSchema = z.enum([
  "validate",
  "inventory",
  "plan",
  "prepare-fixtures",
  "build",
  "launch",
  "capture",
  "extract-layers",
  "verify",
  "save",
]);
export type ImportJobStage = z.infer<typeof ImportJobStageSchema>;

export const ImportJobStateSchema = z.enum([
  "queued",
  "running",
  "paused",
  "ready-to-commit",
  "committed",
  "failed",
  "cancelled",
]);
export type ImportJobState = z.infer<typeof ImportJobStateSchema>;

const BoundedIdentifierSchema = z.string().trim().min(1).max(160);
const BoundedMessageSchema = z.string().trim().min(1).max(2_048);
const HostAbsolutePathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => value.trim() === value)
  .refine(isCanonicalRepositoryPath);

export const ImportApplicationSchemaV2 = z.strictObject({
  id: BoundedIdentifierSchema,
  label: SafeDisplayLabelSchema,
  platform: ImportPlatformSchema,
  relativeRoot: z.union([z.literal("."), ContainedRelativeSourcePathSchema]),
});
export type ImportApplicationV2 = z.infer<typeof ImportApplicationSchemaV2>;

const CaptureSourceAnchorSchemaV2 = z.strictObject({
  relativePath: ContainedRelativeSourcePathSchema,
  symbol: z.string().trim().min(1).max(512).nullable(),
  contentHash: ContentHashSchema,
});

const CaptureViewportSchemaV2 = z.strictObject({
  name: BoundedIdentifierSchema,
  width: z.number().int().positive().max(16_384),
  height: z.number().int().positive().max(16_384),
  scale: z.number().positive().finite().max(8),
});

const CaptureParameterSchemaV2 = z.strictObject({
  key: BoundedIdentifierSchema,
  value: z.string().max(2_048),
});

export const CaptureScenarioSchemaV2 = z
  .strictObject({
    id: CaptureScenarioIdSchema,
    applicationId: BoundedIdentifierSchema,
    route: SafeRoutePathSchema,
    state: SafeDisplayLabelSchema,
    viewport: CaptureViewportSchemaV2,
    authContext: BoundedIdentifierSchema.nullable(),
    parameters: z.array(CaptureParameterSchemaV2).max(64),
    fixtureProfile: BoundedIdentifierSchema,
    readinessSelector: z.string().trim().min(1).max(1_024).nullable(),
    sourceAnchor: CaptureSourceAnchorSchemaV2.nullable(),
  })
  .superRefine(({ parameters }, context) => {
    if (
      new Set(parameters.map((parameter) => parameter.key)).size !==
      parameters.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["parameters"],
        message: "Capture scenario parameter keys must be unique.",
      });
    }
  });
export type CaptureScenarioV2 = z.infer<typeof CaptureScenarioSchemaV2>;

export const CaptureArtifactSchemaV2 = z.strictObject({
  id: ArtifactIdSchema,
  scenarioId: CaptureScenarioIdSchema,
  screenshotArtifactId: ArtifactIdSchema,
  hierarchyArtifactId: ArtifactIdSchema.nullable(),
  geometryArtifactId: ArtifactIdSchema.nullable(),
  reconstructionArtifactId: ArtifactIdSchema.nullable().default(null),
  screenshotHash: ContentHashSchema,
  sourceRevision: GitRevisionSchema,
  fixtureFingerprint: ContentHashSchema,
  dimensions: z.strictObject({
    width: z.number().int().positive().max(65_536),
    height: z.number().int().positive().max(65_536),
    scale: z.number().positive().finite().max(8),
  }),
  verification: z.strictObject({
    stableFrameHash: ContentHashSchema,
    routeMatched: z.literal(true),
    blankRejected: z.literal(true),
    splashRejected: z.literal(true),
    errorBoundaryRejected: z.literal(true),
    verifiedAt: IsoTimestampSchema,
  }),
});
export type CaptureArtifactV2 = z.infer<typeof CaptureArtifactSchemaV2>;

export const CaptureFailureSchemaV1 = z.strictObject({
  scenarioId: CaptureScenarioIdSchema.nullable(),
  code: z.string().regex(FAILURE_CODE).max(96),
  stage: ImportJobStageSchema,
  message: BoundedMessageSchema,
  remediation: BoundedMessageSchema,
  logTail: z.array(z.string().max(2_048)).max(IMPORT_FAILURE_LOG_TAIL_MAX),
  retryable: z.boolean(),
  occurredAt: IsoTimestampSchema,
});
export type CaptureFailureV1 = z.infer<typeof CaptureFailureSchemaV1>;

const ImportLogEntrySchemaV2 = z.strictObject({
  level: z.enum(["debug", "info", "warning", "error"]),
  message: BoundedMessageSchema,
  occurredAt: IsoTimestampSchema,
});

const ImportProgressSchemaV2 = z.strictObject({
  total: z.number().int().nonnegative().max(IMPORT_JOB_MAX_SCENARIOS),
  captured: z.number().int().nonnegative().max(IMPORT_JOB_MAX_SCENARIOS),
  failed: z.number().int().nonnegative().max(IMPORT_JOB_MAX_SCENARIOS),
  remaining: z.number().int().nonnegative().max(IMPORT_JOB_MAX_SCENARIOS),
});

const ImportRepositoryAuthoritySchemaV2 = z.strictObject({
  rootPath: HostAbsolutePathSchema,
  sourceRevision: GitRevisionSchema.nullable(),
  dirtyFingerprint: ContentHashSchema.nullable(),
});

const SelectedHarnessSchemaV1 = z.strictObject({
  harnessId: BoundedIdentifierSchema,
  modelId: BoundedIdentifierSchema,
});

const importJobDraftShape = {
  kind: z.literal("memi-import-job"),
  id: ImportJobIdSchema,
  projectId: ProjectIdSchema.nullable(),
  projectName: SafeDisplayLabelSchema,
  state: ImportJobStateSchema,
  stage: ImportJobStageSchema,
  repository: ImportRepositoryAuthoritySchemaV2,
  managedWorktreeId: WorktreeIdSchema.nullable(),
  selectedHarness: SelectedHarnessSchemaV1.nullable(),
  pilotScope: ImportPilotScopeSchemaV1.nullable().default(null),
  applications: z
    .array(ImportApplicationSchemaV2)
    .max(IMPORT_JOB_MAX_APPLICATIONS),
  scenarios: z.array(CaptureScenarioSchemaV2).max(IMPORT_JOB_MAX_SCENARIOS),
  artifacts: z.array(CaptureArtifactSchemaV2).max(IMPORT_JOB_MAX_SCENARIOS),
  failures: z.array(CaptureFailureSchemaV1).max(IMPORT_JOB_MAX_SCENARIOS),
  progress: ImportProgressSchemaV2,
  currentApplicationId: BoundedIdentifierSchema.nullable(),
  currentScenarioId: CaptureScenarioIdSchema.nullable(),
  checkpoints: z
    .array(ImportJobStageSchema)
    .max(ImportJobStageSchema.options.length),
  logs: z.array(ImportLogEntrySchemaV2).max(IMPORT_JOB_MAX_LOGS),
  cancellationRequestedAt: IsoTimestampSchema.nullable(),
  createdAt: IsoTimestampSchema,
} as const;

function validateImportJob(
  job: {
    readonly applications: readonly ImportApplicationV2[];
    readonly scenarios: readonly CaptureScenarioV2[];
    readonly artifacts: readonly CaptureArtifactV2[];
    readonly failures: readonly CaptureFailureV1[];
    readonly progress: z.infer<typeof ImportProgressSchemaV2>;
    readonly currentApplicationId: string | null;
    readonly currentScenarioId: CaptureScenarioId | null;
    readonly checkpoints: readonly ImportJobStage[];
    readonly state: ImportJobState;
    readonly projectId: z.infer<typeof ProjectIdSchema> | null;
    readonly pilotScope: ImportPilotScopeV1 | null;
    readonly repository: {
      readonly sourceRevision: string | null;
    };
  },
  context: z.RefinementCtx,
): void {
  const applicationIds = job.applications.map((application) => application.id);
  const scenarioIds = job.scenarios.map((scenario) => scenario.id);
  const scenarioIdSet = new Set<string>(scenarioIds);
  const artifactScenarioIds = job.artifacts.map(
    (artifact) => artifact.scenarioId,
  );
  const failedScenarioIds = job.failures.flatMap((failure) =>
    failure.scenarioId === null ? [] : [failure.scenarioId],
  );
  const add = (path: (string | number)[], message: string): void => {
    context.addIssue({ code: "custom", path, message });
  };

  if (new Set(applicationIds).size !== applicationIds.length) {
    add(["applications"], "Import application identities must be unique.");
  }
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    add(["scenarios"], "Capture scenario identities must be unique.");
  }
  if (
    job.scenarios.some(
      (scenario) => !applicationIds.includes(scenario.applicationId),
    )
  ) {
    add(["scenarios"], "Capture scenarios must bind to known applications.");
  }
  if (job.pilotScope !== null) {
    const scopedScenarioIds = job.pilotScope.scenarioIds;
    if (job.pilotScope.sourceRevision !== job.repository.sourceRevision) {
      add(
        ["pilotScope", "sourceRevision"],
        "Pilot capture scope must match the job source revision.",
      );
    }
    if (
      scopedScenarioIds.length !== scenarioIds.length ||
      scopedScenarioIds.some((scenarioId) => !scenarioIdSet.has(scenarioId))
    ) {
      add(
        ["pilotScope", "scenarioIds"],
        "Pilot capture scope must exactly match the job scenarios.",
      );
    }
  }
  if (
    job.artifacts.some((artifact) => !scenarioIdSet.has(artifact.scenarioId)) ||
    job.failures.some(
      (failure) =>
        failure.scenarioId !== null && !scenarioIdSet.has(failure.scenarioId),
    )
  ) {
    add(["artifacts"], "Capture evidence must bind to a known scenario.");
  }
  if (
    new Set(artifactScenarioIds).size !== artifactScenarioIds.length ||
    new Set(failedScenarioIds).size !== failedScenarioIds.length ||
    artifactScenarioIds.some((id) => failedScenarioIds.includes(id))
  ) {
    add(["artifacts"], "A scenario may have only one terminal capture result.");
  }
  for (const [artifactIndex, artifact] of job.artifacts.entries()) {
    const scenario = job.scenarios.find(
      (candidate) => candidate.id === artifact.scenarioId,
    );
    if (
      job.repository.sourceRevision === null ||
      artifact.sourceRevision !== job.repository.sourceRevision
    ) {
      add(
        ["artifacts", artifactIndex, "sourceRevision"],
        "Capture evidence must match the repository source revision.",
      );
    }
    if (
      scenario !== undefined &&
      (artifact.dimensions.width !==
        scenario.viewport.width * scenario.viewport.scale ||
        artifact.dimensions.height !==
          scenario.viewport.height * scenario.viewport.scale ||
        artifact.dimensions.scale !== scenario.viewport.scale)
    ) {
      add(
        ["artifacts", artifactIndex, "dimensions"],
        "Capture dimensions must match the scenario viewport.",
      );
    }
    if (artifact.verification.stableFrameHash !== artifact.screenshotHash) {
      add(
        ["artifacts", artifactIndex, "verification", "stableFrameHash"],
        "Stable-frame evidence must hash the captured screenshot.",
      );
    }
  }
  if (
    job.progress.total !== job.scenarios.length ||
    job.progress.captured !== artifactScenarioIds.length ||
    job.progress.failed !== failedScenarioIds.length ||
    job.progress.captured + job.progress.failed + job.progress.remaining !==
      job.progress.total
  ) {
    add(
      ["progress"],
      "Import progress must equal its scenario and evidence counts.",
    );
  }
  if (
    job.currentApplicationId !== null &&
    !applicationIds.includes(job.currentApplicationId)
  ) {
    add(["currentApplicationId"], "The current import application is unknown.");
  }
  if (
    job.currentScenarioId !== null &&
    !scenarioIdSet.has(job.currentScenarioId)
  ) {
    add(["currentScenarioId"], "The current capture scenario is unknown.");
  }
  if (new Set(job.checkpoints).size !== job.checkpoints.length) {
    add(["checkpoints"], "Import checkpoints must be unique.");
  }
  if (
    (job.state === "ready-to-commit" || job.state === "committed") &&
    job.progress.remaining !== 0
  ) {
    add(["state"], "Only terminal scenario sets can be committed.");
  }
  if ((job.state === "committed") !== (job.projectId !== null)) {
    add(["projectId"], "Only committed imports bind a created project.");
  }
}

export const ImportJobDraftSchemaV2 = z
  .strictObject(importJobDraftShape)
  .superRefine(validateImportJob);
export type ImportJobDraftV2 = z.infer<typeof ImportJobDraftSchemaV2>;

export const ImportJobSnapshotSchemaV2 = z
  .strictObject({
    ...importJobDraftShape,
    revision: z.number().int().positive().safe(),
    updatedAt: IsoTimestampSchema,
  })
  .superRefine(validateImportJob);
export type ImportJobSnapshotV2 = z.infer<typeof ImportJobSnapshotSchemaV2>;

/**
 * Bounded Home/import-workspace descriptor. Full jobs include scenario,
 * evidence, and redacted-log payloads, which are fetched by ID only when a
 * screen needs to render or hydrate that import.
 */
export const ImportJobListItemSchemaV1 = z.strictObject({
  id: ImportJobIdSchema,
  projectId: ProjectIdSchema.nullable(),
  projectName: SafeDisplayLabelSchema,
  state: ImportJobStateSchema,
  stage: ImportJobStageSchema,
  sourceRevision: GitRevisionSchema.nullable(),
  progress: ImportProgressSchemaV2,
  currentApplicationId: BoundedIdentifierSchema.nullable(),
  currentScenarioId: CaptureScenarioIdSchema.nullable(),
  failureCount: z
    .number()
    .int()
    .nonnegative()
    .max(IMPORT_JOB_MAX_SCENARIOS),
  revision: z.number().int().positive().safe(),
  updatedAt: IsoTimestampSchema,
});
export type ImportJobListItemV1 = z.infer<
  typeof ImportJobListItemSchemaV1
>;

export interface SaveImportJobRequestV2 {
  readonly expectedRevision: number | null;
  readonly job: ImportJobDraftV2;
}

export interface ImportJobStoreV2 {
  get(jobId: ImportJobId): Promise<ImportJobSnapshotV2 | null>;
  listAll(): Promise<readonly ImportJobSnapshotV2[]>;
  save(request: SaveImportJobRequestV2): Promise<ImportJobSnapshotV2>;
  delete(jobId: ImportJobId, expectedRevision: number): Promise<void>;
  purgeAll(): Promise<number>;
}

const PlannedRecipeDisplaySchemaV1 = z.strictObject({
  applicationId: BoundedIdentifierSchema,
  applicationLabel: SafeDisplayLabelSchema,
  adapterId: BoundedIdentifierSchema,
  adapterVersion: BoundedIdentifierSchema,
  executable: z.enum(["npm", "npx", "xcodebuild"]),
  resolvedExecutable: HostAbsolutePathSchema,
  args: z.array(z.string().min(1).max(4_096)).max(128),
  cwd: HostAbsolutePathSchema,
  purpose: z.enum(["build", "launch"]),
  hash: ContentHashSchema,
  expiresAt: IsoTimestampSchema,
});
export type PlannedRecipeDisplayV1 = z.infer<
  typeof PlannedRecipeDisplaySchemaV1
>;

const NativeDependencyPreparationPolicyDisplaySchemaV1 = z.strictObject({
  contract: z.literal("memi.native-dependency-preparation-policy.v1"),
  network: z.literal("locked-dependency-downloads"),
  npmLifecycleScripts: z.literal("disabled"),
  cocoapodsHooks: z.literal("enabled"),
  requireLockfiles: z.literal(true),
  sandboxProfileFingerprint: ContentHashSchema,
});

const NativeDependencyPreparationRiskDisplaySchemaV1 = z.strictObject({
  network: z.enum([
    "downloads-lockfile-pinned-packages",
    "may-download-lockfile-pinned-pod-artifacts",
    "none",
  ]),
  scripts: z.enum([
    "npm-lifecycle-scripts-disabled",
    "cocoapods-hooks-and-podspec-code-enabled",
    "deterministic-hermes-release-selection",
  ]),
  writes: z.array(z.string().trim().min(1).max(1_024)).min(1).max(16),
});

const NativeDependencyPreparationCommandDisplaySchemaV1 = z.strictObject({
  id: z.enum(["npm-ci", "pod-install", "hermes-release-selection"]),
  executable: HostAbsolutePathSchema,
  args: z.array(z.string().min(1).max(4_096)).max(256),
  cwd: HostAbsolutePathSchema,
  lockfileRelativePaths: z
    .array(ContainedRelativeSourcePathSchema)
    .min(1)
    .max(16),
  risk: NativeDependencyPreparationRiskDisplaySchemaV1,
});

const NativeDependencyLockfileDisplaySchemaV1 = z.strictObject({
  relativePath: ContainedRelativeSourcePathSchema,
  sha256: ContentHashSchema,
  byteLength: z
    .number()
    .int()
    .positive()
    .safe()
    .max(64 * 1_024 * 1_024),
});

export const NativeDependencyPreparationDisplaySchemaV1 = z.strictObject({
  applicationId: BoundedIdentifierSchema,
  applicationLabel: SafeDisplayLabelSchema,
  adapterVersion: BoundedIdentifierSchema,
  planFingerprint: ContentHashSchema,
  repositoryRevision: GitRevisionSchema,
  policy: NativeDependencyPreparationPolicyDisplaySchemaV1,
  lockfiles: z.array(NativeDependencyLockfileDisplaySchemaV1).min(1).max(16),
  commands: z
    .array(NativeDependencyPreparationCommandDisplaySchemaV1)
    .min(1)
    .max(8),
});
export type NativeDependencyPreparationDisplayV1 = z.infer<
  typeof NativeDependencyPreparationDisplaySchemaV1
>;

const ImportPlanErrorSchemaV1 = z.strictObject({
  code: z.string().regex(FAILURE_CODE).max(96),
  message: BoundedMessageSchema,
  remediation: BoundedMessageSchema,
  retryable: z.boolean(),
});

const ImportInventoryItemSchemaV1 = z.strictObject({
  id: BoundedIdentifierSchema,
  name: SafeDisplayLabelSchema,
  sourcePath: ContainedRelativeSourcePathSchema,
});

const ImportInventoryScreenSchemaV1 = ImportInventoryItemSchemaV1.extend({
  route: SafeRoutePathSchema,
});

export const ImportInventorySchemaV1 = z.strictObject({
  fileCount: z.number().int().nonnegative().max(20_000),
  screenCount: z.number().int().nonnegative().max(IMPORT_JOB_MAX_SCENARIOS),
  componentCount: z.number().int().nonnegative().max(20_000),
  tokenCount: z.number().int().nonnegative().max(20_000),
  screens: z.array(ImportInventoryScreenSchemaV1).max(500),
  components: z.array(ImportInventoryItemSchemaV1).max(250),
  tokens: z.array(ImportInventoryItemSchemaV1).max(100),
  truncated: z.strictObject({
    screens: z.boolean(),
    components: z.boolean(),
    tokens: z.boolean(),
  }),
});
export type ImportInventoryV1 = z.infer<typeof ImportInventorySchemaV1>;

/** Safe display descriptor used to select a capture scenario from an approved plan. */
export const ImportPlanScenarioSchemaV1 = z.strictObject({
  id: CaptureScenarioIdSchema,
  applicationId: BoundedIdentifierSchema,
  route: SafeRoutePathSchema,
  state: SafeDisplayLabelSchema,
  viewport: CaptureViewportSchemaV2,
  sourceAnchor: CaptureSourceAnchorSchemaV2.nullable(),
});
export type ImportPlanScenarioV1 = z.infer<
  typeof ImportPlanScenarioSchemaV1
>;

export const ImportPlanResultSchemaV1 = z.strictObject({
  plan: z.strictObject({
    token: ImportPlanTokenSchema,
    repository: ImportRepositoryAuthoritySchemaV2,
    applications: z
      .array(ImportApplicationSchemaV2)
      .max(IMPORT_JOB_MAX_APPLICATIONS),
    scenarios: z
      .array(ImportPlanScenarioSchemaV1)
      .max(IMPORT_JOB_MAX_SCENARIOS),
    recipes: z
      .array(PlannedRecipeDisplaySchemaV1)
      .max(IMPORT_JOB_MAX_APPLICATIONS),
    dependencyPreparations: z
      .array(NativeDependencyPreparationDisplaySchemaV1)
      .max(IMPORT_JOB_MAX_APPLICATIONS)
      .optional(),
    inventory: ImportInventorySchemaV1,
    scenarioCount: z.number().int().nonnegative().max(IMPORT_JOB_MAX_SCENARIOS),
    errors: z.array(ImportPlanErrorSchemaV1).max(IMPORT_JOB_MAX_APPLICATIONS),
  }),
});
export type ImportPlanResultV1 = z.infer<typeof ImportPlanResultSchemaV1>;

export const ImportsPlanPayloadSchemaV1 = z.strictObject({
  repositoryPath: HostAbsolutePathSchema,
  expoRuntime: z.literal("existing-development-client").optional(),
});
export const ImportsListPayloadSchemaV1 = z.strictObject({});
export const ImportsStartPayloadSchemaV2 = z.strictObject({
  repositoryPath: HostAbsolutePathSchema,
  projectName: SafeDisplayLabelSchema,
  selectedHarness: SelectedHarnessSchemaV1.nullable(),
  planToken: ImportPlanTokenSchema,
  approvedRecipeHashes: z.array(ContentHashSchema).max(256),
  pilotScenarioIds: PilotScenarioIdsSchema.optional(),
});
export const ImportsGetPayloadSchemaV2 = z.strictObject({
  jobId: ImportJobIdSchema,
});
const ImportMutationPayloadSchemaV2 = z.strictObject({
  jobId: ImportJobIdSchema,
  expectedRevision: z.number().int().positive().safe(),
});
export const ImportsCancelPayloadSchemaV2 = ImportMutationPayloadSchemaV2;
export const ImportsDiscardPayloadSchemaV2 = ImportMutationPayloadSchemaV2;
export const ImportsResumePayloadSchemaV2 = ImportMutationPayloadSchemaV2;
export const ImportsCommitPayloadSchemaV2 = ImportMutationPayloadSchemaV2;
export const ImportsRetryFailedPayloadSchemaV2 =
  ImportMutationPayloadSchemaV2.extend({
    scenarioIds: z
      .array(CaptureScenarioIdSchema)
      .min(1)
      .max(IMPORT_JOB_MAX_SCENARIOS)
      .optional(),
  });
export const ImportsPurgeAllPayloadSchemaV1 = z.strictObject({});

export const ImportJobResultSchemaV2 = z.strictObject({
  job: ImportJobSnapshotSchemaV2,
});
export const ImportJobsListResultSchemaV1 = z.strictObject({
  jobs: z.array(ImportJobListItemSchemaV1).max(256),
});
const ImportPurgeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .safe()
  .max(1_000_000);
const ImportPurgeFailureCategorySchema = z.enum([
  "authority",
  "simulator-authority",
  "managed-worktrees",
  "artifacts",
  "plans",
  "jobs",
]);
const ImportPurgeFailureSchemaV1 = z.strictObject({
  category: ImportPurgeFailureCategorySchema,
  code: z.string().regex(FAILURE_CODE).max(96),
  message: BoundedMessageSchema,
});
export const ImportPurgeAllResultSchemaV1 = z
  .strictObject({
    complete: z.boolean(),
    counts: z.strictObject({
      artifacts: ImportPurgeCountSchema,
      jobs: ImportPurgeCountSchema,
      managedWorktrees: ImportPurgeCountSchema,
      pendingPlans: ImportPurgeCountSchema,
      plans: ImportPurgeCountSchema,
      projectBindings: ImportPurgeCountSchema,
      simulatorAuthorities: ImportPurgeCountSchema,
    }),
    failures: z.array(ImportPurgeFailureSchemaV1).max(8),
  })
  .superRefine(({ complete, failures }, context) => {
    if (complete !== (failures.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["complete"],
        message:
          "Import purge completion must exactly match its failure evidence.",
      });
    }
  });
export type ImportPurgeAllResultV1 = z.infer<
  typeof ImportPurgeAllResultSchemaV1
>;
const ImportPausedJobResultSchemaV2 = z.strictObject({
  job: ImportJobSnapshotSchemaV2.refine(
    (job) => job.state === "paused",
    "Cancelled imports must return a paused durable job.",
  ),
});
const ImportCancelledJobResultSchemaV2 = z.strictObject({
  job: ImportJobSnapshotSchemaV2.refine(
    (job) => job.state === "cancelled",
    "Discarded imports must return a terminal cancelled receipt.",
  ),
});
const ImportRunningJobResultSchemaV2 = z.strictObject({
  job: ImportJobSnapshotSchemaV2.refine(
    (job) => job.state === "running",
    "Resumed and retried imports must return a running durable job.",
  ),
});
const ImportCommittedJobResultSchemaV2 = z.strictObject({
  job: ImportJobSnapshotSchemaV2.refine(
    (job) => job.state === "committed" && job.projectId !== null,
    "Committed imports require an atomically bound project.",
  ),
});

export function createImportRuntimeRequestSchemas<Base extends z.ZodRawShape>(
  base: Base,
) {
  const branch = <const Method extends string, Payload extends z.ZodType>(
    method: Method,
    payload: Payload,
  ) =>
    z.strictObject({
      ...base,
      method: z.literal(method),
      payload,
    });
  return [
    branch("imports.plan", ImportsPlanPayloadSchemaV1),
    branch("imports.list", ImportsListPayloadSchemaV1),
    branch("imports.start", ImportsStartPayloadSchemaV2),
    branch("imports.get", ImportsGetPayloadSchemaV2),
    branch("imports.cancel", ImportsCancelPayloadSchemaV2),
    branch("imports.discard", ImportsDiscardPayloadSchemaV2),
    branch("imports.resume", ImportsResumePayloadSchemaV2),
    branch("imports.retryFailed", ImportsRetryFailedPayloadSchemaV2),
    branch("imports.commit", ImportsCommitPayloadSchemaV2),
    branch("imports.purgeAll", ImportsPurgeAllPayloadSchemaV1),
  ] as const;
}

export function createImportRuntimeSuccessSchemas<Base extends z.ZodRawShape>(
  base: Base,
) {
  const branch = <const Method extends string, Result extends z.ZodType>(
    method: Method,
    result: Result,
  ) =>
    z.strictObject({
      ...base,
      method: z.literal(method),
      ok: z.literal(true),
      result,
    });
  return [
    branch("imports.plan", ImportPlanResultSchemaV1),
    branch("imports.list", ImportJobsListResultSchemaV1),
    branch("imports.start", ImportJobResultSchemaV2),
    branch("imports.get", ImportJobResultSchemaV2),
    branch("imports.cancel", ImportPausedJobResultSchemaV2),
    branch("imports.discard", ImportCancelledJobResultSchemaV2),
    branch("imports.resume", ImportRunningJobResultSchemaV2),
    branch("imports.retryFailed", ImportRunningJobResultSchemaV2),
    branch("imports.commit", ImportCommittedJobResultSchemaV2),
    branch("imports.purgeAll", ImportPurgeAllResultSchemaV1),
  ] as const;
}
