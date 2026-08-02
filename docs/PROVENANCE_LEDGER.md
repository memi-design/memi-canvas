# Provenance Ledger

Status: Updated M0 inventory
Inventory date: 2026-07-28
Source checkpoint: `a605931`
Target project license: Apache-2.0
Ledger owner: Principal Architect
Legal approval: **Not signed**

## Interpretation

`Recorded` means the item has an initial provenance entry. It does not mean
Legal/licensing has approved the item or the release.

Memi Canvas is recorded as a clean, standalone implementation. No Figma or
FigJam source code, plugin code, assets, icons, fonts, illustrations, schemas,
private APIs, undocumented protocols, or proprietary interface definitions
have been approved for incorporation.

The string `figma` used by a negative protocol test is rejection-test data, not
a Figma implementation or compatibility surface.

## Direct runtime dependencies

Versions are the exact versions currently declared and installed.

| ID | Item | Version | Use | Upstream license | Initial disposition | Status |
| --- | --- | --- | --- | --- | --- | --- |
| DEP-001 | `react` | 19.2.8 | Web UI runtime | MIT | Compatible package reuse; retain license evidence | Recorded; transitive scan and legal review pending |
| DEP-002 | `react-dom` | 19.2.8 | Browser rendering | MIT | Compatible package reuse; retain license evidence | Recorded; transitive scan and legal review pending |
| DEP-003 | `zod` | 4.4.3 | Runtime schema validation | MIT | Compatible package reuse; retain license evidence | Recorded; transitive scan and legal review pending |

## Direct development dependencies

| ID | Item | Installed version | Use | Upstream license | Initial disposition | Status |
| --- | --- | --- | --- | --- | --- | --- |
| DEV-001 | `@testing-library/react` | 16.3.2 | UI tests | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-002 | `@types/node` | 26.1.2 | Node type declarations | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-003 | `@types/react` | 19.2.17 | React type declarations | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-004 | `@types/react-dom` | 19.2.3 | React DOM type declarations | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-005 | `@vitejs/plugin-react` | 6.0.4 | React build integration | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-006 | `@vitest/coverage-v8` | 4.1.10 | Coverage reporting | MIT | Development dependency; reports do not ship | Recorded; transitive scan pending |
| DEV-007 | `jsdom` | 30.0.0 | Browser test environment | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-008 | `oxlint` | 1.76.0 | Static analysis | MIT | Development tool; bundled binary provenance must be scanned | Recorded; binary and transitive scan pending |
| DEV-009 | `typescript` | 6.0.3 | Type checking and compilation | Apache-2.0 | Development dependency | Recorded; transitive scan pending |
| DEV-010 | `vite` | 8.1.5 | Development and production build | MIT | Build dependency | Recorded; transitive scan pending |
| DEV-011 | `vitest` | 4.1.10 | Unit, contract, integration, and UI tests | MIT | Development dependency | Recorded; transitive scan pending |
| DEV-012 | `@playwright/test` | 1.61.0 | Responsive browser E2E, failure traces, and retained UI screenshots | Apache-2.0 | Development dependency; browser binaries and evidence do not ship | Recorded; binary and transitive scan pending |
| DEV-013 | `vite-node` | 6.0.0 | Execute deterministic TypeScript E2E artifact preparation | MIT | Development dependency | Recorded; transitive scan pending |

The package lock contains additional transitive packages. They are not approved
by omission from this table. A machine-readable transitive license report and
SBOM are required before release.

## Locally authored product implementation

These entries are declared locally authored for this standalone repository and
intended for Apache-2.0 contribution. Independent review and contributor DCO
sign-off remain pending.

| ID | Paths | Content | Source or method | Initial disposition | Status |
| --- | --- | --- | --- | --- | --- |
| LOC-001 | `packages/protocol/src/`, `packages/protocol/test/` | Canonical IDs, manifests, canvas, trace, durability, and durable harness contracts | Authored from the approved Memi Canvas product plan and public TypeScript/Zod APIs | Project-authored Apache-2.0 | Recorded; DCO and legal review pending |
| LOC-002 | `packages/canvas-document/src/` | Immutable canvas operations, hashing, replay, and document types | Standalone implementation against local contracts | Project-authored Apache-2.0 | Recorded; DCO and similarity review pending |
| LOC-003 | `packages/import-compiler/src/` | Deterministic fixture import and invalidation | Standalone implementation against local supported-mode and zero-token contracts | Project-authored Apache-2.0 | Recorded; DCO and review pending |
| LOC-004 | `packages/trace/src/` | Semantic trace journal and replay behavior | Standalone implementation against local trace contracts | Project-authored Apache-2.0 | Recorded; DCO and review pending |
| LOC-005 | `packages/harnesses/src/`, `packages/harnesses/__tests__/` | Provider-neutral fake and deterministic Demo harnesses, lifecycle signals, normalization, routing, and handoff | Standalone implementation against local harness ADR and acceptance contracts | Project-authored Apache-2.0 | Recorded; DCO and review pending |
| LOC-006 | `packages/integration/` | M0 deterministic vertical-slice verification | Locally authored integration evidence | Project-authored Apache-2.0 | Recorded; DCO and review pending |
| LOC-007 | `apps/web/` | M0 web shell and validated WorkspaceDocumentation consumer with responsive matrix, flow, design-system declaration, and canonical evidence views | Locally authored from product acceptance and interaction-state documents | Project-authored Apache-2.0 | Recorded; DCO, accessibility, and similarity review pending |
| LOC-008 | `packages/canvas-target/`, `packages/runtime/` | SQLite-backed canvas effect authority, durable command processing, canonical trace binding, migrations, and Demo harness lifecycle | Standalone implementation against local authority, durability, and harness contracts | Project-authored Apache-2.0 | Recorded; DCO, security, and legal review pending |
| LOC-009 | `packages/product-import/`, `packages/import-runtime/` | Deterministic workspace materialization planning, signed import authority, command-scoped execution, and documentation composition | Standalone implementation against local import and authority contracts | Project-authored Apache-2.0 | Recorded; DCO, security, and legal review pending |
| LOC-010 | `packages/workspace-documentation/` | Browser-safe canonical product documentation schema, selectors, serialization, and runtime projector | Standalone implementation against local product truth and visual-abstention contracts | Project-authored Apache-2.0 | Recorded; DCO and review pending |
| LOC-011 | `packages/canonical-json/` | Canonical JSON serialization and content hashing shared by authority boundaries | Standalone implementation against local deterministic-serialization contracts | Project-authored Apache-2.0 | Recorded; DCO and security review pending |
| LOC-012 | `packages/sandbox/` | Sandbox boundary feasibility implementation and adversarial probes | Standalone feasibility work against the local threat model | Feasibility-only, non-shipping; Product Security not approved | Recorded; Product Security VETO remains |

## Locally authored fixtures

| ID | Paths | Content | Source or method | Initial disposition | Status |
| --- | --- | --- | --- | --- | --- |
| FIX-001 | `packages/test-fixtures/deterministic-product/` | Synthetic routes, responsive states, and CSS token fixture | Locally authored synthetic data; not copied from a third-party product | Project-authored Apache-2.0 | Recorded; DCO review pending |
| FIX-002 | `packages/protocol/test/fixtures.ts` | Synthetic protocol entities | Locally authored from project schemas | Project-authored Apache-2.0 | Recorded; DCO review pending |
| FIX-003 | `packages/harnesses/__tests__/fixtures.ts` | Synthetic harness and task records | Locally authored from project contracts | Project-authored Apache-2.0 | Recorded; DCO review pending |
| FIX-004 | `packages/test-fixtures/sandbox-adversarial/` | Synthetic filesystem, network, process, race, recovery, secret, and outbox attacks | Locally authored from the sandbox threat model | Feasibility-only test data; non-shipping | Recorded; security and DCO review pending |
| FIX-005 | `packages/test-fixtures/security/` | Synthetic security-corpus inputs | Locally authored for local security regression tests | Non-shipping test data | Recorded; security and DCO review pending |

Fixtures must not contain customer data, third-party screenshots, copied product
copy, private APIs, secrets, or proprietary design-system values.

## Locally authored governance and contracts

| ID | Paths | Content | Source or method | Initial disposition | Status |
| --- | --- | --- | --- | --- | --- |
| GOV-001 | `docs/product/` | Product charter, supported modes, vocabulary, interaction states, acceptance criteria, and vertical slice | Authored for Memi Canvas from the approved master plan | Project-authored Apache-2.0 documentation | Recorded; owner approval pending |
| GOV-002 | `docs/adr/` | Proposed standalone architecture decisions | Authored for Memi Canvas; ADRs remain Proposed until signed | Project-authored Apache-2.0 documentation | Recorded; architecture and legal approval pending |
| GOV-003 | `docs/M0_EXECUTION.md`, `docs/PROGRAM_STATUS.md` | Program backlog, gates, status, and no-go conditions | Authored for the M0 program | Project-authored Apache-2.0 documentation | Recorded; program review pending |
| GOV-004 | `docs/OPEN_SOURCE_POLICY.md`, `docs/PROVENANCE_LEDGER.md` | Open-source intake and provenance governance | Authored for the standalone repository | Project-authored Apache-2.0 documentation | Recorded; legal approval not signed |
| GOV-005 | `LICENSE` | Standard Apache License 2.0 text | Apache Software Foundation standard license text | Include verbatim as project license | Present in working tree; legal approval pending |

## Build and repository configuration

| ID | Paths | Content | Source or method | Initial disposition | Status |
| --- | --- | --- | --- | --- | --- |
| CFG-001 | `package.json`, `package-lock.json` | Package metadata and resolved dependency graph | Locally configured; lockfile generated by npm | Project-authored configuration plus generated lockfile | Recorded; release scan pending |
| CFG-002 | `tsconfig.json`, `vite.config.ts`, `vitest.config.ts` | TypeScript, build, test, and coverage configuration | Locally authored from public tool APIs | Project-authored Apache-2.0 configuration | Recorded; DCO review pending |
| CFG-003 | `.gitignore`, `README.md` | Repository hygiene and introduction | Locally authored | Project-authored Apache-2.0 documentation | Recorded; review pending |
| CFG-004 | `playwright.config.ts`, `tests/e2e/` | Isolated responsive browser E2E configuration, page object, deterministic artifact preparation, and non-shipping evidence generation | Locally authored from public Playwright APIs and project contracts | Project-authored Apache-2.0 configuration and tests | Recorded; DCO and review pending |

## Assets, fonts, and icons

| ID | Inventory | Initial disposition | Status |
| --- | --- | --- | --- |
| AST-001 | Memi Canvas app icon source at `apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/`, generated `icon.png` and `icon.icns`, and synchronized `apps/web/public/memi-canvas-icon.png` | Project-owner-authored ruby field, glass body, and heart layers assembled in Apple Icon Composer; generated locally with the documented workflow. PNG SHA-256 `da068f20ba9e0e43f59ebde8602b43342f8c77fef2c080155a18d5a8fd0e25c2`; ICNS SHA-256 `1b333332d703bde26663f1740340d915b7fc1f943a4a07ff89dbb66130df6195` | Recorded as project-authored Apache-2.0 asset; final DCO/legal review pending |
| AST-002 | Bundled fonts | None; the UI uses system font stacks | Recorded; release rescan required |
| AST-003 | UI glyphs under `apps/web/src/canvas/icons.tsx` and related project source | Independently authored React/SVG glyphs for Memi Canvas; no external icon package or copied product asset | Recorded as project-authored Apache-2.0 source; similarity review pending |
| AST-004 | Coverage output, Playwright reports, traces, browser binaries, and non-selected audit screenshots | Non-shipping test output; ignored and excluded from release archives | Recorded; repository hygiene verification pending |
| AST-005 | README screenshots `docs/audits/screenshots/implementation-final/01-web-home.png` and `15-final-workspace.png` | Project-authored captures of the Memi Canvas deterministic M0 application. SHA-256 `d8e6a8f13835d40b05f1079679c3e3cf8cf49a13a40fa212565e96820b5914ae` and `114ff8bc1c93a4e42faaee9054d1f68831959f61cf8c600891e28ad6ca31d972` | Documentation-only Apache-2.0 project evidence; captions must retain the demo boundary |

Any future asset, font, icon set, screenshot, binary, or generated media requires
an entry before merge.

## Explicitly excluded sources

| ID | Source | Disposition | Evidence required |
| --- | --- | --- | --- |
| EXC-001 | Figma and FigJam source, plugins, assets, icons, fonts, private APIs, undocumented protocols, files, or proprietary schemas | Prohibited | Source, dependency, asset, and boundary scans must remain clean |
| EXC-002 | Existing Figma bridge, FigJam synchronization, Code Connect, and Studio cockpit code | Retire; do not port | Legacy disposition and similarity review |
| EXC-003 | FSL-only current Memi or Studio implementation | Do not copy; relicense, optional external invocation, clean-room implementation, or retire | Signed module-level disposition |
| EXC-004 | Customer repositories, screenshots, credentials, traces, and research data | Not redistributable without explicit permission | Data-source and redistribution approval |

## Evidence still required

This updated ledger does not satisfy the legal or release gate. Before public
release, attach:

- Signed contributor DCO attestations
- Direct and transitive license scan with exact resolved versions
- SBOM and bundled-binary inventory
- Source and generated-file provenance scan
- Asset, font, icon, fixture, and screenshot inventory
- Forbidden FSL and Figma/FigJam boundary scan
- `NOTICE` determination and required attribution bundle
- Clean-room notes or relicensing evidence for any current Memi/Studio concept
  implemented beyond this locally authored M0 scope
- Legal/licensing decision with reviewer and date

No item in this ledger is legally approved until that approval is recorded.
