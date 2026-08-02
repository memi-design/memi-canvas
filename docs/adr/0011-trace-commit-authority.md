# ADR 0011: Commit verified effect trace through SQLite authority

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Data/Storage Engineering, Runtime Engineering

## Context

A verified target effect is not durably committed until its outbox, effect
receipt, trace event, and recovery evidence agree. The current JSONL trace
journal allocates event IDs supplied by callers, sequence numbers, timestamps,
and hash-chain linkage in process memory before appending a line. Its writer
guard is process-local, and an append can succeed or partially succeed without
the runtime SQLite transaction committing.

SQLite and JSONL cannot participate in one portable atomic transaction.
Treating both as authorities would create two conflicting answers after a
crash. Requiring JSONL append success before committing the SQLite outbox would
also make a derived file a correctness dependency.

## Decision

Runtime SQLite WAL is the sole authority for canonical trace events, project
trace heads, verified effect bindings, effect receipts, outbox commit state, and
JSONL projection intents.

JSONL is a derived, replaceable projection. It is useful for inspection,
portable export, and offline integrity checks, but it does not allocate trace
identity or ordering and is never required to prove that an effect committed.
Deleting JSONL does not delete authoritative trace. A JSONL file cannot be
promoted automatically over missing or corrupt SQLite state.

This decision refines ADR 0007 without changing its semantic-event or pure
replay requirements.

### Authority boundaries

The authorities are:

- the target adapter for target-native effect and verification receipts;
- runtime SQLite for command, outbox, commit claim, canonical trace row, trace
  head, effect receipt, recovery decision, and projection intent;
- the trace package for canonical event construction, hashing, integrity
  validation, pure replay, and JSONL projection; and
- the application composition root for injecting a target adapter and starting
  the projector.

The canvas target never imports runtime or trace and never writes trace rows.
The trace package never imports runtime. Runtime may depend on protocol and the
trace package's pure functions. The SQLite-backed trace commit repository lives
with runtime so it can use the existing single transaction coordinator.

If shared SQLite mechanics are extracted later, they belong in a lower-level
storage package depended on by runtime and trace. Trace must not gain access to
canvas-target tables, and canvas-target must not gain access to runtime SQLite.

### Closed verified-effect input

Effect trace commit is an internal runtime operation. It accepts an
effect-applied commit claim and reads all other fields from authoritative
records:

- project, task, run, command, outbox, target, and actor identity;
- command action digest and idempotency key;
- expected-before and resulting hashes;
- lease ID and target fencing epoch;
- target effect receipt and receipt hash;
- trusted verification status, evidence hash, and verification time; and
- recovery decision when the commit follows interruption.

The commit API does not accept a trace event ID, sequence, event timestamp,
previous hash, event hash, observed target hash, verification evidence, or
arbitrary trace payload from a caller. Harnesses and target adapters cannot call
the SQLite trace repository.

Only a strict `verified-applied` result from the configured target authority is
eligible. The runtime compares its identity and hashes with the durable command,
effect-applied outbox, and target receipt before opening the commit transaction.
Unknown fields, mismatched bindings, stale claims, unsupported event families,
and caller-provided observations fail closed.

### Authoritative SQLite schema

The logical schema contains:

`trace_heads`

- `project_id` primary key;
- last allocated sequence;
- last event ID and event hash; and
- schema version.

`trace_events`

- event ID primary key;
- project ID and positive sequence with a unique composite constraint;
- task, run, family, actor, correlation, and causation identity;
- command, outbox, and target identity for effect events;
- event action digest, previous event hash, and event hash;
- canonical strict event JSON; and
- authoritative occurrence time.

`trace_effect_bindings`

- command ID primary key;
- unique outbox and event IDs;
- project ID, binding digest, target receipt hash, verification evidence hash,
  and resulting hash; and
- committed time.

`trace_projection_outbox`

- event ID primary key and foreign key to `trace_events`;
- project ID and sequence;
- phase `pending`, `projecting`, `projected`, or `failed`;
- projector claim owner, epoch, and expiry;
- attempt count, last error, projected byte count, and projected content hash.

All tables are strict. JSON columns require valid canonical JSON. Project-scoped
foreign keys use matching composite unique constraints. Event ID uniqueness
does not replace project and sequence uniqueness.

### Event allocation and hashing

Event ID, sequence, timestamp, action digest, previous hash, and event hash are
allocated only inside the runtime SQLite transaction.

1. The transaction acquires the project trace-head row.
2. The authority generates a branded sortable event ID using the repository's
   pinned secure ID generator.
3. Sequence is the previous project sequence plus one.
4. Previous hash is the project head's last event hash or null.
5. Occurrence time comes from the runtime authority clock.
6. A closed family-specific event body is built from authoritative records.
7. Event action digest is the canonical hash of the event input. The command
   action digest remains a separately named bound field.
8. Event hash is the canonical hash of the complete event excluding only
   `eventHash`.
9. The trace event is inserted and the project head advances.

The canonicalizer is shared by protocol, runtime, target receipts, and trace.
Locale-sensitive key sorting, accessors, unbounded values, and package-specific
JSON normalization are prohibited.

An ID allocated in a rolled-back transaction was never accepted and may be
discarded. If the transaction committed but its response was lost, the
command/outbox binding returns the already allocated event.

### Verified effect commit transaction

The runtime performs target verification before the SQLite transaction. It does
not claim that target verification and SQLite commit are atomic. Target
serialization and receipt reconciliation follow ADR 0010.

Within one `BEGIN IMMEDIATE` SQLite transaction, runtime:

1. rechecks the effect-applied commit claim and claim fencing epoch;
2. reloads the command, outbox, target receipt, and verification evidence;
3. rejects a stale lease or changed binding;
4. looks up `trace_effect_bindings` by command and outbox;
5. returns the existing committed receipt when the binding digest matches
   exactly;
6. fails closed when an existing binding differs;
7. allocates the trace event and advances the project trace head;
8. inserts the effect binding and a pending JSONL projection intent;
9. writes the final effect receipt and any recovery decision;
10. advances the outbox and command to `committed`; and
11. commits the SQLite transaction.

No trace event is authoritative unless the same transaction also commits its
effect binding and outbox transition. No committed outbox may reference a trace
event absent from `trace_events`.

The committed response contains the authority-allocated trace event and receipt.
An exact retry returns these rows without allocating another ID, sequence, or
JSONL line. Changed target receipt, verification evidence, action digest,
resulting hash, or event family under the same command or outbox is an
idempotency conflict.

### JSONL projection

After SQLite commit, a projector claims pending projection rows through SQLite
with a project-scoped worker claim and monotonic claim epoch. It reads canonical
event JSON ordered by project sequence and writes only that representation.

Projection follows these rules:

- one file contains one project;
- the file is an ordered prefix of authoritative SQLite events;
- every line is the exact canonical `event_json` plus one newline;
- file and containing-directory durability are synchronized before SQLite marks
  the row projected;
- projection status never changes trace event identity or outbox state; and
- projector failure leaves the effect committed and the projection retryable.

On startup and claim takeover, reconciliation compares JSONL with SQLite:

- an exact prefix resumes at the next sequence;
- an exact line already written before a lost acknowledgement is marked
  projected without appending it again;
- a partial final line, missing line, extra line, reordered line, hash mismatch,
  wrong project, or invalid schema quarantines the derived file;
- quarantine recovery writes a complete replacement to a sibling temporary
  file, synchronizes it, atomically renames it, synchronizes the directory, and
  then updates projection state; and
- SQLite corruption blocks trace and runtime recovery. JSONL is preserved as
  evidence but is not imported automatically as authority.

The existing direct JSONL `append` API is not used for production trace commit.
It may remain only as a fixture/export helper until replaced by an
authority-backed projector.

### Read and replay

Product trace reads and replay use canonical SQLite event order by default.
JSONL replay is an explicit export-validation mode. It first verifies project
identity, strict schemas, contiguous sequence, action digests, previous hashes,
and event hashes.

Replay remains pure. Neither SQLite replay nor JSONL replay may invoke a target
adapter, process, Git, network, harness, current-state mutation, or projection
write.

## Consequences

- Verified effect commit and canonical trace allocation are atomic within one
  SQLite authority.
- JSONL lag or failure is visible operational debt, not ambiguous effect state.
- Multiple runtime processes serialize trace ordering through SQLite instead of
  process-local memory.
- A lost response cannot create another event for the same committed effect.
- JSONL can be rebuilt deterministically and does not silently repair SQLite.
- Trace export requires projection health and integrity evidence.
- Target verification remains a separate authority boundary with explicit
  reconciliation rather than a cross-store atomicity claim.

## Required RED evidence

These tests must fail against caller-allocated or JSONL-authoritative trace
commit and pass against the SQLite authority. They retain deterministic database
rows, outbox phases, event hashes, projection bytes, and recovery decisions.

### Trust and binding

- `trace-trust-001`: supply a caller-chosen trace ID; reject it before trace
  allocation.
- `trace-trust-002`: supply caller-observed target and evidence hashes; ignore or
  reject them and use only trusted target verification.
- `trace-trust-003`: alter command, outbox, target receipt, resulting hash,
  fence, or verification evidence between verify and commit; remain
  effect-applied and append no event.
- `trace-trust-004`: submit an unknown event family or extra payload field;
  reject it before SQLite mutation.

### SQLite transaction crash windows

- `trace-crash-001`: terminate after verification but before SQLite begin;
  preserve effect-applied and allocate no event.
- `trace-crash-002`: terminate after claim recheck but before event insert;
  roll back every trace and outbox write.
- `trace-crash-003`: terminate after event insert but before head update; roll
  back both.
- `trace-crash-004`: terminate after head update but before effect binding;
  roll back event and head.
- `trace-crash-005`: terminate after effect binding but before outbox commit;
  roll back event, head, binding, projection intent, receipt, and outbox.
- `trace-crash-006`: terminate after SQLite commit but before response; exact
  retry returns the original event and receipt without another allocation.
- `trace-crash-007`: corrupt or remove an authoritative trace row referenced by
  a committed outbox; startup fails closed and preserves the database.

### Allocation and concurrency

- `trace-concurrency-001`: race the same effect commit from at least two OS
  processes; exactly one event, sequence, binding, and projection intent exist.
- `trace-concurrency-002`: race different commands in one project; sequences
  are unique and contiguous and every previous hash names the prior event.
- `trace-concurrency-003`: race commits in different projects; each project has
  an independent head and valid chain.
- `trace-concurrency-004`: expire and take over a commit claim while the old
  worker resumes; the stale worker cannot allocate or commit.
- `trace-concurrency-005`: retry one command with a changed binding digest;
  return conflict without modifying the original event or trace head.

Concurrency evidence must use worker threads or OS processes with deterministic
barriers. Promise scheduling of synchronous SQLite calls is insufficient.

### JSONL projection and reconciliation

- `trace-project-001`: crash after SQLite commit but before projection; effect
  remains committed and projection resumes from pending.
- `trace-project-002`: crash after writing a complete line but before marking it
  projected; reconciliation detects the exact line and does not duplicate it.
- `trace-project-003`: crash during a line write; quarantine and rebuild the
  derived file from SQLite.
- `trace-project-004`: truncate, reorder, alter, duplicate, or append an unknown
  line; quarantine and rebuild without changing SQLite events.
- `trace-project-005`: delete JSONL; rebuild byte-identical output from SQLite.
- `trace-project-006`: retain valid JSONL but corrupt SQLite; block recovery and
  never promote JSONL automatically.
- `trace-project-007`: run competing projectors; SQLite claims and epochs
  produce one ordered line per event.
- `trace-project-008`: fail file or directory synchronization; leave projection
  pending or failed and do not claim durable projection.

### Replay and scale

- `trace-replay-001`: replay 10,000 SQLite events and their projected JSONL;
  both produce the same state hash without any effect call.
- `trace-replay-002`: inject effect-like payload fields into replay input;
  strict schemas reject them and no external boundary is invoked.
- `trace-replay-003`: rebuild projection repeatedly; each byte stream and final
  integrity hash is identical.

Passing unit tests in one process is not acceptance evidence. Required evidence
includes the pinned Node 22 runtime, multiprocess contention, disk-full and
short-write injection, transaction rollback, process termination, restart, and
byte-for-byte projection reconciliation.
