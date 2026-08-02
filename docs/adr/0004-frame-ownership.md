# ADR 0004: Separate DraftFrame and CodeFrame ownership

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Product Design, Canvas Engineering

## Context

Repository-backed product screens and canvas-created concepts have different
authorities. Treating a captured product screen as freely editable creates false
source claims; treating a draft as code-owned prevents lightweight exploration.

## Decision

Frame ownership is explicit and closed:

- **DraftFrame:** canvas-owned content changed through document operations.
- **CodeFrame:** source-owned representation backed by route, state, capture, and
  source anchors. Changes require a proposed ChangeSet.
- **SnapshotFrame:** immutable evidence at a source revision and capture plan.
- **ReferenceFrame:** annotation-only external or screenshot material.

Conversion never happens implicitly. A proposal to turn a DraftFrame into source
or a CodeFrame into a detached draft creates a new object and preserves
provenance.

## Consequences

- Canvas undo cannot mutate source.
- CodeFrame visual edits are proposals until approved and verified.
- Lower-truth import modes cannot satisfy source-editing claims.

## Acceptance evidence

- Protocol schemas reject ambiguous ownership.
- The UI visibly distinguishes all four frame kinds.
- Golden tests prove DraftFrame undo and CodeFrame ChangeSet paths separately.
