# Architecture decision records

These records define the decisions that must be accepted before their dependent
production implementation begins.

| ADR | Decision | Required before |
| --- | --- | --- |
| [0001](./0001-apache-repository.md) | Apache-2.0 standalone repository | M1 |
| [0002](./0002-workspace-runtime-boundary.md) | One local workspace runtime and web client | M1 |
| [0003](./0003-hybrid-spatial-renderer.md) | Hybrid DOM/SVG spatial renderer | M1 |
| [0004](./0004-frame-ownership.md) | DraftFrame and CodeFrame ownership | M1 |
| [0005](./0005-local-document-operation-log.md) | Local document operation log | M1 |
| [0006](./0006-authoritative-storage-boundaries.md) | SQLite, artifact, document, and Git authorities | M1 |
| [0007](./0007-semantic-trace-and-pure-replay.md) | Semantic trace and pure replay | M1 |
| [0008](./0008-harness-adapter-contract.md) | Provider-neutral harness contract | M1 |
| [0011](./0011-zero-token-import-compiler.md) | Zero-token deterministic import | M1 |
| [0013](./0013-no-figma-compatibility-layer.md) | No Figma compatibility layer | M1 |
| [0014](./0014-content-addressed-artifact-indirection.md) | Artifact indirection and privacy | M1 |
| [0015](./0015-versioned-public-protocol.md) | Strict versioned public protocol | M1 |

## Status vocabulary

- **Proposed:** review is incomplete and dependent production work is blocked.
- **Accepted:** accountable owners approved the decision and its validation gate.
- **Superseded:** a later ADR replaces the decision.
- **Rejected:** the option must not be implemented.

Feasibility spikes and tests may run while an ADR is Proposed. Production code
that depends on an ADR may not begin until the ADR is Accepted.
