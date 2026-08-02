import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  isAbsolute,
  parse,
  resolve,
} from "node:path";
import { DatabaseSync } from "node:sqlite";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  assertNativeDependencyPreparationApproval,
  type NativeDependencyPreparationApproval,
  type NativeDependencyPreparationPlan,
} from "@memi/capture-execution";
import {
  discoverCaptureApplications,
  type CaptureApplicationUnit,
  type RepositoryManifestInput,
} from "@memi/capture-platforms";
import type {
  RepositorySnapshotExclusionManifest,
} from "@memi/capture-repository";
import {
  ImportJobIdSchema,
  WorktreeIdSchema,
  type ImportJobId,
} from "@memi/protocol";

import type {
  ImportRepositoryInspection,
  ApprovedNativeDependencyPreparation,
  PlannedRecipeApproval,
} from "./import-coordinator.types.js";
import {
  isLegacyPlaintextImportPlan,
  openImportPlan,
  sealImportPlan,
} from "./import-plan-seal.js";

const MAX_PLAN_BYTES = 34 * 1024 * 1024;
const TABLE = `
CREATE TABLE IF NOT EXISTS import_execution_plans_v2 (
  job_id TEXT PRIMARY KEY,
  plan_json TEXT NOT NULL CHECK (
    json_valid(plan_json)
    AND length(CAST(plan_json AS BLOB)) BETWEEN 2 AND ${MAX_PLAN_BYTES}
  ),
  plan_mac TEXT NOT NULL CHECK (
    length(plan_mac) = 72
    AND plan_mac GLOB 'hmac256:[0-9a-f]*'
  )
) STRICT;`;

interface StoredPlan {
  readonly authority: ImportRepositoryInspection["authority"];
  readonly manifest: RepositoryManifestInput;
  readonly snapshotExclusions: RepositorySnapshotExclusionManifest;
  readonly recipeCwds: Readonly<Record<string, string>> | null;
  readonly approvals: readonly PlannedRecipeApproval[];
  readonly dependencyPreparations?: readonly ApprovedNativeDependencyPreparation[];
}

export interface StoredImportExecutionPlan {
  readonly inspection: ImportRepositoryInspection;
  readonly approvals: readonly PlannedRecipeApproval[];
  readonly dependencyPreparations?: readonly ApprovedNativeDependencyPreparation[];
}

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    [...expected]
      .sort()
      .every((key, index) => key === actual[index])
  );
}

function isHash(value: unknown): value is `sha256:${string}` {
  return (
    typeof value === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value)
  );
}

function absolutePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`${label} must be a contained absolute path.`);
  }
  return value;
}

function absoluteNonRootPath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    value.includes("\0") ||
    value.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`${label} must be an absolute non-root path.`);
  }
  const normalized = resolve(value);
  if (normalized === parse(normalized).root) {
    throw new Error(`${label} must be an absolute non-root path.`);
  }
  return normalized;
}

function parseAuthority(
  value: unknown,
): ImportRepositoryInspection["authority"] {
  if (!isRecord(value)) {
    throw new Error("Stored import authority is invalid.");
  }
  const rootPath = absolutePath(
    value.rootPath,
    "Stored source repository",
  );
  const sourceRevision =
    value.sourceRevision === null
      ? null
      : typeof value.sourceRevision === "string" &&
          /^[0-9a-f]{40}$/u.test(value.sourceRevision)
        ? value.sourceRevision
        : null;
  if (value.sourceRevision !== null && sourceRevision === null) {
    throw new Error("Stored source revision is invalid.");
  }
  const dirtyFingerprint =
    value.dirtyFingerprint === null
      ? null
      : typeof value.dirtyFingerprint === "string" &&
          /^sha256:[0-9a-f]{64}$/u.test(value.dirtyFingerprint)
        ? (value.dirtyFingerprint as `sha256:${string}`)
        : null;
  if (value.dirtyFingerprint !== null && dirtyFingerprint === null) {
    throw new Error("Stored dirty fingerprint is invalid.");
  }
  return {
    rootPath,
    sourceRevision,
    dirtyFingerprint,
    managedWorktreeId:
      value.managedWorktreeId === null
        ? null
        : WorktreeIdSchema.parse(value.managedWorktreeId),
    managedRootPath: absoluteNonRootPath(
      value.managedRootPath,
      "Stored managed repository",
    ),
  };
}

function parseRecipeCwds(
  value: unknown,
): Readonly<Record<string, string>> | null {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || Object.keys(value).length > 64) {
    throw new Error("Stored recipe working directories are invalid.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([applicationId, cwd]) => [
      applicationId,
      absolutePath(cwd, "Stored recipe working directory"),
    ]),
  );
}

function restoreApplications(
  manifest: RepositoryManifestInput,
  recipeCwds: Readonly<Record<string, string>> | null,
): readonly CaptureApplicationUnit[] | undefined {
  if (recipeCwds === null) {
    return undefined;
  }
  const discovery = discoverCaptureApplications(manifest);
  return discovery.applications.map((application) => {
    const cwd = recipeCwds[application.applicationId];
    if (application.buildRecipe === null || cwd === undefined) {
      throw new Error(
        "Stored recipe does not match deterministic application discovery.",
      );
    }
    return {
      ...application,
      buildRecipe: { ...application.buildRecipe, cwd },
    };
  });
}

function parseApproval(value: unknown): PlannedRecipeApproval {
  if (!isRecord(value) || !isRecord(value.recipe) || !isRecord(value.adapter)) {
    throw new Error("Stored recipe approval is invalid.");
  }
  const expected = [
    "adapter",
    "applicationCacheKey",
    "applicationId",
    "dirtyFingerprint",
    "environmentFingerprint",
    "expiresAt",
    "hash",
    "nonce",
    "recipe",
    "repositoryFingerprint",
    "resolvedExecutable",
    "schemaVersion",
    "snapshotExclusionFingerprint",
    "snapshotPolicyFingerprint",
    "sourceRevision",
  ] as const;
  const recipeKeys = ["args", "cwd", "executable", "purpose"] as const;
  const adapterKeys = ["id", "version"] as const;
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "hash"),
  );
  if (
    !hasExactKeys(value, expected) ||
    !hasExactKeys(value.recipe, recipeKeys) ||
    !hasExactKeys(value.adapter, adapterKeys) ||
    value.schemaVersion !== 2 ||
    typeof value.applicationId !== "string" ||
    !/^app_[a-z0-9]+$/u.test(value.applicationId) ||
    !isHash(value.repositoryFingerprint) ||
    !isHash(value.snapshotExclusionFingerprint) ||
    !isHash(value.snapshotPolicyFingerprint) ||
    typeof value.sourceRevision !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.sourceRevision) ||
    !isHash(value.dirtyFingerprint) ||
    !isHash(value.applicationCacheKey) ||
    !["npm", "npx", "xcodebuild"].includes(
      String(value.recipe.executable),
    ) ||
    !Array.isArray(value.recipe.args) ||
    value.recipe.args.length > 128 ||
    value.recipe.args.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length === 0 ||
        argument.length > 4_096 ||
        argument.includes("\0"),
    ) ||
    typeof value.recipe.cwd !== "string" ||
    (!isAbsolute(value.recipe.cwd) && value.recipe.cwd !== ".") ||
    !["build", "launch"].includes(String(value.recipe.purpose)) ||
    typeof value.adapter.id !== "string" ||
    value.adapter.id.length === 0 ||
    typeof value.adapter.version !== "string" ||
    value.adapter.version.length === 0 ||
    typeof value.resolvedExecutable !== "string" ||
    !isAbsolute(value.resolvedExecutable) ||
    !isHash(value.environmentFingerprint) ||
    typeof value.nonce !== "string" ||
    value.nonce.length < 8 ||
    value.nonce.length > 256 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !isHash(value.hash) ||
    hashCanonicalValue(unsigned) !== value.hash
  ) {
    throw new Error("Stored recipe approval authority is invalid.");
  }
  return value as unknown as PlannedRecipeApproval;
}

function parseSnapshotExclusions(
  value: unknown,
): RepositorySnapshotExclusionManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "entries",
      "fingerprint",
      "policyFingerprint",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== 1 ||
    !isHash(value.fingerprint) ||
    !isHash(value.policyFingerprint) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 20_000 ||
    value.entries.some(
      (entry) =>
        !isRecord(entry) ||
        !hasExactKeys(entry, ["path", "reason"]) ||
        typeof entry.path !== "string" ||
        entry.path.length === 0 ||
        entry.path.length > 4_096 ||
        typeof entry.reason !== "string",
    )
  ) {
    throw new Error("Stored snapshot exclusion authority is invalid.");
  }
  return deepFreeze(
    value as unknown as RepositorySnapshotExclusionManifest,
  );
}

function parseDependencyPreparations(
  value: unknown,
): readonly ApprovedNativeDependencyPreparation[] {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(
      "Stored native dependency preparation approvals are invalid.",
    );
  }
  return Object.freeze(
    value.map((candidate) => {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, [
          "applicationId",
          "applicationLabel",
          "approval",
          "plan",
        ]) ||
        typeof candidate.applicationId !== "string" ||
        typeof candidate.applicationLabel !== "string" ||
        !isRecord(candidate.plan) ||
        !isRecord(candidate.approval)
      ) {
        throw new Error(
          "Stored native dependency preparation approval is invalid.",
        );
      }
      const plan =
        candidate.plan as unknown as NativeDependencyPreparationPlan;
      const approval =
        candidate.approval as unknown as NativeDependencyPreparationApproval;
      assertNativeDependencyPreparationApproval(plan, approval);
      return deepFreeze({
        applicationId: candidate.applicationId,
        applicationLabel: candidate.applicationLabel,
        plan,
        approval,
      });
    }),
  );
}

function parseStoredPlan(value: unknown): StoredImportExecutionPlan {
  if (!isRecord(value)) {
    throw new Error("Stored import execution plan is invalid.");
  }
  const manifest = value.manifest as RepositoryManifestInput;
  const discovery = discoverCaptureApplications(manifest);
  void discovery;
  const authority = parseAuthority(value.authority);
  const snapshotExclusions = parseSnapshotExclusions(
    value.snapshotExclusions,
  );
  if (
    authority.sourceRevision !== manifest.repository.revision ||
    authority.dirtyFingerprint !==
      manifest.repository.dirtyFileFingerprint
  ) {
    throw new Error(
      "Stored import authority no longer matches its repository inventory.",
    );
  }
  const recipeCwds = parseRecipeCwds(value.recipeCwds);
  const applications = restoreApplications(manifest, recipeCwds);
  if (!Array.isArray(value.approvals) || value.approvals.length > 64) {
    throw new Error("Stored recipe approvals are invalid.");
  }
  const approvals = value.approvals.map(parseApproval);
  if (
    approvals.some(
      (approval) =>
        approval.snapshotExclusionFingerprint !==
          snapshotExclusions.fingerprint ||
        approval.snapshotPolicyFingerprint !==
          snapshotExclusions.policyFingerprint,
    )
  ) {
    throw new Error(
      "Stored recipe approval does not match snapshot exclusion authority.",
    );
  }
  const dependencyPreparations = parseDependencyPreparations(
    value.dependencyPreparations,
  );
  return deepFreeze({
    inspection: {
      authority,
      manifest,
      snapshotExclusions,
      ...(applications === undefined ? {} : { applications }),
    },
    approvals,
    dependencyPreparations,
  });
}

function storedPlan(
  inspection: ImportRepositoryInspection,
  approvals: readonly PlannedRecipeApproval[],
  dependencyPreparations: readonly ApprovedNativeDependencyPreparation[],
): StoredPlan {
  const recipeCwds =
    inspection.applications === undefined
      ? null
      : Object.fromEntries(
          inspection.applications.flatMap((application) =>
            application.buildRecipe === null
              ? []
              : [
                  [
                    application.applicationId,
                    application.buildRecipe.cwd,
                  ],
                ],
          ),
        );
  return {
    authority: inspection.authority,
    manifest: inspection.manifest,
    snapshotExclusions: inspection.snapshotExclusions,
    recipeCwds,
    approvals,
    dependencyPreparations,
  };
}

export interface ImportPlanStore {
  save(
    jobId: ImportJobId,
    inspection: ImportRepositoryInspection,
    approvals: readonly PlannedRecipeApproval[],
    dependencyPreparations?: readonly ApprovedNativeDependencyPreparation[],
  ): Promise<void>;
  get(
    jobId: ImportJobId,
  ): Promise<StoredImportExecutionPlan | null>;
  delete(jobId: ImportJobId): Promise<void>;
  purgeAll(): Promise<number>;
}

export class SqliteImportPlanStore implements ImportPlanStore {
  readonly #database: DatabaseSync;
  readonly #integrityKey: Uint8Array;

  constructor(databasePath: string, integrityKey: Uint8Array) {
    if (integrityKey.byteLength < 32) {
      throw new Error(
        "Import plan integrity authority requires at least 32 bytes.",
      );
    }
    this.#integrityKey = Uint8Array.from(integrityKey);
    this.#database = new DatabaseSync(databasePath, {
      allowExtension: false,
      allowBareNamedParameters: false,
      allowUnknownNamedParameters: false,
      timeout: 5_000,
    });
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      PRAGMA trusted_schema = OFF;
      PRAGMA secure_delete = ON;
      PRAGMA journal_mode = WAL;
      ${TABLE}
    `);
    this.#purgeLegacyPlaintextPlans();
  }

  #purgeLegacyPlaintextPlans(): void {
    const legacyIds = this.#database
      .prepare(
        "SELECT job_id, plan_json FROM import_execution_plans_v2",
      )
      .all() as unknown as readonly {
        readonly job_id: string;
        readonly plan_json: string;
      }[];
    const ids = legacyIds
      .filter(({ plan_json }) => isLegacyPlaintextImportPlan(plan_json))
      .map(({ job_id }) => job_id);
    if (ids.length === 0) {
      return;
    }
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.#database.prepare(
        "DELETE FROM import_execution_plans_v2 WHERE job_id = ?",
      );
      for (const id of ids) {
        statement.run(id);
      }
      this.#database.exec("COMMIT");
      this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  #mac(jobId: ImportJobId, serialized: string): string {
    return `hmac256:${createHmac("sha256", this.#integrityKey)
      .update(jobId)
      .update("\0")
      .update(serialized)
      .digest("hex")}`;
  }

  #verifyMac(
    jobId: ImportJobId,
    serialized: string,
    supplied: string,
  ): void {
    const expected = this.#mac(jobId, serialized);
    const expectedBytes = Buffer.from(expected, "utf8");
    const suppliedBytes = Buffer.from(supplied, "utf8");
    if (
      expectedBytes.byteLength !== suppliedBytes.byteLength ||
      !timingSafeEqual(expectedBytes, suppliedBytes)
    ) {
      throw new Error(
        "Stored import execution plan integrity is invalid.",
      );
    }
  }

  async save(
    jobId: ImportJobId,
    inspection: ImportRepositoryInspection,
    approvals: readonly PlannedRecipeApproval[],
    dependencyPreparations: readonly ApprovedNativeDependencyPreparation[] = [],
  ): Promise<void> {
    const id = ImportJobIdSchema.parse(jobId);
    const validated = parseStoredPlan(
      storedPlan(inspection, approvals, dependencyPreparations),
    );
    const plaintext = JSON.stringify(
      storedPlan(
        validated.inspection,
        validated.approvals,
        validated.dependencyPreparations ?? [],
      ),
    );
    if (Buffer.byteLength(plaintext, "utf8") > MAX_PLAN_BYTES) {
      throw new Error("Stored import execution plan is too large.");
    }
    const serialized = sealImportPlan(
      id,
      plaintext,
      this.#integrityKey,
    );
    if (Buffer.byteLength(serialized, "utf8") > MAX_PLAN_BYTES) {
      throw new Error("Sealed import execution plan is too large.");
    }
    const mac = this.#mac(id, serialized);
    this.#database
      .prepare(
        `INSERT INTO import_execution_plans_v2 (job_id, plan_json, plan_mac)
         VALUES (?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           plan_json = excluded.plan_json,
           plan_mac = excluded.plan_mac`,
      )
      .run(id, serialized, mac);
  }

  async get(
    jobId: ImportJobId,
  ): Promise<StoredImportExecutionPlan | null> {
    const id = ImportJobIdSchema.parse(jobId);
    const row = this.#database
      .prepare(
        `SELECT plan_json, plan_mac
         FROM import_execution_plans_v2
         WHERE job_id = ?`,
      )
      .get(id) as
      | {
          readonly plan_json: string;
          readonly plan_mac: string;
        }
      | undefined;
    if (row === undefined) {
      return null;
    }
    this.#verifyMac(id, row.plan_json, row.plan_mac);
    const plaintext = openImportPlan(
      id,
      row.plan_json,
      this.#integrityKey,
      MAX_PLAN_BYTES,
    );
    return parseStoredPlan(JSON.parse(plaintext) as unknown);
  }

  async delete(jobId: ImportJobId): Promise<void> {
    this.#database
      .prepare(
        "DELETE FROM import_execution_plans_v2 WHERE job_id = ?",
      )
      .run(ImportJobIdSchema.parse(jobId));
  }

  async purgeAll(): Promise<number> {
    const result = this.#database
      .prepare("DELETE FROM import_execution_plans_v2")
      .run();
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return Number(result.changes);
  }

  close(): void {
    this.#database.close();
  }
}
