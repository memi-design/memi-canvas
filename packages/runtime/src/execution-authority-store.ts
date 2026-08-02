import {
  ApprovalReceiptSchema,
  CapabilityGrantSchema,
  ContentHashSchema,
  DurableCommandSchema,
  OutboxRecordSchema,
  ProjectIdSchema,
  RunIdSchema,
} from "../../protocol/src/index.js";

import {
  RuntimeDatabase,
  type SqlRow,
  type SqlValue,
} from "./database.js";
import { parsed, rowText } from "./runtime-records.js";
import { TrustedAuthorityStore } from "./trusted-authority-store.js";

interface SnapshotScope {
  readonly schemaVersion: 1;
  readonly projectId: ReturnType<typeof ProjectIdSchema.parse>;
  readonly runId: ReturnType<typeof RunIdSchema.parse>;
  readonly batchRootDigest: ReturnType<typeof ContentHashSchema.parse>;
}

function parseScope(input: unknown): SnapshotScope {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new TypeError("Execution authority scope must be an object.");
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "batchRootDigest",
    "projectId",
    "runId",
    "schemaVersion",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError("Execution authority scope has unknown fields.");
  }
  if (record.schemaVersion !== 1) {
    throw new TypeError("Execution authority scope version is invalid.");
  }
  try {
    return {
      schemaVersion: 1,
      projectId: ProjectIdSchema.parse(record.projectId),
      runId: RunIdSchema.parse(record.runId),
      batchRootDigest: ContentHashSchema.parse(
        record.batchRootDigest,
      ),
    };
  } catch {
    throw new TypeError(
      "Execution authority scope project, run, or batch is invalid.",
    );
  }
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function camelRow(row: SqlRow): Record<string, SqlValue> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/gu, (_match, letter: string) =>
        letter.toUpperCase(),
      ),
      value,
    ]),
  );
}

export class ExecutionAuthorityStore {
  readonly #database: RuntimeDatabase;
  readonly #trusted: TrustedAuthorityStore;

  constructor(
    database: RuntimeDatabase,
    trusted: TrustedAuthorityStore,
  ) {
    this.#database = database;
    this.#trusted = trusted;
  }

  snapshot(input: unknown) {
    const scope = parseScope(input);
    const authorityRows = this.#trusted.issuanceRowsForScope(
      scope.projectId,
      scope.runId,
      scope.batchRootDigest,
    );
    if (authorityRows.length === 0) {
      throw new Error(
        "Execution authority scope has no trusted batch lineage.",
      );
    }
    const lineages = unique(
      authorityRows.map((row) =>
        JSON.stringify([
          rowText(row, "workspace_digest"),
          rowText(row, "plan_digest"),
        ]),
      ),
    );
    if (lineages.length !== 1) {
      throw new Error(
        "Execution authority scope has contradictory lineage.",
      );
    }
    const commandIds = authorityRows.map((row) =>
      rowText(row, "command_id"),
    );
    const rows = this.#detailedRows(commandIds);
    const observed = this.#observedRuntimeWork(scope);
    const first = authorityRows[0]!;
    return {
      schemaVersion: 1 as const,
      kind: "execution-authority-snapshot" as const,
      scope: {
        projectId: scope.projectId,
        runId: scope.runId,
        batchRootDigest: scope.batchRootDigest,
      },
      signedReviewedContext: {
        workspaceDigest: rowText(first, "workspace_digest"),
        planDigest: rowText(first, "plan_digest"),
        batchRootDigest: scope.batchRootDigest,
      },
      counts: {
        commands: rows.commands.length,
        outboxes: rows.outboxes.length,
        grants: rows.grants.length,
        approvals: rows.approvals.length,
        grantUses: rows.grantUses.length,
        approvalUses: rows.approvalUses.length,
        targetReceipts: rows.targetReceipts.length,
        acceptedVerificationAttempts:
          rows.acceptedVerificationAttempts.length,
        traceBindings: rows.traceBindings.length,
        traceEvents: rows.traceEvents.length,
        projectionIntents: rows.projectionIntents.length,
        canonicalReceipts: rows.canonicalReceipts.length,
        latches: rows.latches.length,
      },
      rows,
      observedRuntimeWork: observed,
    };
  }

  #detailedRows(commandIds: readonly string[]) {
    const commandSlots = placeholders(commandIds);
    const commands = this.#database
      .all(
        `SELECT command_json, state FROM commands
         WHERE id IN (${commandSlots}) ORDER BY rowid`,
        ...commandIds,
      )
      .map((row) => ({
        ...DurableCommandSchema.parse(parsed(row.command_json)),
        state: rowText(row, "state"),
      }));
    const outboxes = this.#database
      .all(
        `SELECT record_json FROM outbox
         WHERE command_id IN (${commandSlots}) ORDER BY rowid`,
        ...commandIds,
      )
      .map((row) =>
        OutboxRecordSchema.parse(parsed(row.record_json)),
      );
    const grantIds = commands.map(
      (command) => command.authority.capabilityGrantId,
    );
    const approvalIds = commands.flatMap((command) =>
      command.authority.approvalReceiptId === null
        ? []
        : [command.authority.approvalReceiptId],
    );
    const grants = this.#database
      .all(
        `SELECT grant_json FROM capability_grants
         WHERE id IN (${placeholders(grantIds)}) ORDER BY rowid`,
        ...grantIds,
      )
      .map((row) =>
        CapabilityGrantSchema.parse(parsed(row.grant_json)),
      );
    const approvals = this.#database
      .all(
        `SELECT receipt_json FROM approval_receipts
         WHERE id IN (${placeholders(approvalIds)}) ORDER BY rowid`,
        ...approvalIds,
      )
      .map((row) =>
        ApprovalReceiptSchema.parse(parsed(row.receipt_json)),
      );
    return {
      commands,
      outboxes,
      grants,
      approvals,
      grantUses: this.#camelRows(
        "capability_grant_uses",
        commandIds,
      ),
      approvalUses: this.#camelRows("approval_uses", commandIds),
      targetReceipts: this.#jsonRows(
        "target_receipts",
        "receipt_json",
        commandIds,
      ),
      acceptedVerificationAttempts: this.#camelRows(
        "target_verification_attempts",
        commandIds,
        "state = 'accepted'",
      ),
      traceBindings: this.#camelRows(
        "trace_effect_bindings",
        commandIds,
      ),
      traceEvents: this.#jsonRows(
        "trace_events",
        "event_json",
        commandIds,
      ),
      projectionIntents: this.#projectionRows(commandIds),
      canonicalReceipts: this.#jsonRows(
        "effect_receipts",
        "receipt_json",
        commandIds,
      ),
      latches: this.#camelRows(
        "target_schedule_latches",
        commandIds,
      ),
    };
  }

  #camelRows(
    table: string,
    commandIds: readonly string[],
    condition = "1 = 1",
  ): readonly Record<string, SqlValue>[] {
    return this.#database
      .all(
        `SELECT * FROM ${table}
         WHERE command_id IN (${placeholders(commandIds)})
           AND ${condition}
         ORDER BY rowid`,
        ...commandIds,
      )
      .map(camelRow);
  }

  #jsonRows(
    table: string,
    column: string,
    commandIds: readonly string[],
  ): readonly unknown[] {
    return this.#database
      .all(
        `SELECT ${column} FROM ${table}
         WHERE command_id IN (${placeholders(commandIds)})
         ORDER BY rowid`,
        ...commandIds,
      )
      .map((row) => parsed(row[column]));
  }

  #projectionRows(
    commandIds: readonly string[],
  ): readonly { readonly operationId: string }[] {
    return this.#database
      .all(
        `SELECT trace_events.operation_id
         FROM trace_projection_outbox
         JOIN trace_events
           ON trace_events.id = trace_projection_outbox.event_id
         WHERE trace_events.command_id IN (${placeholders(commandIds)})
         ORDER BY trace_projection_outbox.rowid`,
        ...commandIds,
      )
      .map((row) => ({
        operationId: rowText(row, "operation_id"),
      }));
  }

  #observedRuntimeWork(scope: SnapshotScope) {
    const observed = this.#database.all(
      `SELECT commands.id, commands.command_json,
              trusted_command_authorities.batch_root_digest
       FROM commands
       LEFT JOIN trusted_command_authorities
         ON trusted_command_authorities.command_id = commands.id
       WHERE commands.project_id = ?
         AND json_extract(commands.command_json, '$.runId') = ?
       ORDER BY commands.rowid`,
      scope.projectId,
      scope.runId,
    );
    const commands = observed.map((row) =>
      DurableCommandSchema.parse(parsed(row.command_json)),
    );
    const outsideBatchCommandIds = observed.flatMap((row) =>
      row.batch_root_digest === scope.batchRootDigest
        ? []
        : [rowText(row, "id")],
    );
    return {
      allObservedCommandsBelongToBatch:
        outsideBatchCommandIds.length === 0,
      commandKinds: unique(commands.map((command) => command.kind)),
      targetKinds: unique(
        commands.map((command) => command.target.kind),
      ),
      observedCommandIds: commands.map((command) => command.id),
      outsideBatchCommandIds,
      observedBatchRootDigests: unique(
        observed.flatMap((row) =>
          row.batch_root_digest === null
            ? []
            : [rowText(row, "batch_root_digest")],
        ),
      ).map((digest) => ContentHashSchema.parse(digest)),
    };
  }
}
