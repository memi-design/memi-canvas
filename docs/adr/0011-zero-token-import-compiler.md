# ADR 0011: Keep the base import compiler deterministic and zero-token

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Import Engineering, Data/Evaluation

## Context

Import establishes product truth. Model-dependent discovery is variable,
expensive, difficult to reproduce, and can turn inference into false coverage.

## Decision

Framework detection, route and state discovery, source instrumentation, capture
planning, runtime capture, design-system extraction, hashing, diffing, and
coverage accounting use deterministic code only. Models may later explain
evidence or propose work, but cannot create, upgrade, or hide coverage status.

Each import fingerprints the source revision, dirty-file manifest, adapter
version, capture plan, and protocol version. Repeating an import under identical
inputs must produce stable manifest and artifact hashes, excluding explicitly
normalized volatile fields.

## Consequences

- Unsupported and blocked cells remain visible.
- Adapters require fixture-backed acceptance suites.
- Model quality cannot compensate for a weak import contract.

## Acceptance evidence

- Representative Vite and Next repositories import with zero model calls.
- Repeated static imports produce stable hashes.
- Every discovered route receives an explicit coverage classification.
