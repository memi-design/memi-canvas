# Canonical vocabulary and truth contract

- Status: Draft for M0 review
- Owner: Principal Product Designer
- Required reviewers: Product, Architecture, Import/runtime, Data/Evals,
  Security, AI, and QA
- Source state: `codex/m0-foundation` M0 scaffold

## Purpose

Memi must distinguish what exists in source, what was observed at runtime, what
was inferred, what was supplied as reference, and what is merely proposed.
Visual similarity is not proof of ownership or editability.

## Canonical nouns

| Noun | Meaning |
|---|---|
| Project | A local Memi workspace and its linked evidence |
| Source | A repository, build, URL, Storybook, or reference collection |
| Page | A document-level organizational area |
| Screen | A product route or view in a particular state |
| State | A meaningful UI condition such as loading, empty, error, or populated |
| Viewport | Exact capture dimensions and device class |
| Frame | A visual representation placed on the canvas |
| Component | A reusable interface unit |
| Token | A declared or observed design value |
| Flow | An ordered journey through screens and states |
| Evidence | Material supporting a claim, such as source, DOM, screenshot, or test |
| Finding | A reviewable issue backed by evidence |
| Context | The explicit material available to a task |
| Task | A bounded unit of human or agent work |
| Agent | A visible worker operating through a harness |
| Harness | The provider runtime used to execute an agent task |
| Proposal | Unaccepted canvas or source changes |
| ChangeSet | A reviewable group of proposed source operations |
| Checkpoint | A restorable accepted document state |
| Trace | The causal record of meaningful product activity |
| Verification | Evidence that an expected result was checked |

## Three independent truth dimensions

Memi does not compress ownership, evidence, and health into one misleading
score.

### 1. Frame kind and authority

| Label | Definition | Authority | May directly change source? |
|---|---|---|---:|
| `CodeFrame` | A route or product view linked to implementation, runtime state, and source anchors | Product source | Only through an approved ChangeSet |
| `DraftFrame` | Native Memi content created by a human or agent | Canvas document | No source exists until explicitly generated |
| `SnapshotFrame` | Immutable capture evidence at one source revision and capture plan | Evidence store | No |
| `ReferenceFrame` | External visual material supplied for annotation or comparison | Imported reference | No |

Conversion never happens implicitly. Turning a `DraftFrame` into code or
detaching a `CodeFrame` creates a new object and preserves provenance.

### 2. Evidence level

Ordered from strongest to weakest:

| Label | Required evidence | Allowed claims |
|---|---|---|
| `Verified` | Reproducible runtime state, current source revision, current source anchors, and successful validation | Runtime and source-linked claims |
| `Observed` | Current runtime or DOM capture, but incomplete or absent source mapping | What was visibly observed |
| `Inferred` | Static analysis or pattern inference without a reproduced runtime state | Discovery hypotheses |
| `Reference` | Screenshot, image, or supplied documentation only | Visual comparison |
| `Proposed` | Unaccepted user or agent draft | Intended change only |

`Verified` may only be shown when validation requirements are met. Confidence
percentages do not promote an `Inferred` result to `Observed` or `Verified`.

### 3. Coverage health

| Label | Meaning | Required action |
|---|---|---|
| `Current` | Evidence matches the active source revision | None |
| `Partial` | Some required evidence exists and some is missing | Show missing evidence |
| `Blocked` | No valid frame can be produced for a known cell | Show cause and recovery |
| `Stale` | Evidence was once valid but the source or runtime changed | Recapture or inspect diff |
| `Not captured` | Known target has not been attempted | Capture or exclude explicitly |

A blocked coverage cell is not a frame and must not display a fabricated
thumbnail.

## Allowed combinations

- A repository-backed screen can be `CodeFrame + Verified + Current`.
- An immutable capture with current source and validation evidence can be
  `SnapshotFrame + Verified + Current`.
- A live URL without source mapping is
  `SnapshotFrame + Observed + Current`.
- A statically discovered route can be `CodeFrame + Inferred + Partial`.
- A screenshot is `ReferenceFrame + Reference + Current`.
- An agent ghost edit is `DraftFrame + Proposed + Current`.
- A previously verified capture with a mismatched source hash is
  `SnapshotFrame + Verified + Stale`; it must not be summarized as currently
  verified.

## Coverage summary language

Use:

- `12 of 15 required screen states verified`
- `2 partial`
- `1 blocked by authentication`
- `3 reference-only frames`
- `Recapture required after source change`

Do not use:

- `Complete` when any required cell is partial, blocked, stale, or not captured
- `Editable` for reference-only material
- `Pixel perfect`
- `AI verified`
- `Safe` without naming the permission or data boundary
- `Agent is thinking`
- `Everything imported`
- `Fixed` before verification succeeds

## Agent language

User-facing agent status is factual:

- Planning
- Reading context
- Preparing proposal
- Waiting for approval
- Applying approved changes
- Verifying
- Paused
- Blocked
- Failed
- Stopped
- Complete

Do not anthropomorphize hidden behavior. Never expose or request private model
chain-of-thought. A short user-visible plan or rationale summary is sufficient.

## Permission language

| Label | User-facing consequence |
|---|---|
| `Inspect` | Can read selected context and prepare a plan |
| `Canvas write` | Can prepare reversible canvas proposals |
| `Workspace write` | Can prepare source ChangeSets; applying still requires approval |

Commit, push, pull request, deploy, payment, destructive remote actions, and
credential access are separate capabilities. They cannot be implied by
`Workspace write`.

## Action labels

Prefer consequence-specific labels:

- Import product
- Start deterministic import
- Add to task context
- Review context
- Start task
- Open trace
- Accept selected changes
- Reject proposal
- Verify affected screens
- Restore previous checkpoint

Avoid vague labels such as `Go`, `Do it`, `Magic`, `Fix everything`, or
`Continue` when multiple consequences are possible.

## Demo labeling

M0 may simulate unavailable runtime capabilities with deterministic fixtures.

Every simulated surface must:

- Display a persistent `Demo` label
- Explain which result is fixture-backed
- Avoid claiming a real model, repository write, browser capture, or Git action
- Produce deterministic output
- Remain separable from future live integrations
