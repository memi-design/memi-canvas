# Workspace product and architecture gap audit

Date: 2026-07-28
Competitive evidence checked: 2026-07-28

## Outcome

The app now opens on a project home instead of presenting the Buzzr repository
inventory as the whole product. Buzzr combines seven hash-pinned App Store 2.1
screens labelled as immutable production references with a separately labelled
local source inventory. Local Design files and Board files are independently
editable and recoverable.

That is a truthful end-to-end foundation, not yet the full product. The 71
Buzzr routes remain deterministic source placeholders rather than runtime
captures. Browser preview controls an isolated localhost iframe, not the local
process that serves it. Project, document, settings, and board state are
versioned and bounded, but browser storage is still the temporary authority.
Harness compatibility is declared and persistent; no live adapter is implied
unless a runtime connection is explicitly supplied.

The next milestone must prove one bounded product loop before adding more
professional-editor breadth.

## Product wedge

Memi Canvas is:

> A local-first, source-truth design workspace where humans and agents inspect
> a real product, create editable drafts, run controlled changes, and verify
> the result.

Memi does not win by matching every Figma tool or by generating another
chat-shaped mockup. Its launch advantage is the combination of:

- deterministic, zero-token source discovery;
- explicit production, local-source, snapshot, reference, and draft authority;
- mobile, tablet, and desktop product-state coverage;
- reversible human and agent operations on one semantic document;
- provider-neutral harness selection with visible permissions and trace; and
- verification against the affected product surface before completion.

## Delivered workspace matrix

| Area | Before | After | Evidence |
| --- | --- | --- | --- |
| Information architecture | Routes, tabs, and layers were mixed in one tree | Canvases, Layers, Assets, and Imports are separate navigator modes | `CanvasSidebar` contract and E2E |
| Canvas creation | No working creation path | New canvas button, command palette, and Mod+N create isolated documents | reducer, consumer, and E2E tests |
| Editing | Imported inventory looked editable but dominated the product | Empty canvases support Frame, Rectangle, and Text creation plus existing transform/history tools | workbench and E2E tests |
| Workspace utilities | Inspector was the only right-side surface | Inspect, Browser, Runs, Files, and Settings share one controlled dock | dock tests and E2E |
| Local preview | None | Explicit-port loopback preview on a different origin, sandboxed without forms, popups, downloads, or top navigation | security tests and Tauri CSP |
| Commands | Toolbar labels advertised shortcuts without a command source of truth | One immutable registry drives toolbar-independent shortcuts and a searchable palette | 42 command tests |
| Harness settings | Small overlapping popover | Dedicated settings view with harness, model, reasoning, permission, and connection state | dock integration |
| Persistence | One imported document autosave | Workspace manifest plus independently namespaced, random-identity document autosaves | persistence and degraded-storage tests |
| Human-agent trace | Floating drawer | Runs view combines prepared/submitted trace with semantic edit history | workbench and E2E |
| Project home | Hardcoded editor launch | Searchable Recents, Projects, Templates, typed Design and Whiteboard creation, import, and settings | home unit tests and E2E |
| Production references | Route silhouettes were the first visual evidence | Seven official App Store 2.1 images are local, hash-pinned, immutable, and provenance-labelled | manifest tests and rendered E2E |
| Whiteboard | No separate board type | Sticky, text, section, connector, selection, editing, and strict per-file recovery use a separate schema | whiteboard model, persistence, and integration tests |
| Global settings | Canvas-only static selectors | Persistent harness/model/reasoning/permission defaults distinguish local compatibility from connected runtime truth and preserve Helium policy | settings and application tests |

## Competitive gap matrix

The comparisons below use public, official product documentation. They define
the user expectation, not an instruction to copy proprietary implementation,
assets, or file formats.

| Priority | Capability | Current Memi | Figma and FigJam | Paper | MagicPath | Required Memi boundary |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Project home | Local typed project catalog, recents, templates, search, import, and settings are working; folders, thumbnails, rename/archive UI, and external projects remain | Teams, projects, drafts, recent files, and typed products | File dashboard, search, folders, and web or desktop entry | Projects own a canvas, chat, designs, and team | A `WorkspaceCatalog` owns projects, typed files, recents, source connections, and thumbnails |
| P0 | Product truth | Seven App Store production references are verified and immutable; local routes remain explicit source placeholders | Imported files and placed media remain visible objects | Figma, HTML, SVG, image paste, plus editable webpage capture | Figma, repository, image, and URL-to-editable-design entry points | Import adapters emit manifests and immutable artifacts; they never create editable truth by implication |
| P0 | Design authoring | Frame, rectangle, text, move, resize, fill, duplicate, delete, undo | Mature nested scene, layout, component, variable, vector, and prototype tools | HTML/CSS canvas, flex layout, nested selection, vectors, styling, and code export | Nested visual editing, multi-selection, layout, styling, revisions, and targeted agent edits | A `DesignDocument` owns a nested semantic graph and versioned design operations |
| P0 | Durable state | Strict versioned and bounded browser persistence covers project, design, board, and settings state; an operation-log authority is not implemented | Cloud file and version authority | File authority shared by editor and desktop MCP | Cloud project and design revisions | The client is a projection; the document operation log is authoritative |
| P0 | Preview | A typed session separates address, running URL, reload revision, and stopped state around a sandboxed explicit-port localhost iframe; process and log ownership remain | Prototype and dev inspection are tied to file selections | Stronger evidence for share and code export than a Figma-like prototype mode | Each completed design exposes preview and share actions | A `PreviewSession` owns process, port, route, health, logs, and source target |
| P0 | Harness and model settings | Global defaults persist and distinguish declared compatibility from connected runtime truth; live capability discovery remains | Agent integrations and Dev Mode expose selected design context | Desktop exposes the open file through local MCP | Project and selected-design context can be driven by external agents | A `HarnessCatalog` reports adapters, auth, models, capabilities, limits, and availability |
| P0 | Runs and proposals | Local semantic history can look run-like, but no live adapter is connected | Version and collaboration history are file-level | Agents can read and write the open design through MCP | Project chat streams agent work and creates design revisions | `Task`, `Run`, `Proposal`, `Approval`, and `Verification` remain distinct durable entities |
| P1 | Design systems | Static filename candidates and an empty Assets view | Components, variants, properties, variables, modes, and libraries | CSS-aligned tokens exist; richer component support is still evolving | Libraries, components, Tailwind or CSS systems, `DESIGN.md`, and extracted themes | An `AssetGraph` owns tokens, modes, components, variants, fonts, media, and usage references |
| P1 | Whiteboard | A separate durable board schema supports sticky, text, section, connector, selection, and editing; images, freehand drawing, voting, timers, and collaboration remain | FigJam is a separate whiteboard file type | The main canvas also supports broader visual work | Sketches, shapes, arrows, images, and designs share project context | A `BoardDocument` has its own schema and reducer; it shares infrastructure, not design-node semantics |
| P1 | Flows | Repository flow manifests are not editable in the workbench | Design files support multiple prototype flows and interactions | No equivalent public prototype model is established | Multi-screen designs and previews support app-flow creation | A flow graph references frame and state IDs; connectors are renderer projections |
| P1 | Versioning | Bounded local undo snapshots | File history and controlled branching | Current public evidence is stronger for file collaboration than branching | Completed edits create design revisions | Operations are append-only; checkpoints and restore are explicit trace events |
| P1 | Collaboration | Local single-user client | Sharing, comments, presence, cursor chat, and audio | Real-time multiplayer, roles, visitors, presence, and cursor chat | Humans and agents appear together in real time | Hosted awareness and CRDT are deferred, but every operation remains actor-addressed and replayable |
| P2 | Code handoff | Source metadata exists without production handoff | Dev Mode, inspection, variables, and Code Connect | HTML/CSS substrate plus React and Tailwind export | React code view, export, IDE handoff, and external agents | Code is a projection or source-owned ChangeSet, never hidden document authority |
| P2 | Renderer scale | Every visible node is rendered into the live DOM | Professional spatial-canvas performance | Professional infinite canvas | Infinite project canvas | Preserve the hybrid DOM/SVG ADR, add virtualization, and use artifact thumbnails for inactive source frames |
| P2 | Editor visual system | Multiple token generations and raw colors remain | Mature, internally consistent editor system | Purpose-built professional editor chrome | Purpose-built agent and visual-editor chrome | One semantic editor-token layer precedes further visual polish |

## Hard domain boundaries

### Typed files, not one universal canvas

A project contains typed files:

- `DesignFile` uses `DesignDocument`.
- `BoardFile` uses `BoardDocument`.

They may share IDs, camera math, selection conventions, comments, command
discovery, and renderer infrastructure. They must not share one ever-growing
`WorkbenchNodeKind` union. A sticky note is not a design text layer, a board
connector is not a prototype transition, and a live product frame is not a
whiteboard image.

### Domain map

```text
WorkspaceCatalog
├── DesignDocument ── semantic operation log ── DesignRenderer
├── BoardDocument  ── semantic operation log ── BoardRenderer
├── AssetGraph ───── tokens, components, fonts, images
├── ImportProjection ─ source, capture, and artifact references
├── PreviewSession ─── process, port, route, logs, and health
├── TaskRuntime ────── tasks, runs, proposals, approvals, verification
└── HarnessCatalog ─── adapters, models, capabilities, auth, and defaults
```

The React application consumes versioned read models and sends typed commands
through a client SDK. It does not import SQLite repositories, process
supervisors, Git implementations, or provider session objects.

### State authority

| State | Authority | Never authoritative |
| --- | --- | --- |
| Projects, files, settings, tasks, runs, approvals | SQLite WAL | React component state or local storage |
| Design and board content | Immutable operation log plus periodic snapshots | Renderer objects or autosave payloads |
| Screenshots, thumbnails, DOM evidence, large logs | Classified content-addressed artifact store | Base64 trace payloads |
| Product source | Git and an app-managed isolated worktree | Canvas undo |
| Preview lifecycle | Local workspace runtime | The iframe |
| Credentials and authenticated browser state | Encrypted local vault | Document, trace, or browser storage |
| Camera, hover, drag preview, active tool, open panel | Client memory | Document operations |
| Prompt draft and last-opened view | Optional session preference | Task or run completion |
| Render nodes and thumbnail cache | Disposable projection | Durable product truth |

### Command and render flow

```text
human or agent intent
→ typed command
→ revision, ownership, and permission validation
→ semantic operation or reviewable proposal
→ atomic operation metadata and trace event
→ read-model projection
→ renderer update
```

Pointer movement may update an ephemeral local preview. Pointer release commits
one semantic operation against an expected revision. Undo appends a validated
inverse operation instead of deleting history.

### Non-negotiable dependency rules

- Documents never store process handles, preview URLs, harness sessions, or
  provider payloads.
- Preview sessions never mutate documents.
- Import results are immutable evidence until an explicit detach or proposal.
- Detach creates a new draft and preserves provenance.
- Harness and model choices live on workspace settings or tasks, never nodes.
- Runs reference file, node, source, and artifact IDs rather than embedding
  scene snapshots.
- Agents propose the same semantic operations available to humans. Approval
  determines whether proposals enter accepted document history.
- Renderer caches may be discarded and rebuilt from the same document hash.

## Truth labels

These labels are required in the UI and protocol. Similar-looking frames must
not collapse into one generic `Screen` label.

| Label | Meaning | Editable? | Required provenance |
| --- | --- | --- | --- |
| `Production reference` | Public App Store or deployed-product evidence | No | Public URL, store version when available, retrieval time, artifact hash |
| `Local source` | A live source binding in the selected repository or isolated worktree | Only through an approved ChangeSet | Repository revision, dirty fingerprint, source anchor, route, state, viewport |
| `Local capture` | Immutable pixels or DOM evidence from a preview or simulator session | No | Preview session, source revision, route, state, viewport, capture time, artifact hash |
| `Source inventory` | A discovered route or state without verified visual evidence | No pixels to edit | Compiler version, source fingerprint, source anchor, blocker |
| `External reference` | Screenshot, image, or outside design used for context | No | Origin and artifact hash |
| `Canvas draft` | Canvas-owned editable design content | Yes | Document revision and operation history |
| `Proposed source change` | A reviewable patch or operation set that has not changed source | Review only | Task, run, baseline hash, permission, proposal hash |
| `Verified source change` | An approved change applied and verified against its target | Through a new change | ChangeSet, resulting revision, verification artifacts |
| `Demo run` | Deterministic fixture or local simulation | No external effects | Demo adapter identity and fixture version |
| `Live run` | A connected adapter executing a real task | Within granted scope | Harness, model, task, run, permission, trace cursor |

App Store evidence and a local repository build may coexist in one project, but
they are not equivalent authorities. App Store screenshots establish what was
publicly shipped. Local captures establish what the selected source revision
currently renders.

## Interaction decisions

- The left rail changes what the navigator means. It does not mix pages and
  document nodes in one hierarchy.
- The right dock shows one utility at a time, matching the mental model of an
  editor inspector rather than stacking overlays.
- Prompt submission remains local and says it is disconnected until a harness
  adapter exists. A prepared prompt is not represented as a completed run.
- Imported source authority is preserved through a separate authority project.
  Detaching produces a canvas-owned draft with provenance.
- The editor origin cannot be embedded in its own Browser view. Localhost and
  `127.0.0.1` aliases on the editor port are treated as the same service.

## Staged roadmap

| Stage | Outcome | Opens only when |
| --- | --- | --- |
| S0: Honest shell | Project home, typed Design and Board files, current workspace navigation, explicit unavailable states | No placeholder is represented as a capture, live run, or source edit |
| S1: Buzzr truth-to-draft | Real production references, verified local capture, durable editable design, managed preview | The vertical-slice matrix below passes through restart |
| S2: Professional design core | Nested selection, multi-select, alignment, snapping, typography, layout, images, assets, tokens, and component instances | All edits use canonical semantic operations and renderer budgets pass |
| S3: Human-agent loop | Capability-discovered harnesses, tasks, proposals, approval, verification, checkpoint, and restore | At least one live adapter passes the shared conformance and recovery suite |
| S4: Product documentation | Route, state, role, theme, flag, and viewport matrices with design-system usage and drift | Capture coverage is explicit, bounded, and repeatable with zero-token base import |
| S5: Collaboration and handoff | Sharing, comments, awareness, versions, code mappings, and source ChangeSets | Local single-authority durability and security gates are approved |

Professional vector editing, hosted multiplayer, branching, and broad import
compatibility do not enter S1 merely because their controls can be drawn.

## S1 vertical-slice acceptance matrix

Slice name: **Buzzr truth-to-draft**

| ID | Journey | Acceptance | Required proof |
| --- | --- | --- | --- |
| S1-01 | Open product home | A user can open Buzzr from recent projects and create a blank Design or Board file | Keyboard E2E plus restart |
| S1-02 | Inspect production | Buzzr shows current public App Store screenshots labelled `Production reference` with source URL, version when available, retrieval time, and artifact hash | Fixture-independent metadata validation and rendered screenshot |
| S1-03 | Inspect local source | A local repository or isolated worktree is identified by canonical path, revision, dirty fingerprint, and source fingerprint | Import contract test |
| S1-04 | Capture one real screen | At least one selected Buzzr route renders through the managed runtime or simulator and becomes a `Local capture` tied to route, state, viewport, and source revision | Capture artifact, console result, and visual review |
| S1-05 | Preserve blocked truth | Routes without verified pixels remain `Source inventory` or `Blocked`; no silhouette is called a screenshot | Negative contract test and UI assertion |
| S1-06 | Create a design | A user creates a mobile frame containing nested text and rectangle layers | Pointer and keyboard E2E |
| S1-07 | Edit the design | Text, fill, position, size, duplicate, delete, undo, and redo operate through semantic commands | Operation-log tests and rendered result |
| S1-08 | Recover the design | Closing and reopening the app reconstructs the same accepted document hash, selection-independent | Native restart smoke test |
| S1-09 | Open local preview | The selected project starts a managed preview session; Browser shows address, starting, ready, failed, stop, refresh, and logs | Process lifecycle integration test |
| S1-10 | Configure an agent | Settings list only runtime-reported harnesses and compatible models, persist workspace defaults, and explain missing auth or capability | Catalog contract and degraded-state E2E |
| S1-11 | Distinguish activity | Canvas operations and preview lifecycle appear in activity; they are not labelled agent runs | Trace projection test |
| S1-12 | Preserve authority | Detaching a source or reference frame creates a new `Canvas draft` with provenance and leaves the original immutable | Ownership and undo tests |

The slice passes only when one user can complete S1-01 through S1-12 without
manual storage repair, an unlabelled fixture, or a placeholder standing in for
runtime evidence.

## S1 non-goals

- One-to-one Figma feature parity
- Automatic conversion of App Store screenshots into trustworthy editable
  layers
- Runtime capture of every Buzzr route and state
- Auto layout, component variants, vector paths, and prototype playback
- General-purpose browsing or non-loopback preview URLs
- Mutation of the user's original or dirty checkout
- Live Git apply, commit, push, deployment, or App Store submission
- Production Codex, Claude, Gemini, or other provider adapters
- Multiplayer, CRDT synchronization, branches, or merge
- Figma file-format compatibility or export
- Responsive inference across every screen
- Claims that App Store evidence and a local source build are the same release

## Automated audit caveat

The current Mémoire CLI scan reports Diagnose 46 and UX 63. The last dedicated
Craft audit reported 64. The current broad scan includes generated coverage,
Playwright, and test artifacts, counted 534 raw color occurrences across 184
files, and did not perform screenshot pixel analysis. It is useful as a
design-system debt signal, but it does not measure the corrected interaction
architecture. The behavioral matrix above is therefore gated by source review,
rendered screenshots, unit coverage, Playwright, and the packaged macOS smoke
test.

## Remaining product debt

- The canvas renderer is still an early editor, not feature-parity with Figma.
  Components, constraints, auto layout, vector editing, multiplayer presence,
  prototype links, and production harness execution remain future slices.
- The Browser is a restricted localhost preview, not a general-purpose browser
  or a Chromium/Helium tab engine.
- Runs currently represent local trace and semantic history unless a real
  harness adapter is connected.
- The stylesheet contains legacy and current token generations. Consolidating
  raw values into one semantic token layer remains required to improve the
  automated craft score.
- The supported authoring shell is desktop. Mobile and tablet widths remain
  imported product-preview targets, not full editor breakpoints.

## Official comparison sources

Sources were checked only to establish current user expectations and product
boundaries.

### Figma and FigJam

- [Guide to the file browser](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser)
- [Guide to components](https://help.figma.com/hc/en-us/articles/360038662654-Guide-to-components-in-Figma)
- [Guide to variables](https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma)
- [Guide to prototyping](https://help.figma.com/hc/en-us/articles/360040314193-Guide-to-prototyping-in-Figma)
- [Guide to Dev Mode](https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode)
- [Guide to FigJam](https://help.figma.com/hc/en-us/articles/1500004362321-Guide-to-FigJam)

### Paper

- [Paper product](https://paper.design/)
- [Paper MCP](https://paper.design/docs/mcp)
- [Paper paste and import](https://paper.design/docs/paste)
- [Paper tokens](https://paper.design/docs/tokens)
- [Paper support and editor shortcuts](https://paper.design/docs/support)
- [Paper roadmap](https://paper.design/roadmap)

Paper's public roadmap distinguishes shipped work from planned component, grid,
sharing, and organization work. Roadmap claims are not treated as current
capabilities in this audit.

### MagicPath

- [MagicPath canvas](https://www.magicpath.ai/documentation/features/canvas)
- [MagicPath visual editing](https://www.magicpath.ai/documentation/features/editing)
- [MagicPath external agents](https://www.magicpath.ai/documentation/features/external-agents)
- [MagicPath design systems](https://www.magicpath.ai/documentation/design/design-systems)
- [MagicPath web-to-design](https://www.magicpath.ai/documentation/features/web-to-design)
- [MagicPath code export](https://www.magicpath.ai/documentation/features/code-export)
