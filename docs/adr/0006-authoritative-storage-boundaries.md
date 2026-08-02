# ADR 0006: Assign one authority to each durable state kind

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Data/Storage Engineering

## Context

Canvas spans relational metadata, document operations, large evidence, product
source, and platform process effects. Treating these stores as one transaction
creates impossible exactly-once claims and ambiguous recovery. An action can
finish after its process crashes but before its result is recorded.

M0 targets Node.js 22. The built-in `node:sqlite` module is convenient but is
not a stable API on that line. It was added in Node 22.5.0, became available
without its enabling flag in 22.13.0, and remains experimental and under active
development in the [Node.js 22 documentation](https://nodejs.org/docs/latest-v22.x/api/sqlite.html).
Removing the flag did not make the API stable.

## Decision

Authorities are:

- SQLite WAL for projects, tasks, runs, immutable approval receipts, approval
  uses, capability grants and uses, leases and fencing epochs, durable commands,
  trace metadata, ChangeSets, artifact metadata, operation metadata, and outbox
  records;
- the local document operation log plus snapshots for canvas content;
- a content-addressed store for large redacted artifacts;
- Git and app-managed isolated worktrees for product source; and
- an encrypted local vault for credentials and authenticated browser state.

SQLite is the only authority allowed to reserve a bounded approval or grant
use, advance a lease fence, accept a durable command, and create its outbox
intent. Those rows are written in one transaction. Runtime memory, a harness
session, or an adapter-local counter is never authoritative.

### Durable command identity

A `DurableCommand` binds one project, task, run, issuer, closed command kind,
exact target and baseline, expected-before hash, payload hash, idempotency key,
action digest, required capabilities, capability grant, approval receipt when
required, lease, and fencing epoch.

The action digest is computed from the versioned canonical action before the
transaction begins. Within a project, an idempotency key may identify only one
action digest. An exact retry returns the existing command and evidence. A
different digest under the same key fails closed.

Approval and capability uses are reserved with the command intent to prevent
concurrent oversubscription. Reservation consumes the use even if dispatch
later fails. Expiry, exact action binding, required capabilities, and the
current lease fence are checked again immediately before an external effect.
Reservation does not extend expiry.

### Outbox state machine

Every external effect follows this state machine:

1. `intent` is durable before dispatch.
2. `effect-applied` records the verified resulting hash.
3. `committed` preserves that applied result and adds trace evidence.
4. `failed` records whether intent or effect application failed.

Allowed transitions are `intent -> effect-applied -> committed`,
`intent -> failed`, and `effect-applied -> failed`. Terminal records cannot be
resurrected. Same-phase retries must be exact repeats. Command ID,
idempotency key, action digest, effect target, expected-before hash, payload
hash, and creation time never change between phases.

### Lease fencing

Lease acquisition and handoff increment a target-scoped fencing epoch inside
SQLite. Every mutating command carries the exact lease ID and epoch. External
effect adapters must reject an epoch older than the authoritative target epoch,
even when a lease timestamp has not yet expired. Wall-clock expiry alone is not
a fence.

### Crash recovery

Restart scans unfinished commands and outbox records, then records an explicit
`CrashRecoveryDecision`.

- A proven-idempotent, probeable effect may retry only after durable probe
  evidence shows the target still matches the expected-before hash.
- An effect-applied record may commit only after the observed target matches
  its resulting hash.
- Committed and failed records never reapply their effect.
- Process execution, publishing, and other non-probeable effects with an
  uncertain outcome become `block-outcome-unknown`. An unchanged target hash is
  not proof that a process did not run.

No cross-store delivery is described as exactly once.

### Node 22 SQLite containment

The Node 22 implementation must isolate `node:sqlite` behind a repository
interface and a compatibility probe. Startup checks the exact Node version,
required SQLite features, WAL behavior, foreign-key enforcement, busy timeout,
and migration version before accepting mutations. The database has one
transaction coordinator, while all other processes use transactional compare
and swap through that authority.

Before a Node upgrade, the SQLite adapter runs migration, backup, restore,
contention, and crash-window tests against the candidate runtime. An
experimental API change blocks the upgrade instead of silently changing
durability semantics. The schema and SQL migration format remain independent
of the Node API so the adapter can be replaced without changing public
protocols.

## Consequences

- Artifact metadata is not visible until bytes are durably hashed.
- Git effects emit prepare, apply, verify, and commit evidence.
- Harness identity is provider-neutral durable run metadata. Raw provider
  session objects never enter authoritative rows.
- Corruption, ambiguous process outcomes, stale fences, and exhausted authority
  uses are surfaced instead of silently repaired or retried.
- Node 22 `node:sqlite` is an implementation risk with an explicit replacement
  seam, not an architectural dependency advertised as stable.

## Acceptance evidence

- Crash-window tests cover every outbox phase and store boundary.
- Concurrent tests prove approval and grant limits cannot oversubscribe.
- Multi-process tests prove stale fencing epochs cannot commit.
- Ambiguous process completion becomes outcome-unknown without re-execution.
- SQLite backup, migration, rollback, contention, and artifact-index
  reconciliation pass on the pinned Node 22 runtime.
- Dirty user checkouts remain byte-for-byte unchanged.
