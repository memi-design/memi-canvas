# M0 Security Metrics and Release Gates

Status: benchmark contract, no runtime implementation
Corpora:

- `packages/test-fixtures/sandbox-adversarial/manifest.json`
- `packages/test-fixtures/security/target-authority-cases.json`
- `packages/test-fixtures/security/trace-authority-cases.json`

Overall M0 status: **RED**. These metrics define required evidence; they do not
claim that the runtime currently satisfies it.

## Objective

M0 proves that the local sandbox and target authorities fail closed at
filesystem, secret, network, process, compare-and-apply, concurrency, queue,
verification, trace commit, projection, replay, and recovery boundaries. A
result is only a pass when the expected policy decision, side-effect outcome,
and evidence are all correct.

The benchmark uses synthetic sentinels and mock transports. It must never read
host secrets, scan the user's home directory, or contact a live network.

## Unit of evaluation

An **atomic scenario** is one independently gradeable attack or recovery case.
The two aggregate public cases expand as follows:

- `outbox-001-crash-windows`: 5 atomic crash windows
- `recovery-001-journal-corpus`: 4 atomic journals
- ADR 0010 target-authority corpus: 28 atomic cases
- ADR 0011 trace-authority corpus: 27 case IDs with 43 mandatory invocations

The public corpus therefore has these denominators:

| Category | Public atomic scenarios |
|---|---:|
| Filesystem escape | 4 |
| Secret access and disclosure | 3 |
| Network and SSRF | 7 |
| Process cleanup | 3 |
| Output and time budgets | 2 |
| Lease and fencing races | 4 |
| Outbox crash windows | 5 |
| Recovery correctness | 4 |
| Target-effect authority | 28 |
| Trace commit authority | 27 |
| **Total** | **87** |

A **trial** is:

```text
atomic scenario × deterministic seed × platform × repetition
```

Required public seed set:

```text
1296387401, 49374, 3735928559, 3237998081, 12648430
```

Required release platforms:

- `darwin-arm64`
- `linux-x64`

Required release stability is three consecutive passing repetitions. The public
release denominator is therefore:

```text
87 scenarios × 5 seeds × 2 platforms × 3 repetitions = 2,610 trials
```

Quick PR evaluation may use one supported CI platform and one repetition:

```text
87 × 5 × 1 × 1 = 435 trials
```

Quick evaluation cannot substitute for the release denominator.

## Outcome states

Every trial has exactly one outcome:

- `pass`: decision, side effects, budgets, and evidence all match
- `fail`: any behavioral, safety, integrity, or budget mismatch
- `infra-invalid`: runner or evidence infrastructure failed before a valid grade

`infra-invalid` is never counted as a pass and is excluded from the accuracy
denominator only after being reported separately. It must be rerun. Three
consecutive infrastructure-invalid runs block release.

## Core metrics

### Policy decision accuracy

```text
correct policy decisions / valid trials
```

Gate: **100%**

An expected safe operation denied by the sandbox is a failure. Security cannot
be improved on paper by denying everything.

### Forbidden side-effect rate

```text
observed forbidden side effects / dangerous valid trials
```

Forbidden effects include unauthorized reads or writes, forbidden connects,
surviving child processes, stale-fence or stale-claim commits, duplicate
committed effects, caller-forged verification acceptance, caller-selected trace
identity, orphan trace/outbox rows, duplicate projection lines, noncontiguous
sequences, and acceptance of tampered recovery state.

Gate: **0**

### Evidence completeness

```text
emitted required evidence items / declared required evidence items
```

Gate: **100% per trial**

A behavior that looks correct but lacks its required trace, before/after state,
or policy evidence is a failure.

### Deterministic replay agreement

```text
trials whose normalized decision, effect, and evidence hashes match
/ repeated trials with the same scenario, seed, platform, and build
```

Gate: **100%**

Monotonic durations may vary within budget and are excluded from equality after
being retained as raw evidence.

### Model token usage

```text
sum(modelTokenUsage across security benchmark trials)
```

Gate: **0**

Security enforcement and grading must not depend on a model.

## Boundary-specific metrics

### Filesystem containment

Denominator: all filesystem atomic trials.

Metrics:

- Escape attempts denied / escape attempts: **100%**
- Unauthorized file reads: **0**
- Unauthorized file writes: **0**
- Allowed workspace reads completed: **100%**
- Raw and canonical targets recorded: **100%**

Canonicalization uncertainty, a broken symlink chain, an absent workspace root,
or a path that cannot be proven to be contained must return a structured denial
before any file operation.

### Secret non-disclosure

The grader scans these disclosure surfaces independently:

1. returned value
2. stdout
3. stderr
4. diagnostics and errors
5. trace events
6. retained artifacts
7. mock network request transcript

Metrics:

```text
forbidden sentinel occurrences / scanned disclosure surfaces
```

Gate: **0 occurrences**

The public sentinel strings are not real credentials. They are exact-match
canaries. Partial, encoded, or case-transformed variants should be added to the
hidden holdout.

### Network and SSRF containment

Denominator: all network atomic trials.

Metrics:

- Forbidden connect attempts: **0**
- Per-hop redirect policy decisions present: **100%**
- DNS answer and connection-address agreement: **100%**
- Authorized mock request success: **100%**
- Host-network packets emitted by the benchmark: **0**

An unresolved hostname, mixed public/private answer, changed DNS answer,
unsupported scheme, malformed URL, missing redirect decision, or unavailable
mock transport must fail closed.

### Process cleanup

Denominator: all process atomic trials, including normal exit.

Metrics:

- Remaining descendant process count after completion: **0**
- Cleanup latency after timeout or cancellation: **≤2,000 ms for every trial**
- Correct termination reason: **100%**
- Process-tree before/after evidence: **100%**

Checking only the direct child is insufficient. The denominator includes every
declared descendant in the process plan.

### Output and time budgets

Metrics and gates:

- Retained combined output: **≤1,048,576 bytes per trial**
- Individual trace event: **≤65,536 bytes**
- Generated-but-discarded byte count recorded exactly: **100%**
- Timeout overshoot: **≤250 ms**
- Case wall time: **≤10,000 ms**
- Quick public suite wall time: **≤180 seconds at p95**

Output truncation must preserve the termination reason and byte counters. It
must not split or bypass sentinel scanning.

### Lease and fencing correctness

Every race runs against the logical schedule for each deterministic seed.

Metrics:

- Maximum concurrent lease holders: **1**
- Accepted stale writes: **0**
- Accepted stale acknowledgements: **0**
- Reused or decreasing fencing tokens: **0**
- Final state equal to scheduled winner: **100%**

Wall-clock timing is not evidence of correctness. The grader uses ordered
logical steps and recorded fencing tokens.

### Outbox crash correctness

Denominator: 5 crash windows × seeds × platforms × repetitions.

Metrics:

- Lost durable messages: **0**
- Duplicate committed effects: **0**
- Idempotency key changes across recovery: **0**
- Corrupt entries delivered: **0**
- Recovery outcome matches declared crash window: **100%**

“Exactly once” refers to committed logical effects. Transport delivery may be
retried after an uncertain acknowledgement, but it must use the original
idempotency key.

### Recovery correctness

Denominator: 4 recovery journals × seeds × platforms × repetitions.

Metrics:

- Incorrect recovered state: **0**
- Invalid checkpoint accepted: **0**
- Invalid middle record skipped while later records apply: **0**
- Valid prefix lost: **0**
- Recovery status and last valid sequence correct: **100%**

A truncated tail may be discarded only after the complete preceding record has
been verified. A middle-record integrity failure quarantines the remainder.

### Target-effect authority

Authority: `docs/adr/0010-target-effect-authority.md`

Corpus: `packages/test-fixtures/security/target-authority-cases.json`

The 28 atomic cases have fixed family denominators:

| Family | Cases | Atomic scenarios |
|---|---|---:|
| Compare-and-apply | `target-cas-001` through `002` | 2 |
| Idempotency | `target-idem-001` through `003` | 3 |
| Lease and claim fencing | `target-fence-001` through `004`, `target-claim-001` through `002` | 6 |
| Execution outcomes | `target-outcome-001` through `003` | 3 |
| Recovery | `target-recovery-001` through `005` | 5 |
| Trusted verification | `target-verify-001` through `003` | 3 |
| Trace binding | `target-trace-001` through `003` | 3 |
| Blocked effects | `target-block-001` through `003` | 3 |
| **Total** |  | **28** |

Each family is graded independently. A perfect result in one family cannot
offset a failure in another.

The target-authority public release denominator is:

```text
28 cases × 5 seeds × 2 platforms × 3 repetitions = 840 trials
```

#### Compare-and-apply measurements

- Stale expected-before hashes accepted: **0**
- Target operations in `target-cas-001`: **0**
- Winners in the two-key race: **exactly 1**
- Loser mutations in the two-key race: **0**
- Authoritative before/after target hashes present: **100%**

The race denominator is the set of requests released through the same barrier,
not the number of returned promises.

#### Idempotency measurements

- Duplicate committed effects: **0**
- Target operations for an exact concurrent key/digest: **exactly 1**
- Durable ledger rows for that key: **exactly 1**
- Distinct receipt hashes for exact retries: **exactly 1**
- Changed digest accepted under an existing key: **0**
- Original receipt or target mutations after digest conflict: **0**

Transport retries are counted separately from target-native operations.

#### Target and claim fence measurements

- Pending-lease dispatches: **0**
- Accepted commits below target-local `highestFence`: **0**
- Reused or decreasing target fencing epochs: **0**
- Maximum authoritative active lease per target: **1**
- Accepted stale-claim verifications: **0**
- Accepted stale-claim trace appends: **0**
- Accepted stale-claim commits: **0**

These gates are evaluated from target, SQLite, outbox, and trace evidence
together. SQLite lease state alone is insufficient.

#### Execution outcome measurements

- Pre-effect failures classified `not-applied` without authoritative evidence:
  **0**
- Unknown outcomes automatically retried: **0**
- Applied effects redispatched after acknowledgement loss: **0**
- Outcome union agreement with target-authoritative evidence: **100%**

A thrown exception, timeout, malformed response, process death, or disconnect
is `outcome-unknown` until trusted lookup proves otherwise.

#### Recovery measurements

- Recovery decisions matching trusted lookup: **100%**
- Apply invocations after `verified-applied`: **0**
- Apply invocations for effect-applied work: **0**
- Fenced retries after `verified-not-applied`: **exactly 1 where declared**
- Duplicate target operations across all recovery cases: **0**
- Corrupt evidence that reaches apply or commit: **0**

#### Trusted verification measurements

- Caller-forged verification acceptances: **0**
- Caller-supplied resulting or evidence hashes used as observations: **0**
- Commits after `mismatch`, `unavailable`, or `corrupt`: **0**
- Authoritative target-hash and receipt checks present: **100%**
- Effect-applied evidence preserved after verifier failure: **100%**

Caller values may be retained as expectations, but never contribute to the
trusted-observation numerator.

#### Trace binding measurements

- Caller-chosen trace IDs accepted: **0**
- Duplicate trace sequence numbers: **0**
- Trace previous-hash breaks: **0**
- New trace events for exact committed replay: **0**
- Commit receipts bound to project, command, outbox, action digest, target,
  lease fence, resulting hash, and verification evidence hash: **100%**

#### Blocked-effect measurements

- Adapter dispatches for blocked effect classes: **0**
- Filesystem or external side effects from blocked cases: **0**
- Block decisions before target adapter invocation: **100%**

The blocked denominator includes `sandbox.process`, source/worktree writes,
original-checkout writes, Git, publish, network, shell, package-manager,
browser-authentication, and deployment effects represented by
`target-block-001` through `003`.

#### Real OS-process concurrency

Every target-authority case marked `requiresOsProcessConcurrency` must use at
least two workers with distinct operating-system PIDs, separate target-authority
handles, and independent SQLite connections. Workers wait on an external
barrier and are released into the contested operation together.

Required evidence:

- distinct worker PIDs and process start records
- barrier-ready and barrier-release records
- per-process target-authority handle and SQLite connection identities
- per-process request, outcome, and monotonic timestamps
- final target hash, idempotency ledger, fence, outbox, receipt, and trace state

JavaScript promise scheduling does not satisfy concurrency evidence. Worker
threads may be useful development tests but do not satisfy the release
denominator. Missing process evidence makes the trial `infra-invalid`.

Seven public cases require real OS-process concurrency:

```text
7 cases × 5 seeds × 2 platforms × 3 repetitions = 210 OS-process trials
```

### Trace commit authority

Authority: `docs/adr/0011-trace-commit-authority.md`

Corpus: `packages/test-fixtures/security/trace-authority-cases.json`

The 27 required case IDs have these family denominators:

| Family | Cases | Case IDs | Mandatory invocations |
|---|---|---:|---:|
| Trust and binding | `trace-trust-001` through `004` | 4 | 9 |
| SQLite crash windows | `trace-crash-001` through `007` | 7 | 8 |
| Allocation and concurrency | `trace-concurrency-001` through `005` | 5 | 5 |
| JSONL projection | `trace-project-001` through `008` | 8 | 13 |
| Replay and scale | `trace-replay-001` through `003` | 3 | 8 |
| **Total** |  | **27** | **43** |

A case trial passes only when every declared variant passes. The trace-authority
public release denominators are:

```text
27 case IDs × 5 seeds × 2 platforms × 3 repetitions = 810 case trials
43 mandatory invocations × 5 × 2 × 3 = 1,290 concrete invocations
```

Overall M0 remains RED until every invocation has retained evidence from the
accepted runtime and hidden holdout.

#### Trace trust and binding

- Caller-chosen trace IDs accepted: **0**
- Caller-observed hashes accepted as trusted observations: **0**
- Trace events appended after any verify-to-commit binding change: **0**
- SQLite mutations after an unknown family or extra field: **0**
- Closed-request fields derived from authoritative rows: **100%**

`trace-trust-003` executes command, outbox, target receipt, resulting hash,
fence, and verification-evidence changes separately.

#### SQLite crash atomicity

- Orphan authoritative trace rows: **0**
- Committed outbox rows without their referenced trace event: **0**
- Trace heads advanced without the matching event and binding: **0**
- Projection intents without the matching event: **0**
- New event IDs, sequences, or receipts after exact response-loss retry: **0**
- JSONL promotions over missing or corrupt SQLite authority: **0**

Every crash case terminates the worker process at the named boundary. Recovery
must run in a new OS process, reopen durable stores, and grade persisted state.
An exception thrown in the same process is not crash evidence.

#### Allocation and concurrency

- Duplicate project/sequence pairs: **0**
- Noncontiguous sequences: **0**
- Previous-hash chain breaks: **0**
- Duplicate effect bindings or projection intents: **0**
- Cross-project event or head rows: **0**
- Stale-claim event allocations or commits: **0**
- Changed binding digests accepted on exact retry: **0**

All five `trace-concurrency-*` cases and `trace-project-007` require at least
two distinct OS worker PIDs, separate SQLite connections, separate repository
handles, and an external synchronized barrier.

```text
6 cases × 5 seeds × 2 platforms × 3 repetitions
= 180 real OS-process trace trials
```

Promise scheduling and worker-thread-only runs do not enter the release
denominator.

#### JSONL projection and reconciliation

- Duplicate projection lines: **0**
- Noncontiguous projected sequences: **0**
- Projection lines that differ from canonical SQLite event JSON: **0**
- Projection state marked durable after failed file or directory sync: **0**
- SQLite event mutations caused by reconciliation: **0**
- Rebuild byte-hash disagreement: **0**

`trace-project-003` requires a real short-write fault during a line.
`trace-project-008` requires separate disk-full failures at file `fsync` and
containing-directory `fsync`. Both run through a real temporary filesystem
adapter, retain sync-call evidence, restart, and reconcile. A mocked method that
throws before any write is not sufficient fault evidence.

#### Replay and scale

`trace-replay-001` contains exactly 10,000 contiguous events per source in every
trial. It replays authoritative SQLite and projected JSONL independently:

```text
10,000 events × 5 seeds × 2 platforms × 3 repetitions
= 300,000 event positions per source
= 600,000 total event-record reads
```

Gates:

- SQLite and JSONL final replay state hashes agree: **100%**
- Noncontiguous sequences or previous-hash breaks accepted: **0**
- Target, process, Git, network, harness, state mutation, or projection calls
  during replay: **0**
- Distinct byte hashes across repeated projection rebuilds: **1**
- Distinct final integrity hashes across repeated rebuilds: **1**

#### Trace restart and fault evidence

Fourteen public trace cases require a fresh recovery process after termination
or projection fault:

```text
14 cases × 5 seeds × 2 platforms × 3 repetitions
= 420 restart trials
```

Each retains terminated PID, restart PID, fault marker, pre-fault database and
projection hashes, post-restart integrity result, and final authoritative rows.
The terminated and restart PIDs must differ.

## Abstention and fail-closed rules

An `abstain` outcome is permitted only when the runtime cannot establish a
security precondition. It must:

- occur before the protected side effect
- emit a stable reason code
- retain the evidence that made the decision uncertain
- produce zero forbidden effects

For a dangerous case, safe abstention is counted separately from an expected
policy denial and does not improve capability accuracy. For a benign allow case,
abstention is a failure.

The evaluator itself must not infer success when evidence is missing. Missing or
unreadable evidence makes the trial `infra-invalid`, and repeated invalid runs
block release.

## Release thresholds

M0 security release requires all of the following:

- Public `pass^3 = 100%` across the 2,610-trial release denominator
- Hidden-holdout `pass^3 = 100%`
- Policy decision accuracy: 100%
- Forbidden side-effect rate: 0
- Secret sentinel occurrences: 0
- Forbidden network connects: 0
- Remaining child processes: 0
- Accepted stale writes or acknowledgements: 0
- Lost durable messages or duplicate committed effects: 0
- Accepted stale-fence or stale-claim commits: 0
- Caller-forged verification acceptances: 0
- Caller-chosen trace IDs accepted: 0
- Orphan trace rows or committed outbox references: 0
- Duplicate projection lines: 0
- Noncontiguous authoritative or projected sequences: 0
- Trace hash-chain breaks: 0
- Blocked-effect adapter dispatches: 0
- Incorrect recovery states: 0
- Evidence completeness: 100%
- Model token usage: 0
- Every output and time budget satisfied

There is no aggregate-score waiver for a critical failure. A release exception
requires a removed support claim, an explicit blocked status, and a new
denominator. It may not silently exclude a failing trial.

## Evidence bundle and retention

Each run produces:

```text
.memi/evals/security/<run-id>/
  run.json
  environment.json
  corpus-manifest.sha256
  cases/<case-id>/<seed>/<repetition>/
    result.json
    policy.json
    trace.jsonl
    effects-before.json
    effects-after.json
    output-metadata.json
    evidence.sha256
```

Category-specific evidence adds process trees, mock DNS/transport transcripts,
lease schedules, target operation and idempotency ledgers, outbox rows, trusted
verification records, trace heads and events, projection bytes and sync calls,
commit receipts, replay state hashes, or recovery state hashes.

Retention:

- Pull-request raw evidence: 14 days
- Nightly raw evidence: 30 days
- Release raw evidence: 180 days
- Signed release summary, corpus digest, build digest, and gate result:
  retained with the release

Bundles remain local or in approved CI storage. They must not contain host
environment dumps, real secrets, raw home-directory paths, private source, or
hidden chain-of-thought.
