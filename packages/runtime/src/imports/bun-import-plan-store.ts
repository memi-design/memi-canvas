import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  isAbsolute,
  parse as parsePath,
  resolve,
} from "node:path";

import { Database } from "bun:sqlite";
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
import type {
  ImportPlanStore,
  StoredImportExecutionPlan,
} from "./import-plan-store.js";
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

interface PlanRow {
  readonly plan_json: string;
  readonly plan_mac: string;
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
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

function hash(value: unknown): value is `sha256:${string}` {
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
  if (normalized === parsePath(normalized).root) {
    throw new Error(`${label} must be an absolute non-root path.`);
  }
  return normalized;
}

function authority(
  value: unknown,
): ImportRepositoryInspection["authority"] {
  if (!record(value)) {
    throw new Error("Stored import authority is invalid.");
  }
  const sourceRevision =
    value.sourceRevision === null
      ? null
      : typeof value.sourceRevision === "string" &&
          /^[0-9a-f]{40}$/u.test(value.sourceRevision)
        ? value.sourceRevision
        : null;
  const dirtyFingerprint =
    value.dirtyFingerprint === null
      ? null
      : hash(value.dirtyFingerprint)
        ? value.dirtyFingerprint
        : null;
  if (value.sourceRevision !== null && sourceRevision === null) {
    throw new Error("Stored source revision is invalid.");
  }
  if (value.dirtyFingerprint !== null && dirtyFingerprint === null) {
    throw new Error("Stored dirty fingerprint is invalid.");
  }
  return {
    rootPath: absolutePath(
      value.rootPath,
      "Stored source repository",
    ),
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

function recipeCwds(
  value: unknown,
): Readonly<Record<string, string>> | null {
  if (value === null) {
    return null;
  }
  if (!record(value) || Object.keys(value).length > 64) {
    throw new Error("Stored recipe working directories are invalid.");
  }
  return Object.fromEntries(
    Object.entries(value).map(([applicationId, cwd]) => [
      applicationId,
      absolutePath(cwd, "Stored recipe working directory"),
    ]),
  );
}

function applications(
  manifest: RepositoryManifestInput,
  cwdByApplication: Readonly<Record<string, string>> | null,
): readonly CaptureApplicationUnit[] | undefined {
  if (cwdByApplication === null) {
    return undefined;
  }
  return discoverCaptureApplications(manifest).applications.map(
    (application) => {
      const cwd = cwdByApplication[application.applicationId];
      if (application.buildRecipe === null || cwd === undefined) {
        throw new Error(
          "Stored recipe does not match deterministic application discovery.",
        );
      }
      return {
        ...application,
        buildRecipe: { ...application.buildRecipe, cwd },
      };
    },
  );
}

function approval(value: unknown): PlannedRecipeApproval {
  if (
    !record(value) ||
    !record(value.recipe) ||
    !record(value.adapter)
  ) {
    throw new Error("Stored recipe approval is invalid.");
  }
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "hash"),
  );
  if (
    !exactKeys(value, [
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
    ]) ||
    !exactKeys(value.recipe, [
      "args",
      "cwd",
      "executable",
      "purpose",
    ]) ||
    !exactKeys(value.adapter, ["id", "version"]) ||
    value.schemaVersion !== 2 ||
    typeof value.applicationId !== "string" ||
    !/^app_[a-z0-9]+$/u.test(value.applicationId) ||
    !hash(value.repositoryFingerprint) ||
    !hash(value.snapshotExclusionFingerprint) ||
    !hash(value.snapshotPolicyFingerprint) ||
    typeof value.sourceRevision !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value.sourceRevision) ||
    !hash(value.dirtyFingerprint) ||
    !hash(value.applicationCacheKey) ||
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
    !hash(value.environmentFingerprint) ||
    typeof value.nonce !== "string" ||
    value.nonce.length < 8 ||
    value.nonce.length > 256 ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !hash(value.hash) ||
    hashCanonicalValue(unsigned) !== value.hash
  ) {
    throw new Error("Stored recipe approval authority is invalid.");
  }
  return value as unknown as PlannedRecipeApproval;
}

function snapshotExclusions(
  value: unknown,
): RepositorySnapshotExclusionManifest {
  if (
    !record(value) ||
    !exactKeys(value, [
      "entries",
      "fingerprint",
      "policyFingerprint",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== 1 ||
    !hash(value.fingerprint) ||
    !hash(value.policyFingerprint) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 20_000 ||
    value.entries.some(
      (entry) =>
        !record(entry) ||
        !exactKeys(entry, ["path", "reason"]) ||
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

function dependencyPreparations(
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
        !record(candidate) ||
        !exactKeys(candidate, [
          "applicationId",
          "applicationLabel",
          "approval",
          "plan",
        ]) ||
        typeof candidate.applicationId !== "string" ||
        typeof candidate.applicationLabel !== "string" ||
        !record(candidate.plan) ||
        !record(candidate.approval)
      ) {
        throw new Error(
          "Stored native dependency preparation approval is invalid.",
        );
      }
      const plan =
        candidate.plan as unknown as NativeDependencyPreparationPlan;
      const parsedApproval =
        candidate.approval as unknown as NativeDependencyPreparationApproval;
      assertNativeDependencyPreparationApproval(plan, parsedApproval);
      return deepFreeze({
        applicationId: candidate.applicationId,
        applicationLabel: candidate.applicationLabel,
        plan,
        approval: parsedApproval,
      });
    }),
  );
}

function parse(value: unknown): StoredImportExecutionPlan {
  if (!record(value)) {
    throw new Error("Stored import execution plan is invalid.");
  }
  const manifest = value.manifest as RepositoryManifestInput;
  void discoverCaptureApplications(manifest);
  const parsedAuthority = authority(value.authority);
  const parsedSnapshotExclusions = snapshotExclusions(
    value.snapshotExclusions,
  );
  if (
    parsedAuthority.sourceRevision !== manifest.repository.revision ||
    parsedAuthority.dirtyFingerprint !==
      manifest.repository.dirtyFileFingerprint
  ) {
    throw new Error(
      "Stored import authority no longer matches its repository inventory.",
    );
  }
  const restoredApplications = applications(
    manifest,
    recipeCwds(value.recipeCwds),
  );
  if (!Array.isArray(value.approvals) || value.approvals.length > 64) {
    throw new Error("Stored recipe approvals are invalid.");
  }
  const approvals = value.approvals.map(approval);
  if (
    approvals.some(
      (candidate) =>
        candidate.snapshotExclusionFingerprint !==
          parsedSnapshotExclusions.fingerprint ||
        candidate.snapshotPolicyFingerprint !==
          parsedSnapshotExclusions.policyFingerprint,
    )
  ) {
    throw new Error(
      "Stored recipe approval does not match snapshot exclusion authority.",
    );
  }
  return deepFreeze({
    inspection: {
      authority: parsedAuthority,
      manifest,
      snapshotExclusions: parsedSnapshotExclusions,
      ...(restoredApplications === undefined
        ? {}
        : { applications: restoredApplications }),
    },
    approvals,
    dependencyPreparations: dependencyPreparations(
      value.dependencyPreparations,
    ),
  });
}

function stored(
  inspection: ImportRepositoryInspection,
  approvals: readonly PlannedRecipeApproval[],
  dependencyApprovalPlans: readonly ApprovedNativeDependencyPreparation[],
): StoredPlan {
  return {
    authority: inspection.authority,
    manifest: inspection.manifest,
    snapshotExclusions: inspection.snapshotExclusions,
    recipeCwds:
      inspection.applications === undefined
        ? null
        : Object.fromEntries(
            inspection.applications.flatMap((application) =>
              application.buildRecipe === null
                ? []
                : [[
                    application.applicationId,
                    application.buildRecipe.cwd,
                  ]],
            ),
          ),
    approvals,
    dependencyPreparations: dependencyApprovalPlans,
  };
}

export class BunSqliteImportPlanStore implements ImportPlanStore {
  readonly #database: Database;
  readonly #integrityKey: Uint8Array;

  constructor(databasePath: string, integrityKey: Uint8Array) {
    if (integrityKey.byteLength < 32) {
      throw new Error(
        "Import plan integrity authority requires at least 32 bytes.",
      );
    }
    this.#integrityKey = Uint8Array.from(integrityKey);
    this.#database = new Database(databasePath, {
      create: true,
      readwrite: true,
      strict: true,
    });
    try {
      this.#database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = FULL;
        PRAGMA trusted_schema = OFF;
        PRAGMA secure_delete = ON;
        PRAGMA journal_mode = WAL;
        ${TABLE}
      `);
      const columns = this.#database
        .query<{ readonly name: string }>(
          "PRAGMA table_info(import_execution_plans_v2)",
        )
        .all()
        .map(({ name }) => name)
        .sort();
      if (columns.join(",") !== "job_id,plan_json,plan_mac") {
        throw new Error(
          "Existing Bun import plan database schema is incompatible.",
        );
      }
      this.#purgeLegacyPlaintextPlans();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  #purgeLegacyPlaintextPlans(): void {
    const rows = this.#database
      .query<{
        readonly job_id: string;
        readonly plan_json: string;
      }>(
        "SELECT job_id, plan_json FROM import_execution_plans_v2",
      )
      .all();
    const ids = rows
      .filter(({ plan_json }) => isLegacyPlaintextImportPlan(plan_json))
      .map(({ job_id }) => job_id);
    if (ids.length === 0) {
      return;
    }
    const remove = this.#database.query(
      "DELETE FROM import_execution_plans_v2 WHERE job_id = ?",
    );
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      for (const id of ids) {
        remove.run(id);
      }
      this.#database.exec("COMMIT");
      this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  async save(
    jobId: ImportJobId,
    inspection: ImportRepositoryInspection,
    approvals: readonly PlannedRecipeApproval[],
    dependencyApprovalPlans: readonly ApprovedNativeDependencyPreparation[] = [],
  ): Promise<void> {
    const id = ImportJobIdSchema.parse(jobId);
    const validated = parse(
      stored(inspection, approvals, dependencyApprovalPlans),
    );
    const plaintext = JSON.stringify(
      stored(
        validated.inspection,
        validated.approvals,
        validated.dependencyPreparations ?? [],
      ),
    );
    if (
      new TextEncoder().encode(plaintext).byteLength >
      MAX_PLAN_BYTES
    ) {
      throw new Error("Stored import execution plan is too large.");
    }
    const json = sealImportPlan(id, plaintext, this.#integrityKey);
    if (new TextEncoder().encode(json).byteLength > MAX_PLAN_BYTES) {
      throw new Error("Sealed import execution plan is too large.");
    }
    this.#database
      .query(
        `INSERT INTO import_execution_plans_v2 (
           job_id, plan_json, plan_mac
         ) VALUES (?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET
           plan_json = excluded.plan_json,
           plan_mac = excluded.plan_mac`,
      )
      .run(id, json, this.#mac(id, json));
  }

  async get(
    jobId: ImportJobId,
  ): Promise<StoredImportExecutionPlan | null> {
    const id = ImportJobIdSchema.parse(jobId);
    const row = this.#database
      .query<PlanRow>(
        `SELECT plan_json, plan_mac
         FROM import_execution_plans_v2
         WHERE job_id = ?`,
      )
      .get(id);
    if (row === null) {
      return null;
    }
    this.#verify(id, row.plan_json, row.plan_mac);
    const plaintext = openImportPlan(
      id,
      row.plan_json,
      this.#integrityKey,
      MAX_PLAN_BYTES,
    );
    return parse(JSON.parse(plaintext) as unknown);
  }

  async delete(jobId: ImportJobId): Promise<void> {
    this.#database
      .query(
        "DELETE FROM import_execution_plans_v2 WHERE job_id = ?",
      )
      .run(ImportJobIdSchema.parse(jobId));
  }

  async purgeAll(): Promise<number> {
    const result = this.#database
      .query("DELETE FROM import_execution_plans_v2")
      .run();
    this.#database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return Number(result.changes);
  }

  close(): void {
    this.#database.close();
  }

  #mac(jobId: ImportJobId, json: string): string {
    return `hmac256:${createHmac("sha256", this.#integrityKey)
      .update(jobId)
      .update("\0")
      .update(json)
      .digest("hex")}`;
  }

  #verify(
    jobId: ImportJobId,
    json: string,
    supplied: string,
  ): void {
    const expectedBytes = Buffer.from(this.#mac(jobId, json), "utf8");
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
}
