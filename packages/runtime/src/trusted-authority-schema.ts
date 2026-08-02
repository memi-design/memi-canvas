export const TRUSTED_AUTHORITY_TABLES = [
  "trusted_authority_reservations",
  "trusted_command_authorities",
] as const;

export function trustedAuthorityReservationsTableSchema(
  name = "trusted_authority_reservations",
): string {
  return `
CREATE TABLE IF NOT EXISTS ${name} (
  id TEXT PRIMARY KEY,
  request_digest TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  operation_id TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  fencing_epoch INTEGER NOT NULL CHECK (fencing_epoch > 0),
  state TEXT NOT NULL CHECK (state IN ('reserved', 'issued')),
  expires_at TEXT NOT NULL,
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  reservation_json TEXT NOT NULL CHECK (json_valid(reservation_json))
) STRICT;`;
}

export function trustedCommandAuthoritiesTableSchema(
  name = "trusted_command_authorities",
): string {
  return `
CREATE TABLE IF NOT EXISTS ${name} (
  reservation_id TEXT PRIMARY KEY
    REFERENCES trusted_authority_reservations(id),
  command_id TEXT NOT NULL UNIQUE,
  grant_id TEXT NOT NULL UNIQUE REFERENCES capability_grants(id),
  approval_id TEXT NOT NULL UNIQUE REFERENCES approval_receipts(id),
  trust_root_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  trust_root_fingerprint TEXT NOT NULL,
  workspace_digest TEXT NOT NULL,
  plan_digest TEXT NOT NULL,
  batch_root_digest TEXT NOT NULL,
  issuance_digest TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  issuance_json TEXT NOT NULL CHECK (json_valid(issuance_json)),
  authority_json TEXT NOT NULL CHECK (json_valid(authority_json))
) STRICT;`;
}

export function trustedAuthoritySchema(): string {
  return `
${trustedAuthorityReservationsTableSchema()}
${trustedCommandAuthoritiesTableSchema()}
CREATE INDEX IF NOT EXISTS trusted_authority_scope
  ON trusted_command_authorities(batch_root_digest, command_id);
`;
}
