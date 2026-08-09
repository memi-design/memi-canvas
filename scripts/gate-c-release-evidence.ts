import { createHash } from "node:crypto";

import {
  ImportJobIdSchema,
  ProjectIdSchema,
  type ImportJobId,
  type ProjectId,
} from "@memi/protocol";

const CONTENT_HASH = /^sha256:[a-f0-9]{64}$/u;
const GIT_REVISION = /^[a-f0-9]{40}$/u;
const MAX_PILOT_EVENT_BYTES = 1_048_576;
const MAX_PILOT_EVENTS = 1_000;

type ContentHash = `sha256:${string}`;

export interface GateCReleaseArtifactReceipt {
  readonly bytes: number;
  readonly extension: string;
  readonly hash: ContentHash;
}

export interface GateCReleaseArtifactInput {
  readonly captureId: string;
  readonly scenarioId: string;
  readonly route: string;
  readonly state: string;
  readonly sourceRevision: string;
  readonly dimensions: {
    readonly width: number;
    readonly height: number;
    readonly scale: number;
  };
  readonly verification: {
    readonly stableFrameHash: ContentHash;
    readonly routeMatched: boolean;
    readonly blankRejected: boolean;
    readonly splashRejected: boolean;
    readonly errorBoundaryRejected: boolean;
    readonly verifiedAt: string;
  };
  readonly screenshot: GateCReleaseArtifactReceipt;
  readonly hierarchy: GateCReleaseArtifactReceipt | null;
  readonly geometry: GateCReleaseArtifactReceipt | null;
  readonly reconstruction: GateCReleaseArtifactReceipt | null;
}

export interface GateCReleaseEvidenceInput {
  readonly projectId: string;
  readonly jobId: string;
  readonly jobRevision: number;
  readonly sourceRevision: string;
  readonly dirtyFingerprint: ContentHash | null;
  readonly completedAt: string;
  readonly progress: {
    readonly total: number;
    readonly captured: number;
    readonly failed: number;
    readonly remaining: number;
  };
  readonly hydration: {
    readonly artifacts: number;
    readonly components: number;
    readonly screens: number;
  };
  readonly artifacts: readonly GateCReleaseArtifactInput[];
  readonly databaseReceipts: readonly {
    readonly name: string;
    readonly hash: ContentHash;
    readonly bytes: number;
  }[];
}

export interface GateCReleaseEvidenceManifest {
  readonly schema: "memi.gate-c-release-evidence.v1";
  readonly sourceAuthorityHash: ContentHash;
  readonly captureAuthorityHash: ContentHash;
  readonly jobRevision: number;
  readonly completedAt: string;
  readonly progress: GateCReleaseEvidenceInput["progress"];
  readonly hydration: GateCReleaseEvidenceInput["hydration"];
  readonly artifacts: readonly GateCReleaseArtifactManifest[];
  readonly databaseReceipts: GateCReleaseEvidenceInput["databaseReceipts"];
}

export interface GateCReleaseArtifactManifest {
  readonly route: string;
  readonly state: string;
  readonly dimensions: GateCReleaseArtifactInput["dimensions"];
  readonly verification: GateCReleaseArtifactInput["verification"];
  readonly screenshot: GateCReleaseArtifactReceipt;
  readonly hierarchy: GateCReleaseArtifactReceipt;
  readonly geometry: GateCReleaseArtifactReceipt;
  readonly reconstruction: GateCReleaseArtifactReceipt;
}

export interface GateCCommittedPilotEvent {
  readonly jobId: ImportJobId;
  readonly projectId: ProjectId;
}

export interface GateCReleaseAuthority {
  readonly jobId: ImportJobId;
  readonly projectId: ProjectId;
  readonly sourceRevision: string;
}

export function assertGateCReleaseAuthority(input: Readonly<{
  readonly actualJobId: string;
  readonly actualProjectId: string | null;
  readonly actualSourceRevision: string | null;
  readonly actualState: string;
  readonly expectedJobId: string;
  readonly expectedProjectId: string;
  readonly expectedSourceRevision: string;
}>): GateCReleaseAuthority {
  const expectedJobId = ImportJobIdSchema.parse(input.expectedJobId);
  const actualJobId = ImportJobIdSchema.parse(input.actualJobId);
  if (actualJobId !== expectedJobId) {
    throw new Error("Gate C committed job authority is contradictory.");
  }
  const expectedProjectId = ProjectIdSchema.parse(input.expectedProjectId);
  const actualProjectId = ProjectIdSchema.parse(input.actualProjectId);
  if (actualProjectId !== expectedProjectId) {
    throw new Error("Gate C committed project authority is contradictory.");
  }
  const expectedSourceRevision = gitRevision(input.expectedSourceRevision);
  if (
    input.actualSourceRevision !== expectedSourceRevision ||
    input.actualState !== "committed"
  ) {
    throw new Error("Gate C committed release authority is contradictory.");
  }
  return Object.freeze({
    jobId: actualJobId,
    projectId: actualProjectId,
    sourceRevision: expectedSourceRevision,
  });
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function contentHash(value: string, label: string): ContentHash {
  if (!CONTENT_HASH.test(value)) {
    throw new Error(`${label} must be a SHA-256 content hash.`);
  }
  return value as ContentHash;
}

function gitRevision(value: string): string {
  if (!GIT_REVISION.test(value)) {
    throw new Error("Gate C source revision must be a full lowercase Git SHA.");
  }
  return value;
}

function receipt(
  value: GateCReleaseArtifactReceipt | null,
  label: string,
): GateCReleaseArtifactReceipt {
  if (value === null) {
    throw new Error(`Gate C release evidence requires ${label} authority.`);
  }
  if (!/^[a-z0-9]{1,12}$/u.test(value.extension)) {
    throw new Error(`Gate C ${label} extension is invalid.`);
  }
  return Object.freeze({
    bytes: positiveSafeInteger(value.bytes, `Gate C ${label} bytes`),
    extension: value.extension,
    hash: contentHash(value.hash, `Gate C ${label} hash`),
  });
}

function timestamp(value: string, label: string): string {
  if (
    value.length > 64 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function artifact(
  value: GateCReleaseArtifactInput,
  expectedSourceRevision: string,
): GateCReleaseArtifactManifest {
  if (
    value.captureId.trim().length === 0 ||
    value.scenarioId.trim().length === 0 ||
    !value.route.startsWith("/") ||
    value.route.length > 512 ||
    value.state.trim().length === 0
  ) {
    throw new Error("Gate C release artifact identity is invalid.");
  }
  if (value.sourceRevision !== expectedSourceRevision) {
    throw new Error("Gate C artifact source revision is contradictory.");
  }
  const screenshot = receipt(value.screenshot, "screenshot");
  if (
    contentHash(
      value.verification.stableFrameHash,
      "Gate C stable-frame hash",
    ) !== screenshot.hash
  ) {
    throw new Error("Gate C stable-frame evidence must match native pixels.");
  }
  if (
    value.verification.routeMatched !== true ||
    value.verification.blankRejected !== true ||
    value.verification.splashRejected !== true ||
    value.verification.errorBoundaryRejected !== true
  ) {
    throw new Error("Gate C native-frame verification is incomplete.");
  }
  const width = positiveSafeInteger(
    value.dimensions.width,
    "Gate C screenshot width",
  );
  const height = positiveSafeInteger(
    value.dimensions.height,
    "Gate C screenshot height",
  );
  if (!Number.isFinite(value.dimensions.scale) || value.dimensions.scale <= 0) {
    throw new Error("Gate C screenshot scale must be positive and finite.");
  }
  return Object.freeze({
    route: value.route,
    state: value.state,
    dimensions: Object.freeze({
      width,
      height,
      scale: value.dimensions.scale,
    }),
    verification: Object.freeze({
      stableFrameHash: screenshot.hash,
      routeMatched: true,
      blankRejected: true,
      splashRejected: true,
      errorBoundaryRejected: true,
      verifiedAt: timestamp(
        value.verification.verifiedAt,
        "Gate C artifact verification time",
      ),
    }),
    screenshot,
    hierarchy: receipt(value.hierarchy, "hierarchy"),
    geometry: receipt(value.geometry, "geometry"),
    reconstruction: receipt(value.reconstruction, "reconstruction"),
  });
}

function authorityHash(domain: string, values: readonly string[]): ContentHash {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  for (const value of values) {
    hash.update("\0", "utf8");
    hash.update(value, "utf8");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function parseGateCReleasePilotEvents(
  input: string,
): GateCCommittedPilotEvent {
  if (new TextEncoder().encode(input).byteLength > MAX_PILOT_EVENT_BYTES) {
    throw new Error("Gate C pilot event stream exceeds its byte budget.");
  }
  const lines = input.split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length > MAX_PILOT_EVENTS) {
    throw new Error("Gate C pilot event stream exceeds its event budget.");
  }
  const committed = lines.flatMap((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Gate C pilot emitted invalid JSONL evidence.");
    }
    if (
      typeof value !== "object" ||
      value === null ||
      !("event" in value) ||
      value.event !== "committed"
    ) {
      return [];
    }
    return [value as Readonly<Record<string, unknown>>];
  });
  if (committed.length !== 1) {
    throw new Error("Gate C release evidence requires one committed pilot event.");
  }
  const event = committed[0]!;
  if (event.state !== "committed") {
    throw new Error("Gate C committed pilot event has a contradictory state.");
  }
  return Object.freeze({
    jobId: ImportJobIdSchema.parse(event.jobId),
    projectId: ProjectIdSchema.parse(event.projectId),
  });
}

export function createGateCReleaseEvidenceManifest(
  input: GateCReleaseEvidenceInput,
): GateCReleaseEvidenceManifest {
  const projectId = ProjectIdSchema.parse(input.projectId);
  const jobId = ImportJobIdSchema.parse(input.jobId);
  const sourceRevision = gitRevision(input.sourceRevision);
  const dirtyFingerprint =
    input.dirtyFingerprint === null
      ? null
      : contentHash(input.dirtyFingerprint, "Gate C dirty fingerprint");
  const jobRevision = positiveSafeInteger(
    input.jobRevision,
    "Gate C job revision",
  );
  const total = nonnegativeSafeInteger(
    input.progress.total,
    "Gate C total captures",
  );
  const captured = nonnegativeSafeInteger(
    input.progress.captured,
    "Gate C captured frames",
  );
  const failed = nonnegativeSafeInteger(
    input.progress.failed,
    "Gate C failed captures",
  );
  const remaining = nonnegativeSafeInteger(
    input.progress.remaining,
    "Gate C remaining captures",
  );
  if (
    input.artifacts.length === 0 ||
    total === 0 ||
    captured !== input.artifacts.length ||
    captured !== total ||
    failed !== 0 ||
    remaining !== 0
  ) {
    throw new Error("Gate C release evidence requires a complete native capture.");
  }
  if (
    new Set(input.artifacts.map(({ scenarioId }) => scenarioId)).size !==
      input.artifacts.length ||
    new Set(input.artifacts.map(({ route }) => route)).size !==
      input.artifacts.length
  ) {
    throw new Error("Gate C release artifacts must have unique scenarios and routes.");
  }
  const artifacts = input.artifacts.map((value) =>
    artifact(value, sourceRevision),
  );
  const hydration = Object.freeze({
    artifacts: positiveSafeInteger(
      input.hydration.artifacts,
      "Gate C hydrated artifacts",
    ),
    components: positiveSafeInteger(
      input.hydration.components,
      "Gate C hydrated components",
    ),
    screens: positiveSafeInteger(
      input.hydration.screens,
      "Gate C hydrated screens",
    ),
  });
  if (hydration.artifacts !== artifacts.length) {
    throw new Error("Gate C hydration must cover every captured artifact.");
  }
  const databaseReceipts = input.databaseReceipts.map((value) => {
    if (!/^imports\.sqlite(?:-(?:wal|shm))?$/u.test(value.name)) {
      throw new Error("Gate C database receipt name is invalid.");
    }
    return Object.freeze({
      name: value.name,
      hash: contentHash(value.hash, "Gate C database hash"),
      bytes: positiveSafeInteger(value.bytes, "Gate C database bytes"),
    });
  });
  if (
    databaseReceipts.length === 0 ||
    !databaseReceipts.some(({ name }) => name === "imports.sqlite") ||
    new Set(databaseReceipts.map(({ name }) => name)).size !==
      databaseReceipts.length
  ) {
    throw new Error("Gate C release evidence requires one imports.sqlite receipt.");
  }
  return Object.freeze({
    schema: "memi.gate-c-release-evidence.v1",
    sourceAuthorityHash: authorityHash("memi.gate-c-source-authority.v1", [
      sourceRevision,
      dirtyFingerprint ?? "clean",
    ]),
    captureAuthorityHash: authorityHash("memi.gate-c-capture-authority.v1", [
      projectId,
      jobId,
      String(jobRevision),
      sourceRevision,
    ]),
    jobRevision,
    completedAt: timestamp(input.completedAt, "Gate C completion time"),
    progress: Object.freeze({ total, captured, failed, remaining }),
    hydration,
    artifacts: Object.freeze(artifacts),
    databaseReceipts: Object.freeze(databaseReceipts),
  });
}
