# M0 coded vertical-slice contract

- Status: Draft for M0 review
- Owner: Principal Product Designer
- Required reviewers: Founder/Product, PM, Architecture, AI, Data/Evals,
  Design Engineering, Accessibility, and QA
- Source state: `codex/m0-foundation` M0 scaffold

## Product outcome

A new user can import an existing product into a standalone local workspace,
understand which screens and responsive states are trustworthy, select an exact
piece of context, collaborate visibly with an agent, approve a proposed change,
verify the affected screens, inspect the complete trace, and restore the
previous checkpoint.

The slice proves the product model and interaction contract. It does not need
to implement production repository scanning, model execution, multiplayer, or
Git publication. Unavailable runtime behavior may use a deterministic fixture
as long as the interface labels it `Demo`.

## Explicit non-goals

- Figma import, export, sync, files, accounts, plugins, or Code Connect
- A complete vector-graphics editor
- Arbitrary shell execution
- Autonomous commit, push, pull request, deployment, payment, or deletion
- Model-generated base import or screen coverage
- Hidden model reasoning
- Claiming screenshot-only frames are source-editable

## The M0 fixture

The coded slice requires one deterministic product fixture with:

- At least three routes or screens
- Desktop, tablet, and mobile viewport columns
- At least one `Verified` frame
- At least one `Observed` or `Inferred` frame
- At least one `Partial` coverage result
- At least one `Blocked` coverage result with a recoverable cause
- One component or element with a source reference
- One agent proposal that changes a visible property
- One verification result that passes
- One prior checkpoint that can be restored

Fixture data must be stable across runs so UI and accessibility tests do not
depend on network access or model output.

## Journey

### 1. Start

The first screen answers two questions:

1. What can I do here?
2. Will importing mutate or upload my product?

Required content:

- Product promise: understand, document, edit, and verify a real product
- `Import existing product` primary action
- `Create blank project` secondary action
- Local-first notice
- Read-only import notice
- Recent projects when available

### 2. Choose a source

M0 presents source choices even when some are marked `Coming later`:

- Local repository
- Running local URL
- Static build
- Storybook
- Screenshot folder

The coded success path uses a local-repository fixture. Choosing a source does
not start execution.

### 3. Review deterministic preflight

Before import, the user sees:

- Source and project name
- Read scope
- Write scope, which is `None` during import
- Detected or fixture-provided run command
- Representative viewports
- Known routes, tests, stories, roles, themes, and flags
- Expected capture count
- Blockers and missing configuration
- `0 AI tokens for base import`

The user can edit the project name and viewport selection. Starting import
creates a project but does not authorize later source edits.

### 4. Observe import

The loading experience reports deterministic stages:

1. Inspecting source
2. Discovering routes and states
3. Extracting components and tokens
4. Starting isolated preview
5. Capturing responsive screens
6. Validating evidence
7. Building the workspace

Progress is expressed as completed stages and discovered artifacts, not a fake
precise percentage. The user may leave and resume. Cancelling preserves a
partial project and clearly labels it `Partial`.

### 5. Review coverage

Import opens the workspace in the `Screens` view with:

- Coverage summary
- Responsive screen matrix
- Filters for route, state, role, theme, viewport, and evidence level
- Explicit `Partial`, `Blocked`, `Stale`, and `Reference` groups
- A recovery action for each recoverable blocked result

The user can answer:

- Which routes and states were discovered?
- Which viewport captures exist?
- Which results are trustworthy?
- What is missing and why?
- What can be opened live?
- What can be edited in source?

### 6. Inspect a screen

Opening a matrix cell focuses its frame on the canvas and inspector.

Required screen details:

- Route and state
- Viewport dimensions
- Role, theme, and relevant flags
- Frame ownership
- Evidence level
- Coverage status
- Capture time and source revision
- Source references when available
- Console, asset, or runtime warnings
- `Open sandbox` when live interaction is available

The layer outline is an equivalent non-spatial way to inspect the frame.

### 7. Inspect the design system

The `Design system` view shows, for the fixture:

- Foundations
- Semantic tokens
- Component specimens
- Variants and states
- Responsive behavior
- Screen usage
- Drift findings

Declared values and observed values remain separate. Selecting a component
shows every known screen using it and its evidence provenance.

### 8. Select task context

The user selects one frame or source-linked element and chooses
`Add to task context`.

The composer shows removable context chips for:

- Selected frame or element
- Source reference
- Related token or component
- Relevant finding

`Review context` reveals exactly what the task will receive. The product does
not silently attach the whole repository, every screenshot, or unrelated
traces.

### 9. Configure the agent task

The user:

1. Enters an intent
2. Chooses `Auto` or a named harness
3. Reviews the selected model when available
4. Selects a permission scope
5. Reviews estimated context size and cost
6. Starts the task

M0 permission scopes:

- `Inspect`: read context and propose a plan
- `Canvas write`: create a reversible canvas proposal
- `Workspace write`: propose a source ChangeSet, with separate apply approval

The fixture success path uses `Canvas write`.

### 10. Follow visible work

A task card appears adjacent to the target and in the Tasks list. It shows:

- Task title
- Target
- Harness
- Permission
- Status
- Latest meaningful action
- Stop or pause action
- `Open trace`

The agent may not display a fake human cursor or private reasoning. Its visual
presence is a task card and target halo.

### 11. Review the proposal

The agent produces a ghost proposal that has not yet changed the accepted
document.

The review surface shows:

- Before and proposed result
- Exact canvas operations or source patch
- Target and blast radius
- Harness and permissions
- Relevant evidence
- Verification plan
- Accept selected
- Accept all
- Reject with feedback
- Send for another review

Acceptance text names the immediate consequence. A canvas approval cannot
implicitly authorize source edits, commits, pushes, or deployment.

### 12. Verify

After acceptance, Memi verifies only the affected dependency set.

The M0 verification report includes:

- Affected screen and responsive variants
- Expected and actual result
- Passed, failed, or blocked status
- Visual evidence
- Accessibility check result
- Runtime or console warnings

Completion is not shown until verification reaches a terminal state.

### 13. Inspect trace and checkpoint

The trace deck provides a readable causal history:

- Context attached
- Harness selected
- Task started
- Plan published
- Proposal created
- Approval requested and resolved
- Proposal applied
- Verification completed
- Checkpoint created

Selecting an entry locates its affected frame or opens its artifact. Technical
event data may be expanded, but the default is human-readable.

### 14. Restore

The user chooses `Restore previous checkpoint`, reviews what will change, and
confirms. The accepted document returns to its prior state. The restore itself
is appended to the trace.

## Workspace information architecture

### Project home

- Recent projects
- Import existing product
- Create blank project
- Runtime and harness readiness
- Local data notice

### Workspace top bar

- Project and source revision
- Runtime health
- Active humans and agents
- Default harness
- Run controls
- Export or share entry point

### Left navigation

- Screens
- Flows
- Components
- Design system
- Tasks
- Evidence
- Assets

### Center workspace

- Infinite canvas
- Screen matrix
- Flow connectors
- Component specimens
- Findings and evidence
- Agent task cards
- Ghost proposals

### Right inspector

- Overview
- Design
- Code
- Context
- Review
- Accessibility

Tabs only appear when relevant to the current selection. Hidden tabs must not
contain required status or approval information.

### Bottom trace deck

- Collapsed activity summary
- Expandable trace event list
- Filters
- Artifact details
- Checkpoint comparison
- Replay and restore

## Responsive documentation model

The screen matrix uses:

- Rows: route plus state combinations
- Columns: representative viewports
- Filters: role, theme, flag, evidence, and coverage

M0 representative viewports:

- Desktop: 1440 by 900
- Tablet: 834 by 1112
- Mobile: 390 by 844

Breakpoint boundary checks may appear in verification details but should not
create permanent matrix columns unless they fail.

## Design-system organization

Memi uses native component and token records. The visual organization follows:

- Foundations
- Atoms
- Molecules
- Organisms
- Templates
- Pages
- Repeated product patterns

Inferred classification is labeled and user-correctable. A component specimen
must expose its variants, states, responsive behavior, token dependencies,
source reference, evidence level, and screen usage.

## M0 success

M0 succeeds when a new user can complete the entire journey without facilitator
help, never mistakes a claim for evidence, knows what the agent can access,
understands what approval will do, and can restore the prior result.
