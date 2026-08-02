# M0 product charter

- Status: Draft for M0 review
- Accountable approvers: Founder/Product Lead and Principal PM
- Design owner: Principal Product Designer
- Implementation authorized: No

## Product

Memi Canvas is a standalone, local-first workspace for understanding,
documenting, changing, and verifying real software products with humans and
agents working from the same evidence.

Memi remembers the product, Trace explains the work, and Canvas provides the
shared place to understand and create. These are one product system.

## Launch segment

Primary:

- Design engineers and frontend engineers working in local React products
- Product designers who need trustworthy access to implemented screens,
  components, tokens, and responsive states

Secondary:

- Design-system owners
- Product managers and researchers documenting implemented journeys
- Agent operators coordinating Codex, Claude, and future harnesses

M0 does not validate enterprise administration, hosted multiplayer, native
mobile-code editing, or non-web design creation.

## Problem

Existing product understanding is fragmented across source code, running
applications, screenshots, design files, tests, documentation, and agent
transcripts. Teams spend substantial manual effort reconstructing:

- Which screens and states exist
- Which responsive variants work
- Which components and tokens are actually used
- Which source owns a visible element
- What an agent changed and why
- Whether a proposed change was verified
- How to restore the prior state

Tools often overclaim completeness or convert screenshots into apparently
editable objects without preserving source truth.

## Promise

Import or create a product, see what is verified and what is missing, collaborate
with an agent on exact selected context, and approve, verify, trace, or restore
the result.

The deterministic base import uses zero model tokens.

## Golden journey

1. Import a local React product read-only.
2. Review the deterministic capture plan and zero-token boundary.
3. Inspect the responsive screen matrix and coverage gaps.
4. Open a source-linked screen, component, and design-system evidence.
5. Select exact task context.
6. Choose Auto or a named harness and a scoped permission.
7. Follow visible agent work.
8. Review a ghost proposal or ChangeSet.
9. Approve selected operations.
10. Verify affected screen states.
11. Inspect the causal trace.
12. Restore the prior checkpoint.

## P0 product capabilities

- Standalone project home and workspace
- Blank native canvas project
- Deterministic local-repository import
- Explicit route, state, viewport, role, theme, and flag coverage
- Desktop, tablet, and mobile screen matrix
- Frame authority, evidence, and health labels
- Screen, component, token, flow, evidence, and finding views
- Native design-system visualization
- Source references with safe abstention
- Selection-based task context
- Human and agent task cards
- Harness selection and handoff
- Scoped permissions and approvals
- Draft proposals and ChangeSets
- Targeted verification
- Semantic trace, checkpoints, replay, and restore
- Keyboard-accessible non-spatial canvas outline
- Local-first data boundary

## P1 capabilities

- Authenticated runtime capture
- Recorded human journeys converted into replayable flows
- Additional web-framework adapters
- Storybook-first component import
- Team comments and hosted sharing
- Background scheduled tasks
- Optional browser and research connectors
- External-agent MCP
- Export to open formats and production code

P1 work cannot weaken P0 evidence, permission, replay, or source-ownership
contracts.

## Non-goals

- Rebuilding Figma or carrying a Figma compatibility layer
- Treating screenshots as source-owned editable implementations
- Using a model to fabricate import completeness
- General-purpose IDE or arbitrary shell terminal
- Hidden autonomous source mutation
- Automatic commit, push, pull request, deployment, payment, or deletion
- Persisting private chain-of-thought
- Hosted collaboration as the local document authority
- Requiring Rust or Tauri product logic

## User outcomes

A successful user can:

- Identify verified, partial, blocked, stale, inferred, and reference-only work
- Find a route, state, component, token, and source reference
- Compare mobile, tablet, and desktop behavior
- See exactly what context an agent can access
- Understand the consequence of approval
- Switch harnesses without reconstructing the task
- Verify the affected dependency set
- Replay activity without rerunning external effects
- Restore accepted state safely

## Product-level acceptance

M0 may pass only when the coded fixture demonstrates the full golden journey
and the RED criteria in [`M0_ACCEPTANCE.md`](M0_ACCEPTANCE.md) pass.

M1 remains blocked until the supported-mode, architecture, security, legal,
evaluation, and release evidence is separately approved.

## Open review decisions

- Named launch-customer cohort
- Quantitative target for time to first trustworthy matrix
- Required 1.0 framework set beyond Vite/React
- Whether hosted sharing is required for beta
- Whether source ChangeSets enter alpha or remain M5-only
