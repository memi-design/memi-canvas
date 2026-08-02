# Memi Canvas gap analysis

## Diagnosis

Memi's current gap is a product-convergence problem, not a lack-of-code problem. The checkout contains a real editor, deterministic import and provenance systems, a durable runtime spine, trace, permissions, Browser, Runs, and persistence. The default user journey does not connect them into one completed change.

![Memi local-only prompt receipt](screenshots/memi/10-prompt-local-result.png)

The central gap is visible here: the prompt is accepted and traced, but remains local because no harness adapter is connected.

Cause codes:

- `CAP`: missing capability
- `IXD`: interaction design
- `VIS`: visual design
- `ARCH`: system architecture
- `IMPL`: incomplete implementation
- `STRAT`: product strategy

## Implementation outcome, 2026-07-29

The current uncommitted M0 Demo slice partially closes P1, P3, P4, P5, P8,
P10, I1, I2, I3, I7, I8, I9, T1, T3, T8, and T10:

- Product Map replaces the flat default inventory with grouped, searchable
  authority, status, and freshness projections.
- A selected source-backed node carries revision, source, permission, harness,
  model, reasoning, viewport, project, document, and full node-snapshot context
  into an inspectable task envelope.
- The deterministic Canvas runtime persists project-scoped run state and
  supports request changes, exact approval, canvas-only apply, verify, cancel,
  reject, checkpoint, rollback, restore, and reload recovery.
- Restore is a reviewed, revision-fenced command with a count-level diff,
  explicit external-effect exclusions, exact post-commit digest validation,
  semantic history, and a verified recovery event. Local Demo persistence is
  bounded and surfaces load, quota, and save failures as volatile recovery.
- Browser uses Connecting, Ready, Stale, Error, and Stopped states. Ready is
  accepted only from an exact same-origin Demo fixture handshake bound to
  session, project, and document revision.
- Complete requires the applied proposal node digest and a current Demo Browser
  receipt. The interface explicitly says repository verification was not
  performed.

This is a bounded Demo closure, not production completion. P2, P6, P7, P9,
I5, I6, I10, T2, T4, T5, T6, and T7 remain open. The Product Security VETO
continues to block production provider, authenticated MCP, arbitrary
repository execution, trusted capture, source writes, Git, shell/process,
network, and publishing authority. The pinned design audit still scores 46 and
reports broad raw-color and motion-token debt, so the Ruby visual reset is not
claimed complete.

## Top 10 product gaps

| ID | Cause | User problem and evidence | Current Memi state | Proposed change and why | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | IMPL | The central prompt promises action but ends locally. MagicPath centers a working agent thread [SHOT-MAG-003]; Memi records no adapter [SHOT-MEM-010]. | Local task envelope and trace only. | Connect the default Canvas consumer to the local runtime and stream normalized run events. This completes the core promise. | Runtime adapter, event transport, cancellation | Unsafe authority coupling | A selection prompt creates a durable run, streams state, can cancel, and never claims completion without a terminal event. |
| P2 | ARCH | Users cannot review the exact source impact. Figma pairs selection and properties; MagicPath pairs selection and agent context. | Patch approval component exists, but no primary source ChangeSet flow. | Make typed ChangeSet plus visual preview the unit of proposal. | ChangeSet schema, diff renderer, target authority | Diff may misrepresent generated files | Every proposal lists exact files, operations, base revision, visual targets, and verification plan before approval. |
| P3 | IXD | Repository intelligence appears as counts and a flat dump. Paper and Figma make structure navigable. | 71 routes, 213 frames, 258 layers, many placeholders [SHOT-MEM-007, 017, 019]. | Replace Files with grouped Product Map: routes, screens, components, tokens, evidence, and freshness. | Product graph query and virtualized tree | Hiding useful raw evidence | In a scripted test with the Buzzr fixture and a cold-open Product Map, 5 representative route/component lookup tasks each complete through keyboard or pointer navigation with the correct ownership and freshness visible, no raw placeholder scrolling, and median completion under 10 seconds across 5 participants. |
| P4 | IMPL | Browser state can overclaim readiness. | `Preview running` follows URL acceptance while embedded content remained blank [SHOT-MEM-005]. | Add connecting, ready, blocked, error, and stale states driven by handshake and load/error evidence. | Runtime health endpoint or bridge | Cross-origin limitations | Running appears only after a successful readiness signal; failure shows cause, retry, logs, and last good frame. |
| P5 | IXD | Agent collaboration is a one-shot field rather than a durable conversation. | Prompt plus trace, no thread object in primary UI. | Add project-scoped threads with references, skills, runs, decisions, and handoffs. | Durable task/run store and thread projection | Conversation clutter | A reopened project restores thread context, linked selection, run receipts, approvals, and unresolved decisions. |
| P6 | IMPL | Imported screens are not yet a dependable cache of the current repository. | Buzzr fixture and static read-only source inventory. | Add explicit Generate, Refresh, Compare, Discard, and Regenerate cache actions. | Import compiler, artifact resolver, invalidation | Expensive or stale regeneration | Every cached screen shows source revision, generated time, stale reason, and deterministic refresh receipt. |
| P7 | CAP | Responsive coverage is represented but not directly actionable. | Route placeholders exist; verified captures intentionally fail closed. | Build a route-by-viewport matrix with verified, missing, stale, blocked, and divergent states. | Trusted capture resolver, route graph | False verification | No cell can show verified without artifact hash, source revision, viewport, and successful capture receipt. |
| P8 | IXD | Approvals are separate from the object and browser outcome. | Runs panel has generic Approve/Reject UI. | Render proposal overlays on affected canvas nodes and pair them with source diff and browser preview. | Proposal projection and diff states | Visual overlay complexity | Reviewer can inspect before/after, exact source operations, risk, and verification from one focused review mode. |
| P9 | CAP | Human collaboration is absent. Figma's comments and presence make review spatial. | No primary comments, mentions, or presence. | Add local-first comment threads anchored to node, route, run, or source line; sync can remain later. | Comment schema and anchors | Scope expansion into full multiplayer | Comments persist locally, survive cache regeneration through stable anchors, and can resolve with a trace receipt. |
| P10 | STRAT | The product can read as a Figma alternative instead of a safe product-change system. | Home emphasizes New design/New whiteboard beside Import/Scan. | Make Open Repository or Scan Product the primary entry; keep blank design secondary. | Home information architecture | Alienating pure design users | First-run copy and action order explain source truth, visual cache, agent proposal, approval, verification, and restore in one screen. |

## Top 10 interaction and polish gaps

![Paper selection and properties](screenshots/paper/04-selection-properties.png)

Paper is useful evidence for how much power can remain legible when selection, creation, canvas, and properties each have one stable place.

| ID | Cause | User problem and competitor evidence | Current state | Proposed change and why | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| I1 | IXD | Users cannot see exactly what the prompt references. MagicPath says select or `@`; Figma makes selection persistent. | Composer shows one selected name. | Add context chips for nodes, files, routes, revision, browser state, and skills. | Reference resolver | Chip overload | Every prompt shows removable references and an expandable exact-context preview. |
| I2 | IXD | The blank canvas teaches shapes, not Memi's value. MagicPath teaches the whole agent loop [SHOT-MAG-003]. | `Press F, R, O, L, or T`. | Replace with repository-first choices plus a secondary Learn tools link. | Import/scan entry | Empty state becomes busy | New users can start from repo, web, Figma JSON, design system, or blank canvas and understand consequences. |
| I3 | IXD | Five right-dock tabs have similar priority. | Inspect, Browser, Runs, Files, Settings always compete. | Use task-sensitive dock modes: Inspect while editing, Run during agent work, Review for proposals, Browser for verification. | Dock state machine | Mode switching surprises users | Selection, prompt, run, proposal, and verification each activate a predictable dock mode with user override. |
| I4 | VIS | Small text and uniform dark panels reduce hierarchy. Paper wins through reduction. | Dense metadata and low-contrast secondary copy. | Increase primary type, reduce always-visible metadata, and group provenance behind a clear authority card. | Token pass | Hiding provenance | Critical authority and status remain visible at a glance; secondary hashes expand on demand. |
| I5 | IXD | Direct manipulation lacks mature spatial feedback. Figma provides precise handles and guides. | One southeast resize handle observed. | Add eight handles, rotation, snap lines, distances, alignment, distribution, and multi-selection bounds. | Geometry engine | Performance regressions | In the checked-in 200-node performance fixture at 1440×900, the interaction harness records p95 animation-frame time at or below 16.7 ms during a 5-second drag; geometry, inspector, and semantic history resolve to the same final transform after pointer-up. |
| I6 | IXD | Responsive intent is not visible while manipulating frames. Paper exposes layout; Figma exposes constraints. | Width/height fields and placeholders. | Add layout mode, constraints, breakpoint previews, and responsive linkage badges. | Responsive model | Recreating a full layout engine | A frame can declare fixed/fill/hug, constraints, and linked viewport variants with deterministic serialization. |
| I7 | IXD | Long-tail features are hard to discover. Figma's command palette is an excellent unifier [SHOT-FIG-003]. | Command palette exists but is visually peripheral. | Make `⌘K` visible in the top bar and index actions, nodes, routes, settings, skills, runs, and files. | Search index | Results become noisy | Command search returns categorized results, shortcut hints, and current availability reasons. |
| I8 | VIS | State transitions do not visibly communicate progress. MagicPath reserves a persistent thread area. | Local prompt jumps to Runs with one text receipt. | Add submitting, queued, planning, tool-use, waiting approval, applying, verifying, complete, failed, and canceled motion states. | Live events | Decorative animation | Every state has text, icon, timestamp, cancellation rules, and reduced-motion behavior. |
| I9 | IXD | Files is not usable at hundreds of rows. | Flat list of nodes and placeholders. | Virtualize, group, search, filter, and show counts by authority/status. | Product Map query | Search index drift | Scrolling remains responsive at 10,000 entries and filters expose source-owned, cached, evidence, proposal, and stale groups. |
| I10 | VIS | Mixed raw values undermine system polish. The pinned static audit found 529 unique hex values across the scanned tree and motion-token warnings. | Tokens exist but fallbacks and fixtures pollute the surface. | Restrict production UI to semantic color, type, spacing, radius, elevation, and motion tokens. | Token inventory and scanner scoping | Mechanical churn | Production UI files have no unexplained raw color or duration values and reduced motion is covered. |

## Top 10 technical and architectural gaps

![Memi browser state](screenshots/memi/05-browser-localhost-result.png)

The Browser surface is present, but the state model needs a readiness protocol before it can be treated as verification.

| ID | Cause | User problem and evidence | Current state | Proposed change and why | Dependencies | Risk | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | ARCH | Canvas and durable runtime are not composed in the default product. | Deep runtime exists; UI callback is absent. | Define one versioned CanvasRuntimePort for submit, subscribe, cancel, approve, apply, verify, restore. | Protocol review | Leaky provider abstractions | Canvas imports no provider logic and all lifecycle transitions arrive as normalized events. |
| T2 | ARCH | UI trace and canonical trace can diverge. | Lightweight workbench trace and SQLite canonical trace are separate. | Project canonical trace into the UI; local optimistic entries must reconcile to durable IDs. | Trace projection | Migration complexity | Every visible durable action references a canonical trace ID and replay reproduces the same projected state. |
| T3 | ARCH | Browser truth is derived from URL state. | Valid URL renders iframe and `Preview running`. | Add PreviewSession protocol with requested, connecting, ready, error, stopped, and stale states. | Tauri/runtime bridge | Browser sandbox variance | UI state is driven only by session events, with heartbeat and last-ready revision. |
| T4 | IMPL | Artifact verification intentionally fails closed. | Trusted resolver and redaction/hash proof pending. | Implement content-addressed artifact resolver bound to project, source revision, viewport, and redaction policy. | Security approval | Sensitive capture leakage | Artifact is visible only when all bindings and hash verification succeed; otherwise a reason code is shown. |
| T5 | ARCH | Cache invalidation is not a first-class contract. | Persistence exists, refresh semantics are incomplete. | Define cache manifest with source hashes, adapter version, dependency graph, stale reasons, and regeneration plan. | Import compiler | Excess invalidation | A source change invalidates only affected screens/components and explains why. |
| T6 | ARCH | Source change authority is pending. | Source writes are disabled by policy. | Introduce typed ChangeSet executor with workspace containment, base-revision check, patch preview, atomic apply, and rollback. | Security veto resolution | Repository corruption | Conflicts fail closed, writes are bounded, rollback is tested, and exact files/hashes appear in receipts. |
| T7 | IMPL | Live provider readiness is not probed. | Catalog is declared, not verified. | Add adapter health, authentication, model inventory, capability, and permission probes. | Adapter implementations | Credential exposure | UI distinguishes installed, authenticated, reachable, model-available, and authorized without exposing secrets. |
| T8 | ARCH | Approval UI is not cryptographically or canonically bound to exact effects. | Demo runtime has grants and approvals; default Canvas flow does not. | Bind approval receipt to project, base revision, ChangeSet hash, targets, permission ceiling, and expiration. | Canonical protocol | UX friction | Any changed proposal invalidates prior approval and requires a new review receipt. |
| T9 | IMPL | Current tests no longer fully pass. | 2 failures in 1,210 tests plus React warnings. | Restore green tests, then add live Browser readiness and default disconnected-prompt E2E cases. | Fixture update decisions | Tests may encode stale product assumptions | All tests pass, no controlled-input warnings remain, and Browser cannot claim ready on blank/error content. |
| T10 | ARCH | Product graph and canvas document can drift. | Multiple stores and projections exist. | Assign authority: graph owns product facts, canvas owns visual arrangement, runtime owns lifecycle, trace owns receipts. | ADR and migrations | Over-centralization | Each persisted field has one documented authority and projections can be rebuilt without information loss. |

## Time horizons

Time ranges below are effort estimates, not milestone authorization. Medium and larger items that touch live providers, authenticated MCP, source writes, ChangeSets, trusted capture, sandboxing, or sync are blocked until the named M0 security, architecture, legal, evaluation, and QA gates are signed and the Product Security VETO is cleared. Until then they may be implemented only against deterministic Demo adapters and fixtures that stay inside the current approved boundary.

### Quick wins, 1 to 3 days

| Priority | Change | Acceptance gate |
| --- | --- | --- |
| 1 | Replace Browser `Preview running` with `Connecting` until readiness evidence exists | Blank or refused localhost never shows Running |
| 2 | Rename Runs to Activity when only local trace is present | Live Run label appears only for a durable runtime run |
| 3 | Add exact context chips to the composer | Node, source path, revision, harness, permission, and mode are inspectable |
| 4 | Rework blank-canvas copy around repository, import, or blank choices | Core product model is understandable without docs |
| 5 | Group and cap Files output; add search | No hundreds-row ungrouped default list |
| 6 | Surface `⌘K` in the editor chrome | Palette opens from button and shortcut |
| 7 | Add reconnect action and reason code to disconnected harness state | User knows whether adapter is absent, unauthenticated, or unreachable |
| 8 | Fix 2 failing tests and React warnings | `npm test` is fully green |
| 9 | Add reduced-motion overrides to production UI motion | OS preference removes nonessential transitions |
| 10 | Separate fixture, cached, source-owned, and verified badges | No fixture is visually mistaken for live source truth |

### Medium changes, 1 to 2 weeks

These are M0-compatible only when implemented with the deterministic Demo runtime and fixture data. They do not authorize M1 provider integration.

| Priority | Change | Acceptance gate |
| --- | --- | --- |
| 1 | CanvasRuntimePort plus Demo adapter end to end | Prompt streams a real local Demo run |
| 2 | Durable thread and activity projection | Reopen restores thread and run state |
| 3 | Browser PreviewSession state machine | Ready/error/stale are event-driven |
| 4 | Product Map replacing flat Files | Routes, screens, components, tokens, and evidence are grouped and searchable |
| 5 | Proposal overlay and review mode | Canvas target, source diff, and actions appear together |
| 6 | Eight-handle resize, snap guides, align/distribute | Core spatial manipulation meets defined precision tests |
| 7 | Route-by-viewport matrix shell | Verified, missing, stale, blocked, and divergent states render distinctly |
| 8 | Adapter readiness probes | Harness and model choices reflect current local truth |
| 9 | Cache manifest and stale-state UI | Source changes explain affected visual cache |
| 10 | Command palette unified index | Actions, routes, nodes, settings, skills, and runs are searchable |

### Larger bets, 1 to 2 months

These are post-M0 or post-veto bets. Their clocks start only after the relevant program gate opens.

| Priority | Change | Acceptance gate |
| --- | --- | --- |
| 1 | Production harness integration with streamed normalized events | Codex and Claude adapters pass the same lifecycle contract |
| 2 | Typed source ChangeSet review, apply, rollback | Safe real-repository edit completes with exact receipts |
| 3 | Trusted responsive capture resolver | Verified images are revision, viewport, hash, and policy bound |
| 4 | Visual cache regeneration and incremental invalidation | Refresh is deterministic, targeted, and explainable |
| 5 | Full review loop: plan, propose, approve, apply, verify, checkpoint | One primary journey completes without leaving Canvas |
| 6 | Local-first comments and review anchors | Comments survive regeneration and can bind to trace |
| 7 | Responsive layout and linked variants | Screen families share explicit constraints and overrides |
| 8 | Deterministic design-system observatory | Tokens and components link usage, drift, source, and proposed changes |
| 9 | Replay and restore product UX | User can replay, compare, restore, and branch from checkpoints |
| 10 | Optional sync and presence layer | Local authority remains intact while collaboration state syncs safely |

## What not to build

- a complete Figma vector engine
- a cloud document as canonical source
- a provider-specific agent implementation inside Canvas
- an opaque generation button without source and permission context
- an approval button that is not bound to an exact proposal
- a green verification badge without artifact and revision proof
- a raw route or node dump presented as product understanding
