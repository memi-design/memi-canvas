import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  CanvasCommittedEffectReceiptSchema,
  CanvasOperationCommittedEventSchema,
  CanvasTraceEffectBindingSchema,
  OutboxRecordSchema,
  TargetReceiptHashMaterialSchema,
  TargetReceiptSchema,
  TargetVerificationEvidenceHashMaterialSchema,
  TargetVerificationRequestHashMaterialSchema,
  TargetVerificationRequestSchema,
  TargetVerificationResultSchema,
  type CanvasCommittedEffectReceipt,
} from "../../protocol/src/index.js";
import { RuntimeDatabase, type SqlRow } from "./database.js";

function parsed(value: unknown): unknown {
  return JSON.parse(String(value));
}

function same(value: unknown, expected: unknown): boolean {
  return String(value) === String(expected);
}

export class CanvasTraceReader {
  readonly #database: RuntimeDatabase;

  constructor(database: RuntimeDatabase) {
    this.#database = database;
  }

  audit(): void {
    for (const row of this.#database.all(
      `SELECT DISTINCT project_id FROM trace_events
       UNION
       SELECT DISTINCT outbox.project_id
       FROM outbox JOIN commands ON commands.id = outbox.command_id
       WHERE outbox.phase = 'committed'
         AND json_extract(commands.command_json, '$.kind') =
               'canvas.operation'`,
    )) {
      this.project(String(row.project_id));
    }
    for (const row of this.#database.all(
      `SELECT DISTINCT command_id
       FROM target_verification_attempts
       WHERE state = 'accepted'
       UNION SELECT command_id FROM effect_receipts`,
    )) {
      this.#validateCommitted(String(row.command_id));
    }
  }

  receipt(commandId: string): CanvasCommittedEffectReceipt | undefined {
    const row = this.#database.one(
      "SELECT phase FROM outbox WHERE command_id = ?",
      commandId,
    );
    return row !== undefined && String(row.phase) === "committed"
      ? this.#validateCommitted(commandId)
      : undefined;
  }

  trace(commandId: string) {
    const receipt = this.receipt(commandId);
    return receipt === undefined
      ? undefined
      : { commandId, traceEventId: receipt.eventId };
  }

  project(projectId: string) {
    const events = this.#validateProject(projectId);
    for (const event of events) {
      this.#validateCommitted(event.commandId, event);
    }
    for (const row of this.#database.all(
      `SELECT outbox.command_id
       FROM outbox
       JOIN commands ON commands.id = outbox.command_id
       LEFT JOIN legacy_effect_receipts
         ON legacy_effect_receipts.command_id = outbox.command_id
       LEFT JOIN legacy_trace_references
         ON legacy_trace_references.command_id = outbox.command_id
       WHERE outbox.project_id = ? AND outbox.phase = 'committed'
         AND json_extract(commands.command_json, '$.kind') =
               'canvas.operation'
         AND (
           legacy_effect_receipts.command_id IS NULL
           OR legacy_trace_references.command_id IS NULL
         )`,
      projectId,
    )) {
      if (!events.some((event) => event.commandId === row.command_id)) {
        this.#validateCommitted(String(row.command_id));
      }
    }
    const last = events.at(-1);
    return {
      projectId,
      lastSequence: last?.sequence ?? 0,
      lastEventHash: last?.eventHash ?? null,
      events,
    };
  }

  #validateProject(projectId: string) {
    const rows = this.#database.all(
      `SELECT * FROM trace_events
       WHERE project_id = ? ORDER BY sequence`,
      projectId,
    );
    let previous: string | null = null;
    const events = rows.map((row, index) => {
      let event;
      try {
        event = CanvasOperationCommittedEventSchema.parse(
          parsed(row.event_json),
        );
      } catch {
        throw new Error("Canonical trace integrity violation.");
      }
      if (
        canonicalJson(event) !== String(row.event_json) ||
        event.sequence !== index + 1 ||
        event.previousEventHash !== previous ||
        !this.#eventRowMatches(row, event)
      ) {
        throw new Error("Canonical trace integrity violation.");
      }
      previous = event.eventHash;
      return event;
    });
    const head = this.#database.one(
      "SELECT * FROM trace_heads WHERE project_id = ?",
      projectId,
    );
    const last = events.at(-1);
    if (
      (last === undefined && head !== undefined) ||
      (last !== undefined &&
        (head === undefined ||
          Number(head.last_sequence) !== last.sequence ||
          !same(head.last_event_id, last.id) ||
          !same(head.last_event_hash, last.eventHash)))
    ) {
      throw new Error("Canonical trace head integrity violation.");
    }
    return events;
  }

  #eventRowMatches(
    row: SqlRow,
    event: ReturnType<typeof CanvasOperationCommittedEventSchema.parse>,
  ): boolean {
    const fields: ReadonlyArray<readonly [string, unknown]> = [
      ["id", event.id],
      ["project_id", event.projectId],
      ["sequence", event.sequence],
      ["schema_version", event.schemaVersion],
      ["task_id", event.taskId],
      ["run_id", event.runId],
      ["family", event.family],
      ["actor_kind", event.actor.kind],
      ["actor_id", event.actor.id],
      ["command_id", event.commandId],
      ["outbox_id", event.outboxId],
      ["target_kind", event.target.kind],
      ["target_id", event.target.id],
      ["idempotency_key", event.idempotencyKey],
      ["command_action_digest", event.commandActionDigest],
      ["operation_action_digest", event.operationActionDigest],
      ["expected_before_hash", event.expectedBeforeHash],
      ["resulting_hash", event.resultingHash],
      ["target_receipt_hash", event.targetReceiptHash],
      ["verification_request_digest", event.verificationRequestDigest],
      ["verification_evidence_hash", event.verificationEvidenceHash],
      ["verification_checked_at", event.verificationCheckedAt],
      ["operation_id", event.operationId],
      ["applied_revision", event.appliedRevision],
      ["lease_id", event.leaseId],
      ["fencing_epoch", event.fencingEpoch],
      ["occurred_at", event.occurredAt],
      ["event_action_digest", event.eventActionDigest],
      ["previous_event_hash", event.previousEventHash],
      ["event_hash", event.eventHash],
    ];
    return fields.every(([field, value]) =>
      typeof value === "number"
        ? Number(row[field]) === value
        : same(row[field], value),
    );
  }

  #validateCommitted(
    commandId: string,
    knownEvent?: ReturnType<
      typeof CanvasOperationCommittedEventSchema.parse
    >,
  ): CanvasCommittedEffectReceipt {
    const row = this.#database.one(
      `SELECT
         effect_receipts.command_id AS receipt_command_id,
         effect_receipts.outbox_id AS receipt_outbox_id,
         effect_receipts.event_id AS receipt_event_id,
         effect_receipts.project_id AS receipt_project_id,
         effect_receipts.target_kind AS receipt_target_kind,
         effect_receipts.target_id AS receipt_target_id,
         effect_receipts.binding_digest AS receipt_binding_digest,
         effect_receipts.receipt_hash,
         effect_receipts.receipt_json AS canonical_receipt_json,
         effect_receipts.committed_at AS receipt_committed_at,
         trace_effect_bindings.command_id AS binding_command_id,
         trace_effect_bindings.outbox_id AS binding_outbox_id,
         trace_effect_bindings.event_id AS binding_event_id,
         trace_effect_bindings.project_id AS binding_project_id,
         trace_effect_bindings.target_kind AS binding_target_kind,
         trace_effect_bindings.target_id AS binding_target_id,
         trace_effect_bindings.verification_attempt_id,
         trace_effect_bindings.verification_attempt_state,
         trace_effect_bindings.binding_digest,
         trace_effect_bindings.target_receipt_hash,
         trace_effect_bindings.verification_request_digest,
         trace_effect_bindings.verification_evidence_hash,
         trace_effect_bindings.resulting_hash,
         trace_effect_bindings.committed_at AS binding_committed_at,
         target_verification_attempts.state AS attempt_state,
         target_verification_attempts.evidence_hash AS attempt_evidence_hash,
         target_verification_attempts.command_id AS attempt_command_id,
         target_verification_attempts.outbox_id AS attempt_outbox_id,
         target_verification_attempts.target_receipt_hash
           AS attempt_target_receipt_hash,
         target_verification_attempts.project_id AS attempt_project_id,
         target_verification_attempts.target_kind AS attempt_target_kind,
         target_verification_attempts.target_id AS attempt_target_id,
         target_verification_attempts.claim_worker_id,
         target_verification_attempts.claim_epoch,
         target_verification_attempts.claim_expires_at,
         target_verification_attempts.apply_worker_claim_id,
         target_verification_attempts.apply_claim_epoch,
         target_verification_attempts.request_json,
         target_verification_attempts.response_json,
         target_verification_attempts.checked_at AS attempt_checked_at,
         target_receipts.receipt_json AS target_receipt_json
       FROM effect_receipts
       JOIN trace_effect_bindings USING (
         command_id, outbox_id, event_id, project_id,
         target_kind, target_id, binding_digest
       )
       JOIN target_verification_attempts
         ON target_verification_attempts.id =
              trace_effect_bindings.verification_attempt_id
        AND target_verification_attempts.request_digest =
              trace_effect_bindings.verification_request_digest
        AND target_verification_attempts.evidence_hash =
              trace_effect_bindings.verification_evidence_hash
        AND target_verification_attempts.state =
              trace_effect_bindings.verification_attempt_state
       JOIN target_receipts
         ON target_receipts.receipt_hash =
              trace_effect_bindings.target_receipt_hash
       WHERE effect_receipts.command_id = ?`,
      commandId,
    );
    if (row === undefined) {
      throw new Error("Committed canvas authority is incomplete.");
    }
    let receipt;
    try {
      receipt = CanvasCommittedEffectReceiptSchema.parse(
        parsed(row.canonical_receipt_json),
      );
    } catch {
      throw new Error("Committed canvas receipt integrity violation.");
    }
    const event =
      knownEvent ??
      this.#validateProject(receipt.projectId).find(
        (candidate) => candidate.id === receipt.eventId,
      );
    if (event === undefined) {
      throw new Error("Committed canvas event is missing.");
    }
    const binding = CanvasTraceEffectBindingSchema.parse({
      schemaVersion: 1,
      projectId: receipt.projectId,
      commandId: receipt.commandId,
      outboxId: receipt.outboxId,
      eventId: receipt.eventId,
      eventHash: receipt.eventHash,
      target: {
        kind: String(row.binding_target_kind),
        id: String(row.binding_target_id),
      },
      targetReceiptHash: String(row.target_receipt_hash),
      verificationAttemptId: String(row.verification_attempt_id),
      verificationRequestDigest: String(
        row.verification_request_digest,
      ),
      verificationEvidenceHash: String(
        row.verification_evidence_hash,
      ),
      resultingHash: String(row.resulting_hash),
      bindingDigest: String(row.binding_digest),
    });
    let request;
    let response;
    let targetReceipt;
    try {
      request = TargetVerificationRequestSchema.parse(
        parsed(row.request_json),
      );
      response = TargetVerificationResultSchema.parse(
        parsed(row.response_json),
      );
      targetReceipt = TargetReceiptSchema.parse(
        parsed(row.target_receipt_json),
      );
    } catch {
      throw new Error("Historical verification integrity violation.");
    }
    const { requestDigest, ...requestMaterial } = request;
    const { evidenceHash, ...responseMaterial } = response;
    const { receiptHash, ...targetReceiptMaterial } = targetReceipt;
    if (
      canonicalJson(receipt) !== String(row.canonical_receipt_json) ||
      !same(row.receipt_hash, receipt.receiptHash) ||
      !same(row.receipt_command_id, receipt.commandId) ||
      !same(row.receipt_outbox_id, receipt.outboxId) ||
      !same(row.receipt_event_id, receipt.eventId) ||
      !same(row.receipt_project_id, receipt.projectId) ||
      !same(row.receipt_target_kind, event.target.kind) ||
      !same(row.receipt_target_id, event.target.id) ||
      !same(row.receipt_binding_digest, receipt.bindingDigest) ||
      !same(row.receipt_committed_at, receipt.committedAt) ||
      hashCanonicalValue({
        schemaVersion: binding.schemaVersion,
        projectId: binding.projectId,
        commandId: binding.commandId,
        outboxId: binding.outboxId,
        eventId: binding.eventId,
        eventHash: binding.eventHash,
        target: binding.target,
        targetReceiptHash: binding.targetReceiptHash,
        verificationAttemptId: binding.verificationAttemptId,
        verificationRequestDigest: binding.verificationRequestDigest,
        verificationEvidenceHash: binding.verificationEvidenceHash,
        resultingHash: binding.resultingHash,
      }) !== receipt.bindingDigest ||
      receipt.eventHash !== event.eventHash ||
      receipt.targetReceiptHash !== event.targetReceiptHash ||
      receipt.verificationEvidenceHash !== event.verificationEvidenceHash
      || binding.verificationRequestDigest !==
        event.verificationRequestDigest
      || !same(row.verification_attempt_state, "accepted")
      || !same(row.attempt_state, "accepted")
      || !same(
        row.attempt_evidence_hash,
        binding.verificationEvidenceHash,
      )
      || !same(row.attempt_command_id, event.commandId)
      || !same(row.attempt_outbox_id, event.outboxId)
      || !same(
        row.attempt_target_receipt_hash,
        event.targetReceiptHash,
      )
      || !same(row.binding_command_id, event.commandId)
      || !same(row.binding_outbox_id, event.outboxId)
      || !same(row.binding_event_id, event.id)
      || !same(row.binding_project_id, event.projectId)
      || !same(row.binding_target_kind, event.target.kind)
      || !same(row.binding_target_id, event.target.id)
      || !same(row.resulting_hash, event.resultingHash)
      || !same(
        row.verification_evidence_hash,
        event.verificationEvidenceHash,
      )
      || !same(row.binding_committed_at, receipt.committedAt)
      || canonicalJson(request) !== String(row.request_json)
      || canonicalJson(response) !== String(row.response_json)
      || requestDigest !== hashCanonicalValue(
        TargetVerificationRequestHashMaterialSchema.parse(
          requestMaterial,
        ),
      )
      || evidenceHash !== hashCanonicalValue(
        TargetVerificationEvidenceHashMaterialSchema.parse(
          responseMaterial,
        ),
      )
      || receiptHash !== hashCanonicalValue(
        TargetReceiptHashMaterialSchema.parse(targetReceiptMaterial),
      )
      || request.commandId !== event.commandId
      || request.requestDigest !== event.verificationRequestDigest
      || response.requestDigest !== request.requestDigest
      || response.evidenceHash !== event.verificationEvidenceHash
      || response.status !== "verified-applied"
      || (response.status === "verified-applied" &&
        canonicalJson(response.receipt) !== canonicalJson(targetReceipt))
      || !same(row.attempt_project_id, event.projectId)
      || !same(row.attempt_target_kind, event.target.kind)
      || !same(row.attempt_target_id, event.target.id)
      || String(row.claim_worker_id).length === 0
      || Number(row.claim_epoch) < 1
      || Number.isNaN(Date.parse(String(row.claim_expires_at)))
      || String(row.apply_worker_claim_id).length === 0
      || Number(row.apply_claim_epoch) < 1
      || !same(row.attempt_checked_at, response.checkedAt)
    ) {
      throw new Error("Committed canvas authority failed integrity.");
    }
    this.#validateTerminal(commandId, receipt, event.sequence);
    return receipt;
  }

  #validateTerminal(
    commandId: string,
    receipt: CanvasCommittedEffectReceipt,
    eventSequence: number,
  ): void {
    const terminal = this.#database.one(
      `SELECT outbox.record_json, outbox.phase, commands.state,
              trace_projection_outbox.state AS projection_state,
              trace_projection_outbox.project_id AS projection_project_id,
              trace_projection_outbox.sequence AS projection_sequence,
              trace_projection_outbox.event_hash AS projection_event_hash
       FROM outbox JOIN commands ON commands.id = outbox.command_id
       JOIN trace_projection_outbox
         ON trace_projection_outbox.event_id = ?
       WHERE outbox.command_id = ?`,
      receipt.eventId,
      commandId,
    );
    const outbox =
      terminal === undefined
        ? undefined
        : OutboxRecordSchema.safeParse(parsed(terminal.record_json));
    if (
      terminal === undefined ||
      !outbox?.success ||
      outbox.data.phase !== "committed" ||
      outbox.data.traceEventId !== receipt.eventId ||
      !same(terminal.phase, "committed") ||
      !same(terminal.state, "committed") ||
      !same(terminal.projection_state, "pending") ||
      !same(terminal.projection_project_id, receipt.projectId) ||
      Number(terminal.projection_sequence) !== eventSequence ||
      !same(terminal.projection_event_hash, receipt.eventHash)
    ) {
      throw new Error("Committed canvas terminal state is incoherent.");
    }
  }
}
