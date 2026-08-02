# ADR 0007: Store semantic trace events and make replay pure

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, AI Systems, Data/Evaluation

## Context

Users need to understand and recover agent and human work without persisting
private reasoning or accidentally repeating external effects.

## Decision

The trace is append-only and composed of strict semantic events. Events include
branded identity, ordering, actor, correlation and causation, compact typed
payload, artifact references, state hashes, approvals, verification, and an
integrity hash chain.

Large or sensitive evidence is referenced through classified artifacts rather
than embedded. Private chain-of-thought is neither requested nor stored.

Replay reducers are pure. They reconstruct historical state without tools,
network, Git, current canvas mutation, or external dispatch. Forking creates new
task or project state from a checkpoint. It does not resume past side effects.

## Consequences

- Provider streams are normalized before persistence.
- Unknown event families and schema versions fail closed.
- Recovery reports resumed, interrupted, blocked, or failed without claiming
  exactly-once external delivery.

## Acceptance evidence

- 10,000 events replay to the same state hash.
- Duplicate and out-of-order event tests are deterministic.
- Chaos tests prove replay cannot dispatch an external effect.
