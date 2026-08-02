# ADR 0014: Indirect large evidence through a classified artifact store

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Product Security, Data/Storage Engineering

## Context

Screenshots, DOM snapshots, logs, patches, reports, and browser evidence are too
large for semantic events. They may also contain secrets, personal data, or
authenticated state.

## Decision

Large evidence is stored by a verified SHA-256 content hash and referenced by a
branded ArtifactId. Before persistence, every artifact is classified as public,
project-private, sensitive, authentication, or prohibited and passes the
required redaction policy.

Authentication and prohibited material never enters the content-addressed store.
Sensitive material enters only after redaction is complete. Browser network
bodies are opt-in. Diagnostic export previews exact included, omitted, redacted,
and corrupt artifacts before confirmation.

Artifacts have project and retention ownership, reference counts, visible
quotas, hash scrubbing, and recoverable garbage-collection quarantine.

## Consequences

- Trace payloads contain references, not base64 evidence.
- Disk pressure pauses capture instead of deleting referenced evidence.
- Credentials and browser storage live only in the encrypted local vault.

## Acceptance evidence

- Seeded secret, cookie, token, and PII tests prove boundary redaction.
- Corrupt and missing artifacts remain explicit during replay and export.
- Garbage collection never removes a referenced artifact.
