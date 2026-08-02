# Local runtime UX acceptance criteria

- Status: RED contract
- Owner: Product Design
- Required reviewers: Product, Architecture, Runtime, AI Systems, Security,
  Accessibility, Data/Storage, and QA
- Companion state model: `docs/product/LOCAL_RUNTIME_STATES.md`

These criteria define observable user behavior for later component,
integration, recovery, and end-to-end tests. They do not approve a sandbox or
claim that the current runtime implements these controls.

## Preflight and connection

### LR-PF-001: Disconnection preserves evidence

Given the local runtime is disconnected, when a workspace opens, then saved
canvas evidence remains readable, runtime-dependent actions are disabled, and
`Reconnect runtime` and `Open evidence only` are available.

### LR-PF-002: Connection does not imply authentication

Given a connection attempt, when it is still in progress, then the interface
names the current stage, offers `Cancel connection`, and does not say
`Connected` before authentication succeeds.

### LR-PF-003: Limited readiness names unavailable capabilities

Given the runtime connects without every required subsystem, when readiness is
shown, then the label is `Local runtime connected with limits`, every
unavailable capability and affected task is named, and runnable unaffected work
remains available.

### LR-PF-004: Runtime readiness is not sandbox readiness

Given the authenticated runtime channel is ready, when status is shown, then it
includes runtime version, project boundary, and health-check time without
claiming the restricted environment or any write permission is ready.

### LR-PF-005: Preflight progress is truthful

Given deterministic preflight is running, when a check changes, then its name
and state are announced, cancellation remains available, and a percentage is
shown only when the total check count is known.

### LR-PF-006: Preflight exposes the full consequence

Given an action can execute local code or mutate accepted state, when preflight
opens, then the user can inspect action, target, destination, executable and
arguments, working directory, mounts, network, secrets, budgets, harness,
sandbox checks, lease, recovery boundary, capability, approval, expiry, and
use count before continuing.

### LR-PF-007: Partial preflight cannot authorize failed requirements

Given some preflight checks pass and others are unavailable or unverified, when
results appear, then passed, failed, and unverified checks are distinct and the
user can continue only with operations whose requirements passed.

### LR-PF-008: Blocked preflight is actionable

Given a required check fails, when preflight completes, then no action is
dispatched and the interface names the failed requirement, recovery owner,
preserved work, and next recovery action.

### LR-PF-009: Changed scope requires fresh review

Given a reviewed action changes target, operation, harness, capability, network,
secret, or consequence, when it returns to preflight, then the changed fields
are highlighted and prior grant or approval is not treated as authorization.

### LR-PF-010: Passed preflight does not overclaim safety

Given all declared preflight checks pass, when the outcome appears, then it says
`Preflight checks passed` and proceeds to authorization without saying the
action is safe, isolated, approved, started, or complete.

## Capability grants

### LR-CG-001: No grant means no privileged dispatch

Given no capability was requested, when a privileged action reaches dispatch,
then the runtime blocks it and the UI shows `Access not requested`.

### LR-CG-002: Grant request is complete and deniable

Given access is requested, when the request appears, then capability,
consequence, project, target, destination, mounts, network, secrets, expiry,
use count, task, and harness are visible with distinct `Grant access` and
`Deny` actions.

### LR-CG-003: Grant does not consume approval

Given capability access is granted, when an approval-gated mutation is pending,
then the grant shows scope, expiry, and uses remaining while the mutation stays
`Waiting for approval`.

### LR-CG-004: Resume preserves or narrows access

Given a paused or handed-off task resumes with a narrower grant, when it
continues, then removed capabilities remain unavailable and the interface
shows `Access narrowed`.

### LR-CG-005: Denial preserves the task

Given access is denied, when the request resolves, then no effect is dispatched,
task context and proposal remain, and the user can revise scope or stop.

### LR-CG-006: Expired grant fails closed

Given a grant expires before effect-boundary validation, when dispatch is
attempted, then nothing starts and a new request against current state is
required.

### LR-CG-007: Revocation stops future dispatch

Given access is revoked during a task, when revocation is recorded, then future
operations cannot dispatch, interruptible work receives a cancellation request,
and the trace preserves the revocation and any effect already completed.

### LR-CG-008: Use limit cannot renew silently

Given a capability grant has no uses remaining, when another operation is
requested, then it is blocked with `Access use limit reached` and requires a
new bounded grant.

### LR-CG-009: Grant binding mismatch is visible

Given the project, target revision, action digest, harness, or scope differs
from the grant, when effect-boundary validation runs, then the operation is
blocked, the mismatched binding is named, and new review is required.

## Approval receipts

### LR-AR-001: Read-only action explains absent approval

Given an action requires no state change approval, when authorization is
reviewed, then the interface says `No change approval required`, explains that
the action is read-only, and still shows any separate capability requirement.

### LR-AR-002: Approval request binds the displayed effect

Given a mutation proposal is ready, when approval is requested, then requester,
approver, exact operations, diff, project, baseline, targets, action digest,
capability, consequence, verification plan, expiry, and maximum uses are
inspectable and nothing is applied.

### LR-AR-003: Approved receipt is immutable and specific

Given an exact change is approved, when the receipt appears, then receipt ID,
digest, actor, scope, target revision, expiry, and use count are readable and
editing any bound value requires a new receipt.

### LR-AR-004: Partial approval excludes unselected operations

Given a proposal has multiple operations, when the user approves a subset, then
only those operations are eligible to apply, excluded operations remain
proposed, and verification scope is recalculated.

### LR-AR-005: Rejection applies nothing

Given the user rejects a proposal, when rejection is recorded, then no proposed
operation is applied and the proposal plus optional feedback remains
inspectable.

### LR-AR-006: Expired approval applies nothing

Given approval expires before apply, when apply is attempted, then the command
is blocked and a current diff plus new approval is required.

### LR-AR-007: Changed target invalidates approval

Given a target revision or operation digest changes after approval, when
effect-boundary validation runs, then nothing further is applied and the UI
shows which binding changed.

### LR-AR-008: Receipt consumption is traceable

Given an approval receipt authorizes an operation, when it is consumed, then it
links to the command outcome, decrements the permitted uses, and cannot
authorize commit, push, deploy, or another capability unless those operations
are explicitly bound.

## Restricted-environment health

### LR-SB-001: Unavailable environment disables execution

Given the restricted environment is absent or unapproved, when a runnable local
action is prepared, then execution is disabled and the missing control is
named.

### LR-SB-002: Preparation exposes individual controls

Given a restricted environment is preparing, when health details open, then
filesystem mounts, network policy, secrets, process supervision, resource
limits, and cleanup checks each show pending, passed, failed, or unverified.

### LR-SB-003: Ready names checked limits

Given required environment controls pass, when readiness appears, then it shows
the exact controls and check time and does not claim complete host isolation or
safety.

### LR-SB-004: Active environment exposes control

Given a command runs in the restricted environment, when task details open,
then current command phase, elapsed time, resource budgets, and truthful pause
and stop availability are shown.

### LR-SB-005: Cleanup is nonterminal

Given an action finishes, fails, times out, is cancelled, or the runtime
restarts, when descendant processes or temporary resources are still being
checked, then the task remains nonterminal with
`Cleaning up local processes`.

### LR-SB-006: Failed health check blocks new effects

Given a required environment control fails, when health changes, then new
effects are blocked, usable evidence remains, and `Retry environment check` or
`Stop task` is available.

### LR-SB-007: Unverified cleanup cannot be called stopped

Given process or temporary-resource cleanup cannot be verified, when the stop
flow resolves, then the interface says `Cleanup could not be verified`, does
not show `Stopped` or `Recovered`, and provides manual inspection details.

### LR-SB-008: Termination links evidence

Given cleanup is verified, when the restricted environment closes, then the UI
confirms no new task effect may start and links the cleanup evidence.

## Durable command phases

### LR-CMD-001: Preflight dispatches nothing

Given a command is reviewing requirements, when its phase is
`Reviewing requirements`, then no external dispatch is claimed or attempted.

### LR-CMD-002: Missing access has a distinct phase

Given preflight passes without a current capability grant, when the command
advances, then its phase is `Waiting for access` and no approval or effect is
implied.

### LR-CMD-003: Waiting approval preserves accepted state

Given a valid grant and pending approval, when command status is shown, then it
says `Waiting for approval` and accepted state remains unchanged.

### LR-CMD-004: Recording intent is not execution

Given the runtime is persisting command intent, when phase is
`Recording action intent`, then the UI does not claim the intent is durable or
the effect started.

### LR-CMD-005: Durable intent is not effect completion

Given command intent is durably recorded, when phase becomes
`Action intent recorded`, then the UI states no external effect is yet claimed.

### LR-CMD-006: Preparation revalidates authority

Given intent is recorded, when preparation runs, then expected-before hashes,
target authority, lease and claim fencing epochs, capability grant, approval
receipt, target revision, supported effect class, and environment health are
validated before dispatch.

### LR-CMD-007: Dispatch communicates uncertainty

Given the runtime hands a command to the restricted environment, when no
terminal evidence exists, then status says
`Action dispatched; outcome not yet known`.

### LR-CMD-008: Applying names possible partial effect

Given an approved operation is applying, when task details open, then the
interface names the active operation and does not promise atomic external
completion.

### LR-CMD-009: Verification precedes success

Given a command returns or expected output appears, when required checks are
still running, then status is `Verifying local result` and not `Succeeded`,
`Fixed`, or `Complete`.

### LR-CMD-010: Terminal claim waits for durable outcome

Given verification finishes, when terminal outcome persistence is pending,
then status is `Recording verified outcome` and the command remains
nonterminal.

### LR-CMD-011: Success remains scoped

Given the expected result is verified and the terminal outcome is durably
recorded, when status becomes `Verified operation completed`, then it names the
scoped operation and does not imply commit, push, deployment, or complete
product coverage.

### LR-CMD-012: Failure identifies the effect boundary

Given a command fails, when the failure is shown, then failed phase, reason,
last known effect boundary, possible partial effect, preserved state, and
available recovery action are visible.

### LR-CMD-013: Block is distinct from failure

Given an unmet prerequisite prevents dispatch or continuation, when status is
shown, then it is `Local action blocked`, names the blocker and owner, and does
not imply an attempted operation failed.

### LR-CMD-014: Unknown outcome cannot retry blindly

Given interruption leaves the external outcome unproven, when recovery opens,
then status is `Action outcome needs review`, automatic retry is unavailable,
and inspection or reconciliation is offered.

## Target effect outcomes

### LR-EFF-001: Applied target effect still requires verification

Given the target authority reports `applied`, when the effect outcome appears,
then it says `Target recorded the approved change`, shows the bounded
target-native receipt and resulting target identity, and does not call the
command complete before trusted verification.

### LR-EFF-002: Exact target replay applies no second change

Given the same idempotency key and action digest already have a target receipt,
when the request repeats, then status is
`Previous target receipt found; no new change applied`, the original receipt
and apply time are shown, and the flow continues to trusted verification
without invoking a second apply.

### LR-EFF-003: Not-applied requires target-authoritative evidence

Given the target authority proves its transaction did not commit and the
current target still matches the approved baseline, when the result appears,
then status is `Target confirmed no change was applied` and
`Review retry conditions` is available only after current grant, approval,
claim, and fence validation.

### LR-EFF-004: Adapter error defaults to outcome unknown

Given apply throws, rejects, times out, disconnects, returns malformed data, or
is interrupted without target-authoritative non-application evidence, when the
result appears, then status is
`Memi cannot yet prove whether the target changed`, automatic apply and retry
are unavailable, and `Check target record` is offered.

### LR-EFF-005: Exact committed replay returns the original result

Given a verified commit succeeded but its response was lost, when the exact
request repeats, then the original trace-bound commit receipt is returned,
status says `Previous verified result returned`, and no new target change or
trace event is claimed or created.

### LR-EFF-006: Changed digest is not exact replay

Given an idempotency key already belongs to another action digest, when a
request attempts to reuse it, then status is
`Repeated request does not match the recorded action`, the original receipt and
target remain unchanged, no operation applies, and `Create revised action` is
offered.

## Trusted target verification

### LR-VER-001: Verification names its authority

Given an effect needs verification, when verification starts, then status is
`Checking the authoritative target` and target, receipt, expected result, and
check start time are visible without a completion claim.

### LR-VER-002: Verified applied permits fenced commit

Given the exact target receipt exists and the authoritative current target hash
matches its resulting hash, when verification completes, then status is
`Approved change verified on target` and only the current fenced commit claim
may record trace and commit.

### LR-VER-003: Verified not-applied permits only a fenced retry

Given no target receipt exists and the authoritative target still matches the
expected-before hash, when verification completes, then status is
`Target verified unchanged`; retry remains separately confirmed and requires a
newly valid worker claim plus active target fence.

### LR-VER-004: Verification mismatch blocks commit and reapply

Given a receipt or current target differs from the expected identity or hash,
when verification completes, then status is
`Target no longer matches the recorded change`, receipt and current evidence
remain inspectable, commit and reapply are unavailable, and
`Inspect target changes` is offered.

### LR-VER-005: Unavailable verification preserves effect evidence

Given the target authority cannot currently prove the result, when
verification completes, then status is `Target verification unavailable`,
existing effect evidence is preserved, completion and reapply are unavailable,
and only `Retry verification` or `Stop task` is offered.

### LR-VER-006: Corrupt target evidence is quarantined

Given receipt, ledger, or target integrity validation fails, when verification
completes, then status is `Target evidence could not be verified`, unverified
evidence is quarantined, apply, verification-based commit, replay, and restore
from it are disabled, and `Open recovery details` plus `Export trace` are
available.

## Collaboration and trace

### LR-COLLAB-001: Task card exposes the proven effect boundary

Given any target effect is active or blocked, when its task card is read, then
task, target, current owner, last durable phase and time, proven effect
boundary, current coordination owner, and recommended next action are visible
without opening raw logs.

### LR-COLLAB-002: Actors and authorities remain distinct

Given a flow contains human approval, harness request, runtime dispatch, target
result, verification, fence rejection, claim takeover, or recovery, when trace
is read, then each event names its actual actor and does not attribute target
evidence or runtime authority to the harness.

### LR-COLLAB-003: Blocked collaboration preserves evidence and ownership

Given stale baseline, fenced owner, verification mismatch, unavailable
verification, corrupt evidence, or outcome unknown blocks collaboration, when
details open, then proposal, available receipt, target, previous and current
owner, proven effect boundary, and recovery action remain inspectable.

### LR-COLLAB-004: Exact replay points to one original effect

Given an exact request returns a prior receipt, when trace and task details are
read, then they link the original effect and commit events; any new read-only
recovery observation is not presented as another target effect or committed
change.

## Authoritative project history

### LR-TRACE-001: Verified effect remains uncommitted while history is pending

Given trusted target verification is `verified-applied`, when the authoritative
SQLite history transaction has not committed, then status is
`Recording verified result in project history`, the effect remains
verified-applied, and no canonical event identity or committed command state is
shown.

### LR-TRACE-002: Canonical history commit is one authoritative transaction

Given the current fenced claim and authoritative records match, when the
SQLite transaction commits the event, effect binding, final receipt, recovery
decision when present, projection intent, and outbox transition, then status is
`Verified result committed to project history` and JSONL projection health is
shown separately.

### LR-TRACE-003: Exact history commit replay allocates nothing new

Given the committed response was lost, when the exact command and outbox
binding repeats, then status is `Previous project-history commit returned`,
the original event identity and receipt are returned, and no new event ID,
sequence, or timestamp is allocated, no new projection intent is created, and
no duplicate JSONL line is appended.

### LR-TRACE-004: Changed commit binding preserves the original history

Given an existing command or outbox binding differs by action digest, target
receipt, verification evidence, resulting hash, event family, lease fence, or
claim, when commit is attempted, then status is
`Recorded project history does not match this request`, the original event and
project head remain unchanged, and `Inspect history binding` is offered.

### LR-TRACE-005: Interrupted SQLite commit accepts no partial history

Given the process stops before the SQLite history transaction commits, when the
project reopens, then event, trace head, effect binding, projection intent,
final receipt, and outbox transition are all absent from accepted history,
status is `Verified result is waiting for history recovery`, and the
verified-applied target effect remains visible.

### LR-TRACE-006: SQLite corruption blocks recovery

Given a committed outbox references missing, altered, or unverifiable canonical
SQLite history, when startup or recovery checks run, then status is
`Project history database could not be verified`, trace commit, runtime
recovery, replay, and projection rebuild are blocked, SQLite and JSONL are
preserved as evidence, and JSONL is not promoted automatically.

### LR-TRACE-007: Event identity belongs only to project history authority

Given a caller, harness, adapter, or imported payload supplies event ID,
sequence, occurrence time, previous hash, event hash, or arbitrary trace
payload, when commit is prepared, then those fields are rejected or ignored,
no editable identity control appears, and accepted event details say
`Allocated by authoritative project history`.

## History export projection

### LR-PROJ-001: Pending projection does not uncommit an effect

Given canonical SQLite history committed and its JSONL projection is pending,
when task and trace status appear, then the effect remains committed, status is
`History export update pending`, and authoritative committed-through and
export-through sequences are visible.

### LR-PROJ-002: Projecting is a derived-file operation

Given a projector owns the current project-scoped claim, when JSONL update
starts, then status is `Updating history export`, sequence range, attempt, and
claim are visible, and projection is not presented as another effect or commit.

### LR-PROJ-003: Projected state includes integrity evidence

Given JSONL contains the exact canonical ordered prefix and file plus directory
durability checks pass through the current authoritative project head, when
projection completes, then status is `History export current` and
exported-through sequence, byte count, content hash, and check time are visible.

### LR-PROJ-004: Projection failure preserves canonical commit

Given JSONL write, rename, file synchronization, or directory synchronization
fails, when projection stops, then status is
`History export update failed`, the committed effect and canonical trace remain
committed and readable, and `Retry history export` is offered.

### LR-PROJ-005: Projection lag is operational debt only

Given one or more canonical events have not reached JSONL, when export health is
shown, then it says `History export is behind by [count] events`, names the
oldest pending sequence, and states `Committed effects are unchanged`.

### LR-PROJ-006: Missing JSONL can be rebuilt

Given the JSONL file is missing while SQLite history passes integrity checks,
when trace opens, then status is
`History export missing; project history remains available`, canonical history
is readable, and `Rebuild history export` is offered.

### LR-PROJ-007: Invalid JSONL is quarantined, not promoted

Given JSONL has a partial final line, missing, extra, duplicate, reordered, or
altered line, wrong project, hash mismatch, or invalid schema, when
reconciliation runs, then status is
`History export quarantined; project history remains available`, the derived
file is preserved with its exact reason, canonical project history remains
available when SQLite is healthy, and the file is unavailable for export
validation or runtime recovery.

### LR-PROJ-008: Rebuild reads only canonical SQLite history

Given a missing or quarantined JSONL projection and verified SQLite authority,
when rebuild starts, then status is
`Rebuilding history export from project history`, project and sequence progress
are shown, and no target, task, accepted state, canonical trace, process, Git,
network, or harness action occurs.

### LR-PROJ-009: Rebuilt export is verified before current

Given replacement JSONL is fully written, synchronized, atomically renamed,
and checked against SQLite, when rebuild completes, then status is
`History export rebuilt and verified`, replacement path, exported-through
sequence, content hash, and retained quarantine evidence are visible.

### LR-PROJ-010: Lost projection acknowledgement does not duplicate a line

Given an exact complete JSONL line was written but its projected-state
acknowledgement was lost, when reconciliation runs, then the existing line is
verified and marked projected without appending it again.

## Pure history replay

### LR-REPLAY-001: Replay validates its source first

Given a person requests replay, when validation begins, then status is
`Validating history for read-only replay`, source, project, event count, schema,
sequence, action-digest, previous-hash, and event-hash checks are visible, and
no external boundary is invoked.

### LR-REPLAY-002: Ready replay states its read-only consequence

Given the selected history source passes validation, when replay becomes ready,
then the interface states that replay calculates derived state only and will
not call targets, processes, Git, network, harnesses, current-state mutation,
or projection writes.

### LR-REPLAY-003: Running replay cannot rerun effects

Given replay is running, when an event contains effect-like data, then status
remains `Replaying history without external actions`, deterministic event
progress is visible, and no target or external service is invoked.

### LR-REPLAY-004: Completed replay does not claim current verification

Given every validated event reduces successfully, when replay completes, then
status is `Read-only replay completed`, event count and resulting state hash
are visible, and current target verification or accepted-state mutation is not
claimed.

### LR-REPLAY-005: Invalid history blocks before state reduction

Given replay source has wrong project, unsupported schema, noncontiguous
sequence, action-digest mismatch, previous-hash mismatch, or event-hash
mismatch, when validation runs, then status is
`Replay blocked by history integrity check`, no state is reduced or external
boundary invoked, and `Open integrity details` is offered.

### LR-REPLAY-006: JSONL replay is explicit export validation

Given JSONL is selected instead of default SQLite history, when replay opens,
then mode is `Validate exported history`, the UI says
`Validating exported history; not using it as authority`, strict integrity
checks precede replay, and results cannot repair or replace SQLite.

## Pause and stop

### LR-CTL-001: Pausing waits for a confirmed boundary

Given a task has an active operation, when the user activates `Pause`, then no
new operation is scheduled, interruption is requested when supported, and
status remains `Pausing at a confirmed scheduling boundary` until confirmed.

### LR-CTL-002: Paused state preserves resumable context

Given the scheduling boundary is confirmed, when status becomes `Task paused`,
then no new effect can dispatch and goal, context, accepted artifacts, grant
state, trace, and last durable phase remain inspectable.

### LR-CTL-003: Stop checks possible completed effects

Given the user activates `Stop task`, when stop is in progress, then future
dispatch is blocked, task-scoped access is revoked, cancellation and process
cleanup are requested, and the UI names any effect that may already exist.

### LR-CTL-004: Stopped is an earned terminal state

Given future dispatch is blocked and supervised descendants plus temporary
resources are verified closed, when stop completes, then status is
`Task stopped`, completed local effects remain visible, and trace records stop.

### LR-CTL-005: Incomplete stop fails closed

Given cleanup cannot be verified, when stopping ends, then status becomes
`Task blocked during cleanup`, not `Stopped`, and a manual recovery action is
available.

## Crash and interruption recovery

### LR-REC-001: Runtime loss does not erase command state

Given the runtime disconnects during a task, when the client remains open, then
the last durable command phase, task context, accepted artifacts, and trace
remain visible while new runtime effects are disabled.

### LR-REC-002: Restart begins reconciliation, not resume

Given the runtime restarts with unfinished intent or outbox state, when the
project reconnects, then it shows `Checking interrupted work`, names the last
durable phase, and does not redispatch an external effect automatically.

### LR-REC-003: Required restart explains preservation

Given runtime health requires restart, when the prompt appears, then it names
the cause, what durable work remains, what in-memory progress may be lost, and
offers `Restart runtime` plus `Open recovery details`.

### LR-REC-004: Resume names the verified boundary

Given reconciliation proves a verified resumable boundary, when recovery
completes, then the user sees the exact next phase and must activate
`Resume from [phase]`; scope cannot exceed the current grant.

### LR-REC-005: Possible apply resumes at verification

Given evidence indicates an effect may already have applied but verification
did not finish, when recovery resolves, then reapply is unavailable and the
actions are `Verify existing result`, `Inspect changes`, or `Stop`.

### LR-REC-006: Unknown outcome requires human review

Given reconciliation cannot establish whether an external effect occurred,
when recovery resolves, then the action remains blocked, known evidence and
unknowns are listed, and automatic retry and completion claims are unavailable.

### LR-REC-007: Recovered state is evidence-backed

Given an interrupted action is reconciled, when status becomes
`Interrupted action reconciled`, then the evidence-backed outcome and recovery
event are durable and task completion still requires its own verification and
checkpoint.

### LR-REC-008: Corrupt recovery record fails closed

Given saved runtime state fails schema, integrity, or hash validation, when it
is opened, then apply, commit, replay, and restore from that record are
disabled, bytes are preserved, and trace export plus recovery escalation are
offered.

### LR-REC-009: Recovery lookup precedes another apply

Given an intent was previously claimed or dispatch may have started, when
recovery begins, then the platform-owned target ledger is checked before apply
is considered and the UI says `Checking the target record before retry`.

### LR-REC-010: Recovery reuses an exact receipt without reapply

Given recovery lookup finds the exact command and action-digest receipt, when
reconciliation continues, then status is
`Existing result reconciled; no new change applied`, the original receipt is
bound to recovery, and only trusted verification runs next.

### LR-REC-011: Claim takeover fences the former recorder

Given an interrupted or expired worker claim is replaced, when recovery
continues, then status is `Reassigning interrupted result check`, the former
worker cannot verify, append trace, or commit, and the new claimant checks the
target before continuing.

## Leases and writer conflicts

### LR-LEASE-001: Active lease is inspectable

Given a writer holds the current editing lease, when lease details open, then
target, owner, acquired time, expiry, and fencing epoch are visible.

### LR-LEASE-002: Stale lease applies nothing

Given a lease expires before effect-boundary validation, when apply is
attempted, then nothing further is applied, prior epoch cannot be reused, and
`Check and acquire new lease` is offered.

### LR-LEASE-003: Current writer conflict stays read-only

Given another current writer owns the target, when a conflicting action is
prepared, then it is blocked, permitted owner and expiry details are shown,
evidence remains readable, and force takeover is not the default action.

### LR-LEASE-004: Reacquisition advances fencing

Given a stale lease may be replaced, when reacquisition begins, then previous
writer inactivity is checked and dispatch remains disabled until a new fencing
epoch is durably allocated.

### LR-LEASE-005: Pending fence cannot dispatch

Given SQLite allocates a pending lease epoch, when target activation is not yet
acknowledged, then status is `Securing the current editing turn`, apply remains
disabled, and the lease is not described as active.

### LR-LEASE-006: New fence blocks a late old writer at target

Given the target authority activates a newer fencing epoch while an older
worker is paused, when that worker later attempts apply, then the target rejects
it, status says `Previous editing turn blocked at target`, and the attempt
remains visible in trace without becoming the current result.

### LR-LEASE-007: Active worker claim is inspectable

Given a worker owns the current result-recording claim, when collaboration
details open, then worker identity, command phase, claim expiry, and claim
fencing epoch are visible.

### LR-LEASE-008: Stale worker cannot record authority

Given a worker claim expires or is taken over, when the old worker later
responds, then it cannot verify, append trace, or commit and status is
`Previous result recording claim is stale`.

### LR-LEASE-009: Fenced claim preserves the current owner

Given a stale claimant attempts a late verification or commit, when the runtime
rejects it, then status says `Previous result recorder blocked`, current
recovery ownership remains visible, and no duplicate trace or commit is added.

### LR-LEASE-010: Interrupted fence activation remains pending

Given the runtime crashes after allocating or advancing a pending target fence
but before lease activation is durably acknowledged, when recovery starts, then
status is `Finishing editing-turn recovery`, only the exact fence-activation
handshake repeats, dispatch remains disabled, and the older epoch is never
reused.

## Blocked actions

### LR-BLK-001: Missing capability points to access review

Given a named capability is missing, when an action is blocked, then the UI
states what was prevented and provides `Review access request`.

### LR-BLK-002: Invalid approval points to current diff

Given approval no longer matches the action, when it is blocked, then the
changed binding is named and `Review updated diff` is offered.

### LR-BLK-003: Stale lease points to guarded reacquisition

Given the previous lease is stale, when the action is blocked, then the previous
owner and expiry are visible and reacquisition does not reuse the prior epoch.

### LR-BLK-004: Revision mismatch points to a new proposal

Given the target changed after preparation, when the action is blocked, then
the old and current revisions are shown and `Refresh proposal` creates a new
authorization path.

### LR-BLK-005: Runtime unavailability stops new effects

Given the local runtime is unavailable, when a runtime-dependent action is
attempted, then no new effect starts and `Reconnect runtime` is offered.

### LR-BLK-006: Unverified environment blocks dispatch

Given a required environment control cannot be verified, when dispatch is
attempted, then the failed control is named and
`Retry environment check` is offered.

### LR-BLK-007: Unknown outcome points to reconciliation

Given Memi cannot prove whether an action took effect, when it is blocked, then
the interface names the possible effect boundary and offers
`Inspect and reconcile` instead of blind retry.

### LR-BLK-008: Cleanup failure names possible residue

Given cleanup cannot be verified, when the task is blocked, then possible
remaining process or resource, last check time, and `Open cleanup details` are
available.

### LR-BLK-009: Stale target baseline is a proven pre-effect block

Given the authoritative target hash changed after approval but before
compare-and-apply, when the target rejects the request, then the UI says
`The target changed after this action was approved. No operation from this
request was applied`, invalidates the approval, and offers
`Review target changes`.

### LR-BLK-010: Fenced owner remains a collaboration state

Given a newer lease or worker claim replaces an older owner, when the older
owner attempts to continue, then it is blocked, current owner and phase remain
visible, and `Open collaboration details` is offered without calling the task
failed.

### LR-BLK-011: Verification mismatch is recoverable but noncommittable

Given trusted verification reports a target or receipt mismatch, when the task
is blocked, then preserved evidence and the mismatch are visible, commit and
reapply remain unavailable, and `Inspect target changes` is offered.

### LR-BLK-012: Verification unavailable permits verification retry only

Given the target authority is temporarily unavailable, when the task is
blocked, then effect evidence remains visible, completion and reapply remain
unavailable, and the recommended action is `Retry verification`.

### LR-BLK-013: Corrupt target evidence fails closed

Given target receipt, ledger, or integrity evidence is corrupt, when the task
is blocked, then the evidence is quarantined, apply, commit, replay, and restore
from it remain unavailable, and `Open recovery details` is offered.

### LR-BLK-014: Process effects are rejected before dispatch

Given a task requests `sandbox.process` through a canvas or artifact target
adapter, when preflight validates the effect class, then it is blocked before
dispatch with `Process execution is not available through this target action`.

### LR-BLK-015: Source and Git effects cannot use canvas authority

Given a task requests an original-checkout write, worktree write, or Git effect
through a canvas or artifact target adapter, when preflight validates the
effect class, then it is blocked before filesystem mutation and the interface
states that no accepted source or Git authority exists for this action.

### LR-BLK-016: External effects require their own accepted authority

Given a task requests network, shell, package-manager, browser-authentication,
publish, or deployment work through the generic target contract, when preflight
validates the effect class, then it is rejected before external call and the UI
names the unsupported class.

### LR-BLK-017: Unsupported ambiguous effect stays outcome unknown

Given an unsupported effect was ambiguously dispatched by an older or
incompatible runtime, when recovery opens, then it remains
`This effect class has no accepted recovery authority, so Memi cannot prove its
outcome`, automatic retry and generic canvas or artifact lookup are unavailable,
and manual recovery steps are offered.

### LR-BLK-018: History binding conflict blocks a second commit

Given authoritative history already binds the command or outbox to another
digest or receipt, when commit is blocked, then the original event remains
canonical, the verified target effect remains visible, and
`Inspect history binding` is offered.

### LR-BLK-019: Authoritative history corruption blocks runtime recovery

Given SQLite history integrity fails, when recovery is blocked, then the UI
states `The project history database could not be verified. Runtime recovery is
blocked`, preserves SQLite and JSONL evidence, and offers
`Open recovery options` without treating JSONL as authority.

### LR-BLK-020: Replay integrity failure invokes nothing

Given history fails replay validation, when replay is blocked, then the failing
event or check is named, no state reduction or external boundary occurs, and
`Open integrity details` is offered.

## Retry and restore

### LR-RST-001: Restore is previewed

Given a previous checkpoint exists, when `Restore previous checkpoint` is
activated, then current versus checkpoint state, affected canvas objects or
worktree paths, conflicts, and external effects that will not be undone are
shown before confirmation.

### LR-RST-002: Unsafe restore applies nothing

Given restore has a conflict, missing artifact, invalid capability, or corrupt
checkpoint, when validation runs, then nothing is applied and the blocker plus
recovery owner is named.

### LR-RST-003: Restore preserves the previous checkpoint

Given a valid restore is confirmed, when it applies, then the previous
checkpoint remains available and target plus progress are visible.

### LR-RST-004: Restore requires verification

Given restore operations finish, when state hashes or required evidence remain
unchecked, then status is `Verifying restored state`, not `Restored` or
`Recovered`.

### LR-RST-005: Completed restore names exclusions

Given restored local state is verified and durably recorded, when completion is
shown, then prior and new checkpoints plus recovery trace are linked and
the interface restates which completed external effects were not undone.

### LR-RST-006: Failed restore preserves a recovery path

Given restore fails, when the failure appears, then the prior checkpoint is
preserved, the known effect boundary is named, and blind retry is unavailable.

### LR-RTRY-001: Retry is phase-scoped

Given an operation failed or was invalidated, when retry is offered, then its
label identifies `Retry check`, `Retry verification`, or `Retry action` and the
confirmation names the exact phase.

### LR-RTRY-002: Retry cannot duplicate an unknown effect

Given an external effect may already exist, when retry is considered, then
`Retry action` remains unavailable until trusted target lookup verifies no
prior effect, and current revision, action digest, idempotency result, grant,
approval, worker claim, lease, and target fencing checks pass.

### LR-RTRY-003: Revised action uses new authorization

Given scope, target, operation, or consequence must change, when the user
chooses `Create revised action`, then a new proposal, digest, grant review, and
approval path are created without overwriting prior trace.

## Keyboard, accessibility, and language

### LR-A11Y-001: Full runtime flow is keyboard operable

Given pointer input is unavailable, when a user operates runtime status,
preflight, capability, approval, pause, stop, blocked recovery, retry, and
restore, trace commit, history export, and replay, then every action and detail
is reachable and operable by keyboard.

### LR-A11Y-002: Focus follows dialogs predictably

Given a runtime modal or drawer opens, when it becomes active, then focus moves
to its heading; when it closes, focus returns to the invoker unless that
control no longer exists.

### LR-A11Y-003: Escape never authorizes an effect

Given a detail surface or confirmation is open, when the user presses `Escape`,
then non-destructive details may close but no grant, approval, pause, stop,
retry, restore, or unresolved alert is accepted or dismissed.

### LR-A11Y-004: Consequential confirmation defaults to cancel

Given an action can mutate, stop, retry, or restore, when confirmation opens,
then initial focus is on `Cancel` and pressing `Enter` from the trigger cannot
confirm it.

### LR-A11Y-005: Pause and stop are distinguishable

Given both controls are available, when assistive technology reads them, then
their accessible names and descriptions distinguish scheduling pause from
task termination and cleanup.

### LR-A11Y-006: Announcements are meaningful and bounded

Given status changes, when assistive technology is active, then stage changes
use a polite live region, urgent possible-write disconnection, invalidated
approval, cleanup failure, target-evidence corruption, and authoritative SQLite
history corruption use an assertive alert; projection lag, failure, and
quarantine remain polite, and high-frequency logs are not announced.

### LR-A11Y-007: State is not color-only

Given any preflight, grant, approval, environment, command, effect,
verification, lease, claim, trace commit, history projection, replay, or
recovery state, when viewed without color or motion, then equivalent text and
an accessible status remain available.

### LR-A11Y-008: Validation preserves input and locates failure

Given preflight or authorization submission fails, when the error appears, then
user input remains, focus moves to an error summary, and summary links reach
the failing fields or sections.

### LR-A11Y-009: Plain language precedes technical detail

Given a runtime error includes IDs, hashes, logs, or provider detail, when it is
shown, then a plain-language cause and next action appear first and technical
content is available in an expandable region.

### LR-LANG-001: Isolation is never overclaimed

Given environment health is shown, when checks pass, then wording names a
`restricted local environment` and checked controls without saying
`fully isolated`, `impenetrable`, `100% safe`, or equivalent.

### LR-LANG-002: Completion is never overclaimed

Given an action reaches any nonterminal phase, unknown outcome, cleanup
failure, or incomplete verification, when status is shown, then it is not
called stopped, recovered, successful, fixed, rolled back, or complete.

### LR-LANG-003: Scope accompanies authorization

Given a grant or approval is shown, when a user reads its summary, then exact
capability or change, target, expiry, and consequence are present rather than
an unqualified `Access granted` or `Approved`.

## Test mapping

| UI test suite | Required criteria |
|---|---|
| Runtime connection and preflight | LR-PF-001 through LR-PF-010 |
| Capability grant | LR-CG-001 through LR-CG-009 |
| Approval receipt | LR-AR-001 through LR-AR-008 |
| Restricted environment health | LR-SB-001 through LR-SB-008 |
| Durable command lifecycle | LR-CMD-001 through LR-CMD-014 |
| Target effect outcome and exact replay | LR-EFF-001 through LR-EFF-006 |
| Trusted target verification | LR-VER-001 through LR-VER-006 |
| Collaboration and trace | LR-COLLAB-001 through LR-COLLAB-004 |
| Authoritative project history | LR-TRACE-001 through LR-TRACE-007 |
| History export projection and rebuild | LR-PROJ-001 through LR-PROJ-010 |
| Pure history replay | LR-REPLAY-001 through LR-REPLAY-006 |
| Pause and stop | LR-CTL-001 through LR-CTL-005 |
| Crash recovery | LR-REC-001 through LR-REC-011 |
| Lease, claim, and fencing | LR-LEASE-001 through LR-LEASE-010 |
| Blocked action recovery and effect classes | LR-BLK-001 through LR-BLK-020 |
| Retry and restore | LR-RST-001 through LR-RST-006; LR-RTRY-001 through LR-RTRY-003 |
| Keyboard and accessibility | LR-A11Y-001 through LR-A11Y-009 |
| Truthful language | LR-LANG-001 through LR-LANG-003 |

No runtime UI suite passes by checking labels alone. It must also assert that
the disallowed action cannot dispatch or mutate state for each blocked,
expired, invalidated, stale, unknown, and unverified condition.
