# ADR 0005: Use a local single-authority document operation log

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Canvas Engineering

## Context

Canvas state needs deterministic undo, restart, checkpoints, and future
collaboration compatibility. Hosted CRDT convergence is not required for 1.0 and
must not complicate the initial authority model.

## Decision

The authoritative canvas document is reconstructed from strict, versioned,
immutable semantic operations plus periodic snapshots. Each operation includes:

- a branded operation and document ID;
- actor and occurrence time;
- a discriminated operation type and strict payload;
- expected-before and resulting state hashes; and
- sufficient prior values to derive or validate its inverse.

Operation and semantic trace metadata are committed atomically through the
SQLite transaction protocol. Snapshots are accelerators, not independent truth.

Yjs may encode DraftFrame internals later, but the local operation log remains
the M1 authority. Hosted synchronization and awareness are deferred.

## Consequences

- Canvas undo appends an inverse operation rather than deleting history.
- Replayed operations must produce the same document hash.
- Unknown operation types and schema versions fail closed.

## Acceptance evidence

- 1,000 randomized operations replay and invert correctly.
- A crash at each outbox boundary reconciles without a ghost operation.
- Replay performs no tool, Git, network, or current-state mutation.
