import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type TraceConcurrencyCaseId =
  | "trace-concurrency-002"
  | "trace-concurrency-003"
  | "trace-concurrency-004"
  | "trace-concurrency-005";

export interface TraceConcurrencyWorkerEvidence {
  readonly role: string;
  readonly pid: number;
  readonly claimEpoch?: number;
}

export interface TraceConcurrencyResultEvidence {
  readonly role: string;
  readonly status: "committed" | "error";
  readonly eventId?: string;
  readonly errorCode?: string;
}

export interface TraceConcurrencyEvidenceInput {
  readonly caseId: TraceConcurrencyCaseId;
  readonly databasePath: string;
  readonly workers: readonly TraceConcurrencyWorkerEvidence[];
  readonly phases: readonly string[];
  readonly results: readonly TraceConcurrencyResultEvidence[];
  readonly comparison?: {
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly unchanged: boolean;
  };
  readonly bindingDigests?: {
    readonly committed: string;
    readonly rejected: string;
  };
}

const CASE_IDS = new Set<TraceConcurrencyCaseId>([
  "trace-concurrency-002",
  "trace-concurrency-003",
  "trace-concurrency-004",
  "trace-concurrency-005",
]);

const evidenceRoot = resolve(
  process.cwd(),
  "dist",
  "test-evidence",
  "canonical-trace-concurrency",
);

export function retainedTraceConcurrencyEvidencePath(
  caseId: TraceConcurrencyCaseId,
): string {
  if (!CASE_IDS.has(caseId)) {
    throw new Error("Unknown trace concurrency evidence case.");
  }
  return join(evidenceRoot, `${caseId}.json`);
}

function scalarRows(database: DatabaseSync, sql: string) {
  return database.prepare(sql).all();
}

function snapshot(database: DatabaseSync) {
  return {
    integrity: scalarRows(database, "PRAGMA integrity_check"),
    foreignKeys: scalarRows(database, "PRAGMA foreign_key_check"),
    commands: scalarRows(
      database,
      `SELECT id, state FROM commands ORDER BY id`,
    ),
    outbox: scalarRows(
      database,
      `SELECT id, command_id, phase, claim_epoch, worker_id,
              claim_expires_at
       FROM outbox ORDER BY id`,
    ),
    heads: scalarRows(
      database,
      `SELECT project_id, last_sequence, last_event_id,
              last_event_hash
       FROM trace_heads ORDER BY project_id`,
    ),
    events: scalarRows(
      database,
      `SELECT id, project_id, sequence, command_id, outbox_id,
              previous_event_hash, event_hash
       FROM trace_events ORDER BY project_id, sequence`,
    ),
    bindings: scalarRows(
      database,
      `SELECT command_id, outbox_id, event_id, binding_digest,
              verification_attempt_id, verification_evidence_hash
       FROM trace_effect_bindings ORDER BY command_id`,
    ),
    receipts: scalarRows(
      database,
      `SELECT command_id, event_id, binding_digest, receipt_hash
       FROM effect_receipts ORDER BY command_id`,
    ),
    projections: scalarRows(
      database,
      `SELECT event_id, project_id, sequence, event_hash, state
       FROM trace_projection_outbox ORDER BY project_id, sequence`,
    ),
    attempts: scalarRows(
      database,
      `SELECT id, command_id, state, claim_worker_id, claim_epoch,
              evidence_hash
       FROM target_verification_attempts ORDER BY id`,
    ),
    remainingLatches: scalarRows(
      database,
      `SELECT command_id, outbox_id, state
       FROM target_schedule_latches ORDER BY command_id`,
    ),
  };
}

function assertSafeEvidence(
  input: TraceConcurrencyEvidenceInput,
  json: string,
): void {
  if (
    !CASE_IDS.has(input.caseId) ||
    input.workers.length !== 2 ||
    new Set(input.workers.map((worker) => worker.pid)).size !== 2 ||
    input.workers.some(
      (worker) =>
        !Number.isSafeInteger(worker.pid) ||
        worker.pid <= 0 ||
        worker.role.length < 1 ||
        worker.role.length > 64,
    ) ||
    input.phases.length < 3 ||
    input.results.length !== 2 ||
    json.length > 64 * 1024 ||
    json.includes(input.databasePath) ||
    json.includes(process.cwd()) ||
    /"nonce"|"request_json"|"response_json"/u.test(json)
  ) {
    throw new Error("Trace concurrency evidence is unsafe or incomplete.");
  }
}

export function retainTraceConcurrencyEvidence(
  input: TraceConcurrencyEvidenceInput,
): string {
  const database = new DatabaseSync(input.databasePath, {
    readOnly: true,
  });
  database.exec("BEGIN");
  let authority;
  try {
    authority = snapshot(database);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    throw error;
  }
  database.close();
  if (
    JSON.stringify(authority.integrity) !==
      JSON.stringify([{ integrity_check: "ok" }]) ||
    authority.foreignKeys.length !== 0
  ) {
    throw new Error("Cannot retain unhealthy SQLite evidence.");
  }
  const evidence = {
    schemaVersion: 1,
    caseId: input.caseId,
    schedule: {
      workers: input.workers,
      phases: input.phases,
    },
    results: input.results,
    authority,
    ...(input.comparison === undefined
      ? {}
      : { comparison: input.comparison }),
    ...(input.bindingDigests === undefined
      ? {}
      : { bindingDigests: input.bindingDigests }),
  };
  const json = JSON.stringify(evidence);
  assertSafeEvidence(input, json);
  mkdirSync(evidenceRoot, { recursive: true });
  const path = retainedTraceConcurrencyEvidencePath(input.caseId);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  rmSync(temporaryPath, { force: true });
  writeFileSync(temporaryPath, `${json}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  renameSync(temporaryPath, path);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    readonly schemaVersion?: unknown;
    readonly caseId?: unknown;
  };
  if (
    parsed.schemaVersion !== 1 ||
    parsed.caseId !== input.caseId
  ) {
    throw new Error("Retained trace concurrency evidence is invalid.");
  }
  console.info(
    `trace concurrency evidence: ${relative(process.cwd(), path)}`,
  );
  return path;
}
