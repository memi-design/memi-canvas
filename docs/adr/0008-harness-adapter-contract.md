# ADR 0008: Normalize harnesses behind a provider-neutral contract

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, AI Systems

## Context

Codex, Claude, and future harnesses expose different session and streaming
models. Provider-specific state in the shared task model would make handoff,
replay, permissions, and evaluation unreliable.

## Decision

Harness adapters consume a versioned provider-neutral task context and emit a
closed stream of normalized events. Shared state may record harness and model
identity but never raw provider session, conversation, response, or event
objects.

Mutations are available only through typed scoped services. Every mutating call
includes an idempotency key, expected-before hash, target lease, fencing epoch,
and capability grant. Auto routing is deterministic and records candidates,
disqualifications, scores, selection, and cost.

## Consequences

- Codex and Claude must pass one conformance suite.
- Switching harnesses preserves goal, selection, criteria, and pending work.
- Provider additions cannot expand shared protocol fields without a versioned
  protocol decision.

## Acceptance evidence

- Fake, Codex, and Claude adapters pass the same contract tests.
- Recursive tests reject provider-specific fields in shared state.
- Stale leases, expired grants, and repeated idempotency keys fail closed.
