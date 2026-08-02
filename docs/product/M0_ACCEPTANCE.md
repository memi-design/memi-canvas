# M0 RED acceptance criteria

- Status: RED contract
- Owner: Principal Product Designer
- Required reviewers: Product, Design Engineering, Accessibility, Data/Evals,
  and QA
- Source state: `codex/m0-foundation` M0 scaffold

These criteria are user-facing contracts. Automated tests should begin RED and
become GREEN as the coded vertical slice is implemented.

## A. Standalone and truthfulness

### UX-001: No Figma dependency

Given a clean install, when the user completes the M0 journey, then no Figma
account, file, plugin, process, API, type, or setting is required.

### UX-002: Fixture honesty

Given M0 fixture-backed behavior, when it is shown, then the affected surface
has a persistent `Demo` label and does not claim a real model or repository
write occurred.

### UX-003: Import is read-only

Given import preflight, when the user reviews permissions, then write scope is
`None` and starting import cannot mutate source.

### UX-004: Zero-token base import

Given the base import path, when preflight and completion are shown, then both
state `0 AI tokens` and no harness task is required.

## B. Project start and import

### UX-010: Empty home is actionable

Given no projects, when the home opens, then the user can find
`Import existing product`, `Create blank project`, and the local/read-only
notice without opening another panel.

### UX-011: Submission explains invalid source

Given an invalid or unavailable source, when import is submitted, then input is
preserved, the cause is named, and focus reaches the error.

### UX-012: Preflight precedes execution

Given a valid source, when it is selected, then no import begins until the user
reviews scope, viewports, expected captures, blockers, and starts it.

### UX-013: Import progress is meaningful

Given an active import, when stages progress, then the current deterministic
stage and discoveries are visible and no unsupported precise percentage is
shown.

### UX-014: Partial import is preserved

Given an interrupted import, when the user opens the project, then valid
artifacts remain available and the project is visibly `Partial`.

## C. Coverage and frame truth

### UX-020: Responsive matrix is complete

Given the M0 fixture, when Screens opens, then the matrix contains desktop,
tablet, and mobile columns and at least one non-default state row.

### UX-021: Truth dimensions remain distinct

Given any frame, when inspected, then ownership, evidence level, and coverage
health are separately readable.

### UX-022: Verified is evidence-backed

Given a `Verified` frame, when its evidence is opened, then current runtime,
source revision, source anchor, and validation evidence are available.

### UX-023: Blocked is not a thumbnail

Given a blocked matrix cell, when displayed, then no fabricated capture appears
and the blocker, attempted evidence, and recovery action are shown.

### UX-024: Screenshot-only is not editable

Given a reference-only frame, when inspected, then it is labeled `Reference`
and no source-edit action is offered.

### UX-025: Stale evidence loses current claims

Given a source revision mismatch, when a previously verified frame appears,
then it is visibly `Stale` and prompts recapture.

### UX-026: Coverage summary does not overclaim

Given any partial, blocked, stale, or uncaptured required cell, when coverage is
summarized, then the project is not called complete.

## D. Design-system understanding

### UX-030: Component provenance is inspectable

Given a component specimen, when selected, then its atomic level, evidence,
source, states, variants, tokens, and screen usage are available.

### UX-031: Declared and observed tokens are separate

Given declared and raw observed values, when Design system opens, then they are
not silently merged and drift candidates are visibly reviewable.

### UX-032: Blast radius is understandable

Given a component or token, when usage is opened, then every known affected
screen in the fixture can be reached.

## E. Context, task, and harness

### UX-040: Selection becomes explicit context

Given a selected screen or element, when `Add to task context` is activated,
then a named, removable context chip appears with type and evidence level.

### UX-041: Context is inspectable before execution

Given a ready task, when `Review context` opens, then all attached frames,
files, tokens, findings, and exclusions are visible.

### UX-042: Unavailable context does not disappear

Given attached context becomes unavailable, when the task is reviewed, then the
chip is marked unavailable and execution requires recovery or removal.

### UX-043: Harness is visible

Given a task is ready or running, when viewed anywhere in the workspace, then
its Auto decision or named harness is visible.

### UX-044: Permission consequence is visible

Given the task configuration, when a permission is selected, then the user can
read what it allows and what remains separately approval-gated.

### UX-045: Harness switch preserves the task

Given a paused or failed task, when the harness is switched, then goal,
context, accepted artifacts, permissions, and trace remain available.

## F. Visible agent collaboration

### UX-050: Agent work has truthful presence

Given an agent task starts, when it runs, then a task card and target indicator
show task, harness, permission, status, and latest meaningful action.

### UX-051: No fake cursor or hidden reasoning

Given agent activity, when viewed, then the product uses task presence rather
than a human-like cursor and does not expose private chain-of-thought.

### UX-052: Work can be interrupted

Given an active interruptible task, when the user pauses or stops it, then
future work stops, completed artifacts remain, and trace records the action.

### UX-053: Blocked task explains recovery

Given a task is blocked, when its card is opened, then blocker, recovery owner,
and available actions are shown.

## G. Proposal, approval, and verification

### UX-060: Proposal is not accepted state

Given an agent proposal, when it appears, then it is visually distinguished
from accepted work and no accepted document state changes before approval.

### UX-061: Approval is scoped

Given a proposal, when approval is requested, then target, operations,
consequence, requester, and permission scope are visible.

### UX-062: Partial approval applies selected operations only

Given multiple proposal operations, when selected operations are approved, then
unselected operations remain unapplied and verification scope is recalculated.

### UX-063: Canvas approval does not authorize source actions

Given a canvas proposal is accepted, when it completes, then no source write,
commit, push, pull request, or deployment is implied.

### UX-064: Changed target invalidates approval

Given an approval exists, when its target revision changes before apply, then
the approval becomes invalid and a new diff is required.

### UX-065: Completion requires verification

Given an accepted proposal, when verification has not reached a terminal state,
then the task cannot be labeled `Complete`.

### UX-066: Verification shows affected variants

Given the M0 proposal, when verification runs, then affected desktop, tablet,
and mobile results are listed with evidence and status.

## H. Trace and recovery

### UX-070: Trace explains the causal loop

Given a completed M0 task, when trace opens, then context, routing, plan,
proposal, approval, apply, verification, and checkpoint events are present in
causal order.

### UX-071: Trace event locates its target

Given a trace event with a target, when activated, then the corresponding frame,
proposal, report, or approval receipt is focused.

### UX-072: Human and agent actors are distinct

Given trace events from both, when displayed, then actor, harness when
applicable, and result are readable without technical expansion.

### UX-073: Restore is previewed

Given a previous checkpoint, when restore is requested, then the user sees what
will change before confirmation.

### UX-074: Restore is itself traced

Given restore is confirmed, when it completes, then accepted state matches the
checkpoint and a recovery event is appended.

### UX-075: Interrupted run does not silently resume

Given restart after interrupted work, when the project opens, then the last
durable checkpoint is shown and external actions remain stopped until resumed.

## I. Keyboard-only path

The full M0 proof must be completable without a pointer.

### Keyboard region model

- `F6` and `Shift+F6`: move between top bar, navigation, workspace or outline,
  inspector, composer, and trace
- `Tab` and `Shift+Tab`: move within the active region
- Arrow keys: move within lists, trees, tabs, and matrix cells
- `Enter`: open or activate
- `Space`: select or toggle the focused item
- `Escape`: close a transient layer and return focus to its trigger
- `Command/Ctrl+K`: open the command palette
- `Command/Ctrl+Enter`: start a ready task or confirm the primary review action
- `Command/Ctrl+.`: stop an active task after consequence is announced
- `Command/Ctrl+Z`: undo reversible canvas state only
- `+`, `-`, and `0`: zoom in, zoom out, and reset

All commands must also be discoverable through menus or the command palette.

### UX-080: Region navigation

Given the workspace, when `F6` is pressed repeatedly, then every major region
receives visible focus in a stable order.

### UX-081: Matrix navigation

Given the responsive matrix, when arrow keys are used, then focus moves by row
and viewport column and announces screen, state, viewport, evidence, and health.

### UX-082: Canvas has a non-spatial equivalent

Given any selectable frame in the M0 canvas, when using the outline, then it can
be selected, inspected, added to context, and located without pointer gestures.

### UX-083: Modal focus is contained and restored

Given import, approval, or restore dialogs, when opened and closed, then focus
is trapped while open and returns to the invoking control.

### UX-084: Agent updates are announced without flooding

Given an active task, when meaningful states change, then a polite live region
announces them and high-frequency trace deltas are not announced.

### UX-085: Color is not the sole signal

Given any evidence, coverage, task, approval, or verification state, when
rendered without color, then text and shape still communicate the state.

## J. Responsive product-shell proof

M0 is primarily a desktop workspace, but its shell must remain understandable
at supported tablet widths.

### UX-090: Desktop workspace

At 1440 by 900, navigation, canvas, inspector, composer, and trace can be
reached without overlapping primary controls.

### UX-091: Tablet workspace

At 834 by 1112, secondary panels may become drawers, but Screens, canvas or
outline, composer, task state, approval, and trace remain reachable.

### UX-092: Mobile product documentation is represented

The product need not provide a full mobile authoring shell in M0. It must still
capture, inspect, compare, and verify mobile product frames at 390 by 844.

## M0 release gate

M0 is accepted only when:

1. One deterministic fixture passes the entire journey.
2. Every criterion above passes through an automated test or documented manual
   evidence.
3. The full keyboard path passes.
4. Screen truth and coverage never overclaim.
5. Agent context and permission consequences remain visible.
6. Verification and restore complete successfully.
7. No Figma dependency or compatibility control appears in the runnable
   product.
