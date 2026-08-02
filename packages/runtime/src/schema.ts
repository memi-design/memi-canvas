import {
  TRUSTED_AUTHORITY_TABLES,
  trustedAuthoritySchema,
} from "./trusted-authority-schema.js";

export const AUTHORITATIVE_TABLES = [
  "approval_receipts",
  "approval_uses",
  "capability_grants",
  "capability_grant_uses",
  "commands",
  "effect_receipts",
  "harness_checkpoints",
  "harness_handoffs",
  "harness_lifecycle_events",
  "harness_runs",
  "harness_tasks",
  "harness_trace_refs",
  "leases",
  "legacy_effect_receipts",
  "legacy_trace_references",
  "outbox",
  "recovery_decisions",
  "run_state",
  "target_receipts",
  "target_recovery_evidence",
  "target_schedule_latches",
  "target_verification_attempts",
  "trace_effect_bindings",
  "trace_events",
  "trace_heads",
  "trace_projection_outbox",
  ...TRUSTED_AUTHORITY_TABLES,
] as const;

export const MAX_CANONICAL_TRACE_JSON_BYTES = 65_536;

export function commandsTableSchemaV2(
  name = "commands",
): string {
  return `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES capability_grants(id),
  approval_id TEXT NOT NULL REFERENCES approval_receipts(id),
  state TEXT NOT NULL,
  command_json TEXT NOT NULL,
  effect_payload_json TEXT NOT NULL,
  UNIQUE (project_id, idempotency_key)
) STRICT;`;
}

export function commandsTableSchema(name = "commands"): string {
  return `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES capability_grants(id),
  approval_id TEXT NOT NULL REFERENCES approval_receipts(id),
  state TEXT NOT NULL,
  command_json TEXT NOT NULL CHECK (json_valid(command_json)),
  effect_payload_json TEXT NOT NULL CHECK (json_valid(effect_payload_json)),
  UNIQUE (project_id, idempotency_key),
  UNIQUE (id, project_id, target_kind, target_id)
) STRICT;`;
}

export function outboxTableSchemaV2(name = "outbox"): string {
  return `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE REFERENCES commands(id),
  phase TEXT NOT NULL,
  record_json TEXT NOT NULL,
  worker_id TEXT,
  claim_epoch INTEGER NOT NULL DEFAULT 0,
  claim_expires_at TEXT
) STRICT;`;
}

export function outboxTableSchema(name = "outbox"): string {
  return `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  worker_id TEXT,
  claim_epoch INTEGER NOT NULL DEFAULT 0,
  claim_expires_at TEXT,
  UNIQUE (id, command_id, project_id, target_kind, target_id),
  FOREIGN KEY (command_id, project_id, target_kind, target_id)
    REFERENCES commands(id, project_id, target_kind, target_id)
) STRICT;`;
}

export function targetReceiptsTableSchema(
  name = "target_receipts",
): string {
  return `
CREATE TABLE ${name} (
  command_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (
    outbox_id, command_id, project_id, target_kind, target_id
  ) REFERENCES outbox(
    id, command_id, project_id, target_kind, target_id
  )
) STRICT;`;
}

export function targetScheduleLatchesTableSchema(
  name = "target_schedule_latches",
): string {
  return `
CREATE TABLE ${name} (
  project_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  outbox_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (
    state IN (
      'pending-fence',
      'active',
      'pending-commit',
      'blocked-unknown',
      'retry-ready'
    )
  ),
  worker_claim_id TEXT,
  claim_epoch INTEGER NOT NULL,
  recovery_json TEXT CHECK (
    recovery_json IS NULL OR json_valid(recovery_json)
  ),
  acquired_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, target_kind, target_id),
  FOREIGN KEY (
    outbox_id, command_id, project_id, target_kind, target_id
  ) REFERENCES outbox(
    id, command_id, project_id, target_kind, target_id
  )
) STRICT;`;
}

export function targetRecoveryEvidenceTableSchema(
  name = "target_recovery_evidence",
): string {
  return `
CREATE TABLE ${name} (
  sequence INTEGER PRIMARY KEY,
  request_digest TEXT NOT NULL UNIQUE,
  challenge_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL REFERENCES commands(id),
  outbox_id TEXT NOT NULL REFERENCES outbox(id),
  disposition TEXT NOT NULL CHECK (
    disposition IN (
      'accepted-found',
      'accepted-not-found',
      'blocked-target',
      'rejected-response'
    )
  ),
  checked_at TEXT,
  evidence_hash TEXT,
  response_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  recorded_at TEXT NOT NULL
) STRICT;`;
}

export function leasesTableSchemaV3(name = "leases"): string {
  return `
CREATE TABLE ${name} (
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  fencing_epoch INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  lease_json TEXT NOT NULL,
  PRIMARY KEY (project_id, target_id)
) STRICT;`;
}

export function leasesTableSchema(name = "leases"): string {
  return `
CREATE TABLE ${name} (
  id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  holder_id TEXT NOT NULL,
  fencing_epoch INTEGER NOT NULL,
  phase TEXT NOT NULL CHECK (
    phase IN ('pending-fence', 'target-activated', 'active')
  ),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  target_activated_at TEXT,
  activated_at TEXT,
  activation_json TEXT CHECK (
    activation_json IS NULL OR json_valid(activation_json)
  ),
  lease_json TEXT NOT NULL CHECK (json_valid(lease_json)),
  PRIMARY KEY (project_id, target_id)
) STRICT;`;
}

export function recoveryDecisionsTableSchema(
  name = "recovery_decisions",
): string {
  return `
CREATE TABLE ${name} (
  sequence INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL REFERENCES commands(id),
  decision_json TEXT NOT NULL
) STRICT;`;
}

const authorityBaseSchema = `
CREATE TABLE IF NOT EXISTS capability_grants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  grant_json TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS approval_receipts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL
) STRICT;
`;

const authorityUseSchema = `
CREATE TABLE IF NOT EXISTS capability_grant_uses (
  grant_id TEXT NOT NULL REFERENCES capability_grants(id),
  command_id TEXT NOT NULL UNIQUE REFERENCES commands(id),
  use_number INTEGER NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (grant_id, use_number)
) STRICT;

CREATE TABLE IF NOT EXISTS approval_uses (
  approval_id TEXT NOT NULL REFERENCES approval_receipts(id),
  command_id TEXT NOT NULL UNIQUE REFERENCES commands(id),
  use_number INTEGER NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (approval_id, use_number)
) STRICT;

${leasesTableSchemaV3()}
`;

export function legacyEffectReceiptsTableSchema(
  name = "legacy_effect_receipts",
): string {
  return `
CREATE TABLE ${name} (
  command_id TEXT PRIMARY KEY REFERENCES commands(id),
  receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json))
) STRICT;`;
}

export function legacyTraceReferencesTableSchema(
  name = "legacy_trace_references",
): string {
  return `
CREATE TABLE ${name} (
  command_id TEXT PRIMARY KEY REFERENCES commands(id),
  trace_event_id TEXT NOT NULL
) STRICT;`;
}

const runtimeTailSchema = `
${recoveryDecisionsTableSchema()}

CREATE TABLE IF NOT EXISTS run_state (
  run_id TEXT PRIMARY KEY,
  state_json TEXT NOT NULL
) STRICT;
`;

const legacyOutcomeSchemaV6 = `
CREATE TABLE effect_receipts (
  command_id TEXT PRIMARY KEY REFERENCES commands(id),
  receipt_json TEXT NOT NULL
) STRICT;

CREATE TABLE trace_references (
  command_id TEXT PRIMARY KEY REFERENCES commands(id),
  trace_event_id TEXT NOT NULL
) STRICT;

${runtimeTailSchema}
`;

const legacyOutcomeSchema = `
${legacyEffectReceiptsTableSchema()}
${legacyTraceReferencesTableSchema()}
${runtimeTailSchema}
`;

const hashCheck = (column: string) => `
    length(${column}) = 71
    AND substr(${column}, 1, 7) = 'sha256:'
    AND substr(${column}, 8) NOT GLOB '*[^0-9a-f]*'
`;

const timestampCheck = (column: string) => `
    length(${column}) = 24
    AND substr(${column}, 24, 1) = 'Z'
`;

export function harnessLifecycleSchema(): string {
  return `
CREATE TABLE harness_tasks (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  goal TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 32768),
  permission_ceiling_json TEXT NOT NULL CHECK (
    json_valid(permission_ceiling_json)
  ),
  token_budget INTEGER NOT NULL CHECK (token_budget >= 0),
  cost_budget_usd_micros INTEGER NOT NULL CHECK (
    cost_budget_usd_micros >= 0
  ),
  task_json TEXT NOT NULL CHECK (
    json_valid(task_json)
    AND length(CAST(task_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  task_hash TEXT NOT NULL CHECK (${hashCheck("task_hash")}),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")})
) STRICT;

CREATE TABLE harness_runs (
  run_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES harness_tasks(task_id),
  parent_run_id TEXT REFERENCES harness_runs(run_id),
  harness_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'queued',
      'running',
      'awaiting-approval',
      'paused',
      'stopped',
      'completed',
      'failed'
    )
  ),
  dispatch_epoch INTEGER NOT NULL CHECK (dispatch_epoch > 0),
  adapter_cursor INTEGER NOT NULL CHECK (adapter_cursor >= 0),
  remaining_token_budget INTEGER NOT NULL CHECK (
    remaining_token_budget >= 0
  ),
  remaining_cost_budget_usd_micros INTEGER NOT NULL CHECK (
    remaining_cost_budget_usd_micros >= 0
  ),
  checkpoint_id TEXT REFERENCES harness_checkpoints(checkpoint_id),
  last_event_sequence INTEGER NOT NULL CHECK (
    last_event_sequence >= 0
  ),
  last_event_hash TEXT CHECK (
    last_event_hash IS NULL OR (${hashCheck("last_event_hash")})
  ),
  failure_json TEXT CHECK (
    failure_json IS NULL OR json_valid(failure_json)
  ),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")}),
  updated_at TEXT NOT NULL CHECK (${timestampCheck("updated_at")}),
  CHECK (
    (
      last_event_sequence = 0
      AND last_event_hash IS NULL
    )
    OR (
      last_event_sequence > 0
      AND last_event_hash IS NOT NULL
    )
  )
) STRICT;

CREATE TABLE harness_lifecycle_events (
  run_id TEXT NOT NULL REFERENCES harness_runs(run_id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  dispatch_epoch INTEGER NOT NULL CHECK (dispatch_epoch > 0),
  event_type TEXT NOT NULL,
  previous_hash TEXT CHECK (
    previous_hash IS NULL OR (${hashCheck("previous_hash")})
  ),
  event_hash TEXT NOT NULL CHECK (${hashCheck("event_hash")}),
  event_json TEXT NOT NULL CHECK (
    json_valid(event_json)
    AND length(CAST(event_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")}),
  PRIMARY KEY (run_id, sequence),
  UNIQUE (run_id, event_hash),
  UNIQUE (run_id, sequence, event_hash),
  FOREIGN KEY (run_id, previous_hash)
    REFERENCES harness_lifecycle_events(run_id, event_hash)
) STRICT;

CREATE TABLE harness_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES harness_runs(run_id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  checkpoint_json TEXT NOT NULL CHECK (
    json_valid(checkpoint_json)
    AND length(CAST(checkpoint_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")}),
  UNIQUE (run_id, sequence),
  FOREIGN KEY (run_id, sequence)
    REFERENCES harness_lifecycle_events(run_id, sequence)
) STRICT;

CREATE TABLE harness_handoffs (
  handoff_id TEXT PRIMARY KEY,
  parent_run_id TEXT NOT NULL REFERENCES harness_runs(run_id),
  child_run_id TEXT NOT NULL UNIQUE REFERENCES harness_runs(run_id),
  packet_json TEXT NOT NULL CHECK (
    json_valid(packet_json)
    AND length(CAST(packet_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")})
) STRICT;

CREATE TABLE harness_trace_refs (
  run_id TEXT NOT NULL,
  lifecycle_sequence INTEGER NOT NULL CHECK (
    lifecycle_sequence > 0
  ),
  trace_event_id TEXT NOT NULL REFERENCES trace_events(id),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")}),
  PRIMARY KEY (run_id, lifecycle_sequence, trace_event_id),
  FOREIGN KEY (run_id, lifecycle_sequence)
    REFERENCES harness_lifecycle_events(run_id, sequence)
) STRICT;

CREATE TRIGGER harness_tasks_no_update
BEFORE UPDATE ON harness_tasks
BEGIN
  SELECT RAISE(ABORT, 'harness task authority is immutable');
END;

CREATE TRIGGER harness_tasks_no_delete
BEFORE DELETE ON harness_tasks
BEGIN
  SELECT RAISE(ABORT, 'harness task authority is immutable');
END;

CREATE TRIGGER harness_runs_immutable_attribution
BEFORE UPDATE ON harness_runs
WHEN
  NEW.run_id IS NOT OLD.run_id
  OR NEW.task_id IS NOT OLD.task_id
  OR NEW.parent_run_id IS NOT OLD.parent_run_id
  OR NEW.harness_id IS NOT OLD.harness_id
  OR NEW.model_id IS NOT OLD.model_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'harness run attribution is immutable');
END;

CREATE TRIGGER harness_runs_no_delete
BEFORE DELETE ON harness_runs
BEGIN
  SELECT RAISE(ABORT, 'harness run authority is immutable');
END;

CREATE TRIGGER harness_lifecycle_events_append_order
BEFORE INSERT ON harness_lifecycle_events
WHEN
  NEW.sequence IS NOT (
    SELECT COALESCE(MAX(sequence), 0) + 1
    FROM harness_lifecycle_events
    WHERE run_id = NEW.run_id
  )
  OR (
    NEW.sequence = 1
    AND NEW.previous_hash IS NOT NULL
  )
  OR (
    NEW.sequence > 1
    AND NEW.previous_hash IS NOT (
      SELECT event_hash
      FROM harness_lifecycle_events
      WHERE run_id = NEW.run_id
        AND sequence = NEW.sequence - 1
    )
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'harness lifecycle events must append to the hash chain'
  );
END;

CREATE TRIGGER harness_lifecycle_events_no_update
BEFORE UPDATE ON harness_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'harness lifecycle event is immutable');
END;

CREATE TRIGGER harness_lifecycle_events_no_delete
BEFORE DELETE ON harness_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'harness lifecycle event is immutable');
END;

CREATE TRIGGER harness_checkpoints_no_update
BEFORE UPDATE ON harness_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'harness checkpoint is immutable');
END;

CREATE TRIGGER harness_checkpoints_no_delete
BEFORE DELETE ON harness_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'harness checkpoint is immutable');
END;

CREATE TRIGGER harness_handoffs_no_update
BEFORE UPDATE ON harness_handoffs
BEGIN
  SELECT RAISE(ABORT, 'harness handoff is immutable');
END;

CREATE TRIGGER harness_handoffs_no_delete
BEFORE DELETE ON harness_handoffs
BEGIN
  SELECT RAISE(ABORT, 'harness handoff is immutable');
END;

CREATE TRIGGER harness_trace_refs_no_update
BEFORE UPDATE ON harness_trace_refs
BEGIN
  SELECT RAISE(ABORT, 'harness trace reference is immutable');
END;

CREATE TRIGGER harness_trace_refs_no_delete
BEFORE DELETE ON harness_trace_refs
BEGIN
  SELECT RAISE(ABORT, 'harness trace reference is immutable');
END;
`;
}

export function traceEventsTableSchema(
  name = "trace_events",
): string {
  return `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  task_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK (
    family = 'canvas.operation.committed'
  ),
  actor_kind TEXT NOT NULL CHECK (
    actor_kind IN ('human', 'agent', 'harness', 'system')
  ),
  actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 1024),
  command_id TEXT NOT NULL,
  outbox_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind = 'canvas-document'),
  target_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_action_digest TEXT NOT NULL CHECK (
    ${hashCheck("command_action_digest")}
  ),
  operation_action_digest TEXT NOT NULL CHECK (
    ${hashCheck("operation_action_digest")}
  ),
  expected_before_hash TEXT NOT NULL CHECK (
    ${hashCheck("expected_before_hash")}
  ),
  resulting_hash TEXT NOT NULL CHECK (
    ${hashCheck("resulting_hash")}
  ),
  target_receipt_hash TEXT NOT NULL CHECK (
    ${hashCheck("target_receipt_hash")}
  ),
  verification_request_digest TEXT NOT NULL CHECK (
    ${hashCheck("verification_request_digest")}
  ),
  verification_evidence_hash TEXT NOT NULL CHECK (
    ${hashCheck("verification_evidence_hash")}
  ),
  verification_checked_at TEXT NOT NULL CHECK (
    ${timestampCheck("verification_checked_at")}
  ),
  operation_id TEXT NOT NULL,
  applied_revision INTEGER NOT NULL CHECK (applied_revision >= 0),
  lease_id TEXT NOT NULL,
  fencing_epoch INTEGER NOT NULL CHECK (fencing_epoch > 0),
  occurred_at TEXT NOT NULL CHECK (${timestampCheck("occurred_at")}),
  event_action_digest TEXT NOT NULL CHECK (
    ${hashCheck("event_action_digest")}
  ),
  previous_event_hash TEXT CHECK (
    previous_event_hash IS NULL OR (${hashCheck("previous_event_hash")})
  ),
  event_hash TEXT NOT NULL UNIQUE CHECK (${hashCheck("event_hash")}),
  event_json TEXT NOT NULL CHECK (
    json_valid(event_json)
    AND length(CAST(event_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  UNIQUE (project_id, sequence),
  UNIQUE (project_id, event_hash),
  UNIQUE (id, project_id, sequence),
  UNIQUE (id, project_id, sequence, event_hash),
  UNIQUE (
    id, project_id, command_id, outbox_id, target_kind, target_id
  ),
  FOREIGN KEY (
    outbox_id, command_id, project_id, target_kind, target_id
  ) REFERENCES outbox(
    id, command_id, project_id, target_kind, target_id
  ),
  FOREIGN KEY (target_receipt_hash)
    REFERENCES target_receipts(receipt_hash),
  FOREIGN KEY (project_id, previous_event_hash)
    REFERENCES ${name}(project_id, event_hash)
) STRICT;`;
}

export function traceHeadsTableSchema(
  name = "trace_heads",
  eventsName = "trace_events",
): string {
  return `
CREATE TABLE ${name} (
  project_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
  last_event_id TEXT,
  last_event_hash TEXT,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  CHECK (
    (
      last_sequence = 0
      AND last_event_id IS NULL
      AND last_event_hash IS NULL
    )
    OR (
      last_sequence > 0
      AND last_event_id IS NOT NULL
      AND last_event_hash IS NOT NULL
      AND (${hashCheck("last_event_hash")})
    )
  ),
  FOREIGN KEY (
    project_id, last_sequence, last_event_id, last_event_hash
  ) REFERENCES ${eventsName}(
    project_id, sequence, id, event_hash
  )
) STRICT;`;
}

export function traceEffectBindingsTableSchema(
  name = "trace_effect_bindings",
  eventsName = "trace_events",
  attemptsName: string | null = "target_verification_attempts",
  closedAttemptBinding = true,
): string {
  return `
CREATE TABLE ${name} (
  command_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind = 'canvas-document'),
  target_id TEXT NOT NULL,
  ${attemptsName === null ? "" : "verification_attempt_id TEXT NOT NULL,"}
  ${attemptsName === null || !closedAttemptBinding ? "" : `verification_attempt_state TEXT NOT NULL
    CHECK (verification_attempt_state = 'accepted'),`}
  binding_digest TEXT NOT NULL CHECK (${hashCheck("binding_digest")}),
  target_receipt_hash TEXT NOT NULL CHECK (
    ${hashCheck("target_receipt_hash")}
  ),
  verification_request_digest TEXT NOT NULL CHECK (
    ${hashCheck("verification_request_digest")}
  ),
  verification_evidence_hash TEXT NOT NULL CHECK (
    ${hashCheck("verification_evidence_hash")}
  ),
  resulting_hash TEXT NOT NULL CHECK (${hashCheck("resulting_hash")}),
  committed_at TEXT NOT NULL CHECK (${timestampCheck("committed_at")}),
  UNIQUE (
    command_id, outbox_id, event_id, project_id, target_kind, target_id
  ),
  FOREIGN KEY (
    outbox_id, command_id, project_id, target_kind, target_id
  ) REFERENCES outbox(
    id, command_id, project_id, target_kind, target_id
  ),
  FOREIGN KEY (
    event_id, project_id, command_id, outbox_id, target_kind, target_id
  ) REFERENCES ${eventsName}(
    id, project_id, command_id, outbox_id, target_kind, target_id
  ),
  FOREIGN KEY (target_receipt_hash)
    REFERENCES target_receipts(receipt_hash)
  ${attemptsName === null ? "" : `, FOREIGN KEY (
    verification_attempt_id, verification_request_digest,
    command_id, outbox_id, target_receipt_hash
    ${closedAttemptBinding ? ", verification_attempt_state, verification_evidence_hash" : ""}
  ) REFERENCES ${attemptsName}(
    id, request_digest, command_id, outbox_id, target_receipt_hash
    ${closedAttemptBinding ? ", state, evidence_hash" : ""}
  )`}
) STRICT;`;
}

export function targetVerificationAttemptsTableSchema(
  name = "target_verification_attempts",
  closedAttemptBinding = true,
): string {
  return `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  outbox_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind = 'canvas-document'),
  target_id TEXT NOT NULL,
  claim_worker_id TEXT NOT NULL,
  claim_epoch INTEGER NOT NULL CHECK (claim_epoch > 0),
  claim_expires_at TEXT NOT NULL CHECK (
    ${timestampCheck("claim_expires_at")}
  ),
  apply_worker_claim_id TEXT NOT NULL,
  apply_claim_epoch INTEGER NOT NULL CHECK (apply_claim_epoch > 0),
  target_receipt_hash TEXT NOT NULL CHECK (
    ${hashCheck("target_receipt_hash")}
  ),
  request_digest TEXT NOT NULL UNIQUE CHECK (
    ${hashCheck("request_digest")}
  ),
  request_json TEXT NOT NULL CHECK (
    json_valid(request_json)
    AND length(CAST(request_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  state TEXT NOT NULL CHECK (
    state IN ('issued', 'accepted', 'rejected')
  ),
  evidence_hash TEXT CHECK (
    evidence_hash IS NULL OR (${hashCheck("evidence_hash")})
  ),
  response_json TEXT CHECK (
    response_json IS NULL OR (
      json_valid(response_json)
      AND length(CAST(response_json AS BLOB))
        BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
    )
  ),
  checked_at TEXT CHECK (
    checked_at IS NULL OR (${timestampCheck("checked_at")})
  ),
  issued_at TEXT NOT NULL CHECK (${timestampCheck("issued_at")}),
  resolved_at TEXT CHECK (
    resolved_at IS NULL OR (${timestampCheck("resolved_at")})
  ),
  CHECK (
    (
      state = 'issued'
      AND evidence_hash IS NULL
      AND response_json IS NULL
      AND checked_at IS NULL
      AND resolved_at IS NULL
    )
    OR (
      state IN ('accepted', 'rejected')
      AND evidence_hash IS NOT NULL
      AND response_json IS NOT NULL
      AND checked_at IS NOT NULL
      AND resolved_at IS NOT NULL
    )
  ),
  UNIQUE (
    id, request_digest, command_id, outbox_id, target_receipt_hash
  )${closedAttemptBinding ? `,
  UNIQUE (
    id, request_digest, command_id, outbox_id, target_receipt_hash,
    state, evidence_hash
  )` : ""},
  FOREIGN KEY (
    outbox_id, command_id, project_id, target_kind, target_id
  ) REFERENCES outbox(
    id, command_id, project_id, target_kind, target_id
  ),
  FOREIGN KEY (target_receipt_hash)
    REFERENCES target_receipts(receipt_hash)
) STRICT;`;
}

export function canonicalEffectReceiptsTableSchema(
  name = "effect_receipts",
  bindingsName = "trace_effect_bindings",
): string {
  return `
CREATE TABLE ${name} (
  command_id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind = 'canvas-document'),
  target_id TEXT NOT NULL,
  binding_digest TEXT NOT NULL CHECK (${hashCheck("binding_digest")}),
  receipt_hash TEXT NOT NULL UNIQUE CHECK (${hashCheck("receipt_hash")}),
  receipt_json TEXT NOT NULL CHECK (
    json_valid(receipt_json)
    AND length(CAST(receipt_json AS BLOB))
      BETWEEN 2 AND ${MAX_CANONICAL_TRACE_JSON_BYTES}
  ),
  committed_at TEXT NOT NULL CHECK (${timestampCheck("committed_at")}),
  FOREIGN KEY (
    command_id, outbox_id, event_id, project_id, target_kind, target_id
  ) REFERENCES ${bindingsName}(
    command_id, outbox_id, event_id, project_id, target_kind, target_id
  )
) STRICT;`;
}

export function traceProjectionOutboxTableSchema(
  name = "trace_projection_outbox",
  eventsName = "trace_events",
): string {
  return `
CREATE TABLE ${name} (
  event_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_hash TEXT NOT NULL CHECK (${hashCheck("event_hash")}),
  state TEXT NOT NULL CHECK (state = 'pending'),
  created_at TEXT NOT NULL CHECK (${timestampCheck("created_at")}),
  UNIQUE (project_id, sequence),
  FOREIGN KEY (event_id, project_id, sequence, event_hash)
    REFERENCES ${eventsName}(id, project_id, sequence, event_hash)
) STRICT;`;
}

export function traceAuthorityIndexesSchema(): string {
  return `
CREATE INDEX trace_events_effect_lookup
  ON trace_events(
    project_id, command_id, outbox_id, target_kind, target_id
  );
CREATE INDEX trace_effect_bindings_project_event
  ON trace_effect_bindings(project_id, event_id, target_kind, target_id);
CREATE INDEX trace_projection_pending_order
  ON trace_projection_outbox(state, project_id, sequence);
`;
}

const canonicalTraceAuthoritySchemaV7 = `
${traceEventsTableSchema()}
${traceHeadsTableSchema()}
${traceEffectBindingsTableSchema(
  "trace_effect_bindings",
  "trace_events",
  null,
)}
${canonicalEffectReceiptsTableSchema()}
${traceProjectionOutboxTableSchema()}
${traceAuthorityIndexesSchema()}
`;

const canonicalTraceAuthoritySchemaV8 = `
${traceEventsTableSchema()}
${traceHeadsTableSchema()}
${targetVerificationAttemptsTableSchema(
  "target_verification_attempts",
  false,
)}
${traceEffectBindingsTableSchema(
  "trace_effect_bindings",
  "trace_events",
  "target_verification_attempts",
  false,
)}
${canonicalEffectReceiptsTableSchema()}
${traceProjectionOutboxTableSchema()}
${traceAuthorityIndexesSchema()}
`;

const canonicalTraceAuthoritySchema = `
${traceEventsTableSchema()}
${traceHeadsTableSchema()}
${targetVerificationAttemptsTableSchema()}
${traceEffectBindingsTableSchema()}
${canonicalEffectReceiptsTableSchema()}
${traceProjectionOutboxTableSchema()}
${traceAuthorityIndexesSchema()}
`;

export const RUNTIME_SCHEMA_V2 = `
${authorityBaseSchema}
${commandsTableSchemaV2()}
${authorityUseSchema}
${outboxTableSchemaV2()}
${legacyOutcomeSchemaV6}
`;

export const RUNTIME_SCHEMA_V6 = `
${authorityBaseSchema}
${commandsTableSchema()}
${authorityUseSchema.replace(leasesTableSchemaV3(), leasesTableSchema())}
${outboxTableSchema()}

${targetReceiptsTableSchema()}
${targetRecoveryEvidenceTableSchema()}
${targetScheduleLatchesTableSchema()}

${legacyOutcomeSchemaV6}
`;

export const RUNTIME_SCHEMA_V7 = `
${authorityBaseSchema}
${commandsTableSchema()}
${authorityUseSchema.replace(leasesTableSchemaV3(), leasesTableSchema())}
${outboxTableSchema()}

${targetReceiptsTableSchema()}
${targetRecoveryEvidenceTableSchema()}
${targetScheduleLatchesTableSchema()}

${legacyOutcomeSchema}
${canonicalTraceAuthoritySchemaV7}
`;

export const RUNTIME_SCHEMA_V8 = `
${authorityBaseSchema}
${commandsTableSchema()}
${authorityUseSchema.replace(leasesTableSchemaV3(), leasesTableSchema())}
${outboxTableSchema()}

${targetReceiptsTableSchema()}
${targetRecoveryEvidenceTableSchema()}
${targetScheduleLatchesTableSchema()}

${legacyOutcomeSchema}
${canonicalTraceAuthoritySchemaV8}
`;

export const RUNTIME_SCHEMA = `
${authorityBaseSchema}
${commandsTableSchema()}
${authorityUseSchema.replace(leasesTableSchemaV3(), leasesTableSchema())}
${outboxTableSchema()}

${targetReceiptsTableSchema()}
${targetRecoveryEvidenceTableSchema()}
${targetScheduleLatchesTableSchema()}

${legacyOutcomeSchema}
${canonicalTraceAuthoritySchema}
${trustedAuthoritySchema()}
${harnessLifecycleSchema()}
`;
