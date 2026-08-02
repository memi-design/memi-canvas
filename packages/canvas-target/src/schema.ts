export const TARGET_AUTHORITY_TABLES = [
  "documents",
  "idempotency_ledger",
  "operations",
  "receipts",
  "target_fences",
] as const;

export const TARGET_AUTHORITY_SCHEMA_VERSION = 1;

export const TARGET_AUTHORITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 256),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  state_hash TEXT NOT NULL CHECK (
    length(state_hash) = 71
    AND substr(state_hash, 1, 7) = 'sha256:'
    AND substr(state_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  document_record_hash TEXT NOT NULL CHECK (
    length(document_record_hash) = 71
    AND substr(document_record_hash, 1, 7) = 'sha256:'
    AND substr(document_record_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  document_json TEXT NOT NULL CHECK (
    json_valid(document_json)
    AND length(CAST(document_json AS BLOB)) BETWEEN 2 AND 1048576
    AND json_extract(document_json, '$.schemaVersion') = 1
  ),
  PRIMARY KEY (project_id, target_id)
) STRICT;

CREATE TABLE IF NOT EXISTS target_fences (
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 256),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256),
  highest_fence INTEGER NOT NULL CHECK (highest_fence > 0),
  lease_id TEXT NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 256),
  holder_id TEXT NOT NULL CHECK (length(holder_id) BETWEEN 1 AND 1024),
  activation_json TEXT NOT NULL CHECK (
    json_valid(activation_json)
    AND length(CAST(activation_json AS BLOB)) BETWEEN 2 AND 1048576
    AND json_extract(activation_json, '$.schemaVersion') = 1
  ),
  PRIMARY KEY (project_id, target_id),
  FOREIGN KEY (project_id, target_id)
    REFERENCES documents(project_id, target_id)
) STRICT;

CREATE TABLE IF NOT EXISTS operations (
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 256),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 256),
  command_id TEXT NOT NULL UNIQUE
    CHECK (length(command_id) BETWEEN 1 AND 256),
  operation_json TEXT NOT NULL CHECK (
    json_valid(operation_json)
    AND length(CAST(operation_json AS BLOB)) BETWEEN 2 AND 1048576
    AND json_extract(operation_json, '$.schemaVersion') = 1
  ),
  operation_hash TEXT NOT NULL CHECK (
    length(operation_hash) = 71
    AND substr(operation_hash, 1, 7) = 'sha256:'
    AND substr(operation_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  resulting_hash TEXT NOT NULL CHECK (
    length(resulting_hash) = 71
    AND substr(resulting_hash, 1, 7) = 'sha256:'
    AND substr(resulting_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  applied_revision INTEGER NOT NULL CHECK (applied_revision > 0),
  applied_at TEXT NOT NULL CHECK (
    length(applied_at) BETWEEN 20 AND 35
    AND julianday(applied_at) IS NOT NULL
  ),
  PRIMARY KEY (project_id, target_id, operation_id),
  UNIQUE (
    project_id, target_id, operation_id, command_id, operation_hash,
    resulting_hash, applied_revision, applied_at
  ),
  FOREIGN KEY (project_id, target_id)
    REFERENCES documents(project_id, target_id)
) STRICT;

CREATE TABLE IF NOT EXISTS receipts (
  receipt_hash TEXT PRIMARY KEY CHECK (
    length(receipt_hash) = 71
    AND substr(receipt_hash, 1, 7) = 'sha256:'
    AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 256),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256),
  command_id TEXT NOT NULL UNIQUE
    CHECK (length(command_id) BETWEEN 1 AND 256),
  receipt_json TEXT NOT NULL CHECK (
    json_valid(receipt_json)
    AND length(CAST(receipt_json AS BLOB)) BETWEEN 2 AND 1048576
    AND json_extract(receipt_json, '$.schemaVersion') = 1
    AND json_extract(
      receipt_json,
      '$.adapterContractVersion'
    ) = 1
  ),
  UNIQUE (project_id, target_id, command_id, receipt_hash),
  FOREIGN KEY (project_id, target_id)
    REFERENCES documents(project_id, target_id)
) STRICT;

CREATE TABLE IF NOT EXISTS idempotency_ledger (
  project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 256),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL
    CHECK (length(idempotency_key) BETWEEN 1 AND 256),
  task_id TEXT NOT NULL CHECK (length(task_id) BETWEEN 1 AND 256),
  run_id TEXT NOT NULL CHECK (length(run_id) BETWEEN 1 AND 256),
  outbox_id TEXT NOT NULL CHECK (length(outbox_id) BETWEEN 1 AND 256),
  command_id TEXT NOT NULL CHECK (length(command_id) BETWEEN 1 AND 256),
  command_action_digest TEXT NOT NULL CHECK (
    length(command_action_digest) = 71
    AND substr(command_action_digest, 1, 7) = 'sha256:'
    AND substr(command_action_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  operation_action_digest TEXT NOT NULL CHECK (
    length(operation_action_digest) = 71
    AND substr(operation_action_digest, 1, 7) = 'sha256:'
    AND substr(operation_action_digest, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  payload_hash TEXT NOT NULL CHECK (
    length(payload_hash) = 71
    AND substr(payload_hash, 1, 7) = 'sha256:'
    AND substr(payload_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  expected_before_hash TEXT NOT NULL CHECK (
    length(expected_before_hash) = 71
    AND substr(expected_before_hash, 1, 7) = 'sha256:'
    AND substr(expected_before_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  lease_id TEXT NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 256),
  lease_holder_id TEXT NOT NULL
    CHECK (length(lease_holder_id) BETWEEN 1 AND 1024),
  fencing_epoch INTEGER NOT NULL CHECK (fencing_epoch > 0),
  worker_claim_id TEXT NOT NULL
    CHECK (length(worker_claim_id) BETWEEN 1 AND 256),
  worker_claim_epoch INTEGER NOT NULL CHECK (worker_claim_epoch > 0),
  resulting_hash TEXT NOT NULL CHECK (
    length(resulting_hash) = 71
    AND substr(resulting_hash, 1, 7) = 'sha256:'
    AND substr(resulting_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 256),
  operation_hash TEXT NOT NULL CHECK (
    length(operation_hash) = 71
    AND substr(operation_hash, 1, 7) = 'sha256:'
    AND substr(operation_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  applied_revision INTEGER NOT NULL CHECK (applied_revision > 0),
  applied_at TEXT NOT NULL CHECK (
    length(applied_at) BETWEEN 20 AND 35
    AND julianday(applied_at) IS NOT NULL
  ),
  receipt_hash TEXT NOT NULL CHECK (
    length(receipt_hash) = 71
    AND substr(receipt_hash, 1, 7) = 'sha256:'
    AND substr(receipt_hash, 8) NOT GLOB '*[^0-9a-f]*'
  ),
  adapter_contract_version INTEGER NOT NULL
    CHECK (adapter_contract_version = 1),
  PRIMARY KEY (project_id, target_id, idempotency_key),
  FOREIGN KEY (project_id, target_id)
    REFERENCES documents(project_id, target_id),
  FOREIGN KEY (
    project_id, target_id, operation_id, command_id, operation_hash,
    resulting_hash, applied_revision, applied_at
  ) REFERENCES operations (
    project_id, target_id, operation_id, command_id, operation_hash,
    resulting_hash, applied_revision, applied_at
  ),
  FOREIGN KEY (project_id, target_id, command_id, receipt_hash)
    REFERENCES receipts (
      project_id, target_id, command_id, receipt_hash
    )
) STRICT;
`;
