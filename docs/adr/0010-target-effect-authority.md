# ADR 0010: Require target-authoritative compare-and-apply effects

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Data/Storage Engineering, Runtime Engineering

## Context

A durable outbox proves that Memi recorded an intent. It does not prove that the
target still matches the reviewed baseline, that a stale lease holder did not
write, that an adapter applied an effect only once, or that a caller-supplied
result hash describes the target.

An arbitrary executor returning `{ resultingHash, receipt }` is not a target
authority. Likewise, accepting a caller-supplied observed hash, evidence hash,
or trace identifier cannot turn an unverified effect into a committed one.
Failures are especially ambiguous because an adapter can durably mutate its
target and then lose the acknowledgement.

SQLite and a target store cannot form one portable transaction. This decision
therefore does not claim cross-store exactly-once delivery. It defines a
target-local atomic contract and the evidence required to reconcile that
contract with the SQLite outbox.

## Decision

Every supported mutation is implemented by a platform-owned target adapter.
Harnesses, generated code, plugins, and callers may request a typed effect but
cannot provide an adapter, verification result, commit receipt, or trace ID.

M0 permits this contract only for:

- `canvas.operation` backed by the local document operation authority; and
- `artifact.persist` backed by the content-addressed artifact authority.

An adapter is enabled only after its conformance suite proves the complete
contract below. A fake adapter is test evidence, not a production adapter.

### Closed request

The runtime constructs a strict, versioned `TargetEffectRequest` from the
accepted durable command and its authoritative outbox record. At minimum it
contains:

- project, task, run, command, outbox, target, and effect-kind identity;
- idempotency key and action digest;
- exact target baseline and expected-before hash;
- canonical payload hash and an adapter-specific, schema-validated payload;
- capability-grant and approval references;
- lease ID, holder ID, and fencing epoch; and
- worker claim ID and claim fencing epoch.

The adapter rejects unknown fields and unsupported versions. It receives no raw
provider session, harness event, conversation, credential, or arbitrary trace
payload.

### Fence activation

Wall-clock expiry is not a target fence. Before a lease becomes usable for
dispatch, the runtime performs this recoverable handshake:

1. SQLite allocates the next target-scoped fencing epoch in a pending lease.
2. The target adapter durably advances its target-local `highestFence` to that
   epoch without changing user content.
3. SQLite marks the lease active only after the target authority acknowledges
   the exact project, target, lease, and epoch.

`advanceFence` is monotonic and idempotent. A lower epoch is rejected; an exact
repeat returns the prior acknowledgement. Dispatch under a pending lease is
forbidden. A crash during activation is reconciled by repeating
`advanceFence`; it never reuses the previous epoch or silently activates a
lease.

Every compare-and-apply transaction rejects a request whose lease epoch is not
the target-local `highestFence`. Thus, once a replacement fence is activated,
an older worker cannot write even if it wakes before its previous expiry time.

### Target-local atomic compare and apply

Each target authority owns a durable idempotency ledger keyed by project,
target, and idempotency key. A ledger entry binds:

- command ID and action digest;
- expected-before hash and canonical payload hash;
- lease ID and fencing epoch used for the original application;
- resulting target hash;
- target-native operation, object, or artifact identity;
- a bounded receipt hash; and
- the adapter contract version.

Inside one target-local transaction or equivalent indivisible critical section,
the adapter:

1. validates target identity and the activated lease fence;
2. looks up the idempotency ledger;
3. returns the prior receipt without applying an effect when the key and action
   digest match exactly;
4. rejects the request when the key exists with another action digest;
5. computes the authoritative current target hash and compares it with
   `expectedBeforeHash`;
6. applies the canonical payload exactly once;
7. computes the resulting hash from the authoritative target representation;
   and
8. persists the target change and idempotency receipt atomically before
   acknowledgement.

Two different idempotency keys racing from the same expected-before hash cannot
both apply. One compare-and-apply succeeds and every loser reports a stale
target without mutation.

The adapter may use an operation-log transaction, content-addressed create, or
another target-native primitive. A check followed by an unprotected write does
not satisfy this contract.

### Typed execution outcomes

`apply` returns a strict discriminated union:

- `applied`: the target transaction committed and includes the resulting hash
  plus bounded receipt evidence;
- `replayed`: the exact idempotency entry already existed and no new effect was
  applied;
- `not-applied`: target-authoritative evidence proves the target transaction
  did not commit; or
- `outcome-unknown`: the adapter cannot prove whether the transaction committed.

A thrown exception, rejected promise, timeout, transport disconnect, malformed
response, or process interruption defaults to `outcome-unknown`. It never
becomes `not-applied` merely because the caller observed an error.

Only `not-applied` may produce a definite pre-effect failure. `outcome-unknown`
blocks automatic dispatch until trusted recovery lookup resolves it. A
`replayed` result advances the outbox using the original receipt without
reapplying the effect.

### Trusted lookup and verification

The runtime owns a separate read-only adapter capability for recovery and
verification. It queries the target authority by project, target, idempotency
key, command ID, and action digest. It does not accept observed state from a
harness or API caller.

Verification returns a strict union:

- `verified-applied`: the exact idempotency receipt exists and the current
  authoritative target hash matches its resulting hash;
- `verified-not-applied`: no receipt exists and the target still matches the
  expected-before hash;
- `mismatch`: the receipt or current target differs from the expected identity
  or hash;
- `unavailable`: the target authority cannot currently prove an outcome; or
- `corrupt`: receipt, ledger, or target integrity validation failed.

Only `verified-applied` may produce `effect-applied` evidence or allow commit.
Only `verified-not-applied`, combined with a conforming idempotent adapter and
an active fence, may allow retry. `mismatch`, `unavailable`, and `corrupt` fail
closed and preserve evidence for recovery.

The resulting and evidence hashes are computed by trusted platform code over
canonical target data. Caller-supplied hashes may be compared as expectations
but are never accepted as observations.

### Outbox and trace binding

An effect commit is a runtime-owned operation, not a public assertion. The
runtime requires an effect-applied commit claim fenced by the outbox claim
epoch. A stale claim cannot verify, append trace, or commit.

After trusted verification, the single SQLite transaction coordinator:

1. rechecks the effect-applied commit claim;
2. records the verification and any `CrashRecoveryDecision`;
3. appends trace metadata through the trace authority;
4. binds the trace event to project, command, outbox, action digest, target,
   lease fence, resulting hash, and verification evidence hash;
5. writes the final effect receipt; and
6. advances the outbox to `committed`.

The trace authority allocates sequence and previous-hash linkage. Callers cannot
choose a trace event ID. A successful commit that loses its response is
idempotent: an exact retry returns the recorded receipt, while changed evidence
or trace identity fails closed.

### Recovery order

Recovery always checks the target idempotency ledger before considering another
apply:

1. An unclaimed intent with no dispatch attempt remains eligible for its first
   claim.
2. An interrupted or expired claimed intent performs trusted lookup.
3. `verified-applied` advances to effect-applied without invoking `apply`.
4. `verified-not-applied` may retry only under a newly valid claim and active
   target fence.
5. Unknown, mismatched, or corrupt evidence becomes a blocked recovery record.
6. Effect-applied work runs verification only; it never invokes `apply`.
7. Committed and failed work never invokes `apply`.

Every restart decision is durable and visible. Recovery does not infer absence
of an effect from a thrown exception or from an unrelated unchanged hash.

### Explicitly blocked effects

This ADR does not authorize:

- `sandbox.process`;
- source-worktree or original-checkout writes;
- `git.effect`;
- `external.publish`; or
- any network, shell, package-manager, browser-authentication, or deployment
  effect.

Process completion and source mutation require their own authorities,
enforcement, receipts, rollback rules, and accepted ADRs. They remain
`block-outcome-unknown` after ambiguous dispatch and cannot be routed through a
canvas or artifact adapter. A generic filesystem adapter, shell adapter, or
“trusted local executor” is prohibited.

## Consequences

- Adapter APIs are narrower than a generic executor and require target-native
  transactions or operation deduplication.
- Lease activation gains a pending phase so a new fence is visible at the
  target before dispatch.
- Crash recovery can distinguish an applied effect with a lost acknowledgement
  from an effect that provably did not apply.
- Target and SQLite stores remain separate authorities with explicit
  reconciliation rather than an exactly-once claim.
- Trace evidence is derived from verified target state and cannot be fabricated
  by a harness or caller.
- Unsupported effects remain unavailable even when their payloads satisfy the
  public schemas.

## Required RED evidence

The following tests must fail against a pass-through or caller-asserted
executor before implementation and pass against every production adapter.
Deterministic seeds, target hashes, ledger rows, fence epochs, outbox phases,
recovery decisions, and trace hashes are retained as evidence.

### Compare-and-apply

- `target-cas-001`: change the target after approval but before apply; zero
  operations apply and the stale expected-before hash is reported.
- `target-cas-002`: race two different keys from one expected-before hash;
  exactly one applies.
- `target-idem-001`: submit the same key and digest concurrently from at least
  two OS processes; one target operation and one receipt exist.
- `target-idem-002`: reuse a key with another digest; fail closed without
  changing the original receipt or target.
- `target-idem-003`: lose the successful acknowledgement, then retry; return
  `replayed` with the original receipt and no second operation.

### Lease and claim fencing

- `target-fence-001`: activate epoch N+1 while an epoch N worker is paused; the
  late epoch N apply is rejected at the target.
- `target-fence-002`: crash after SQLite allocates a pending epoch but before
  target activation; no dispatch is enabled.
- `target-fence-003`: crash after target activation but before SQLite marks the
  lease active; recovery repeats activation and never reuses the old epoch.
- `target-fence-004`: race activation of two epochs; target `highestFence` is
  monotonic and only the authoritative active lease dispatches.
- `target-claim-001`: take over an expired worker claim while the original
  worker finishes late; target ledger records one effect.
- `target-claim-002`: take over an effect-applied commit claim; the stale
  claimant cannot verify, append trace, or commit.

### Execution outcomes and recovery

- `target-outcome-001`: commit the target transaction and then reject the
  adapter promise; recovery records the original applied receipt without
  redispatch.
- `target-outcome-002`: fail before the target transaction with authoritative
  non-application evidence; record `not-applied`.
- `target-outcome-003`: timeout without authoritative evidence; record
  `outcome-unknown` and disable automatic retry.
- `target-recovery-001`: crash before target transaction commit; lookup proves
  unchanged state and permits one fenced retry.
- `target-recovery-002`: crash after target commit but before outbox
  effect-applied; lookup advances evidence without another apply.
- `target-recovery-003`: crash after effect-applied but before SQLite trace
  commit; run verification only.
- `target-recovery-004`: crash after SQLite commit but before response; exact
  retry returns the prior commit receipt.
- `target-recovery-005`: truncate, alter, or substitute a target receipt;
  quarantine the evidence and block apply, verify, and commit.

### Trusted verification and trace

- `target-verify-001`: supply forged matching observed and evidence hashes;
  trusted verification rejects them and the outbox remains uncommitted.
- `target-verify-002`: mutate the target after apply but before verification;
  verification reports mismatch and commit is unavailable.
- `target-verify-003`: make the verifier throw or return an unknown field;
  preserve effect-applied evidence and fail closed.
- `target-trace-001`: supply a caller-chosen trace ID; reject it.
- `target-trace-002`: race verified commits from separate processes; trace
  sequence, previous hash, command binding, and outbox receipt remain unique and
  consistent.
- `target-trace-003`: replay an exact committed request after response loss;
  return the existing trace-bound receipt without appending another event.

### Blocked effect classes

- `target-block-001`: route `sandbox.process` through a target adapter; reject
  before dispatch.
- `target-block-002`: route an original-checkout or worktree write through a
  canvas or artifact adapter; reject before filesystem mutation.
- `target-block-003`: route Git, publish, network, shell, or deployment effects
  through the generic contract; reject before any external call.

The concurrency cases must use real worker threads or OS processes with
barriers. Scheduling synchronous calls through JavaScript promises is not
concurrency evidence. Crash cases must inject termination at each named
boundary, reopen the durable stores, and prove final target, ledger, outbox, and
trace state.
