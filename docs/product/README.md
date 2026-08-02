# Memi Canvas product contracts

These documents define the M0 user experience before production implementation.
They are the product source of truth for the coded vertical slice.

Memi Canvas is standalone. None of these flows, artifacts, or acceptance gates
require Figma, a Figma account, a Figma file, or a Figma plugin.

## M0 contracts

- [`M0_PRODUCT_CHARTER.md`](M0_PRODUCT_CHARTER.md) defines the launch segment,
  product promise, golden journey, P0, P1, and non-goals.
- [`SUPPORTED_MODES.md`](SUPPORTED_MODES.md) defines what M0 demonstrates and
  prevents fixture or planned modes from becoming support claims.
- [`M0_VERTICAL_SLICE.md`](M0_VERTICAL_SLICE.md) defines the complete journey,
  information architecture, and responsive product-documentation model.
- [`CANONICAL_VOCABULARY.md`](CANONICAL_VOCABULARY.md) defines canonical
  nouns, frame authority, evidence levels, coverage states, and prohibited
  claims.
- [`INTERACTION_STATES.md`](INTERACTION_STATES.md) defines empty, loading,
  partial, blocked, recovery, agent-task, approval, and trace states.
- [`M0_ACCEPTANCE.md`](M0_ACCEPTANCE.md) defines user-facing RED acceptance
  criteria, including the keyboard-only proof path.
- [`WORKSPACE_DESIGN_AUDIT.md`](WORKSPACE_DESIGN_AUDIT.md) records the
  post-implementation workspace audit, competitive gap matrix, truth labels,
  hard domain boundaries, staged roadmap, and next vertical-slice gates.

## M0 product rule

The coded slice must prove one honest loop:

> import deterministically, understand coverage, select evidence, assign a
> scoped agent task, inspect the proposal, approve it, verify it, trace it, and
> restore the prior checkpoint.

The M0 implementation may use deterministic fixtures for unavailable runtime
capabilities. A simulated capability must be labeled `Demo` in the interface
and must never be presented as a live repository operation.
