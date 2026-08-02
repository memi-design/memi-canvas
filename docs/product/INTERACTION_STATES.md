# Interaction and state contract

- Status: Draft for M0 review
- Owner: Principal Product Designer
- Required reviewers: Product, Architecture, AI, Design Engineering,
  Accessibility, Security, and QA
- Source state: `codex/m0-foundation` M0 scaffold

## State design rule

Every surface must distinguish:

- Empty
- Loading
- Ready
- Partial
- Blocked
- Failed
- Recovering
- Recovered
- Stale

Loading cannot erase existing usable evidence. Failures must preserve the last
valid state whenever possible.

## Project home states

### Empty

Show:

- What Memi Canvas does
- `Import existing product`
- `Create blank project`
- Local-first and read-only import notices

Do not show an empty recent-projects table.

### Ready

Show recent projects with:

- Name
- Source type
- Last opened
- Coverage health
- Runtime availability

### Source unavailable

Preserve the project entry. Label it `Source unavailable` and provide
`Locate source` or `Open evidence only`.

## Import states

### Source not chosen

- Primary action disabled
- Source options remain navigable
- Explanation does not rely on placeholder text

### Invalid source

- Error appears next to the source field
- Error names the issue
- Existing input remains intact
- Focus moves to the error summary only on submission

### Preflight loading

- Announce current stage
- Keep cancel available
- Do not show capture claims before discovery finishes

### Preflight partial

- Show discoveries already available
- List missing runtime, auth, assets, fixtures, or commands
- Allow `Import partial project`
- Explain the resulting evidence limitations

### Import loading

Show stage, elapsed time, new discoveries, and current screen. Avoid a fake
precise completion percentage when the total is unknown.

### Import paused

Preserve all artifacts. Offer `Resume import`, `Open partial project`, and
`Discard import`. Discard requires confirmation.

### Import failed

Show:

- Failed stage
- Human-readable reason
- Evidence preserved
- Retry scope
- Recovery action
- Technical detail disclosure

Retry only the failed or invalidated stage when possible.

## Workspace states

### No screens discovered

Do not show a blank canvas without explanation. Offer:

- Review source setup
- Add a route manually
- Import screenshots as reference
- Open discovered components or tokens

### Matrix loading

Retain the previous matrix and mark affected cells `Refreshing`. Do not replace
the whole workspace with a spinner.

### Partial coverage

Show verified results normally and group gaps. The summary names the exact
partial and blocked counts.

### Blocked cell

A blocked cell shows:

- No fabricated thumbnail
- Blocking category
- Short reason
- `Resolve` action when recoverable
- Evidence attempted

### Stale frame

Show the prior capture with a visible `Stale` overlay and source-revision
comparison. Disable claims that require current evidence until recapture.

### Runtime disconnected

Canvas evidence remains available. Live sandbox actions are disabled. Provide
`Reconnect runtime`. Tasks requiring runtime move to `Blocked`, not `Failed`.

## Selection and context states

### No selection

Inspector explains how to select a frame or use the outline. The composer may
accept a general project task but states that no specific screen is attached.

### Selection

Show selection name, type, ownership, evidence, and available actions.

### Context attached

Each context chip has:

- Name
- Type
- Evidence level
- Remove action
- Inspect action

### Context unavailable

Do not silently omit it. Mark the chip `Unavailable` and require removal or
recovery before starting the task.

### Oversized context

Show estimated size, likely cause, and options to remove, summarize
deterministically, or narrow scope.

## Agent task state machine

```text
Draft
  -> Ready
  -> Queued
  -> Planning
  -> Preparing proposal
  -> Waiting for approval
  -> Applying
  -> Verifying
  -> Complete
```

Exceptional terminal or resumable states:

- Paused
- Redirecting
- Blocked
- Failed
- Stopped
- Rejected

### Draft

Intent or required context is incomplete. Starting is disabled with an explicit
reason.

### Ready

Intent, context, harness, and permission are valid. Starting states the
consequence.

### Queued

Show queue position when known and allow cancellation without a confirmation.

### Planning

Show a meaningful activity label and elapsed time. Do not show hidden reasoning.

### Preparing proposal

Show target and artifact type. Current accepted state remains unchanged.

### Waiting for approval

Prominently show:

- Proposal consequence
- Changed targets
- Permission requested
- Accept, reject, and inspect

### Applying

Approval receipt remains visible. Stop is available if the operation is
interruptible. If not, explain why.

### Verifying

Show affected dependency set and individual check states.

### Complete

Requires a terminal verification result and a checkpoint. Completion does not
mean commit, push, or deploy.

### Paused

Preserve task context and progress. Resume uses the same harness unless the
user selects another.

### Redirecting

Show the previous instruction and pending redirect. Do not launch two writers
against the same target.

### Blocked

Name the blocker and recovery owner. Examples include approval, runtime,
credentials, fixture, conflict, or rate limit.

### Failed

Preserve artifacts and the last valid state. Offer retry, switch harness, open
trace, or stop.

### Stopped

Stop future work, preserve completed artifacts, and record the stop in trace.

### Rejected

The proposal remains inspectable but is not accepted. Feedback can seed a new
task or revision.

## Harness switching

Switching a harness:

- Preserves goal, context, accepted artifacts, trace, and permissions
- Does not transfer provider-private state
- Shows the new harness and model
- Records who initiated the switch
- Requires reapproval if capabilities or data boundaries broaden
- Does not automatically rerun completed tools

## Approval states

### Not requested

The proposal remains read-only.

### Requested

Show scope, target, consequence, requester, and expiry if any.

### Approved

Create an immutable approval receipt and apply only the approved operations.

### Partially approved

Apply selected operations only. Verification scope is recalculated.

### Rejected

Apply nothing. Record optional user feedback.

### Expired

Apply nothing. Preserve the proposal and allow a new request.

### Invalidated

If the target or source revision changed, approval becomes invalid. Require a
new diff and approval.

## Trace event model

User-facing event categories:

- Context
- Routing
- Plan
- Action
- Proposal
- Approval
- Verification
- Checkpoint
- Recovery
- Error

Event statuses:

- Pending
- In progress
- Needs input
- Succeeded
- Failed
- Reverted

M0 trace sequence:

```text
context.attached
harness.selected
task.started
plan.published
proposal.created
approval.requested
approval.resolved
proposal.applied
verification.started
verification.completed
checkpoint.created
checkpoint.restored
```

Every event must show actor, time, task, target, harness when relevant, and
result. Expandable technical details may include event IDs, hashes, and tool
references.

## Trace loading and recovery

### Loading

Keep the latest readable activity summary visible.

### Replay unavailable

Explain whether an artifact is missing, incompatible, or corrupted. Raw event
export remains available when possible.

### Interrupted run recovered

Show a recovery event and the last durable checkpoint. Do not silently resume
external tools.

### Restore conflict

Show current versus checkpoint state and require an explicit branch, overwrite,
or cancel decision. M0 may support cancel only, but must explain the limitation.

## Notifications and announcements

- Use a polite live region for meaningful progress and status changes.
- Use an assertive alert only for destructive consequence, failure requiring
  immediate attention, or lost connectivity during an approved write.
- Do not announce high-frequency trace deltas.
- When status changes visually, equivalent text must also change.
