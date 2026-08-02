# Feature matrix

Labels describe current Memi behavior, not architectural intent.

- **Stronger**: working behavior provides a material repository-first, deterministic, provenance, or reversibility advantage
- **Competitive**: the main workflow works at comparable completeness
- **Partial**: visible or implemented, but disconnected, fixture-bound, unreliable, or poorly productized
- **Missing**: no current live behavior found
- **Out of scope**: intentionally excluded by a defensible product boundary

`Inaccessible` is used for competitor capabilities that were not safely exercised. It is not equivalent to missing.

![Memi's current source-aware canvas and inspector](screenshots/memi/01-current-canvas-inspector.png)

| Capability | Figma | Paper | MagicPath | Current Memi evidence | Memi label |
| --- | --- | --- | --- | --- | --- |
| Product mental model | Shared design file | Web-native agent canvas | Human-agent workspace | Local-first product canvas, but editor, evidence, preview, and agent roles compete | Partial |
| Home and project browser | Mature teams/projects/files | Clear recents/files/team | Clear files/shared/favorites/libraries | Project home works with source and status metadata [SHOT-MEM-002] | Competitive |
| Multiple documents/canvases | Files and pages | Files and pages | Files and canvas | Canvas creation and switching reproduced [SHOT-MEM-011, 015] | Competitive |
| Infinite canvas | Mature | Mature | tldraw-based | Working pan/zoom surface and objects [SHOT-MEM-012] | Competitive |
| Basic creation tools | Frame, shape, pen, text, comment | Frame, shape, pen, text, media, shader | Compact canvas rail | Text, rectangle, ellipse, line, arrow, frame | Partial |
| Selection | Precise, mature | Immediate property binding | Selection scopes prompt | Working single selection and resize handle [SHOT-MEM-001] | Partial |
| Multi-selection and alignment | Mature | Available in editor | Not fully verified | Basic selection exists; mature align/distribute feedback not observed | Missing |
| Geometry inspector | Mature | Strong | Not fully verified | X, Y, width, height and domain fields work | Competitive |
| Constraints and responsive layout | Strong constraints and auto layout | Flex and layout properties | Responsive components/libraries | Responsive route placeholders exist; authoring model incomplete | Partial |
| Components | Mature components and instances | Web-native groups and React export | First-class Components tab | Nine source-derived components and instances [SHOT-MEM-018] | Partial |
| Design-system libraries | Variables, assets, libraries | Theme tokens via MCP | Searchable shared libraries | Deterministic source tokens and assets, but no polished library workflow | Partial |
| Design-system provenance | Design-file and library provenance | Token/document context | Library ownership | File, symbol, revision, and content hash shown [SHOT-MEM-001] | Stronger |
| Imported product visualization | Figma-native files | Imports and MCP edits | Figma and web imports | Buzzr fixture with reference and source nodes; arbitrary repo path not production-ready | Partial |
| Repository as source of truth | Not primary | Can integrate/export code | Can connect external coding agents | Explicit source ownership and read-only repository inventory | Stronger |
| Visual cache regeneration | Not a core model | Canvas remains document | Canvas remains workspace | Architectural intent exists; full refresh/invalidation loop not productized | Partial |
| Source linkage | Dev Mode and code hints | Copy as React | Component code generation | Exact paths, symbols, revisions, hashes for fixture components | Stronger |
| Source editing | Dev handoff, not repository authority | React export and agent edits | External agent path | Source writes and ChangeSets explicitly disabled | Missing |
| Browser/preview | Prototype and presentation | Web-native canvas; prototype path | Component previews and imports | Localhost-only iframe and Helium entry | Partial |
| Preview readiness | Mature prototype state | Live web structures | Live component previews | Reports running from accepted URL before readiness proof [SHOT-MEM-005] | Partial |
| Responsive screen matrix | Manual frames and prototypes | Authored layouts | Component previews | 213 route/view placeholders; current source of record reports zero observed or verified screenshots | Partial |
| AI prompt composer | Agents entry visible; run not tested | External MCP is primary | Native thread and selection-aware composer | Persistent floating selection prompt exists | Partial |
| Selection-to-agent context | Visible Agents entry; not tested | MCP can read canvas | Explicit select or `@` reference | Versioned envelope includes document, nodes, revision, mode, model, permission, reasoning | Stronger |
| Live agent execution | Inaccessible in this audit | External agent path not connected | Native and external agent entries | Default consumer has no live harness adapter [SHOT-MEM-010] | Missing |
| Harness choice | Figma-controlled | Bring own agent through MCP | Codex, Claude Code, Cursor | Broad local catalog with truthful declared status | Partial |
| Model and reasoning control | Mostly abstracted | External harness-owned | Auto visible; details not fully tested | Model and reasoning controls are explicit but not runtime-verified | Partial |
| Skill routing | Plugins/actions | MCP guidance | `/` skills are first-class | Skills exist in the ecosystem; Canvas composer does not productize them | Partial |
| Agent threads | Figma Agents not tested | External agent conversation | Central thread model | One prompt field and trace; no durable user-facing thread | Missing |
| Streaming agent state | Inaccessible | External harness-owned | Native run model visible | No live default adapter or streamed run | Missing |
| Plan/propose/apply modes | Not primary | External agent-owned | Agent loop | Modes visible; only local preparation verified | Partial |
| Runs and history | Version history and activity | Document history not deeply tested | Thread history | Runs panel shows trace and semantic history, but no completed live run | Partial |
| Deterministic trace | Design history | Not a core differentiator | Agent conversation | Deep local runtime and hash-linked trace architecture | Stronger |
| Replay | Version history | Not verified | Not verified | Runtime replay exists, but primary Canvas replay UX is absent | Partial |
| Approvals | Share and review | External workflow | Agent collaboration | Patch Approve/Reject component exists; no live default patch flow | Partial |
| Permission controls | Team/file permissions | Team/settings | Team and agent connections | Inspect/approval/full access model and localhost policy | Stronger |
| Comments | Mature comments | Comment tool | Collaboration implied; not exercised | No primary comment thread observed | Missing |
| Presence | Mature multiplayer | Team product; not exercised | Team workspace; not exercised | No presence or cursor model observed | Missing |
| Review and visual diff | Branching/review ecosystem | Manual canvas review | Agent-generated component review | Patch UI exists; visual/source diff is absent | Missing |
| Undo and redo | Mature | Mature | Expected canvas behavior | Reproduced successfully [SHOT-MEM-013, 014] | Competitive |
| Reload persistence | Mature cloud persistence | Cloud persistence | Cloud persistence | Reproduced local reload persistence [SHOT-MEM-016] | Competitive |
| Checkpoint and restore | Version history | File history | Thread history | Runtime checkpoints exist; primary restore UX not observed | Partial |
| Command palette | Excellent [SHOT-FIG-003] | Keyboard-heavy but palette not observed | Shortcuts visible; palette not verified | Command palette exists in code; not prominent in inspected shell | Partial |
| Keyboard shortcuts | Extensive and discoverable | Compact tool shortcuts | Composer and canvas hints | Core shortcuts work and tooltips disclose many | Competitive |
| Empty-state onboarding | Product-type launcher | Editable welcome canvas | Best agent-native empty state [SHOT-MAG-003] | Blank canvas teaches object shortcuts, not core repo-agent loop | Partial |
| Error handling | Mature | Loading/update states | Product notifications | Honest disconnected states; Browser readiness state is overconfident | Partial |
| Performance and latency | Highly optimized | Felt responsive after load | Felt responsive after load | Basic editor felt responsive; no formal frame-time benchmark | Partial |
| Visual hierarchy | Mature dense editor | Minimal and legible | Clear task-centered layout | Coherent but many peer surfaces and small text | Partial |
| Motion and feedback | Refined | Lightweight | Contextual panels and updates | Limited observed transition feedback; static audit flags token drift | Partial |
| Extensibility | Plugins, widgets, MCP | MCP-first | integrations, skills, external agents | Harness, tools, MCP, Engine, and adapters are architecturally strong | Stronger |
| Arbitrary vector illustration | Best-in-class | Capable | Not central | Deliberately not the goal | Out of scope |
| Full Figma compatibility | Native | Not applicable | Figma import | Explicitly rejected by ADR and README positioning | Out of scope |
| Cloud-first multiplayer suite | Mature | Team-oriented | Team-oriented | Local-first architecture intentionally prioritizes private work | Out of scope |

## Summary by band

### Stronger

- repository and source linkage
- design-system provenance
- explicit selection task envelope
- deterministic trace architecture
- permission model
- extensibility model

### Competitive

- project home
- multiple canvases
- infinite canvas foundation
- geometry inspector
- undo/redo
- reload persistence
- core keyboard shortcuts

### Partial

- components and design systems
- responsive coverage
- imports and visual cache
- Browser
- prompt composer
- harness and model controls
- Runs, approvals, replay, checkpoints
- command palette, onboarding, hierarchy, motion, and errors

### Missing

- default live harness execution
- source ChangeSet application
- durable agent threads and streamed state
- multi-user presence and comments
- visual/source diff review
- primary restore UX

## Evidence caveats

- Figma AI execution was not tested in an existing user file.
- Paper's external MCP agent was not connected during this audit.
- MagicPath generation was not submitted, so generation quality and latency are not scored.
- Memi's installed debug app was exercised directly. Current code and tests were also inspected.
- A full current test run had 2 failures out of 1,210 tests. A capability is not upgraded to Competitive solely because an older program-status document reports a prior green run.
