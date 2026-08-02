# Agentic Editor Delivery Plan

Status: In progress
Owner: Memi Canvas product team
Scope: macOS-first human-agent collaboration for source-backed canvases

## Goal

Turn the current deterministic canvas demo into a trustworthy collaboration
surface where a person can:

1. Understand every editor action before using it.
2. Prompt Codex or Claude Code with bounded canvas and source context.
3. Follow concise progress, tool, evidence, and verification summaries.
4. Review an exact canvas and source ChangeSet.
5. Approve one revision-bound change.
6. Apply it in a managed disposable worktree.
7. Verify the result and refresh the source-linked canvas.
8. Recover, reject, request changes, or roll back without touching the original
   checkout.

The interface displays accountable activity summaries. It does not expose or
persist private chain-of-thought, provider scratchpads, secrets, raw provider
events, or private provider identifiers.

## Current truth

The editor already has:

- selection, document revision, viewport, model, harness, mode, reasoning, and
  permission context;
- immutable canvas commands and revision-aware agent patches;
- queued, planning, tool use, approval, apply, verify, cancel, reject,
  checkpoint, restore, and rollback concepts;
- provider-neutral event normalization and durable runtime foundations;
- validated localhost and contained-source native launch boundaries.

The current product still uses a browser-local deterministic demo. Codex and
Claude Code are configuration labels, not verified live adapters. Source
ChangeSets, managed worktrees, provider processes, and source refresh are not
yet connected.

## Experience contract

### Action help

Every icon-only action uses one shared tooltip:

- pointer hover and keyboard focus;
- action name, canonical shortcut, and concise outcome;
- disabled reason when applicable;
- stable placement within the app window;
- neutral surfaces and Ruby only for active state;
- reduced-motion and touch-safe behavior;
- accessible name independent of the tooltip.

### Composer

Idle:

```text
[scope] Ask Memi... [mode · harness · model] [send]
```

Expanded:

- target scope and source provenance;
- document and source revision;
- prompt and bounded attachments;
- mode, harness, model, reasoning, permission, and connection truth;
- explicit submit status and disabled reason.

Running:

```text
[status] Planning changes... [elapsed] [Open Runs] [Stop]
```

The prompt is cleared only after runtime acknowledgement. Failed and canceled
runs preserve the prompt for editing and retry.

### Run progress

Runs opens as a resizable split and shows:

1. User prompt and bounded context.
2. Current phase, elapsed time, harness, and resolved model.
3. Concise plan and active step.
4. Files and evidence read.
5. Tools used and public reason.
6. Canvas commands and source changes prepared.
7. Token, cost, and timing usage when reported.
8. Approval, verification, errors, and recovery.
9. Final outcome and trace receipt.

### Review

The review surface separates:

- Canvas: changed nodes and before/after selection.
- Code: affected file tree and exact diff.
- Preview: local runtime result and captured evidence.

Approval binds to the ChangeSet digest, canvas revision, source revision, dirty
fingerprint, exact file hashes, permission ceiling, and one use. Any mismatch
invalidates approval and requires a new proposal.

## Architecture

```text
Prompt + bounded evidence
  -> immutable task manifest
  -> local runtime
  -> selected harness adapter
  -> normalized public events
  -> revision-bound ChangeSet
  -> human review and exact approval
  -> managed disposable worktree
  -> allowlisted verification
  -> import invalidation and canvas refresh
  -> durable trace and checkpoint
```

React must not launch providers, read credentials, execute commands, or mutate
source. A local runtime owns those capabilities through a private authenticated
transport. Tauri starts and monitors the runtime but does not become the source
mutation engine.

Provider adapters must report installed, authenticated, reachable,
model-available, and capability health independently. Catalog presence is not a
connection.

Source operations apply verified replacement bytes whose hashes were approved.
The runtime never asks an executor to reinterpret a model-authored patch at
apply time.

## Delivery workstreams

### W1: Action clarity

- Shared tooltip and keycap atoms.
- Complete topbar, workspace, inspector, preview, review, and composer coverage.
- Hover, focus, disabled, collision, touch, and reduced-motion tests.

### W2: Composer and activity

- Compact, expanded, offline, running, failed, and recovered states.
- Prompt drafts and bounded context attachments.
- Typed public run events and outcome summaries.
- Keyboard, IME, screen-reader, and focus recovery tests.

### W3: ChangeSet protocol

- Immutable task, event, source operation, verification, and ChangeSet schemas.
- Path, symlink, special-file, revision, dirty-state, hash, duplicate, size, and
  approval validation.
- Exact diff artifacts and single-use approval receipts.

### W4: Local runtime and harnesses

- One provider-neutral durable adapter contract.
- Runtime health handshake and private authenticated transport.
- Codex read/propose adapter first, Claude Code through the same contract.
- Sanitized environment, bounded output, cancelable process groups, redacted
  public events, and no arbitrary shell.

### W5: Managed worktree apply

- App-managed disposable worktree.
- Exact replacement-byte application.
- Allowlisted typecheck, test, preview, and capture verification.
- Crash, disk-full, stale lease, partial apply, rollback, and restart recovery.
- Original checkout remains byte-for-byte unchanged.

### W6: Canvas refresh and release proof

- Invalidate affected source anchors.
- Re-import only impacted components/screens.
- Preserve selection and show changed nodes.
- Package the macOS app and complete native interaction, accessibility,
  performance, security, and restart E2E.

## First vertical slice

1. Select one source-backed Buzzr button.
2. Submit a bounded prompt to a deterministic subprocess fixture.
3. Stream plan, evidence, tool, proposal, and verification summaries.
4. Review one canvas change and one source-file replacement.
5. Approve the exact digest.
6. Apply to a disposable fixture worktree.
7. Run an allowlisted verification command.
8. Refresh the source-linked component.
9. Restart Memi and recover the run and review.
10. Prove the original fixture checkout is unchanged.

Real provider read/propose mode follows this deterministic gate. Promotion into
the user's checkout remains a separate, explicit action after the sandbox,
approval, crash-recovery, and containment gates pass.

## Release gates

- Minimum 80% coverage across the new contracts and adapters.
- No tooltip-less icon actions.
- No false connected status based only on configured harness metadata.
- No hidden-reasoning field accepted by public event schemas.
- No full canvas serialization when bounded evidence references suffice.
- No source apply without exact, current, single-use approval.
- No write to the original checkout during proposal or verification.
- No provider-inherited unrestricted environment, shell, network, or host
  credentials.
- Prompt, run, diff, approval, verification, cancel, conflict, recovery, and
  restart journeys pass E2E.
- Static design, accessibility, security, full test, and packaged macOS gates
  pass with retained evidence.
