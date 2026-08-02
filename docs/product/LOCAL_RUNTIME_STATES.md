# Local runtime user-visible state contract

- Status: Draft product contract; not sandbox approval
- Owner: Product Design
- Required reviewers: Product, Architecture, Runtime, AI Systems, Security,
  Accessibility, Data/Storage, and QA
- Related decisions: ADR 0002, ADR 0006, ADR 0008, ADR 0010,
  ADR 0011 (trace commit authority)

## Purpose

This contract defines what a person sees while Memi prepares, authorizes,
executes, pauses, stops, and recovers local work. It does not select a sandbox
technology or claim that the current implementation provides containment.

The interface must keep these concepts separate:

| Concept | What it means | What it does not mean |
|---|---|---|
| Capability grant | The runtime may attempt a named operation within a bounded scope | The operation was approved, started, or completed |
| Approval receipt | A person approved the displayed action digest and consequence | A broader capability, later revision, commit, push, or deploy is approved |
| Lease | One current writer may act on a target at a fencing epoch | The writer still owns the target after expiry or restart |
| Worker claim | One current worker may reconcile or commit one durable command phase | A stale worker may verify, append trace, or commit after takeover |
| Durable intent | The runtime recorded an operation before dispatch | The external effect occurred |
| Target baseline | The authoritative target hash an approved effect expects before apply | The target still matches after review or approval |
| Target receipt | The target authority recorded an applied or exactly replayed effect | The current target still matches that result |
| Verification | The runtime checked an expected result against evidence | Every product state is correct or the work was published |
| Authoritative project history | Canonical trace, effect binding, receipt, and outbox commit recorded together in runtime SQLite | A JSONL export line is authoritative or required for effect commit |
| History event identity | Event ID, sequence, time, and hash linkage allocated by the project history authority | A caller, harness, adapter, or JSONL file may choose canonical identity |
| History export | A replaceable JSONL projection of canonical project history | Deleting, lagging, or quarantining the export deletes or uncommits canonical history |
| Checkpoint | Accepted local state can be restored | External side effects will be undone |

## Persistent runtime status

Runtime status is available from every workspace and task. It is text, not
color alone, and contains a `View details` action.

| State key | User-visible label | Required message and actions | Test criteria |
|---|---|---|---|
| `runtime.disconnected` | `Local runtime disconnected` | `Saved canvas evidence remains available. Local files, commands, Git, and live capture are unavailable.` Actions: `Reconnect runtime`, `Open evidence only` | LR-PF-001, LR-REC-001 |
| `runtime.connecting` | `Connecting to local runtime` | Name the connection stage. `Cancel connection` remains available. Do not imply authentication before it succeeds. | LR-PF-002 |
| `runtime.ready_limited` | `Local runtime connected with limits` | Name every unavailable capability and affected task. Actions: `Review limits`, `Run preflight again` | LR-PF-003 |
| `runtime.ready` | `Local runtime connected` | Show runtime version, selected project boundary, and last health check. This label alone makes no sandbox or permission claim. | LR-PF-004 |
| `runtime.degraded` | `Local runtime needs attention` | Preserve readable evidence, disable affected effects, name the failing subsystem, and offer a scoped recovery action. | LR-SB-006 |
| `runtime.recovering` | `Checking interrupted work` | Show the command being reconciled and the last durable phase. No interrupted external action resumes silently. | LR-REC-002 |
| `runtime.restart_required` | `Restart local runtime` | Explain why restart is required and what saved work will remain. Actions: `Restart runtime`, `Open recovery details` | LR-REC-003 |

`Connected` means only that the authenticated local client-to-runtime channel
is available. It must not be rendered as `Safe`, `Isolated`, or `Ready to
write`.

## Action preflight

Every runnable local action enters `preflight.review` before capability or
approval. The review is a single keyboard-navigable surface with these sections
in this order:

1. **Action**: plain-language goal, exact operations, and consequence.
2. **Target**: project name, canonical project boundary, baseline revision,
   affected paths or canvas objects, and destination.
3. **Execution**: named harness and model when applicable; executable and
   argument list; working directory; expected outputs.
4. **Runtime access**: filesystem mounts and read/write mode, network rule,
   named secret access, process limits, and device or IPC access.
5. **Safety state**: supported effect class, target authority, sandbox control
   checks, current lease and worker-claim state, expected-before hashes, and
   known limitations.
6. **Recovery**: checkpoint, retry boundary, cleanup expectation, and operations
   that restore cannot undo.
7. **Authorization**: capability grant requested, separate approval required,
   expiry, maximum uses, and any separately gated follow-up.

Preflight outcomes:

| State key | Label | Behavior | Test criteria |
|---|---|---|---|
| `preflight.checking` | `Checking local requirements` | Report the current deterministic check; do not show a percentage unless the denominator is known. | LR-PF-005 |
| `preflight.review` | `Review local action` | Nothing has started. Primary action names the consequence, such as `Request workspace-write access`. | LR-PF-006 |
| `preflight.partial` | `Preflight completed with limits` | List passed, unavailable, and unverified checks separately. Only actions whose requirements passed may continue. | LR-PF-007 |
| `preflight.blocked` | `Action cannot start` | Name the failed requirement, recovery owner, preserved work, and next action. | LR-PF-008 |
| `preflight.changed` | `Review updated action` | Highlight the changed scope and invalidate the prior authorization path. | LR-PF-009 |
| `preflight.passed` | `Preflight checks passed` | State that requirements were checked, not that the action is safe or complete. Continue to grant and approval. | LR-PF-010 |

When M0 uses fixture-backed behavior, the surface instead says
`Demo: no live local command will run`.

## Capability grant states

A capability grant is closed, project-scoped, action-bound, expiring, and
usage-limited. The grant detail always shows:

- capability name and plain-language consequence;
- exact project, targets, and destination;
- read/write mode and prohibited access;
- network and secret access, including `None`;
- issuer, recipient task and harness, issued time, expiry, and uses remaining;
- revoke action and separately gated follow-up actions.

| State key | Label | Behavior | Test criteria |
|---|---|---|---|
| `grant.not_requested` | `Access not requested` | No privileged operation is available. | LR-CG-001 |
| `grant.requested` | `Access requested` | Show exact requested scope. `Grant access` and `Deny` are distinct actions. | LR-CG-002 |
| `grant.granted` | `Access granted for this action` | Show expiry and uses remaining. Do not start an approval-gated effect. | LR-CG-003 |
| `grant.narrowed` | `Access narrowed` | Show removed capabilities. Resume may continue only within the narrower scope. | LR-CG-004 |
| `grant.denied` | `Access denied` | Apply nothing. Preserve the task and offer scope revision or stop. | LR-CG-005 |
| `grant.expired` | `Access expired` | Block dispatch and require a new request against current state. | LR-CG-006 |
| `grant.revoked` | `Access revoked` | Prevent future dispatch, request cancellation of interruptible work, and preserve trace. | LR-CG-007 |
| `grant.exhausted` | `Access use limit reached` | Do not silently renew. Require a new bounded grant. | LR-CG-008 |
| `grant.invalidated` | `Access no longer matches this action` | Name the target, revision, harness, or scope change and require new review. | LR-CG-009 |

`Canvas write`, `Workspace write`, Git commit, Git push, pull request,
deployment, external publication, payments, destructive remote actions, and
credential access are separate capabilities.

## Approval receipt states

Approval is requested only after a proposal and action digest exist. The review
shows requester, approver, exact operations, diff or object changes, project,
baseline revision, target paths, capability set, consequence, verification
plan, expiry, and maximum uses.

| State key | Label | Behavior | Test criteria |
|---|---|---|---|
| `approval.not_required` | `No change approval required` | Explain why the action is read-only. A capability may still be required. | LR-AR-001 |
| `approval.requested` | `Approval required` | Nothing is applied. Actions: `Approve selected operations`, `Reject`, `Inspect details`. | LR-AR-002 |
| `approval.approved` | `Approved for this exact change` | Show immutable receipt ID, digest, scope, expiry, and use count. | LR-AR-003 |
| `approval.partial` | `Selected operations approved` | List approved and excluded operations. Recalculate verification scope. | LR-AR-004 |
| `approval.rejected` | `Change rejected` | Apply nothing. Preserve proposal and optional feedback. | LR-AR-005 |
| `approval.expired` | `Approval expired` | Apply nothing. Require current diff and new approval. | LR-AR-006 |
| `approval.invalidated` | `Approval no longer matches the target` | Show the revision or operation mismatch. Apply nothing further. | LR-AR-007 |
| `approval.consumed` | `Approval used` | Link to the one command outcome. Reuse is permitted only when uses remain and every bound value is still current. | LR-AR-008 |

## Sandbox health states

Product wording refers to a `restricted local environment`, not an
`impenetrable`, `fully isolated`, or `safe sandbox`. Health details expose the
controls that were checked and those that remain unverified.

| State key | Label | Behavior | Test criteria |
|---|---|---|---|
| `sandbox.unavailable` | `Restricted environment unavailable` | Disable command execution. Name the missing or unapproved control. | LR-SB-001 |
| `sandbox.preparing` | `Preparing restricted environment` | Show mounts, network policy, and resource-policy checks as pending, passed, failed, or unverified. | LR-SB-002 |
| `sandbox.ready` | `Restricted environment ready` | Show the exact checked controls and check time. Do not generalize to host safety. | LR-SB-003 |
| `sandbox.active` | `Local action running in restricted environment` | Show current command phase, budgets, and `Pause` or `Stop` availability. | LR-SB-004 |
| `sandbox.cleanup` | `Cleaning up local processes` | Keep the task nonterminal until descendant termination and temporary-resource cleanup are checked. | LR-SB-005 |
| `sandbox.degraded` | `Restricted environment check failed` | Block new effects, name the failed control, and offer `Retry environment check` or `Stop task`. | LR-SB-006 |
| `sandbox.cleanup_failed` | `Cleanup could not be verified` | Do not show `Stopped` or `Recovered`. Identify possible remaining process or resource and give a manual inspection path. | LR-SB-007 |
| `sandbox.terminated` | `Restricted environment closed` | Confirm no new task effects may start and link cleanup evidence. | LR-SB-008 |

## Durable command phases

The command detail shows one phase, last durable update time, target, actor,
harness, grant, approval receipt when required, lease, worker claim, and trace
link.

| Phase key | User-visible label | Exact claim permitted | Test criteria |
|---|---|---|---|
| `command.preflight` | `Reviewing requirements` | No command was dispatched. | LR-CMD-001 |
| `command.awaiting_grant` | `Waiting for access` | The command lacks a current capability grant. | LR-CMD-002 |
| `command.awaiting_approval` | `Waiting for approval` | The proposed effect is not authorized. | LR-CMD-003 |
| `command.recording_intent` | `Recording action intent` | The runtime is attempting to persist the intent. No external effect is claimed. | LR-CMD-004 |
| `command.intent_recorded` | `Action intent recorded` | Durable intent exists. The effect is not claimed to have started. | LR-CMD-005 |
| `command.preparing` | `Preparing local action` | Hashes, lease, fencing epoch, grant, receipt, and environment are being checked. | LR-CMD-006 |
| `command.dispatched` | `Action dispatched; outcome not yet known` | The runtime handed the command to the restricted environment. | LR-CMD-007 |
| `command.applying` | `Applying approved operation` | The approved effect may be in progress. Partial external effects are possible until verified. | LR-CMD-008 |
| `command.verifying` | `Verifying local result` | The command returned or evidence appeared; success is not yet established. | LR-CMD-009 |
| `command.recording_outcome` | `Recording verified outcome` | Verification finished; the durable terminal record is still pending. | LR-CMD-010 |
| `command.succeeded` | `Verified operation completed` | The scoped expected result was verified and its terminal outcome recorded. It does not imply commit, push, deploy, or complete product coverage. | LR-CMD-011 |
| `command.failed` | `Local action failed` | Name the failed phase and known effect boundary. Preserve prior valid state and evidence. | LR-CMD-012 |
| `command.blocked` | `Local action blocked` | Name the blocker, recovery owner, and actions that remain unavailable. | LR-CMD-013 |
| `command.outcome_unknown` | `Action outcome needs review` | Never relabel as failed or retry automatically. Offer inspection and reconciliation. | LR-CMD-014 |

The UI never says `exactly once`. It may say `A repeated identical request
returns the previously recorded result` only when that result was found and its
action digest matched.

## Target effect outcomes

An adapter error, timeout, disconnect, malformed response, or interruption is
not proof that the effect did not apply. The outcome surface shows which
authority produced the result, whether a new target operation occurred, and
what may happen next.

| State key | User-visible label | Required behavior | Test criteria |
|---|---|---|---|
| `effect.applied` | `Target recorded the approved change` | Show the target-native receipt, resulting target identity, and `Verification required`. Do not call the command complete yet. | LR-EFF-001 |
| `effect.replayed` | `Previous target receipt found; no new change applied` | Show original receipt and apply time, repeated request time, matching action digest, and that trusted verification still follows. | LR-EFF-002 |
| `effect.not_applied` | `Target confirmed no change was applied` | Use only with target-authoritative non-application evidence. Show unchanged baseline and `Review retry conditions` when current grant, approval, claim, and fence can be revalidated. | LR-EFF-003 |
| `effect.outcome_unknown` | `Memi cannot yet prove whether the target changed` | Block automatic apply and retry. Preserve available evidence and offer `Check target record`, `Inspect target`, or `Stop task`. | LR-EFF-004 |
| `effect.committed_replay` | `Previous verified result returned` | Show the original trace-bound commit receipt and state `No new target change or trace event was created.` | LR-EFF-005 |
| `effect.replay_conflict` | `Repeated request does not match the recorded action` | Preserve the original receipt and target, apply nothing, name the action-digest mismatch, and offer `Create revised action`. | LR-EFF-006 |

`Previous target receipt found` never means `Applied again`. Exact replay may
return a prior receipt, but Memi never describes cross-store delivery as
exactly once.

## Trusted verification states

Verification uses the platform-owned target authority. Harness output,
caller-supplied hashes, screenshots, and trace IDs may be shown as context but
cannot establish these states.

| State key | User-visible label | Required behavior | Test criteria |
|---|---|---|---|
| `verification.checking` | `Checking the authoritative target` | Show target, receipt, expected result, and check start time. No completion claim. | LR-VER-001 |
| `verification.applied` | `Approved change verified on target` | Show matching receipt and current target evidence. The command may proceed to its fenced durable commit. | LR-VER-002 |
| `verification.not_applied` | `Target verified unchanged` | Show that no receipt exists and the authoritative target still matches the approved baseline. Offer a separately confirmed fenced retry when eligible. | LR-VER-003 |
| `verification.mismatch` | `Target no longer matches the recorded change` | Preserve receipt and current target evidence, block commit and reapply, and offer `Inspect target changes` or `Create revised action`. | LR-VER-004 |
| `verification.unavailable` | `Target verification unavailable` | Preserve effect evidence, block completion and reapply, and offer `Retry verification` or `Stop task`. | LR-VER-005 |
| `verification.corrupt` | `Target evidence could not be verified` | Quarantine the unverified receipt or ledger evidence; block apply, verification-based commit, replay, and restore from it. Offer `Open recovery details` and `Export trace`. | LR-VER-006 |

Verification mismatch, unavailable verification, and corrupt evidence are
blocked collaboration states, not failed changes and not permission to apply
again.

## Collaboration and trace presentation

Every target-effect card keeps the following visible without opening raw logs:

- current human task and affected target;
- current owner: human, harness, runtime worker, or target authority;
- last durable phase and update time;
- last proven effect boundary: `Not dispatched`, `Not applied`, `May be
  applied`, `Applied receipt found`, or `Verified`;
- current lease or recovery owner when coordination is blocked; and
- the recommended next human or system action. (LR-COLLAB-001)

Trace renders human approval, harness request, runtime dispatch, target result,
verification, fence rejection, claim takeover, and recovery as distinct actors
and events. It does not attribute target evidence to the harness.
(LR-COLLAB-002)

Stale baseline, fenced owner, mismatch, unavailable, corrupt, and
outcome-unknown states preserve the proposal, receipt or attempted receipt,
target identity, owner transition, and recovery action. Their technical details
include command, outbox, action digest, lease fence, worker-claim fence, and
evidence identifiers when available. (LR-COLLAB-003)

Exact replay links to the original receipt and trace event. The repeated request
may append a read-only recovery observation when required by policy, but it
cannot present that observation as another target effect or another committed
change. (LR-COLLAB-004)

## Authoritative project history states

Runtime SQLite is the sole authority for canonical history events, project
history order, verified effect bindings, effect receipts, outbox commit state,
recovery decisions, and history-export intents. User-facing surfaces call this
`authoritative project history`; technical details name `Runtime SQLite WAL`.

| State key | User-visible label | Required behavior | Test criteria |
|---|---|---|---|
| `trace.commit_pending` | `Recording verified result in project history` | The target effect remains verified-applied but not committed. Show the current commit claim and that no authoritative history event exists yet. | LR-TRACE-001 |
| `trace.committed` | `Verified result committed to project history` | Show the authority-allocated event identity, effect receipt, project sequence, and commit time. JSONL projection state is shown separately. | LR-TRACE-002 |
| `trace.commit_replayed` | `Previous project-history commit returned` | Return the original event and receipt. State `No duplicate event identity, sequence, projection intent, or history-export line was created.` | LR-TRACE-003 |
| `trace.commit_conflict` | `Recorded project history does not match this request` | Preserve the existing event and receipt, keep the verified effect visible, block a second commit, and offer `Inspect history binding`. | LR-TRACE-004 |
| `trace.commit_interrupted` | `Verified result is waiting for history recovery` | When the SQLite transaction did not commit, show no accepted event identity and keep the effect at verified-applied. Offer `Retry history commit` only after current claim and binding checks. | LR-TRACE-005 |
| `trace.authority_corrupt` | `Project history database could not be verified` | Block trace commit, runtime recovery, replay, and projection rebuild. Preserve SQLite and JSONL as evidence; never promote JSONL automatically. Offer `Open recovery options`. | LR-TRACE-006 |

Canonical event details show event ID, project sequence, authoritative occurrence
time, previous-event hash, event hash, event action digest, and bound command,
outbox, target, target receipt, verification evidence, lease fence, and commit
claim. Each identity field is labeled
`Allocated by authoritative project history`. There is no editable or
caller-provided event-identity field. (LR-TRACE-007)

An event is not authoritative unless its event row, effect binding, final
effect receipt, and outbox transition committed in the same SQLite transaction.
A committed effect does not become uncommitted because its history export is
pending, lagging, failed, missing, or quarantined.

## History export projection states

JSONL is presented as `History export (JSONL)`. It is useful for inspection,
portable export, and offline integrity checks, but it is derived and
replaceable.

| State key | User-visible label | Required behavior | Test criteria |
|---|---|---|---|
| `projection.pending` | `History export update pending` | Show the authoritative committed-through sequence and export-through sequence. The effect remains committed. | LR-PROJ-001 |
| `projection.projecting` | `Updating history export` | Show the project, sequence range, attempt, and current projector claim. Do not present projection as another effect or commit. | LR-PROJ-002 |
| `projection.projected` | `History export current` | Show only when exported-through equals the current authoritative head. Include sequence, byte count, content hash, and check time. | LR-PROJ-003 |
| `projection.failed` | `History export update failed` | Preserve the committed effect and canonical trace. Show the file or directory durability failure and offer `Retry history export`. | LR-PROJ-004 |
| `projection.lagging` | `History export is behind by [count] events` | Keep canonical history readable, name the oldest pending sequence, and state `Committed effects are unchanged.` | LR-PROJ-005 |
| `projection.missing` | `History export missing; project history remains available` | Offer `Rebuild history export` from SQLite. Do not call canonical history missing. | LR-PROJ-006 |
| `projection.quarantined` | `History export quarantined; project history remains available` | Preserve the derived file, name the integrity reason, and prevent export validation from using it. Offer `Review rebuild` when SQLite remains healthy. | LR-PROJ-007 |
| `projection.rebuilding` | `Rebuilding history export from project history` | Show authoritative source, project, sequence progress, and replacement-file stage. Do not mutate target, task, or canonical trace state. | LR-PROJ-008 |
| `projection.rebuilt` | `History export rebuilt and verified` | Show replacement path, exported-through sequence, content hash, and retained quarantine evidence. | LR-PROJ-009 |

Quarantine reasons are user-visible and closed:

- partial final line;
- missing or extra line;
- duplicate or reordered line;
- event, action-digest, previous-hash, or content-hash mismatch;
- wrong project identity; or
- invalid or unsupported schema.

An exact complete line found after a lost projector acknowledgement is marked
projected without appending it again. Rebuild writes only canonical SQLite
event JSON in project-sequence order and never repairs or replaces SQLite from
JSONL. (LR-PROJ-010)

## Pure history replay states

Project replay reads canonical SQLite order by default. JSONL replay is an
explicit `Validate exported history` mode, not a runtime recovery authority.

| State key | User-visible label | Required behavior | Test criteria |
|---|---|---|---|
| `replay.validating` | `Validating history for read-only replay` | Show source, project, event count, schema, sequence, digest, and hash-chain checks. Invoke no external boundary. | LR-REPLAY-001 |
| `replay.ready` | `History ready for read-only replay` | State that replay will calculate derived state only and will not call targets, processes, Git, network, harnesses, or projection writes. | LR-REPLAY-002 |
| `replay.running` | `Replaying history without external actions` | Show deterministic event progress and source. Pause or cancel affects replay only. | LR-REPLAY-003 |
| `replay.completed` | `Read-only replay completed` | Show event count and resulting state hash without claiming current target verification or changing accepted state. | LR-REPLAY-004 |
| `replay.blocked` | `Replay blocked by history integrity check` | Apply nothing, invoke nothing external, name the failing event or check, and offer `Open integrity details`. | LR-REPLAY-005 |
| `replay.export_validation` | `Validating exported history; not using it as authority` | Require strict project, schema, contiguous sequence, digest, previous-hash, and event-hash validation before replay. | LR-REPLAY-006 |

Replay never invokes a target adapter, process, Git, network, harness,
current-state mutation, or history-export write. It never converts a JSONL
export into authoritative recovery state.

## Pause and stop

### Pause

`Pause` means “stop scheduling new operations and request interruption of the
current interruptible operation.”

| State key | Label | Required behavior | Test criteria |
|---|---|---|---|
| `control.pausing` | `Pausing at a confirmed scheduling boundary` | Disable duplicate pause requests, show whether the active operation can be interrupted, and keep `Stop` available. | LR-CTL-001 |
| `control.paused` | `Task paused` | Confirm no new operation will dispatch. Preserve context, accepted artifacts, grant state, trace, and last durable phase. | LR-CTL-002 |

If the active operation cannot be interrupted, say
`The current operation may finish before pause takes effect`. Never show
`Paused` until the runtime confirms the scheduling boundary.

### Stop

`Stop task` prevents future dispatch, revokes task-scoped access, requests
cancellation, terminates supervised descendants, and checks cleanup.

| State key | Label | Required behavior | Test criteria |
|---|---|---|---|
| `control.stopping` | `Stopping task and checking cleanup` | Show the active phase, whether an effect may already have occurred, and cleanup progress. | LR-CTL-003 |
| `control.stopped` | `Task stopped` | Show only after future dispatch is blocked and process cleanup is verified. Preserve completed effects and artifacts. | LR-CTL-004 |
| `control.stop_incomplete` | `Task blocked during cleanup` | Do not claim stop completion. Show what remains unverified and a manual recovery action. | LR-CTL-005 |

Stopping is not rollback. The confirmation says:
`Completed local changes remain. Stop prevents additional task actions.`

## Recovery and lease states

After a client or runtime interruption, the first state is
`runtime.recovering`. The runtime reads durable intent and outcome records,
checks the current project identity and revision, and reconciles evidence. It
does not silently redispatch an external effect.

| State key | Label | Required behavior | Test criteria |
|---|---|---|---|
| `recovery.checking` | `Checking interrupted action` | Show last durable phase and the checks being performed. | LR-REC-002 |
| `recovery.resume_available` | `Action can resume from a verified boundary` | Name the next phase. Require `Resume from [phase]`; preserve the existing grant ceiling. | LR-REC-004 |
| `recovery.verify_only` | `Change may already be applied; verification is incomplete` | Do not apply again. Offer `Verify existing result`, `Inspect changes`, or `Stop`. | LR-REC-005 |
| `recovery.outcome_unknown` | `Action outcome needs review` | Block automatic retry. Show available external evidence and escalation path. | LR-REC-006 |
| `recovery.recovered` | `Interrupted action reconciled` | State the evidence-backed outcome and append a recovery event. Do not claim the task complete unless terminal verification and checkpoint requirements pass. | LR-REC-007 |
| `recovery.corrupt` | `Saved runtime record could not be verified` | Fail closed. Preserve bytes, offer trace export, and prevent apply, commit, replay, or restore from the unverified record. | LR-REC-008 |
| `recovery.lookup` | `Checking the target record before retry` | Use the target idempotency ledger before considering another apply. Show that no new effect is running. | LR-REC-009 |
| `recovery.exact_replay` | `Existing result reconciled; no new change applied` | Bind the original target receipt to the current command recovery and continue with trusted verification only. | LR-REC-010 |
| `recovery.claim_takeover` | `Reassigning interrupted result check` | Show that the former worker can no longer verify, append trace, or commit. The new claim must reconcile target evidence before continuing. | LR-REC-011 |
| `lease.active` | `Editing lease active` | Show target, owner, acquisition time, expiry, and fencing epoch in details. | LR-LEASE-001 |
| `lease.stale` | `Previous editing lease is stale` | Apply nothing. Name the last owner and expiry; offer `Check and acquire new lease`. | LR-LEASE-002 |
| `lease.conflict` | `Another writer currently owns this target` | Show owner identity when disclosure is permitted, expiry, and read-only options. Do not offer force takeover by default. | LR-LEASE-003 |
| `lease.reacquiring` | `Checking previous writer before acquiring lease` | Verify inactivity and allocate a new fencing epoch before enabling dispatch. | LR-LEASE-004 |
| `lease.pending_fence` | `Securing the current editing turn` | Dispatch remains disabled until the target authority acknowledges the exact lease and new fencing epoch. | LR-LEASE-005 |
| `lease.fenced` | `Previous editing turn blocked at target` | Show that a late older writer was rejected by the target and did not become the current result. Preserve its attempted action in trace. | LR-LEASE-006 |
| `claim.active` | `Result recording claim active` | In technical details, show worker, command phase, claim expiry, and claim fencing epoch. | LR-LEASE-007 |
| `claim.stale` | `Previous result recording claim is stale` | Prevent that worker from verifying, appending trace, or committing. Start recovery lookup under a new claim. | LR-LEASE-008 |
| `claim.fenced` | `Previous result recorder blocked` | Ignore the late recorder's verification or commit attempt and keep the current recovery owner visible. | LR-LEASE-009 |
| `lease.recovering_fence` | `Finishing editing-turn recovery` | Repeat only the target fence-activation handshake. Keep dispatch disabled until the target acknowledges the exact pending epoch; never reuse the older epoch. | LR-LEASE-010 |

An expired lease or claim never becomes permission to reuse its prior fencing
epoch. A wall-clock expiry alone is not a target fence.

## Blocked action contract

Every blocked action shows:

- what was prevented;
- why it was prevented in plain language;
- the last known effect boundary;
- whether any local change may already exist;
- the recovery owner: `You`, `Memi`, `Repository`, `Harness`, or `Administrator`;
- preserved context and artifacts;
- one recommended next action plus `Open details` and `Stop task`;
- whether retry, resume, restore, or a new proposal is required.

Blocked categories and preferred actions:

| Category | Message | Preferred action | Test criteria |
|---|---|---|---|
| Missing capability | `This action does not have [capability].` | `Review access request` | LR-BLK-001 |
| Invalid approval | `The approved change no longer matches the target.` | `Review updated diff` | LR-BLK-002 |
| Stale lease | `The previous editing lease expired and cannot be reused.` | `Check and acquire new lease` | LR-BLK-003 |
| Revision mismatch | `The target changed after this action was prepared.` | `Refresh proposal` | LR-BLK-004 |
| Runtime unavailable | `The local runtime is unavailable. No new local action can start.` | `Reconnect runtime` | LR-BLK-005 |
| Environment unhealthy | `A restricted-environment control could not be verified.` | `Retry environment check` | LR-BLK-006 |
| Outcome unknown | `Memi cannot yet prove whether the action took effect.` | `Inspect and reconcile` | LR-BLK-007 |
| Cleanup unverified | `Memi could not verify that all local processes stopped.` | `Open cleanup details` | LR-BLK-008 |
| Stale target baseline | `The target changed after this action was approved. No operation from this request was applied.` | `Review target changes` | LR-BLK-009 |
| Fenced lease or claim | `A newer editing or recovery owner replaced this worker.` | `Open collaboration details` | LR-BLK-010 |
| Verification mismatch | `The current target does not match the recorded result.` | `Inspect target changes` | LR-BLK-011 |
| Verification unavailable | `Memi cannot currently verify the target result.` | `Retry verification` | LR-BLK-012 |
| Corrupt target evidence | `Target evidence failed integrity checks and was quarantined.` | `Open recovery details` | LR-BLK-013 |
| Unsupported process effect | `Process execution is not available through this target action.` | `Review supported actions` | LR-BLK-014 |
| Unsupported source or Git effect | `Source and Git changes are not available through canvas or artifact actions.` | `Review supported actions` | LR-BLK-015 |
| Unsupported external effect | `Network, shell, package, browser sign-in, publish, and deploy actions require a separately accepted authority.` | `Review supported actions` | LR-BLK-016 |
| Unsupported effect with unknown outcome | `This effect class has no accepted recovery authority, so Memi cannot prove its outcome.` | `Open manual recovery steps` | LR-BLK-017 |
| History commit conflict | `The existing project-history binding does not match this request.` | `Inspect history binding` | LR-BLK-018 |
| Authoritative history corruption | `The project history database could not be verified. Runtime recovery is blocked.` | `Open recovery options` | LR-BLK-019 |
| Replay integrity failure | `History replay was blocked before state reduction.` | `Open integrity details` | LR-BLK-020 |

`Stale target baseline` is shown only when the target authority proves its
compare-and-apply transaction rejected the request before mutation. A thrown
error, timeout, or unchanged unrelated hash uses `Outcome unknown` instead.

The currently accepted target effect classes are `canvas.operation` and
`artifact.persist`. A matching schema does not make any other effect supported.

## Retry and restore

Retry is phase-scoped. Its confirmation states the failed or invalidated phase,
the same or refreshed action digest, whether an external effect may already
exist, and why retry will not blindly duplicate it.

- `Retry check` reruns a read-only precondition.
- `Retry verification` checks an existing possible result and does not apply.
- `Retry action` is available only after idempotency, target revision, grant,
  approval, a current worker claim, and an active target fence pass, and trusted
  lookup has verified that no prior effect was applied.
- `Create revised action` creates a new proposal and authorization path.

Retry criteria: LR-RTRY-001, LR-RTRY-002, LR-RTRY-003.

Restore always begins with a preview showing the checkpoint, current accepted
state, changed canvas objects or worktree paths, conflicts, and excluded
effects. The confirmation says:
`Restore changes accepted local state. It does not undo commits, pushes,
deployments, messages, payments, or other completed external actions.`

Restore states:

| State key | Label | Required behavior | Test criteria |
|---|---|---|---|
| `restore.preview` | `Review restore` | Apply nothing; show current versus checkpoint state and excluded effects. | LR-RST-001 |
| `restore.blocked` | `Restore cannot start` | Name conflict, missing artifact, corruption, or capability. | LR-RST-002 |
| `restore.applying` | `Restoring accepted local state` | Show target and progress; keep the previous checkpoint. | LR-RST-003 |
| `restore.verifying` | `Verifying restored state` | Do not claim recovery until state hashes and required evidence pass. | LR-RST-004 |
| `restore.completed` | `Local state restored and verified` | Link prior and new checkpoints plus recovery trace. Restate which external effects were excluded. | LR-RST-005 |
| `restore.failed` | `Restore failed` | Preserve the prior checkpoint and name the known effect boundary. | LR-RST-006 |

## Keyboard and accessibility behavior

- Runtime status, preflight, task state, grant, approval, pause, stop, retry,
  restore, trace commit, history export, and replay are operable without pointer
  input. (LR-A11Y-001)
- Opening a modal or drawer moves focus to its heading; closing returns focus to
  the invoker unless that control no longer exists. (LR-A11Y-002)
- Preflight sections use headings and semantic description lists. Status tables
  are not required for interaction.
- `Escape` closes non-destructive detail surfaces. It never grants access,
  approves, pauses, stops, retries, restores, or dismisses an unresolved alert.
  (LR-A11Y-003)
- Pause and stop are separate buttons with distinct accessible names.
  (LR-A11Y-005)
- Destructive or externally consequential confirmations place initial focus on
  `Cancel`; `Enter` alone never confirms from the trigger. (LR-A11Y-004)
- Status and phase changes use a polite live region. Use an assertive alert only
  for lost connection during a possible write, invalidated approval at apply,
  cleanup failure, target-evidence corruption, or authoritative SQLite history
  corruption. Projection lag, failure, and quarantine remain polite.
  (LR-A11Y-006)
- Progress announcements are stage-based and throttled. Streaming logs and
  high-frequency trace events are not announced.
- Color, motion, icon, and position are never the only state signal. Respect
  reduced motion and do not use countdown motion as the only expiry indicator.
  (LR-A11Y-007)
- After a blocked validation or failed submission, focus moves to an error
  summary that links to the failing field or section. User input remains intact.
  (LR-A11Y-008)
- Technical identifiers, raw logs, and hashes live in an expandable
  `Technical details` region and do not replace the plain-language result.
  (LR-A11Y-009)

## Prohibited wording

Do not say:

- `Fully isolated`, `impenetrable`, `100% safe`, or `secure sandbox`
- `Nothing can access your computer`
- `Exactly once`
- `No changes were made` unless the effect boundary proves that claim
- `Applied again` when an exact prior receipt was replayed
- `Trace committed` when only JSONL projection output exists
- `Effect uncommitted` or `Effect failed` because JSONL projection is pending,
  lagging, missing, failed, or quarantined
- `Recovered from export` when SQLite authority is missing or corrupt
- `Actions rerun` for pure history replay
- `Retry is safe` without target-authoritative `verified-not-applied` evidence,
  a current claim, and an active target fence
- `Stopped` while cleanup or a noninterruptible effect is unresolved
- `Recovered` before reconciliation is durably recorded
- `Complete`, `fixed`, or `successful` before scoped verification finishes
- `Rolled back` when only canvas or worktree state was restored
- `Approved` without naming the exact change or receipt
- `Access granted` without scope and expiry

Prefer:

- `Restricted local environment; checked controls are listed below`
- `No new operation was dispatched`
- `Outcome not yet known`
- `Previous target receipt found; no new change applied`
- `Target confirmed no change was applied`
- `Verified result committed to project history; history export pending`
- `History export is behind; committed effects are unchanged`
- `Replaying history without external actions`
- `Verified operation completed`
- `Task stopped; completed local changes remain`
- `Local state restored; completed external actions were not undone`

Language criteria: LR-LANG-001, LR-LANG-002, LR-LANG-003.
