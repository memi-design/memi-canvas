# M0 Security and Durability Execution Plan

Status: RED, planning evidence only
Phase owner: Principal PM and Program Lead
Technical DRI: Principal Architect
Required veto owners: Product Security, QA/Release, Legal/licensing
Program baseline: `fb02e7b`

## Objective

Prove that Memi Canvas can execute untrusted product work without exposing the
host or corrupting durable state. This phase must establish:

- An approved repository sandbox boundary
- One durable authority for tasks, approvals, leases, ChangeSets, and trace
  metadata
- Transactional intent, outbox/inbox, idempotency, lease, and fencing behavior
- Pure replay and crash recovery without repeated external effects
- Worktree-only source mutation with durable approval receipts
- Reproducible platform-specific evidence

Nothing in this plan is GREEN until an implementation exists, its required
tests pass, its evidence is retained, and the accountable reviewer signs it.

## Current boundary

The canonical protocol, deterministic fixture importer, local canvas document,
semantic trace, fake harness, responsive workspace, and focused local runtime
have passing implementation evidence. The runtime currently exercises SQLite
authority, durable intent/outbox transitions, capability grants, leases,
fencing, recovery decisions, and an unconditional in-process effect boundary.

This focused runtime GREEN does not provide:

- Target-authority commitment bound to the runtime outbox
- Trusted semantic trace binding to the target commit receipt
- Node 22 platform containment and persistence evidence
- A Product-Security-approved arbitrary-repository sandbox
- A complete real harness lifecycle
- Worktree-backed ChangeSets
- Durable approval receipts
- Complete import, capture, edit, verification, and recovery flows

Product Security records the sandbox as VETO / NOT APPROVED. M0 remains RED and
M1 and public release remain NO-GO.

## Task graph

```text
SD-00 freeze authorities, commands, and platform claims
├── SD-01 approve threat assumptions and abuse corpus
├── SD-02 decide SQLite, outbox, inbox, lease, and fencing contract
└── SD-03 decide sandbox and worktree boundary

SD-02
├── SD-04 implement durable command journal
├── SD-05 implement leases and fencing
└── SD-06 build deterministic crash harness

SD-03
├── SD-07 implement filesystem and process containment
├── SD-08 implement network and secret containment
└── SD-09 implement disposable worktree lifecycle

SD-04 + SD-05 + SD-07 + SD-09
└── SD-10 implement ChangeSet and approval-receipt path

SD-06 + SD-08 + SD-10
└── SD-11 execute crash, adversarial, and platform matrices

SD-11
├── SD-12 close or time-bound risks
├── SD-13 assemble security/durability evidence
└── SD-14 request independent gate decisions
```

Parallel prototypes are permitted. A dependent production path cannot begin
until its entry gate passes.

## Executable backlog

| ID | Deliverable | DRI | Depends on | Exit evidence | Status |
| --- | --- | --- | --- | --- | --- |
| SD-00 | Freeze state authorities, privileged commands, external effects, and platform claims | Architect | Current protocol | `docs/adr/0006-authoritative-storage-boundaries.md` and `docs/adr/0010-target-effect-authority.md` | YELLOW — contracts extended; ADRs Proposed |
| SD-01 | Convert the threat model into executable abuse fixtures and expected denials | Product Security | SD-00 | Threat model, adversarial fixtures, security metrics, and benchmark | YELLOW — evidence present; security unsigned |
| SD-02 | Decide SQLite schema, intent/outbox/inbox transactions, idempotency digest, lease, and fencing semantics | Data/Storage Engineering | SD-00, SD-01 | ADR 0006 and runtime acceptance contracts | YELLOW — focused implementation tests GREEN; ADR Proposed |
| SD-03 | Decide sandbox isolation, mount, environment, network, process, cleanup, and worktree policy per platform | Product Security | SD-00, SD-01 | `docs/adr/0009-sandbox-boundary.md` and sandbox feasibility evidence | VETO — Product Security NOT APPROVED |
| SD-04 | Implement durable command state machine and outbox/inbox reconciliation | Data/Storage Engineering | SD-02 accepted | Runtime and tests under `packages/runtime/`; evidence under `docs/evidence/m0/durability/` | YELLOW — focused runtime tests GREEN; target receipt and trusted trace pending |
| SD-05 | Implement project-scoped leases, fencing epochs, expiry, takeover, and stale-writer rejection | Data/Storage Engineering | SD-02 accepted | Runtime concurrency tests under `packages/runtime/` using adversarial race fixtures | YELLOW — focused runtime tests GREEN; target authority pending |
| SD-06 | Build crash injection at every transaction and external-effect boundary | QA/Release | SD-02, SD-04 | Runtime harness, adversarial crash seeds, deterministic replay and Node 22 report | YELLOW — focused outbox tests GREEN; platform matrix incomplete |
| SD-07 | Implement canonical path, regular-file, symlink, special-file, mount, process, and resource containment | Runtime Engineering | SD-03 accepted | Implementation and tests under `packages/sandbox/` using the adversarial filesystem/process fixtures | VETO — implementation evidence exists; Node 22 containment and approval pending |
| SD-08 | Implement deny-by-default egress, DNS/redirect validation, secret brokering, environment filtering, and cleanup | Runtime Engineering, Security | SD-03 accepted | Tests under `packages/sandbox/` using adversarial network and secret fixtures | VETO — Product Security remediation and rerun required |
| SD-09 | Implement app-managed worktree creation, original-checkout protection, cleanup, and recovery | Git/Runtime Engineering | SD-03 accepted | `docs/adr/0010-worktree-changesets.md`; lifecycle and dirty-checkout tests under `packages/runtime/` | RED — implementation absent |
| SD-10 | Implement expected-hash ChangeSets, scoped approval receipts, selective apply, verification, rollback, and trace | ChangeSet Engineering | SD-04, SD-05, SD-07, SD-09 | Planned future paths: `packages/changesets/` and `packages/changesets/test/`; approval and recovery evidence | RED — future implementation absent |
| SD-11 | Run crash-window, adversarial, platform, corruption, disk-pressure, and restart matrices | QA/Release, Security | SD-06, SD-08, SD-10 | Versioned reports under `docs/evidence/m0/` with commit and artifact hashes | RED — Node 22, ChangeSet, full platform, and security evidence incomplete |
| SD-12 | Resolve every critical/high risk or preserve a non-overridable veto | PM/Program | SD-11 | `docs/program/M0_RISK_REGISTER.md` | RED — risks open |
| SD-13 | Assemble reproducible evidence packet with commands, environment, results, failures, and limitations | QA/Release | SD-11, SD-12 | `docs/program/M0_SECURITY_DURABILITY_EVIDENCE.md` | RED — evidence absent |
| SD-14 | Obtain independent Architecture, Security, QA, Data/Evals, and Legal decisions | Founder/Product | SD-13 | Signed decision section in the evidence packet | RED — no signatures |

## Entry gates

### Production-integration entry

Focused RED/GREEN prototypes may run against synthetic fixtures. No privileged
production integration is authorized until:

- State authorities and command families are enumerated.
- Runtime validation schemas exist for every command.
- Threat cases have executable expected outcomes.
- The relevant ADR is Accepted.
- The code owner, security reviewer, and test owner are assigned.
- The implementation cannot reach the original checkout or host credentials.

### ChangeSet entry

ChangeSet implementation cannot start until:

- SQLite intent/outbox semantics are accepted.
- Lease and fencing semantics are accepted.
- Sandbox and worktree boundaries are accepted.
- Approval receipt fields and effect-bound verification are frozen.

### Evidence entry

A result enters the gate packet only when it records:

- Source commit and dirty-state manifest
- Platform, filesystem, runtime, SQLite, Git, and browser versions
- Exact commands and deterministic seed
- Test and coverage results
- Raw artifact hashes
- Expected versus actual outcome
- Known limitations and skipped cases
- Owner and reviewer, without implied approval

## Exit gates

This phase is eligible for review only when:

1. All critical crash windows have deterministic recovery outcomes.
2. Reconciliation never repeats a verified external effect.
3. Duplicate idempotency keys with different digests fail closed.
4. Stale leases, grants, approvals, revisions, and fencing epochs fail closed.
5. Original checkouts remain byte-for-byte unchanged.
6. Sandbox workers cannot reach unauthorized files, processes, sockets,
   secrets, private networks, loopback services, or cloud metadata.
7. Redirects and DNS changes cannot broaden approved network scope.
8. ChangeSets apply only to app-managed worktrees and verify expected hashes.
9. Approval receipts bind actor, action digest, target revision, capability,
   consequence, expiry, usage, lease, and fencing epoch.
10. Rollback and restart restore an honest terminal or interrupted state.
11. Trace and replay preserve integrity without dispatching external effects.
12. Supported platform evidence meets its declared tier.
13. All critical/high risks are closed or held by an explicit veto.
14. Architecture, Product Security, and QA/Release sign the evidence.

Passing unit tests alone does not satisfy these gates.

The `fb02e7b` verification is focused runtime evidence only: 331 tests pass
with 91.88% statement, 84.31% branch, 97.45% function, and 91.84% line
coverage; typecheck, lint, build, and `npm audit` pass. It does not satisfy the
phase exit gates above.

## Non-overridable vetoes

| Veto owner | Veto condition |
| --- | --- |
| Product Security | Sandbox escape; unauthorized filesystem, process, network, credential, or cross-project access; stale capability accepted |
| QA/Release | Critical data loss; original-checkout mutation; unrecoverable corruption; repeated external effect; non-reproducible evidence |
| Legal/licensing | Incompatible or unknown shipping dependency, asset, binary, fixture, or provenance |
| Data/Evals | Release claim lacks denominator, calibration, holdout, or reproducible evidence |
| Principal Architect | Conflicting state authorities, unsafe cross-store assumptions, or unversioned durable protocol |

A veto is cleared only by fixing the condition and regenerating evidence. It
cannot be waived in a meeting or converted into accepted risk.

## Crash-window matrix

| Window | Crash point | Required durable state | Restart behavior | Required proof |
| --- | --- | --- | --- | --- |
| CW-00 | Before validation | No intent and no effect | Reject or retry as a new command | Invalid-command tests |
| CW-01 | After validation, before transaction | No intent and no effect | Retry safely | Injection test |
| CW-02 | During intent/outbox transaction | Entire transaction committed or absent | Roll back partial transaction | SQLite fault injection |
| CW-03 | After outbox commit, before worker claim | Pending intent with action digest | Claim once under active lease | Restart and concurrent-worker test |
| CW-04 | After worker claim, before effect | Claimed intent and fencing epoch | Expired claim may be taken over with higher epoch | Lease-expiry test |
| CW-05 | During external effect | Intent remains non-terminal | Probe effect state; do not blindly repeat | Ambiguous-effect fixture |
| CW-06 | Effect succeeds, before result capture | Effect discoverable by digest or expected result | Verify existing effect, then continue | Git/artifact/process fixture |
| CW-07 | Result captured, before verification | Effect result stored, intent non-terminal | Re-run pure verification only | Restart test |
| CW-08 | Verification succeeds, before terminal transaction | Verified result available | Commit terminal state and semantic trace atomically | Injection test |
| CW-09 | During terminal transaction | Terminal state and trace metadata both commit or neither does | Reconcile from verified result | SQLite fault injection |
| CW-10 | Artifact bytes written, before metadata | Unreferenced content-addressed bytes | Scrub or adopt only after hash verification | Artifact orphan test |
| CW-11 | Metadata written, bytes incomplete | Prohibited state | Fail closed and mark corrupt | Partial-write test |
| CW-12 | Worktree patch partially applied | Original checkout unchanged; worktree marked interrupted | Discard or restore worktree from checkpoint | Kill-during-apply test |
| CW-13 | Commit created, before journal terminal | Commit discoverable by expected tree and digest | Record existing commit; never create a duplicate | Git reconciliation test |
| CW-14 | Approval recorded, before effect | Immutable unused receipt | Resume only if target, lease, grant, and expiry remain valid | Stale-approval test |
| CW-15 | Shutdown during process cleanup | Worker identity and resources recorded | Reaper terminates descendants and verifies cleanup | Orphan-process test |
| CW-16 | Disk full or database busy | No silent partial success | Pause, preserve durable evidence, report blocked | Disk-pressure and lock test |
| CW-17 | Corrupt journal or database tail | Last verified checkpoint retained | Quarantine corruption; do not fabricate recovery | Corruption test |

The test harness must exercise each window repeatedly with deterministic seeds
and concurrent workers where applicable.

## Platform scope

| Platform | M0 scope | Required evidence before claim |
| --- | --- | --- |
| macOS arm64 | Primary dogfood and live sandbox evidence | APFS path/symlink behavior, process cleanup, local sockets, worktrees, SQLite WAL, crash matrix |
| Linux x64 | Reference CI and containment platform | ext4 semantics, rootless containment, cgroups/resource limits where available, network denial, SQLite and Git matrix |
| Windows 11 x64 | Deterministic import and contract validation only during M0 | NTFS path/reparse-point analysis and test plan; no arbitrary-repository runtime claim until equivalent containment passes |
| Browser client | Latest stable Chromium primary; Firefox and WebKit compatibility tracked | Origin/token enforcement belongs to the runtime; imported content cannot escape its rendering boundary |

Platform claims are independent. Passing macOS does not make Linux or Windows
GREEN. Unsupported containment must remain unavailable and visibly blocked.

## Evidence paths

Planned canonical locations:

- Sandbox implementation and tests: `packages/sandbox/`
- Privileged runtime, durability, worktree, and crash tests:
  `packages/runtime/`
- Adversarial fixtures:
  `packages/test-fixtures/sandbox-adversarial/`
- Future ChangeSet implementation and tests, not yet present:
  `packages/changesets/` and `packages/changesets/test/`
- Threat model: `docs/security/M0_THREAT_MODEL.md`
- Sandbox ADR: `docs/adr/0009-sandbox-boundary.md`
- Worktree/ChangeSet ADR: `docs/adr/0010-worktree-changesets.md`
- Durability ADR: `docs/adr/0016-sqlite-outbox-fencing.md`
- Target-effect authority ADR: `docs/adr/0010-target-effect-authority.md`
- Runtime acceptance contract: `docs/product/LOCAL_RUNTIME_ACCEPTANCE.md`
- Runtime state contract: `docs/product/LOCAL_RUNTIME_STATES.md`
- Security metrics: `docs/evals/M0_SECURITY_METRICS.md`
- Security benchmark: `docs/evals/MEMIBENCH_SECURITY_M0.md`
- Sandbox feasibility: `docs/spikes/SANDBOX_FEASIBILITY.md`
- Risk register: `docs/program/M0_RISK_REGISTER.md`
- Gate evidence: `docs/program/M0_SECURITY_DURABILITY_EVIDENCE.md`
- Security summaries: `docs/evidence/m0/security/`
- Durability summaries: `docs/evidence/m0/durability/`
- Platform summaries: `docs/evidence/m0/platforms/`
- Raw CI artifacts: linked by immutable run ID and content hash

Large raw logs, databases, coverage sites, and sandbox images do not enter Git.

## Remaining full-product dependencies

Security and durability evidence is necessary but not sufficient for M1 or
release. Remaining dependencies include:

- Real Vite/React and Next.js repository import and calibrated source anchors
- Storybook, static-build, running-URL, screenshot, and blank-project journeys
- Responsive states, roles, themes, locales, flags, errors, and critical flows
- Design-system extraction, provenance, usage graphs, and drift evidence
- Authenticated MCP and real harness adapters
- Selection-scoped context, interruption, handoff, and recovery
- Visual/code diff, affected-surface analysis, verification, rollback, and Git
  handoff
- MemiBench definitions, corpus, hidden holdout, and release thresholds
- Renderer performance, accessibility, and large-project evidence
- Transitive license/SBOM/NOTICE evidence and contributor attestations
- Accepted ADRs and signed Product, Architecture, Security, Legal, Data/Evals,
  and QA gate packet

## Program update rule

`docs/PROGRAM_STATUS.md` is updated only after evidence lands. An implemented
item without passing tests remains RED. Passing tests without required review
is YELLOW. Only evidence plus accountable approval may be GREEN.
