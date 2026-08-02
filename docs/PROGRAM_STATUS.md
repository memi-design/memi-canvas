# Memi Canvas Program Status

As of: 2026-08-02
Public status: In development
Overall: RED
Active milestone: M0, product and architecture lock
Next decision: M1 go/no-go
Target: public development-source snapshot; public beta remains gated

## Executive status

The M0 foundation implementation has passed its current automated and browser
fixture checks. The canonical RED-to-GREEN chain is recorded below.

This is focused implementation evidence, not a signed M0 gate. The local
runtime now has passing SQLite, outbox, grant, lease, fencing, and
effect-boundary tests. The local canvas-target authority, exact verification
binding, atomic canonical SQLite trace commit, pure replay, fail-closed
integrity checks, and deterministic OS-process concurrency cases are also
implemented and passing. The deterministic import protocol, flow manifest,
workspace projection, and workspace-bound canvas materialization plan are now
implemented and passing their isolated architecture and security gates. The
trusted deterministic fixture now executes through the durable runtime,
canvas target, canonical SQLite trace, replay, WorkspaceDocumentation
projection, and responsive browser consumer. A durable two-adapter Demo
harness lifecycle now persists tasks, runs, hash-linked events, checkpoints,
handoffs, budgets, and race-safe controls under SQLite schema v11.

Verified capture evidence intentionally fails closed until a trusted artifact
resolver can prove artifact existence, project and source-revision binding,
redaction, and content hashes. JSONL history projection, production provider
composition, authenticated MCP, Node 22 containment and full persistence
evidence, ChangeSets, and complete product flows remain pending. The sandbox
remains under a non-overridable Product Security VETO. Architecture, security,
legal, evaluation, and QA evidence remains unsigned. Overall M0 therefore
remains RED; M1 production integration, tagged artifacts, and public beta
remain NO-GO. Publishing development source does not lift those gates.

No approval or signature is inferred from a passing test.

## Checkpoint chain

| Checkpoint | Commit | Result |
| --- | --- | --- |
| Initial product RED | `036e9ae` | Product contracts and RED evidence defined |
| Canonical convergence RED | `4d86722` | Canonical protocol and security contracts defined before implementation |
| Canonical foundation GREEN | `f688fd1` | Runtime converged on the canonical protocol and passed current verification |
| Journal and importer review RED | `25bab74` | Canonical journal and importer blockers reproduced |
| Journal and importer review GREEN | `bb667cb` | Canonical journal and importer review gaps closed |
| Trace authority review RED | `4e4d0bd` | Pre-persistence project authority and shared-close regressions reproduced |
| Trace authority review GREEN | `ab4a110` | Cross-project writes now fail before persistence and close shares one drain |
| Aggregate workspace foundation GREEN | `49c8e90` | Reviewed web, harness, licensing, provenance, and security evidence committed |
| Target-authority metric RED | `d691ce0` | Security cases and release metrics map the missing target-authority boundary |
| Durable runtime contract | `e220ce5` | Product states and acceptance criteria extend through effect finalization |
| Focused runtime GREEN | `fb02e7b` | The in-process M0 effect boundary is enforced by the current runtime tests |
| Durable local runtime | `e7504c3` | SQLite-backed runtime foundation and recovery surfaces established |
| Canonical trace verification GREEN | `568f594` | Exact target receipt binding, replay conflicts, and fail-closed authority audits pass |
| Canonical trace concurrency GREEN | `d538a39` | Deterministic OS-process cases 002–005 pass with retained sanitized evidence and exact post-conflict database equality |
| Deterministic import protocol GREEN | `1ff0cc3` | Strict flow, containment, invalidation, Unicode-control, and import-authority contracts pass |
| Product materialization plan final RED | `2276760` | Self-authored verified artifact claims reproduced before the final fail-closed fix |
| Product materialization plan GREEN | `05d73c1` | Workspace-bound plans reject re-authored truth, unsafe provenance, unsupported URLs, and unauthenticated verified evidence |
| Import runtime feasibility | `22c01ff` | Automated GREEN; architecture and security NO-GO findings recorded before remediation |
| Trusted import identity RED | `fbbb2fe` | Reserved-identity and cross-actor bypasses reproduced |
| Trusted import identity GREEN | `8885754` | Signed delegation, reserved execution identity, and command-scoped recovery enforced |
| Accepted import runtime | `daae6c1` | Signed human authority, command-scoped execution, and authority-derived evidence accepted |
| Workspace documentation projection | `048a729` | Canonical workspace, plan, runtime truth, and visual abstention projected |
| Replay adapter hardening | `00205b3` | Exact replay wrapper and project identity preserved |
| Production-entry browser consumer | `a00a10b` | Validated bounded artifact consumer replaces demo data in the production entry |
| Browser E2E RED | `2a557c9` | Missing real generated artifact reproduced |
| Browser E2E GREEN | `c3187cc` | Exact 18-cell WorkspaceDocumentation fixture proof passes on desktop, tablet, and mobile |
| Durable harness lifecycle RED | `f1f6c76`, `f5f888b` | Lifecycle authority and review-discovered bypasses reproduced |
| Durable Demo harness lifecycle GREEN | `a605931` | SQLite-owned tasks, events, controls, checkpoints, handoffs, budgets, and process-race handling pass |

The current combined source-of-record verification for `a605931` reports:

- `npm run verify:full`: PASS
- Typecheck: PASS
- Lint: PASS
- Build: PASS
- Automated tests: 916 tests in 87 files, all PASS
- Browser E2E: 18 tests, all PASS across 1440×900 desktop, 834×1112
  tablet, and 390×844 mobile
- Coverage: 90.85% statements, 84.57% branches, 98.05% functions, 90.81% lines

An independent `npm audit --json` run on 2026-07-28 reports zero known
vulnerabilities across 208 dependencies. Review agents found no remaining
P0/P1/P2 code findings or Critical/High/Medium security findings in the
browser and harness slices, but those review observations are not signed gate
approvals.

The retained browser evidence is under
`dist/test-evidence/web-e2e/`; durable Demo harness evidence is under
`dist/test-evidence/harness-lifecycle/`. These artifacts prove the local
fixture workspace and Demo lifecycle, not sandbox containment, real provider
integration, or imported-product visual correctness.

### Current convergence recovery slice

The convergence recovery candidate is based on `6559bb4` and replaces a large
uncommitted 24-hour product run with one reviewed public WIP snapshot. This
section is deliberately separate from the committed `a605931` checkpoint
chain above.

The current slice removes the hardcoded Buzzr canvas project and replaces it
with repository-general import, Canvas Document V3, authenticated runtime,
managed worktree, capture adapter, reconstruction, project-home, editor, and
macOS sidecar foundations. It also retains the grouped Product Map, bounded
selection capsule, deterministic zero-token Demo runtime, proposal review,
exact approval and revision binding, canvas-only apply, checkpoint, rollback,
reviewed restore, reload recovery, and failure-visible local durability.

Fresh recovery evidence on 2026-08-02:

- `npm run typecheck`: PASS
- `npm run lint`: PASS with zero warnings
- `npm run build`: PASS; the production boundary excludes fixture-runtime
  markers. Vite reports one application chunk above 500 kB, which remains a
  performance follow-up.
- Automated tests: 2,334 PASS, 6 explicit platform/host skips; 269 test files
  PASS and 2 skipped out of 271 total
- Focused development-client/import suite: 55 PASS across 4 files
- `npm audit --json`: zero known vulnerabilities across 238 dependencies
- No fresh browser E2E, packaged macOS E2E, coverage, or real runtime-capture
  proof is claimed by this recovery checkpoint

This evidence does not sign M0 or lift the Product Security VETO. The Browser
receipt is emitted only by the bundled same-origin Demo fixture. Verification
proves the exact canvas node digest and current Demo preview receipt while
explicitly performing no repository verification. No production provider,
authenticated MCP, source write, shell, process, Git, arbitrary network, or
publishing authority is enabled.

Codex and Claude process adapters, deterministic source compilation, managed
worktree composition, and authenticated renderer RPC are conformance-tested
foundations only. The Tauri application injects an authenticated import and
canvas-document runtime transport, but no production provider process or
source-mutation authority. The worktree manager remains deliberately absent
from the public source-edit API while the Product Security VETO is active.

Checkpoint restore is a two-step local review. It shows the revision and
object-count delta, requires confirmation, rechecks the current revision,
validates the restored node digest, records a semantic restore command, and
emits a verified recovery event. It does not undo commits, pushes,
deployments, messages, payments, or any other external action. Demo runtime
storage retains at most eight runs and eight checkpoints within a 1.5 MB
payload; load, parse, quota, or save failures visibly downgrade recovery to
volatile memory rather than claiming durable restart recovery.

The current visual evidence is indexed under
[`docs/audits/screenshots/`](audits/screenshots/README.md). Those flow captures
come from the production web bundle shared by the Tauri shell. Native wrapper
proof is the macOS build and WindowServer smoke result; a new native screenshot
could not be recorded because the current Codex host lacks macOS screen-capture
permission, so the stale prior native image was removed rather than retained
as misleading evidence.

### Fixture truth ledger

| Claim | Current truth |
| --- | --- |
| Planned and committed canvas operations | 18 |
| Canonical canvas trace events | 18 |
| Inferred captures | 18 |
| Observed or verified screenshots | 0 |
| Declared flows | 1, not observed |
| Declared token identifiers | 6 |
| Authoritative component inventory | 0, unavailable |
| Base import model-token use | 0 |

## Milestone dashboard

| Milestone | Status | Entry state | Exit evidence |
| --- | --- | --- | --- |
| M0 Product and architecture lock | RED | Active; foundation and focused runtime implementation GREEN | Gate packet remains unsigned and incomplete |
| M1 Standalone technical spine | NO-GO | M0 gate has not passed | Production integration not authorized |
| M2 Runtime import and documentation | NOT OPEN | M1 gate required | Prototype evidence landed under M0; milestone not opened |
| M3 Canvas and design-system workspace | NOT OPEN | M2 contracts required | Prototype evidence landed under M0; milestone not opened |
| M4 Human-agent runtime | NOT OPEN | M3 selection and trace contracts required | Durable Demo lifecycle evidence landed under M0; milestone not opened |
| M5 Sandboxed editing and verification | NOT OPEN | Source-anchor and approval gates required | Not started |
| M6 Integrated alpha | NOT OPEN | Internal golden path required | Not started |
| M7 Public beta | NOT OPEN | M6 release gates required | Not started |
| M8 1.0 | NOT OPEN | Four-week production-like beta soak required | Not started |

## M0 workstream status

`Not evidenced` is intentionally different from `not started`.

| Workstream | Accountable owner | Status | Evidence required before GREEN |
| --- | --- | --- | --- |
| Product charter and supported modes | Founder/Product | YELLOW — draft evidence present, unsigned | Signed charter and capability contract |
| Program controls and scope | PM/Program | YELLOW — backlog and status present, unsigned | Reviewed execution plan and current status |
| Canonical vocabulary and workflows | Product Design | YELLOW — contracts and partial workspace flow evidenced, unsigned | Signed workflow validation across required product flows |
| Product and work schemas | Architect | YELLOW — canonical protocol implemented and tested, unsigned | Approved versioned contracts |
| Architecture and ADRs | Architect | YELLOW — ADR evidence present, all decisions still Proposed | Accepted M0 ADR index and decisions |
| Import and source anchors | Import/runtime | YELLOW — trusted deterministic fixture executes through runtime, canvas target, trace, replay, documentation, and browser proof | Real supported-repository source anchors, authenticated artifact resolution, and verified visual capture |
| Renderer and document operations | Canvas/DE | YELLOW — responsive workspace slice and replay tests pass | Signed renderer budgets and full feasibility evidence |
| Local runtime durability | Architect/Data | YELLOW — SQLite, outbox, grant, lease, fencing, target verification, atomic trace binding, replay, and deterministic OS-process cases GREEN | JSONL projection, Node 22 containment/persistence, remaining platform evidence, and approval |
| Harness, task, and MCP contracts | AI/Agents | YELLOW — durable two-adapter Demo lifecycle, restart-preserved paused state, portable handoff, and two-process control race pass | Live provider adapters, authenticated MCP, browser control transport, provider recovery, and signed contract |
| Benchmark and metric definitions | Data/Evals | YELLOW — M0 security corpus and metrics present, unsigned | Full-product MemiBench, hidden holdout, thresholds, and signed interpretation |
| Sandbox and capability boundary | Product Security | VETO — implementation and spike evidence exist; Product Security NOT APPROVED | Node 22 containment evidence, remaining mitigations, rerun, and signed decision |
| Provenance and OSS policy | Legal/licensing | YELLOW — license, policy, and updated inventory present, unsigned | Transitive scan, NOTICE decision, provenance review, and legal approval |
| Acceptance and release evidence | QA/Release | YELLOW — current verify and browser checks pass, unsigned | Reproducible M0/M1 acceptance packet and QA approval |
| Legacy disposition and migration boundary | Architect/Product | RED — not evidenced | Signed keep/rewrite/retire ledger |
| Contributor and decision documentation | Developer Experience | YELLOW — core project and governance docs present | Contributor setup, DCO workflow, and accepted decision index |

## Current evidence

Evidence currently attached:

- [M0 execution backlog and no-go gates](M0_EXECUTION.md)
- [Product charter and acceptance contracts](product/M0_PRODUCT_CHARTER.md)
- [Supported-mode contract](product/SUPPORTED_MODES.md)
- [Architecture decision records](adr/README.md), all still Proposed
- [Apache-2.0 license](../LICENSE)
- [Open-source policy](OPEN_SOURCE_POLICY.md), legal approval not signed
- [Updated provenance inventory](PROVENANCE_LEDGER.md), legal approval not signed
- [M0 threat model](security/M0_THREAT_MODEL.md), security approval not signed
- [M0 security metrics](evals/M0_SECURITY_METRICS.md), evaluation approval not signed
- [M0 security benchmark](evals/MEMIBENCH_SECURITY_M0.md), full-product holdout incomplete
- [Local runtime acceptance](product/LOCAL_RUNTIME_ACCEPTANCE.md), product approval not signed
- [Sandbox feasibility](spikes/SANDBOX_FEASIBILITY.md), Product Security VETO
- Canonical protocol, canvas-document, deterministic-import, trace,
  fake-harness, integration, and workspace-slice implementation through
  `ab4a110` and aggregate checkpoint `49c8e90`
- Target-authority RED evidence at `d691ce0`, the durable runtime contract at
  `e220ce5`, and focused runtime implementation at `fb02e7b`
- Local canvas-target authority, exact target verification, atomic SQLite
  canonical trace commit, fail-closed integrity audit, pure replay, and
  deterministic OS-process concurrency evidence through `d538a39`; each
  focused run retains bounded sanitized evidence under
  `dist/test-evidence/canonical-trace-concurrency/`
- Deterministic import protocol and flow authority through `1ff0cc3`, followed
  by workspace-bound product materialization planning through `05d73c1`;
  verified capture truth remains unavailable until trusted artifact authority
  is implemented
- Trusted import execution through `8885754` and `daae6c1`, followed by
  WorkspaceDocumentation projection and exact replay composition through
  `048a729` and `00205b3`
- Production-entry browser consumption and exact responsive fixture proof through
  `a00a10b` and `c3187cc`; the retained UI screenshots do not upgrade the
  imported-product capture truth above inferred
- Durable two-adapter Demo harness lifecycle through `a605931`, including
  schema-v11 persistence, hash-linked collaboration events, budgets,
  checkpoints, portable handoff, stale-session rejection, and a real
  two-process stop race; no live provider or MCP is enabled
- Root verification results recorded in this status

Implemented contracts and feasibility slices are evidenced, but not approved.
The evidence packet remains incomplete.

## Critical path

```text
product and program controls
→ canonical contracts and foundation slice
→ focused SQLite/outbox/grant/lease/fencing runtime evidence
→ local target authority and canonical trace binding
→ deterministic import-to-canvas-to-documentation browser vertical
→ SQLite-authoritative JSONL history projection and reconciliation
→ Node 22 containment and full persistence evidence
→ approved sandbox and live provider or authenticated MCP lifecycle
→ ChangeSets, approval receipts, and recovery verification
→ complete supported product flows and evaluation corpus
→ signed architecture, security, legal, evaluation, and QA evidence
→ M0 evidence packet
→ M1 go/no-go
```

## Active blockers

The following remain M0 and M1 no-go conditions:

1. Product Security has an active, non-overridable VETO on the sandbox. Node 22
   filesystem, process, network, secret, cleanup, and platform-containment
   evidence is incomplete.
2. The trusted deterministic fixture import-to-documentation browser vertical
   is accepted locally. Real supported-repository execution, calibrated source
   anchors, trusted artifact resolution, visual capture receipts, JSONL
   history export, and authenticated production composition remain incomplete.
3. Node 22 `node:sqlite` containment, replacement boundary, backup,
   database-busy, disk-pressure, corrupt-tail, full platform/kill/contention
   migration matrix, and multi-process persistence evidence remains incomplete.
4. The SQLite-owned two-adapter Demo harness lifecycle passes
   restart-preserved paused state, portable handoff, stale-session, Demo-local
   approval-boundary, budget, and process-race tests. Live provider adapters,
   authenticated human approval, authenticated MCP, browser control transport,
   provider-side cancellation, and production recovery are not complete.
5. The Demo now supports revision-bound canvas proposals, exact approval,
   canvas-only apply, preview-gated verification, rollback, and checkpoint
   restore. Worktree-backed ChangeSets, expected-hash source conflicts, scoped
   source approvals, durable source receipts, selective source apply, source
   rollback, and repository verification remain unimplemented.
6. The current workspace now passes blank-canvas, shape editing, grouping,
   Browser-state, Demo proposal, approval, verification, rollback, restore,
   reload, and responsive documentation journeys. Required real repository,
   Storybook, trusted capture, authenticated MCP, production provider, source
   ChangeSet, and full recovery journeys have not all passed their declared
   acceptance gates.
7. ADRs remain Proposed. No architecture approval is recorded.
8. The threat model and sandbox spike exist, but Product Security records
   VETO / NOT APPROVED.
9. The Apache-2.0 license, open-source policy, and updated provenance inventory
   exist, but transitive license/SBOM scans, NOTICE determination, contributor
   attestations, and Legal/licensing approval are absent.
10. M0 security metrics and fixtures exist, but full-product MemiBench, hidden
    holdout, source-anchor calibration, affected-surface recall, and Data/Evals
    approval remain absent.
11. Current automated and browser checks pass, but the reproducible QA gate
   packet and QA/Release approval are absent.
12. The legacy keep, relicense, clean-room, optional-external, rewrite, and
    retire ledger is absent.
13. The signed M0 gate packet and every required owner or veto signature are
    absent.

## M1 status

M1 is explicitly NO-GO.

Public beta and 1.0 are explicitly NO-GO.

It cannot move from prototype preparation to production integration until:

- Every mandatory M0 exit condition in `docs/M0_EXECUTION.md` is GREEN; any
  permitted non-critical exception has a signed owner, containment, expiry, and
  downstream gate.
- Product Security, Legal/licensing, QA/Release, Data/Evals, the Architect,
  PM/Program, and Founder/Product have signed the gate packet.
- No non-overridable veto remains open.

## Update protocol

The PM/Program Lead updates this file when:

- A backlog item changes status
- An evidence artifact is added or invalidated
- A risk becomes critical or blocked
- A gate decision occurs
- Scope, staffing, or dates change

Each update must link evidence rather than summarize an unrecorded meeting.
Concurrent owners update their own evidence artifacts; this file reports their
accepted state and must not overwrite their work.

## Next program actions

The deterministic fixture import-to-documentation vertical and durable Demo
harness core now pass locally. The next critical dependencies are:

1. Complete the SQLite-authoritative JSONL history projector and
   reconciliation gates without
   weakening SQLite authority.
2. Complete Node 22 containment, persistence, backup/restore, database-busy,
   disk-pressure, crash, corruption, the full platform/kill/contention
   migration matrix, and
   multi-process evidence.
3. Close the Product Security sandbox veto through remediation and a full
   adversarial rerun.
4. Add live provider adapters or authenticated MCP only after their
   authentication, capability, cancellation, and recovery gates pass.
5. Build ChangeSets and durable approval receipts on the approved boundary.
6. Add trusted browser capture authority and promote supported product modes
   one at a time.
7. Complete all supported product-mode and recovery flows.
8. Produce evaluation, license, security, QA, and ADR evidence for signature.
9. Assemble the M0 gate packet and hold the M1 go/no-go review.
