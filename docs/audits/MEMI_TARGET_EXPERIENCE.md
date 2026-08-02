# Memi Canvas target experience

## Product definition

Memi Canvas is the shared visual operating surface for understanding and changing a real software product with humans and agents.

The repository is authoritative. The canvas is a typed, disposable visual cache plus human-authored collaboration state. The browser proves runtime behavior. The local runtime controls processes and permissions. The Engine supplies deterministic product understanding and verification.

## Primary loop

```text
Open repository
→ scan product and build graph
→ generate or refresh visual cache
→ select route, screen, component, token, source, or evidence
→ describe intent with visible context
→ choose plan, propose, or apply ceiling
→ agent runs through local runtime
→ proposal appears on canvas with source impact
→ human approves or rejects
→ runtime applies a typed ChangeSet
→ Browser and Engine verify
→ checkpoint, compare, restore, or continue
```

Every step must be visible in the same workspace. The user should never need to infer whether a control is local configuration, a live run, a proposal, a durable source change, or verified evidence.

![MagicPath's agent-centered empty canvas](screenshots/magicpath/03-empty-canvas-agent.png)

MagicPath demonstrates the right framing: agent, components, libraries, imports, and canvas work are one product surface. Memi should use that integration pattern while adding source authority, permission, trace, and verification.

## Authority model

| System | Owns | Must not own |
| --- | --- | --- |
| Repository | Product source, configuration, tests, assets, Git revision | Canvas arrangement, transient prompts |
| Engine | Product graph, routes, tokens, components, deterministic findings, cache plan, verification | Provider sessions or UI state |
| Canvas | Selection, camera, layout, annotations, proposal overlays, review focus, local collaboration state | Direct provider process execution or unrestricted filesystem access |
| Studio/runtime | Harness adapters, processes, grants, events, budgets, tasks, runs, ChangeSet application, checkpoints | Product-specific visual rendering logic |
| Canonical trace | Durable receipts, approvals, effects, verification, replay identity | Decorative UI history |
| Browser session | Local preview readiness, console, network, current revision and viewport | Repository authority |

## Target layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Project / branch / revision      Cache freshness      Run state   Review │
├──────────────┬───────────────────────────────────────┬───────────────────┤
│ Product Map  │                                       │ Context dock      │
│              │              Infinite canvas          │ Inspect           │
│ Routes       │                                       │ Run               │
│ Screens      │    cached screens, components,        │ Review            │
│ Components   │    proposals, evidence, comments      │ Browser           │
│ Tokens       │                                       │ Verify            │
│ Evidence     │                                       │                   │
├──────────────┴───────────────────────────────────────┴───────────────────┤
│ [references] Ask Memi…  /skill  @route  mode  harness  permission   Send │
└──────────────────────────────────────────────────────────────────────────┘
```

## Top bar

### Left

- back to projects
- project name
- repository root
- branch and short revision
- cache freshness badge

Clicking the project identity opens a compact source card with path, remote, branch, revision, dirty state, adapter, and last scan.

### Center

- select, pan, frame, text, shape, connector
- undo and redo
- fit selection and fit all
- command palette

The creation toolbar stays small. Repository-specific actions do not live here.

### Right

- collaborators or local actors
- active run state
- review queue count
- checkpoint
- share or export, only when configured

Run state uses a fixed vocabulary:

```text
Disconnected
Ready
Queued
Planning
Using tools
Waiting for approval
Applying
Verifying
Complete
Failed
Canceled
```

## Left sidebar: Product Map

The left sidebar is not a generic Files list. It is a projection of product structure.

Primary tabs:

- Product
- Layers
- Assets
- Imports

### Product

Grouped sections:

- Routes
- Screen families
- Components
- Tokens
- Flows
- Evidence
- Findings

Each row can show:

- source-owned, cached, evidence, proposal, or canvas-only authority
- fresh, stale, blocked, missing, or divergent status
- desktop, tablet, and mobile coverage
- open findings or active proposals

Rows support search, filter, keyboard navigation, and reveal-in-canvas.

### Layers

Layers show the current canvas hierarchy only. They do not repeat the entire repository graph.

### Assets

Assets are reusable source-backed components, token groups, media, and canvas-local materials. Dragging or duplicating a source-backed component creates an instance with an explicit authority badge.

### Imports

Every import shows:

- adapter and source
- source revision
- imported time
- cache version
- status
- affected screen/component counts
- Refresh, Compare, Discard, and Regenerate actions

## Infinite canvas

### Node types

- `ScreenCache`: generated or captured screen at a route and viewport
- `ComponentCache`: source component visualization
- `ReferenceEvidence`: immutable screenshot or external evidence
- `CanvasDraft`: human-authored frame, text, shape, or annotation
- `ProposalOverlay`: agent-proposed visual operation
- `RouteGroup`: responsive screen family
- `FindingMarker`: deterministic or review finding
- `CommentAnchor`: discussion attached to stable identity

### Selection feedback

Selection must display:

- eight resize handles
- rotation handle where applicable
- snap guides and measured distances
- bounding box for multi-selection
- authority badge
- source and revision indicator
- stale badge when cache and source differ

Direct manipulation creates semantic history entries. Moving a cached screen changes canvas arrangement only. Editing a source-owned visual property creates a proposal or explicit detachment, never a silent repository mutation.

### Responsive screen families

A screen family can expand into:

```text
Route: /settings
Desktop 1440 × 900   Verified
Tablet 834 × 1112    Stale
Mobile 390 × 844     Missing
```

Dragging one variant does not imply source change. Editing shared layout intent shows which variants inherit or override the change.

## Context dock

The dock changes mode based on the workflow while allowing explicit pinning.

### Inspect

Sections:

- identity and authority
- source
- geometry and layout
- appearance
- component and variant
- responsive behavior
- evidence and freshness
- actions

Hashes and long revisions are collapsed under Provenance details. Authority and freshness remain visible.

### Run

The Run view is a durable thread, not a log dump.

Each run card includes:

- request and references
- harness, model, effort, and permission ceiling
- plan
- tool events with concise status
- artifacts
- token/cost budget where available
- cancel, retry, and handoff
- canonical trace ID

### Review

Review combines:

- summary of intent
- affected canvas targets
- source file operations
- visual before/after
- browser preview
- deterministic findings before/after
- risks and required approvals

Approve is enabled only when the displayed proposal hash matches the approval target and base revision.

### Browser

Browser states:

```text
Stopped
Connecting
Ready
Blocked
Error
Stale
```

The panel includes:

- validated localhost address
- viewport presets and free resize
- reload and stop
- open in Helium
- console and network badges
- inspected-element link back to source/canvas
- current preview source revision
- last good frame

`Ready` requires a positive bridge or health signal. A syntactically valid URL is only `Connecting`.

### Verify

Verification groups:

- deterministic Engine checks
- typecheck/build/tests
- browser route and viewport checks
- accessibility
- screenshot or artifact proof

Results bind to source revision and ChangeSet. A changed source revision marks prior results stale.

## Floating prompt composer

The composer is the center of human-agent collaboration.

![Current Memi selection-scoped composer](screenshots/memi/09-prompt-selection-ready.png)

### Context row

Chips can represent:

- selected canvas nodes
- routes
- source files
- components
- browser elements
- findings
- prior runs
- comments
- skills

Every chip is removable and inspectable. `@` opens reference search. `/` opens skills and workflows.

### Controls

- mode: Plan, Propose, Apply
- harness
- model
- reasoning
- permission
- budget

Advanced controls collapse by default. The current permission ceiling is always visible.

### Submission behavior

Before send:

- exact context preview available
- disconnected harness blocks live submission and offers Reconnect
- stale source prompts a refresh or explicit continue decision

After send:

- composer transforms into a thread input
- Run dock opens
- progress appears both in the thread and top bar
- selection remains visible unless the agent intentionally changes review focus

## Review and approval states

| State | Canvas | Dock | Allowed actions |
| --- | --- | --- | --- |
| Planned | No durable overlay | Plan summary | Refine, Propose |
| Proposed | Dashed overlays and before/after | Exact ChangeSet and risk | Approve, Reject, Request changes |
| Approved | Overlay marked approved | Bound approval receipt | Apply, Revoke before effect |
| Applying | Locked affected targets | Effect progress | Cancel only if safe |
| Applied | New cache pending verification | Source receipt | Verify, Roll back |
| Verified | Green verified edge and revision | Evidence receipts | Checkpoint, Continue |
| Failed | Red failure marker, last good state retained | Cause and recovery | Retry, Roll back, Inspect logs |
| Stale | Amber badge | Changed source or cache explanation | Refresh, Compare, Discard |

## Design-system view

The design-system view is a generated observatory, not a manually maintained sticker sheet.

Sections:

- tokens with source and usage
- components with variants and repository paths
- screen usage
- inconsistencies and drift
- pending proposals
- verified examples

Selecting a token highlights every cached use. A token change proposal previews affected screens and produces one source-aware ChangeSet.

## Import and screen-matrix view

Import flow:

1. choose repository, web target, Figma JSON, or reference images
2. show exactly what access is required
3. preview adapter plan and exclusions
4. run deterministic scan
5. materialize Product Map
6. request trusted captures only where supported
7. render screen matrix with explicit status

No cell is silently blank. It says Missing, Blocked, Stale, Not applicable, or Verified.

## Empty states

### Project home

Primary:

- Open repository
- Scan product
- Import existing evidence

Secondary:

- New blank design
- New whiteboard

### Blank repository canvas

Headline: `Turn this repository into a shared visual workspace`

Actions:

- Generate product map
- Build responsive screen matrix
- Visualize design system
- Open localhost preview

### No live runtime

Headline: `Canvas is ready. Agent runtime is disconnected.`

Actions:

- Connect Codex
- Connect Claude Code
- Use deterministic Engine only

The interface never lets a disconnected submit look like a live run.

## Keyboard model

| Shortcut | Action |
| --- | --- |
| `⌘K` | Global command and search |
| `V` | Select |
| `H` or held Space | Pan |
| `F`, `R`, `O`, `L`, `T` | Create frame, rectangle, ellipse, line, text |
| `⌘D` | Duplicate |
| `⌘Z`, `⇧⌘Z` | Undo, redo |
| `⇧1`, `⇧2` | Fit all, fit selection |
| `⌘Enter` | Submit prompt |
| `⌘.` | Cancel active run |
| `⌥⌘P` | Plan current selection |
| `⌥⌘R` | Open Review |
| `⌥⌘B` | Open Browser |
| `⌥⌘V` | Open Verify |
| `@` in composer | Reference search |
| `/` in composer | Skill search |

Keyboard hints appear in tooltips, menus, empty states, and command results.

## Recovery

Recovery is not a separate settings feature.

- every canvas operation is undoable
- every durable source effect has a receipt
- checkpoints bind source revision, cache manifest, canvas document, trace head, and verification state
- failure preserves the last good preview
- restore previews affected files and canvas state before execution
- stale approvals are invalidated automatically

## Implementation mapping

| Phase | Existing surface | Change |
| --- | --- | --- |
| 1 | `apps/web/src/canvas/collaboration.tsx` | Add context chips, connection blocking, thread projection |
| 1 | `apps/web/src/canvas/workspace-dock.tsx` | Introduce event-driven PreviewSession and rename local-only Runs state |
| 1 | `apps/web/src/canvas/CanvasSidebar.tsx` | Replace raw import counts and Files dump with grouped Product Map entry |
| 1 | `apps/web/src/canvas/CommandPalette.tsx` | Index nodes, routes, settings, skills, and runs |
| 2 | `apps/web/src/canvas/CanvasWorkbench.tsx` | Compose CanvasRuntimePort and durable activity projection |
| 2 | `apps/web/src/ProductCanvasConsumer.tsx` | Supply a real local runtime adapter rather than default local-only callback |
| 2 | `apps/web/src/canvas/workspace-dock.tsx` | Add Run, Review, Browser, Verify task modes |
| 2 | `apps/web/src/canvas/persistence.ts` | Persist stable references, threads, comments, and cache status |
| 2 | `packages/runtime/src/runtime.ts` | Expose normalized submit, subscribe, cancel, approve, apply, verify, restore port |
| 2 | `packages/runtime/src/harness-lifecycle-store.ts` | Project durable task/run/checkpoint/handoff state into Canvas |
| 3 | `packages/import-runtime` and `packages/import-compiler` | Emit cache manifest, dependency graph, and invalidation reasons |
| 3 | `packages/runtime/src/schema.ts` | Persist ChangeSet, approval binding, preview session, verification, and comment anchors |
| 3 | `packages/trace` | Make UI receipts canonical and replayable |
| 3 | `apps/web/src/WorkspaceDocumentationConsumer.tsx` | Become the verified route-by-viewport matrix projection |
| 3 | `apps/web/src/platform/helium.ts` | Add bridge events for readiness, inspected element, console, and failure |

## Definition of done for the target loop

A target slice is complete only when:

1. a real repository is opened
2. a typed visual cache is generated with revision provenance
3. the user selects a source-owned component
4. a connected harness receives the visible task context
5. live run events stream into Canvas
6. the agent produces a typed, bounded ChangeSet
7. Canvas displays visual and source impact
8. approval is bound to the exact proposal
9. the runtime applies the change safely
10. Browser and Engine verify the new revision
11. a checkpoint is created
12. restore returns both source and canvas to the checkpoint

Anything less is a partial slice and should be labeled as such.
