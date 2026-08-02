# MemiBench Security M0

Status: public benchmark specification
Implementation status: fixtures and evaluation contract only
Overall M0 status: **RED**

## Claim under test

Memi Canvas can run deterministic local import, target-authoritative canvas and
artifact effects, SQLite-authoritative trace commit and projection, and agent
tooling without crossing its declared filesystem, secret, network, process,
concurrency, queue, verification, trace, projection, replay, or recovery
boundaries.

This benchmark does not prove the host operating system, third-party harnesses,
or arbitrary user applications are secure. It proves the supported Memi
sandbox behaviors against a versioned corpus.

## Threat surfaces

| Surface | Protected asset | Attacker-controlled input | Required invariant |
|---|---|---|---|
| Filesystem | Files outside workspace | Paths, symlinks, filenames | Canonical target remains inside authorized root |
| Secrets | Environment and forbidden files | Search, errors, output | Sentinel never crosses an output boundary |
| Network | Local/private services | URLs, DNS, redirects | Every resolved hop is policy checked before connect |
| Processes | Host resources | Command behavior and child tree | Timeout/cancel removes every descendant |
| Budgets | Memory, disk, UI and trace | Output volume and runtime | Bounded retention and bounded termination |
| Leases | Exclusive mutation rights | Timing and stale actors | One holder; monotonic fencing; stale writes rejected |
| Outbox | Durable intended effects | Crash timing and retries | No lost durable message or duplicate logical effect |
| Recovery | Last valid committed state | Truncation and tampering | Recover valid prefix; reject corrupt state |
| Target authority | Canvas operations and content-addressed artifacts | Effect request, hashes, receipts, trace IDs, stale workers | Atomic compare-and-apply; trusted verification; caller cannot assert success |
| Trace authority | Canonical events, project heads, effect bindings, projections | Caller fields, crash timing, concurrent writers, derived JSONL | SQLite allocates and commits trace atomically; JSONL remains derived |

## Corpus layout

```text
packages/test-fixtures/sandbox-adversarial/
  manifest.json
  filesystem/
    workspace/allowed.txt
    outside-workspace/SYNTHETIC_SECRET.txt
  secrets/synthetic.env
  network/resolver-map.json
  process/plans.json
  races/schedules.json
  outbox/crash-windows.json
  recovery/journals.json
packages/test-fixtures/security/
  target-authority-cases.json
  trace-authority-cases.json
```

`sandbox-adversarial/manifest.json` is the source of truth for sandbox case IDs,
expected decisions, budgets, and required evidence.
`security/target-authority-cases.json` maps every required ADR 0010 case to
deterministic counters and evidence.
`security/trace-authority-cases.json` maps every required ADR 0011 trace case,
fault variant, restart requirement, and scale requirement. Category fixture
files provide the remaining input details.

## Synthetic-data policy

All canaries are public strings prefixed with `MEMI_SYNTHETIC_` or
`MEMI_PUBLIC_`. They must never be replaced with credentials copied from a
developer machine.

The runner must:

- copy fixtures to a fresh temporary root
- set the fixture workspace as the only authorized path
- provide only the synthetic environment variables
- use an empty temporary home directory
- use a mock resolver and transport
- prevent host-network fallback
- snapshot fixture hashes before and after each case
- delete the temporary root after evidence is finalized

## Public benchmark catalog

### Filesystem escape

| Case | Stimulus | Expected |
|---|---|---|
| `fs-001` | Relative traversal read | Denied before read |
| `fs-002` | Absolute path outside root | Denied before read |
| `fs-003` | Symlink-mediated write escape | Denied; target hash unchanged |
| `fs-004` | Authorized workspace read | Allowed with exact public sentinel |

### Secret access

| Case | Stimulus | Expected |
|---|---|---|
| `secret-001` | Workspace-scoped sentinel search | Forbidden file sentinel absent |
| `secret-002` | Environment inspection | Synthetic secret redacted |
| `secret-003` | Diagnostic containing canary | Every retained output redacted |

### Network and SSRF

| Case | Stimulus | Expected |
|---|---|---|
| `net-001` | IPv4 loopback URL | No connect |
| `net-002` | IPv6 loopback URL | No connect |
| `net-003` | Private DNS result | No connect |
| `net-004` | Link-local metadata address | No connect |
| `net-005` | Allowed origin redirects to loopback | Redirect blocked before connect |
| `net-006` | DNS answer changes to loopback | Rebinding blocked |
| `net-007` | Authorized mock URL | Mock response succeeds |

The runner may not resolve or connect through the host network. A mock transport
connect attempt is evidence; an actual socket attempt is a benchmark failure.

### Process and budget behavior

| Case | Stimulus | Expected |
|---|---|---|
| `proc-001` | Normal process tree | All descendants exit |
| `proc-002` | Timeout process tree | Entire tree removed within 2 seconds |
| `proc-003` | Cancel process tree | Entire tree removed within 2 seconds |
| `budget-001` | 16 MiB output flood | At most 1 MiB retained; counts preserved |
| `budget-002` | 100 ms deadline | At most 250 ms overshoot |

Process plans are declarative. A platform adapter may realize them differently,
but it must preserve the declared tree, byte counts, deadlines, and observable
outcomes.

### Lease and fencing races

| Case | Schedule | Expected |
|---|---|---|
| `lease-001` | Holder A expires; B acquires; A writes | A fenced, B accepted |
| `lease-002` | Simultaneous contenders | One holder, monotonic tokens |
| `lease-003` | Acknowledgement arrives after takeover | Stale acknowledgement discarded |
| `lease-004` | Renewal races takeover | One winner; loser cannot write |

Schedules use logical time and named barriers. Seeded variation may choose the
winner when the schedule permits either actor, but never the invariant.

### Outbox crash windows

| Window | Expected recovery |
|---|---|
| Before persist | Nothing delivered |
| After persist, before send | Deliver once |
| After send, before acknowledgement | Retry with original idempotency key |
| After acknowledgement, before cleanup | Complete without redelivery |
| Corrupt entry | Quarantine and abstain |

The grader counts committed effects by idempotency key, not raw transport calls.

### Recovery journals

| Journal | Expected |
|---|---|
| Valid checkpoint and tail | Recover final sequence |
| Truncated tail | Keep complete valid prefix |
| Tampered middle record | Quarantine remainder |
| Invalid checkpoint | Block recovery |

### Target-effect authority

Authority: `docs/adr/0010-target-effect-authority.md`

| Family | Case IDs | Deterministic pass condition |
|---|---|---|
| Compare-and-apply | `target-cas-001`, `target-cas-002` | Stale baseline never writes; two-key race has one winner and one target operation |
| Idempotency | `target-idem-001` through `003` | One operation and receipt for exact retries; digest conflict changes nothing |
| Lease and claim fencing | `target-fence-001` through `004`, `target-claim-001` through `002` | No pending dispatch, stale-fence commit, stale verification, stale trace append, or stale commit |
| Execution outcomes | `target-outcome-001` through `003` | Outcome union matches target evidence; unknown never auto-retries |
| Recovery | `target-recovery-001` through `005` | Lookup precedes retry; applied work is never reapplied; corrupt evidence quarantines |
| Trusted verification | `target-verify-001` through `003` | No caller-forged observation is accepted; mismatch or unavailable cannot commit |
| Trace binding | `target-trace-001` through `003` | Trace identity is authority-created, hash-linked, unique, and replay-idempotent |
| Blocked effects | `target-block-001` through `003` | Rejected before adapter dispatch or external side effect |

The public authority denominator is 28 atomic cases. Each case runs for all
seeds, platforms, and release repetitions.

```text
28 × 5 × 2 × 3 = 840 target-authority trials
```

#### Target CAS and idempotency

For every target mutation the grader captures:

- expected-before and authoritative current hashes
- canonical payload hash and action digest
- idempotency key and durable ledger row
- target-native operation count
- resulting hash and bounded receipt hash

`target-cas-002` and `target-idem-001` use a synchronized OS-process start.
Pass requires exactly one target operation. Multiple adapter calls or transport
attempts are allowed only when the target operation and committed effect counts
remain one.

#### Fence and claim authority

Target `highestFence`, pending and active SQLite leases, worker claim epochs,
dispatches, verification attempts, trace appends, and commit attempts are
recorded as separate counters. Any stale-fence target commit or stale-claim
verification, trace append, or SQLite commit fails the release.

#### Outcomes, recovery, and verification

Fault injection occurs at the named ADR boundary. The runner then terminates the
worker process, reopens target and SQLite stores, and performs recovery through
the public recovery entry point.

The grader never accepts a result hash, evidence hash, receipt, verification
outcome, or trace identifier supplied by the test caller. It independently
reads target-authoritative state and compares the runtime result.

Required zero counters:

- duplicate committed effects
- accepted stale-fence commits
- accepted stale-claim commits
- caller-forged verification acceptances
- automatic retries after unresolved outcomes
- apply invocations after `verified-applied`
- commits after `mismatch`, `unavailable`, or `corrupt`

#### Trace and blocked effects

Trace grading independently recomputes sequence uniqueness, previous-hash
linkage, payload hash, and commit-receipt bindings. Exact replay after response
loss must append no event.

Blocked-effect cases snapshot adapter dispatch, filesystem, process, and mock
external-call ledgers before and after the request. Every delta must be zero.

### Trace commit authority

Authority: `docs/adr/0011-trace-commit-authority.md`

| Family | Case IDs | IDs | Mandatory invocations | Deterministic pass condition |
|---|---|---:|---:|---|
| Trust and binding | `trace-trust-001` through `004` | 4 | 9 | Caller identity and observations never become authority; binding changes append nothing |
| SQLite crash windows | `trace-crash-001` through `007` | 7 | 8 | Transaction is all-or-nothing; response loss is idempotent; corrupt authority blocks |
| Allocation and concurrency | `trace-concurrency-001` through `005` | 5 | 5 | Unique contiguous per-project sequence and chain under real process races |
| JSONL projection | `trace-project-001` through `008` | 8 | 13 | One canonical line per event; faults quarantine and rebuild without changing SQLite |
| Replay and scale | `trace-replay-001` through `003` | 3 | 8 | 10,000-event sources agree; replay is pure; rebuild bytes are stable |
| **Total** |  | **27** | **43** | Every variant passes |

The trace-authority release denominator is 810 case trials and 1,290 concrete
variant invocations. The overall public M0 denominator includes all 27 case IDs,
not only the happy path.

#### Trust and transaction atomicity

The grader derives event, head, binding, projection, receipt, and outbox counts
from SQLite after reopening it. It does not trust returned values.

Zero-tolerance gates:

- caller-chosen trace IDs accepted: 0
- caller-observed hashes accepted as authority: 0
- orphan trace rows: 0
- committed outbox rows referencing absent events: 0
- head-only or binding-only transactions: 0
- extra allocation after response-loss retry: 0

All seven crash windows use real process termination and a fresh restart process
with a distinct PID.

#### Concurrency and per-project ordering

The five `trace-concurrency-*` cases plus `trace-project-007` use at least two
distinct OS worker processes. Each process has an independent SQLite connection
and repository handle and waits on an external barrier.

Zero-tolerance gates:

- duplicate project/sequence values: 0
- noncontiguous sequences: 0
- previous-hash chain breaks: 0
- duplicate bindings or projection intents: 0
- stale-claim allocations or commits: 0
- cross-project rows: 0

Promise interleaving and worker-thread-only evidence remain RED.

#### Projection fault matrix

The public fixture requires:

- complete-line acknowledgement loss
- short write during a line
- truncate, reorder, alter, duplicate, and unknown-line variants
- deleted JSONL
- valid JSONL with corrupt SQLite
- competing projectors
- disk full during file synchronization
- disk full during containing-directory synchronization

Every projection is an ordered prefix or a quarantined derived file. Duplicate
lines, noncontiguous sequences, SQLite repair from JSONL, and durable projection
claims after sync failure are all zero-tolerance failures.

#### Restart and replay scale

Fourteen trace cases require process restart and store reopening. Fault recovery
in the same process does not pass.

`trace-replay-001` replays exactly 10,000 events from SQLite and exactly 10,000
from projected JSONL for every seed, platform, and repetition. That is 300,000
event positions per source, or 600,000 event-record reads, in the public release
matrix. Final state hashes must match and external effect calls must remain
zero.

## Deterministic execution protocol

For each platform, build digest, and public seed:

1. Create a new temporary sandbox.
2. Copy the fixture corpus and record SHA-256 hashes.
3. Configure the logical clock, mock DNS, mock transport, and process adapter.
4. Run cases in seed-derived order.
5. Reset filesystem, network, process, lease, outbox, and journal state between
   cases.
6. Collect all required evidence before cleanup.
7. Scan every disclosure surface for synthetic forbidden sentinels.
8. Re-hash files and enumerate surviving process descendants.
9. Grade exact outcomes using deterministic code graders.
10. Retain the signed result bundle according to the metrics policy.

No case may depend on another case's result.

Target-authority concurrency cases add this protocol:

1. Start at least two separate OS worker processes.
2. Give each an independent SQLite connection and target-authority handle.
3. Wait until every worker records `barrier-ready`.
4. Release the external barrier once.
5. Wait for every worker or the case timeout.
6. Reopen both durable stores from a separate grader process.
7. Grade target operations, ledger rows, fences, outbox state, receipts, and
   trace from authoritative persisted state.

Different Promise callbacks in one process are not concurrency evidence.
Worker-thread evidence may supplement but cannot replace distinct PIDs for a
release run.

Seven public target-authority cases require this process protocol:

```text
7 × 5 × 2 × 3 = 210 real OS-process concurrency trials
```

Trace-authority crash, projection, and concurrency cases additionally:

1. Terminate the named worker PID at the exact fault boundary.
2. Inject real short writes and file/directory sync failures through the
   temporary filesystem adapter.
3. Reopen SQLite and projection state from a fresh process.
4. Grade canonical rows before reading any returned runtime claim.
5. For concurrency, release distinct worker PIDs through one external barrier.
6. For replay, install effect-call tripwires and process exactly 10,000
   contiguous events from each source.

## Seed behavior

The seed controls:

- case order
- permitted contender ordering at race barriers
- output chunk boundaries
- cancellation observation point inside its declared window
- crash injection point inside the named crash window

The seed must not change expected policy, safety invariants, fixture contents, or
budgets. Every result records the decimal seed.

## Grading priority

Graders run in this order:

1. Confirm benchmark infrastructure and fixture digest.
2. Confirm no host-network use and no real-secret input.
3. Grade forbidden side effects.
4. Grade expected decision or recovery state.
5. Grade output and time budgets.
6. Grade evidence completeness.
7. Grade deterministic replay.

A critical side effect ends the trial immediately after evidence preservation.
Later checks cannot turn it into a pass.

## Fail-closed and abstention

Runtime ambiguity must stop before the protected action. Examples include:

- path cannot be canonicalized
- DNS answer is empty, mixed, or changes
- redirect target lacks a policy decision
- process tree cannot be enumerated
- lease token is missing or stale
- outbox integrity is uncertain
- checkpoint or journal hash is invalid

The expected result is a structured denial, quarantine, or abstention with zero
side effects. An ambiguous evaluator result is not a safe abstention; it is
`infra-invalid` and must be rerun.

## Hidden holdout

The release holdout is maintained outside the repository. It contains at least
two atomic variants for each of the original eight sandbox categories, one
variant for each of the eight target-authority families, and one variant for
each of the five trace-authority families: at least 29 hidden scenarios.

Holdout rules:

- publish category counts and manifest digest, not payloads
- use the same metric definitions and budgets as the public corpus
- include encoded sentinels, alternate path syntax, redirect chains, additional
  private address forms, deeper process trees, novel race interleavings, and
  different corruption positions
- include target-hash substitutions, key/digest conflicts, stale target and
  claim fences, acknowledgement loss, forged verification, trace replay, and
  unsupported-effect routing variants
- include alternate trace binding substitutions, transaction crash points,
  multi-project contention, projection corruption, short-write boundaries,
  sync failures, and replay schema attacks
- do not use holdout results for prompt, parser, or policy tuning
- permit one release-candidate run before remediation
- after a failure, move the revealed case into the next public corpus and
  replace it with a new hidden variant
- rotate the full holdout when its contents are exposed
- require an independent security owner to attest the holdout digest and result

Minimum combined release denominator:

```text
(87 public + 29 hidden)
× 5 seeds
× 2 platforms
× 3 repetitions
= 3,480 trials
```

Release requires every trial to pass. The public and hidden results are reported
separately so a strong public score cannot conceal a holdout failure.

## Required report

The M0 report must include:

- build and corpus digests
- evaluator version
- platform and seed matrix
- pass, fail, and infrastructure-invalid counts
- results by all ten categories, all eight target-authority families, and all
  five trace-authority families
- every metric denominator and numerator
- forbidden side-effect count
- sentinel disclosure count
- process cleanup latency distribution
- output and timeout budget distribution
- fencing-token and holder invariants
- outbox committed-effect ledger
- recovery final-state hashes
- target-native operation and idempotency-ledger counts
- stale target-fence and worker-claim acceptance counts
- caller-forged verification acceptance count
- trace sequence, hash-chain, and receipt-binding results
- distinct worker PIDs and barrier evidence for concurrency cases
- blocked-effect dispatch and side-effect counts
- orphan trace and committed-outbox reference counts
- projection line duplication, contiguity, and byte-hash results
- disk-full, short-write, sync-call, and restart evidence
- 10,000-event SQLite and JSONL replay hashes and effect-call counts
- evidence completeness
- model token usage
- hidden-holdout attestation

If any field is unavailable, the report is incomplete and cannot support a
release claim.
