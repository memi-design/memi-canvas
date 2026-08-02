# M0 Execution Plan

Status: RED
Milestone: M0, product and architecture lock
Calendar target: weeks 1–2
Next milestone: M1, standalone technical spine
Program owner: Principal PM and Program Lead
Release DRI: Founder and Product Lead

## Purpose

M0 turns the approved Memi Canvas master plan into signed constraints,
versioned contracts, measurable feasibility evidence, and explicit decisions.
It exists to prevent M1 from building on unlicensed code, unsafe repository
execution, ambiguous product claims, unstable schemas, or an unproven renderer.

M0 is intentionally RED until every exit-gate item has reviewable evidence.
Scaffolding, experiments, meetings, or verbal agreement do not make a gate
green.

## M0 outcome

At M0 exit, the team can start M1 knowing:

1. Who the first product is for and which journey defines release success.
2. What is required for 1.0, what is deferred, and what is prohibited.
3. What “supported,” “all screens,” “accurate,” “source-linked,” and
   “zero-token” mean.
4. Which current Memi and Studio assets may legally and technically be reused.
5. How project, evidence, canvas, task, trace, approval, and ChangeSet data
   relate.
6. How untrusted repositories, preview processes, files, Git, network access,
   secrets, and external agents are isolated.
7. Whether the renderer, source anchors, replay model, and sandbox are feasible
   within the approved budgets.
8. Which benchmark products and fixtures will decide milestone acceptance.

## M0 boundaries

### In scope

- Product charter, launch segment, golden journey, P0, P1, and non-goals
- Supported-mode and truth-level contracts
- Canonical vocabulary and entity boundaries
- Draft versioned schemas and compatibility policy
- Security threat model and sandbox decision
- License and provenance disposition
- Benchmark corpus and metric definitions
- Disposable renderer, source-anchor, replay, and sandbox feasibility spikes
- ADRs for irreversible M1 decisions
- Legacy keep, relicense, clean-room, optional-external, rewrite, or retire
  ledger
- Signed M0 evidence packet and M1 go/no-go decision

### Out of scope

- Production application features
- Production importer, renderer, harness, trace, or patch implementation (out of scope for M0)
- Figma, FigJam, or Code Connect compatibility
- Desktop shell or Tauri wrapper
- Hosted collaboration or multi-human CRDT
- Additional frameworks beyond defining the initial support contract
- Production migration or deletion of Studio data

Disposable spikes must be isolated from production package paths and clearly
marked as non-shipping evidence.

## Status language

| Status | Meaning |
| --- | --- |
| RED | Required evidence is absent, failing, contradicted, or not approved |
| YELLOW | Evidence exists but review, decision, or remediation remains open |
| GREEN | Evidence meets the exit criterion and the accountable owner signed it |
| BLOCKED | Work cannot proceed without a named dependency or external decision |
| DEFERRED | Explicitly removed from M0 and linked to a later milestone |

An item moves to GREEN only when its evidence artifact is linked in the
backlog and its exit criterion is satisfied.

## Ownership

| Role | M0 accountability |
| --- | --- |
| Founder and Product Lead | Final product charter, strategic constraints, and M1 release decision |
| Principal PM and Program Lead | Backlog, dependency order, status truth, scope control, and gate packet |
| Principal Architect and Tech Lead | Architecture contracts, ADRs, package boundaries, and feasibility synthesis |
| Product Security Engineer | Threat model, sandbox boundary, capability policy, and security veto |
| Legal/licensing support | Module provenance, reuse disposition, dependency policy, and licensing veto |
| Import/runtime lead | Import contract, source-anchor spike, runtime assumptions, and framework evidence |
| Canvas/design-engineering lead | Renderer spike, document-operation feasibility, and performance evidence |
| AI/agent-systems lead | Task, harness, context, approval, MCP, and interruption contracts |
| Data/evaluation lead | Benchmark corpus, metric definitions, truth grades, confidence, and release claims |
| Product design/research lead | Launch-user evidence, canonical workflows, vocabulary, and usability risks |
| QA/release lead | Acceptance test plan, reproducibility, evidence completeness, and quality veto |
| Developer experience lead | Contributor setup, artifact discoverability, and decision documentation |

## Dependency order

```text
D0 program controls and product charter
├── D1 supported-mode, claim, evaluation, license, and security contracts
│   ├── D2 renderer, source-anchor, replay, and sandbox spikes
│   └── D2 draft entity schemas and service boundaries
├── D3 reconcile spike evidence into final schemas and ADRs
├── D4 complete legacy disposition and risk closure
└── D5 assemble evidence packet and decide M1 go/no-go
```

Draft schemas and spikes may proceed in parallel. Schemas cannot be approved
until the relevant spike and threat-model evidence has been reconciled.

## Executable backlog

Initial statuses remain RED unless a draft artifact is already present. Draft
evidence is YELLOW until reviewed and approved.

| ID | Work item and exit criterion | DRI | Depends on | Required evidence artifact | Current status |
| --- | --- | --- | --- | --- | --- |
| M0-PGM-001 | Establish role assignments, decision cadence, status semantics, exception process, and evidence location | PM/Program | None | `docs/PROGRAM_STATUS.md` and this plan | YELLOW — initial drafts present; review pending |
| M0-PROD-001 | Sign the launch segment, JTBD, product promise, golden journey, P0, P1, and non-goals | Founder/Product | M0-PGM-001 | `docs/product/M0_PRODUCT_CHARTER.md` | RED — not evidenced |
| M0-PROD-002 | Approve the supported-mode capability matrix for Vite/React, Next.js, Storybook, static build, running URL, screenshots, and blank projects | PM/Program | M0-PROD-001 | `docs/product/SUPPORTED_MODES.md` | RED — not evidenced |
| M0-PROD-003 | Freeze canonical terms for frames, evidence, coverage, tasks, runs, traces, approvals, ChangeSets, and ownership grades | Product Design | M0-PROD-001 | `docs/product/CANONICAL_VOCABULARY.md` | RED — not evidenced |
| M0-EVAL-001 | Define “all screens,” “accurate,” “source-linked,” “supported,” “stable,” and “zero-token,” including denominators and abstention | Data/Evals | M0-PROD-002 | `docs/evals/M0_METRIC_DEFINITIONS.md` | RED — not evidenced |
| M0-EVAL-002 | Select five internal and five external benchmark products or legally usable equivalents, plus hidden holdout policy | Data/Evals | M0-PROD-002, M0-LEG-001 | `docs/evals/MEMIBENCH_M0.md` | RED — not evidenced |
| M0-QA-001 | Convert every M0 and M1 gate into a reproducible acceptance checklist with evidence-retention rules | QA/Release | M0-EVAL-001 | `docs/quality/M0_M1_ACCEPTANCE.md` | RED — not evidenced |
| M0-LEG-001 | Record provenance and one signed disposition for every current Memi/Studio module or asset considered for reuse | Legal/licensing | M0-PGM-001 | `docs/licensing/LEGACY_PROVENANCE_LEDGER.md` | RED — not evidenced |
| M0-LEG-002 | Approve Apache-2.0 dependency, contributor, generated-asset, and clean-room rules | Legal/licensing | M0-LEG-001 | `docs/licensing/OSS_POLICY.md` | RED — not evidenced |
| M0-SEC-001 | Complete the untrusted-repository threat model, assets, trust zones, abuse cases, and prohibited host access | Product Security | M0-PROD-002 | `docs/security/M0_THREAT_MODEL.md` | RED — not evidenced |
| M0-SEC-002 | Decide the M1 sandbox boundary, process/network/filesystem defaults, secret handling, capability grants, and failure behavior | Product Security | M0-SEC-001, M0-SPIKE-004 | `docs/decisions/ADR-0009-sandbox-boundary.md` | RED — not evidenced |
| M0-ARCH-001 | Define repository topology, workspace runtime boundary, package rules, browser trust boundary, and public protocol policy | Architect | M0-PROD-002, M0-LEG-001 | `docs/decisions/ADR-0002-runtime-and-topology.md` | RED — not evidenced |
| M0-ARCH-002 | Draft canonical IDs and schemas for project, product, route, state, flow, design system, coverage, evidence, artifact, and source anchor | Architect | M0-PROD-003, M0-EVAL-001 | `docs/contracts/product-and-evidence.schema.md` | RED — not evidenced |
| M0-ARCH-003 | Draft schemas and state machines for canvas operations, tasks, runs, traces, checkpoints, approvals, capabilities, and ChangeSets | Architect | M0-PROD-003, M0-SEC-001 | `docs/contracts/work-and-change.schema.md` | RED — not evidenced |
| M0-AI-001 | Define the harness-neutral task, context, provider-event, handoff, permission, interruption, and deterministic-routing contract | AI/Agents | M0-ARCH-003, M0-SEC-001 | `docs/contracts/HARNESS_CONTRACT.md` | RED — not evidenced |
| M0-SPIKE-001 | Prove the renderer approach against agreed node, frame, interaction, memory, and accessibility budgets | Canvas/DE | M0-PROD-002, M0-ARCH-001 | `docs/spikes/RENDERER_FEASIBILITY.md` | RED — not evidenced |
| M0-SPIKE-002 | Measure source-anchor precision and abstention on supported React fixtures without production transforms | Import/runtime | M0-EVAL-001, M0-ARCH-002 | `docs/spikes/SOURCE_ANCHOR_FEASIBILITY.md` | RED — not evidenced |
| M0-SPIKE-003 | Prove pure replay, undo, crash-window reconciliation, and stable state hashes using disposable fixtures | Architect | M0-ARCH-003 | `docs/spikes/REPLAY_FEASIBILITY.md` | RED — not evidenced |
| M0-SPIKE-004 | Exercise the proposed sandbox against malicious install scripts, path escape, SSRF, secret access, and process cleanup | Product Security | M0-SEC-001, M0-ARCH-001 | `docs/spikes/SANDBOX_FEASIBILITY.md` | RED — not evidenced |
| M0-DES-001 | Validate import, coverage, selection, task, approval, and recovery workflows with coded or native prototypes | Product Design | M0-PROD-001, M0-PROD-003 | `docs/research/M0_WORKFLOW_VALIDATION.md` | RED — not evidenced |
| M0-LEGACY-001 | Complete the keep, relicense, clean-room, optional-external, rewrite, and retire ledger for current Studio capabilities | Architect | M0-LEG-001, M0-PROD-002 | `docs/migration/LEGACY_DISPOSITION.md` | RED — not evidenced |
| M0-ADR-001 | Reconcile evidence and approve the required M1 ADR set; unresolved alternatives include owner and decision deadline | Architect | M0-ARCH-001 through M0-SPIKE-004 | `docs/decisions/M0_ADR_INDEX.md` | RED — not evidenced |
| M0-RISK-001 | Close or time-bound every critical M0 risk with owner, trigger, mitigation, and expiry | PM/Program | All workstreams | `docs/program/M0_RISK_REGISTER.md` | RED — not evidenced |
| M0-GATE-001 | Assemble the signed evidence packet and issue GO, CONDITIONAL GO, or NO-GO for M1 | Founder/Product | All prior M0 items | `docs/program/M0_GATE_PACKET.md` | RED — not evidenced |

## Required ADR decisions

The ADR index may consolidate documents, but it must resolve these decisions:

1. New Apache-2.0 repository and provenance boundary
2. Single local workspace runtime plus web client
3. Renderer and frame-ownership model
4. Local document operation log and authoritative state
5. SQLite, content-addressed artifacts, and Git responsibilities
6. Append-only semantic trace and pure replay
7. Harness adapter and deterministic routing boundary
8. Approved repository sandbox
9. Worktree-backed ChangeSets and expected-hash conflict behavior
10. Zero-model-token import compiler
11. No Figma compatibility layer
12. Versioned public protocol and optional external-tool boundary

## Evidence standards

Every evidence artifact must include:

- Owner and reviewers
- Date and source revision
- Question or risk being decided
- Method and fixtures
- Result, including failures and uncertainty
- Explicit decision
- Consequences and deferred work
- Links to raw, reproducible evidence
- Approval or veto state

Spike reports must distinguish measured results from projections. A failed spike
is valid M0 evidence, but it normally produces a scope change or M1 no-go.

## M0 entry gate

M0 may execute when:

- The approved master plan is the program baseline.
- The standalone repository exists.
- The release DRI, PM, Architect, Security, Legal, QA, Data/Evals, Product
  Design, Design Engineering, Import/runtime, and AI responsibilities are
  assigned or explicitly blocked.
- M0 work is limited to contracts, evidence, fixtures, disposable spikes, and
  documentation.
- Existing user and Studio data is read-only.

## M0 exit gate

M0 is GREEN only when all conditions are true:

- Product charter, launch segment, P0, non-goals, and supported-mode claims are
  signed.
- Core product, evidence, canvas, task, trace, approval, capability, and
  ChangeSet schemas are approved at an M1-compatible version.
- Five internal and five external benchmark products, or approved legal
  substitutes, are selected.
- Evaluation has defined every release claim and denominator.
- Renderer evidence meets the agreed node, frame, latency, memory, and
  accessibility budgets.
- Source-anchor evidence defines confidence thresholds and safe abstention.
- Replay evidence reproduces state hashes and performs no external effects.
- Product Security approves the sandbox boundary.
- Legal/licensing signs the provenance and reuse disposition.
- No Figma, FigJam, Code Connect, Tauri, desktop, or hosted-collaboration
  dependency enters M1.
- Critical risks are closed or explicitly converted into M1 gate conditions.
- Founder/Product, PM, Architect, Security, Legal, QA, and Data/Evals sign the
  gate packet.

## Explicit M1 no-go conditions

M1 must not begin production integration if any condition is true:

1. The launch segment, golden journey, or supported modes remain unsigned.
2. “Supported,” “all screens,” “accurate,” “source-linked,” or “zero-token”
   lacks a measurable definition.
3. A proposed reused module lacks a signed compatible-license, relicense,
   optional-external, clean-room, or retire disposition.
4. A critical or high sandbox, secret, filesystem, process, network, MCP, or
   capability-boundary risk remains open.
5. The sandbox requires broad host credentials, unrestricted host execution, or
   unbounded network access.
6. Core IDs or schemas have unresolved ownership, mutation, persistence, or
   versioning conflicts.
7. Replay can repeat an external side effect or cannot restore the expected
   state hash.
8. Renderer evidence misses its approved interaction, memory, accessibility, or
   frame budget without an accepted scope correction.
9. High-confidence source anchors cannot meet the approved precision threshold
   or cannot abstain safely.
10. The benchmark corpus cannot exercise Vite/React, Next.js, responsive
    behavior, roles, states, flows, design-system evidence, and adversarial
    cases.
11. A Figma, FigJam, Code Connect, desktop shell, Tauri, or hosted service is
    required for the M1 golden path.
12. The M1 architecture depends on copying incompatible FSL code, tests,
    fixtures, generated assets, or interface definitions.
13. Any gate artifact has no accountable owner, no reproducible evidence, or an
    unresolved veto.
14. The team is staffed below the approved safety and release minimum without a
    signed scope reduction.

Conditional GO is permitted only for a non-critical item with a named owner,
expiry, containment, and an M1 gate that prevents the risk from reaching users.
Security, licensing, critical data-loss, and evidence-integrity vetoes cannot
be waived.

## Gate review

The PM assembles the M0 gate packet. QA verifies artifact completeness and
reproducibility. Data/Evals validates claims. The Architect signs architecture
readiness. Product Security and Legal/licensing exercise independent vetoes.
The Founder/Product Lead issues the final GO, CONDITIONAL GO, or NO-GO.

M1 work may continue only at disposable prototype level until GO is recorded.
