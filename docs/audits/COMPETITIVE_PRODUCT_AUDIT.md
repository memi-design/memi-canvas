# Memi Canvas competitive product audit

Date: 2026-07-29
Checkout: `codex/m0-foundation` at `e74492d`
Status: evidence-backed audit of the installed Figma, Paper, MagicPath, and Memi Canvas desktop applications

## Executive summary

Memi is not primarily behind because it lacks another toolbar or property field. It is behind because its most differentiated systems do not yet close a visible human-agent loop.

The five most important conclusions are:

1. **Memi already has a credible editor foundation.** Live tests verified canvas creation, object creation, selection, inspector edits, undo, redo, switching, reload persistence, layers, assets, imports, source revision and content hashes, and local configuration. Browser, Runs, Files, and Settings are implemented and inspectable surfaces, but Browser readiness and Runs remain partial. Calling the whole product only a mockup would still be inaccurate.
2. **The primary promise stops exactly where the product becomes unique.** A selection prompt produces `local only; no harness adapter connected`. The global settings correctly say compatibility is declared but not runtime-verified. This is the largest product gap.
3. **Repository truth is Memi's strongest advantage, but the UI presents it as inventory instead of a workflow.** The live app can show 71 routes, 213 responsive placeholders, nine source components, file paths, revisions, and hashes. The user cannot yet move naturally from that evidence to a scoped proposal, preview, approval, source ChangeSet, verification, and checkpoint.
4. **Figma wins on precision, Paper wins on reduction, and MagicPath wins on native agent framing.** Memi currently combines more system concepts than any of them, but gives those concepts nearly equal visual weight. The result feels denser and less decisive.
5. **Trust language is better than trust behavior.** Memi deserves credit for explicit `Disconnected`, `read only`, and `local preview` labels. However, Browser reports `Preview running` from URL validity alone, before proving content readiness. Runs can look authoritative while showing fixture and local trace rather than a live agent lifecycle.

## Method

The same inspection frame was used for all four products:

- home and project hierarchy
- empty and populated canvas
- layers, components, libraries, and assets
- creation and selection
- properties and direct manipulation
- commands and shortcuts
- AI or agent entry
- preview or browser behavior
- trace, history, permissions, and recovery

Evidence types:

- `UI`: direct live observation
- `FLOW`: reproduced interaction
- `SHOT`: saved screenshot
- `CODE`: current checkout file and line
- `DOC`: intended behavior only
- `LIMIT`: action not verified due safety, plan, or access boundary

No competitor files were edited. No paid generation, sharing, publishing, comment, update, or external-agent connection was triggered.

## Product mental models

| Product | What the interface says the product is |
| --- | --- |
| Figma | A shared design file with pages, layers, precise objects, reusable systems, prototypes, and multiplayer review. |
| Paper | A lightweight web-native canvas that humans and external agents can both edit through MCP. |
| MagicPath | A shared agent workspace where conversation, selection, components, libraries, imports, and generated output meet on one canvas. |
| Memi | A local-first product-understanding and editing workspace with repository evidence, deterministic imports, configurable harness context, preview, trace, and reversible canvas operations. |

Memi's model is strategically coherent, but its interface currently reads as several adjacent products: editor, repository inventory, design-system viewer, local browser, harness configuration, and trace viewer. The missing live loop prevents those surfaces from converging.

## Figma

### Observed strengths

![Figma editor](screenshots/figma/02-existing-project-canvas.png)

Figma's advantage is not novelty. It is the accumulated quality of its interaction contract:

- pages and layers anchor document structure
- the toolbar stays compact and spatially stable
- selection changes the inspector immediately
- prototype, presentation, comments, share, and multiplayer are visible without dominating creation
- tool modes and shortcuts are legible
- the command palette makes long-tail power searchable

The command palette is particularly important. It combines commands, settings, plugins, recents, and shortcut education in one predictable overlay.

### Adopt

- precise selection, snapping, handles, multi-selection feedback, and property synchronization
- progressive inspector sections
- command search as the universal escape hatch
- stable distinction between document structure, creation, inspection, and review
- visible multiplayer and comment affordances near the work

### Reinterpret

Memi should use Figma-like precision for repository-backed nodes, but the inspector should show authority as a first-class dimension:

- canvas-only node
- cached representation
- source-owned component
- immutable evidence
- proposed ChangeSet
- verified output

### Avoid

- cloning Figma's entire vector-authoring surface
- treating the design document as the source of truth
- reproducing plugin sprawl when Memi can route deterministic tools and skills directly

## Paper

### Observed strengths

![Paper selected frame](screenshots/paper/04-selection-properties.png)

Paper feels fast because it reduces the product to a small number of legible surfaces:

- file and page structure on the left
- a small vertical creation rail
- the canvas
- one selection-linked property panel

Its onboarding document teaches the product by being editable product content. It explicitly explains MCP, external agents, React export, tokens, images, shaders, and the human edit loop inside the canvas.

Paper also makes its technical thesis clear: web-native structures are accessible to models and can move toward React. Whether every generated result is production-ready was not tested, but the mental model is immediately understandable.

### Adopt

- smaller stable tool surface
- in-canvas, editable onboarding
- selection colors and high-value aggregate properties
- direct `Copy as React` or source handoff where authority permits
- explicit MCP onboarding near the project list

### Reinterpret

Memi should not make HTML the only source model. It should make the repository adapter produce a typed, disposable visual cache while retaining file, component, route, token, and revision provenance.

### Avoid

- implying that generated visual code is already integrated into the repository
- optimizing for freeform canvas creation at the expense of verification and source authority

## MagicPath

### Observed strengths

![MagicPath empty agent canvas](screenshots/magicpath/03-empty-canvas-agent.png)

MagicPath had the strongest first-run agent framing:

- the agent thread is not a later panel; it is the left-side primary workspace
- the composer states that `@`, canvas selection, and `/` skills control context
- Connect Agent, Import from Figma, Import from Web, and Start from a design system occupy the canvas empty state
- Components and Libraries are adjacent to Agent
- external harness entry is visible at the top of the canvas
- integrations are reduced to three understandable actions

This makes agent collaboration feel native even before generation begins.

### Adopt

- selection and mention context rendered directly in the composer
- persistent thread model instead of a single detached prompt
- visible skills in the prompt grammar
- agent, components, and libraries as peer working modes
- an empty state that teaches the core loop rather than only object shortcuts

### Reinterpret

Memi's agent thread should be grounded in repository authority. Every message should show:

- selected nodes and source files
- revision and cache freshness
- harness and model
- permission ceiling
- plan, proposal, applied, and verified state
- deterministic evidence used

### Avoid

- making generation the only path to value
- hiding model cost, source impact, or approval boundaries
- cloud-first collaboration that weakens the local-first and reproducible architecture

## Current Memi Canvas

### What works

![Memi editor](screenshots/memi/01-current-canvas-inspector.png)

Live, working behavior:

- project home and recent project metadata
- multiple canvases
- blank canvas creation
- rectangle creation and selection
- direct geometry inspection
- undo and redo
- canvas switching
- reload persistence
- hierarchical layers
- source-derived assets
- static repository import summary
- selection-scoped prompt envelope
- local trace receipts
- harness, model, reasoning, and permission configuration
- localhost-only browser validation

Code corroborates the behavior:

- task envelope and local-only branch: `apps/web/src/canvas/CanvasWorkbench.tsx:1172`
- browser validation and iframe: `apps/web/src/canvas/workspace-dock.tsx:203`
- Runs and approval surface: `apps/web/src/canvas/workspace-dock.tsx:393`
- truthful disconnected state: `apps/web/src/canvas/workspace-dock.tsx:517`
- declared, not verified harness catalog: `apps/web/src/settings/global-settings.ts:69`
- deterministic fixture boundary: `README.md:7`

### What is partial

- Browser navigation treats a syntactically allowed URL as running without a readiness handshake.
- Runs displays trace and approval UI, but the default product consumer does not execute a live external harness.
- Files is a flat node dump rather than a repository-oriented navigator.
- imports expose strong counts and provenance, but the Buzzr surface is fixture-backed and read-only.
- responsive route coverage is represented mainly as placeholders rather than verified visual artifacts.
- Figma URL import requires a token path and is not a complete live round trip.

### What is missing

- live harness connection from the default Canvas product
- streamed run events and cancellation
- plan and proposal rendered in context
- source diff or typed ChangeSet review
- approval receipt tied to the exact change
- application to repository source
- deterministic and browser verification of that source change
- checkpoint and restore from the primary workflow
- human comments, presence, mentions, and review threads
- verified browser readiness and console/error inspection

## Why Memi feels behind

### 1. The primary loop is incomplete

Cause: `IMPL`, secondarily `IXD`.

The composer is always visible and looks central, but submission produces only a local trace. This is more damaging than a missing button because it breaks the product's promise at the moment of intent.

### 2. System concepts are presented before workflow outcomes

Cause: `IXD`.

Harness, model, reasoning, permission, trace, files, imports, assets, layers, canvases, browser, and provenance are all valuable. The current layout does not clearly answer:

1. What should I do now?
2. What is selected?
3. What will the agent receive?
4. What can it change?
5. What happened?
6. Is the result verified?

### 3. Repository intelligence is legible to engineers, not yet productized

Cause: `IXD` and `IMPL`.

`71 routes · 213 frames` is powerful evidence. Hundreds of placeholder rows in Files are not a useful primary navigation model. Users need route grouping, responsive completeness, freshness, ownership, and verification status, not a raw node inventory.

### 4. The canvas lacks Figma-grade manipulation feedback

Cause: `CAP` and `IXD`.

Basic creation, move, resize, selection, and inspector fields work. The live pass did not expose mature snapping, alignment guides, distribution, constraints, auto layout, rotation, multi-edit summaries, or a responsive layout model comparable to Figma and Paper.

### 5. Agent collaboration is a composer, not a shared state machine

Cause: `ARCH` and `IMPL`.

MagicPath visibly centers threads, selection references, skills, and result generation. Memi has deeper trace architecture, but the user-facing run lifecycle is not connected to it.

### 6. Trust states are inconsistent

Cause: `IMPL`.

The global settings are unusually honest about runtime status. Browser's `Preview running` state is less rigorous. Trust should be derived from observed readiness, not only accepted intent.

### 7. Visual polish is coherent but not yet calibrated

Cause: `VIS`.

The dark shell is consistent and substantially more polished than the earlier architecture notes implied. Remaining issues are density, small text, weak empty-state hierarchy, overly similar panel weights, and limited motion/transition feedback. A pinned Memi diagnose reported score 46 with low confidence 0.47; its actionable static signals were token drift, hardcoded motion durations, and missing local reduced-motion coverage. The score is not treated as a product verdict.

## Strongest strategic position

Memi should not become “Figma with agents.” It should become the visual operating surface for changing a real product safely:

```text
Open repository
→ generate or refresh typed visual cache
→ select screen, component, route, token, or evidence
→ describe intent
→ agent plans against explicit source and permission context
→ agent proposes canvas operations or source ChangeSet
→ human reviews visual and code impact
→ approve
→ apply through the local runtime
→ verify with browser plus deterministic Engine checks
→ checkpoint or restore
```

Canvas owns selection, visual context, review, and collaboration.
Studio/runtime owns processes, adapters, grants, persistence, and normalized events.
Engine owns deterministic product understanding, provenance, audit, verification, and cache regeneration.

## Verification status

Current test run on 2026-07-29:

- 125 test files passed
- 2 test files failed
- 1,208 tests passed
- 2 tests failed
- failures concern expected Buzzr visual evidence and a `Dashboard / Mobile` canvas element
- React also emitted controlled/uncontrolled input and `act()` warnings

This means the current checkout does not satisfy its full green verification claim, even though most runtime and editor tests pass.
