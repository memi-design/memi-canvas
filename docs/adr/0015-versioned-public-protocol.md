# ADR 0015: Publish a strict, versioned protocol package

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Developer Experience

## Context

The web client, workspace runtime, adapters, tests, exports, and future external
tools need the same boundary contracts. Permissive parsing would silently accept
provider leakage, stale writers, or data from unknown protocol versions.

## Decision

`@memi/protocol` is the canonical package for branded IDs, strict Zod schemas,
wire-safe inferred types, error codes, and compatibility fixtures.

Every durable top-level object has `schemaVersion`. M1 accepts only version 1.
Missing, legacy, and unknown future versions fail closed at the boundary.
Objects reject unknown keys. Discriminated unions are closed. IDs use a
domain-specific prefix plus canonical sortable identifier and are branded in
TypeScript so IDs from different domains are not assignable.

Schema changes are:

- backward-compatible additions only when old readers remain safe;
- migrations for persisted data;
- a new schema version for changed meaning or removed/required fields; and
- conformance fixtures before release.

## Consequences

- Internal storage models do not leak directly onto the wire.
- Consumers parse untrusted data instead of casting it.
- Version rejection is an intentional error, not best-effort coercion.

## Acceptance evidence

- RED contract tests cover all M1 durable objects before implementation.
- Runtime and client pass identical conformance fixtures.
- Missing, legacy, future, extra, malformed, and cross-domain inputs fail.
