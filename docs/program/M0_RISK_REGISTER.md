# M0 Risk Register

Status: RED, active
Owner: Principal PM and Program Lead
Review cadence: Daily during implementation; formal review at every gate
Source baseline: `951b982`

## Status rules

| Status | Meaning |
| --- | --- |
| OPEN | Trigger exists or required control is absent |
| MITIGATING | Control implementation is active but unverified |
| EVIDENCED | Tests exist and pass; accountable approval remains pending |
| CLOSED | Required evidence and accountable approval are recorded |
| VETO | Non-overridable blocker to dependent work |

No risk is CLOSED based on intention, code review, or unit tests alone.

## Active risks

| ID | Risk and trigger | Severity | DRI | Required mitigation and evidence | Gate/status |
| --- | --- | --- | --- | --- | --- |
| R-001 | Untrusted repository escapes the project boundary through paths, symlinks, special files, mounts, or subprocesses | Critical | Product Security, Runtime | Canonical descriptor-relative access, deny special files, read-only mounts, disposable worker, adversarial tests | M1 veto / OPEN |
| R-002 | Install or preview process reads host credentials, sockets, environment, or unrelated repositories | Critical | Runtime, Security | Empty environment, explicit secret broker, socket denial, process isolation, cleanup proof | M1 veto / OPEN |
| R-003 | Preview traffic reaches loopback, private networks, cloud metadata, or broadens scope through DNS or redirects | Critical | Product Security | Deny-by-default egress, resolution pinning, redirect revalidation, SSRF corpus | M1 veto / OPEN |
| R-004 | Source mutation reaches the user's original or dirty checkout | Critical | Git/Runtime | App-managed worktree only, read-only original, path and Git identity checks, byte-for-byte fixture | M1 veto / OPEN |
| R-005 | Crash after an external effect causes duplicate application or false success | Critical | Data/Storage | Transactional intent/outbox, action digest, effect probing, crash-window tests | M1 veto / OPEN |
| R-006 | Two writers allocate conflicting journal order or previous hashes | Critical | Data/Storage | Single SQLite authority, transactional allocation, busy handling, concurrency tests | M1 veto / OPEN |
| R-007 | Stale lease, fencing epoch, grant, approval, or target revision authorizes a write | Critical | Data/Storage, AI/Agents | Effect-bound atomic validation and stale-writer tests | M1 veto / OPEN |
| R-008 | Approval scope is broadened or reused for a different action | Critical | ChangeSet, Security | Immutable receipt bound to actor, digest, target, capability, consequence, expiry, usage, lease, fence | M1 veto / OPEN |
| R-009 | Database, journal, artifact, or worktree corruption is hidden or “repaired” into false success | Critical | Data/Storage, QA | Integrity hashes, checkpoints, quarantine, backup/restore, corrupt-tail tests | M1 veto / OPEN |
| R-010 | Disk full, database busy, or process kill loses accepted work | High | Data/Storage, QA | Atomic transactions, pressure thresholds, interruption states, deterministic recovery tests | M1 no-go / OPEN |
| R-011 | Secret or authenticated content enters trace, artifacts, prompt context, or exports | Critical | Product Security, AI/Agents | Event allowlists, classification, redaction, export preview, secret corpus | M1 veto / OPEN |
| R-012 | Loopback or MCP caller bypasses project, origin, token, capability, or lease boundaries | Critical | Product Security, AI/Agents | Private socket or rotating token, origin binding, project grants, fencing, malicious-client tests | M1 veto / OPEN |
| R-013 | Platform behavior differs for paths, locks, WAL, cleanup, or containment | High | Runtime, QA | Separate macOS/Linux/Windows matrices and platform-specific claim gates | Platform claim no-go / OPEN |
| R-014 | Current fixture evidence is misrepresented as full product readiness | High | Product, PM | Persistent Demo labeling, mode-specific claims, signed release denominators | Release no-go / OPEN |
| R-015 | Missing repository, Storybook, URL, screenshot, blank, responsive, state, flow, MCP, or recovery journeys hide product failures | High | Product, QA | Required acceptance matrix and end-to-end evidence per supported mode | M1 no-go / OPEN |
| R-016 | Source anchors or affected-surface analysis target the wrong code or omit critical screens | Critical | Import, Data/Evals | Calibrated precision/recall, abstention, hidden holdout, zero wrong-target benchmark | Source-edit veto / OPEN |
| R-017 | Dependency, binary, fixture, asset, or generated code has incompatible or unknown provenance | Critical | Legal/licensing | SBOM, transitive scan, NOTICE decision, provenance ledger, DCO | Release veto / OPEN |
| R-018 | Figma/FigJam code, assets, schemas, private protocols, or hidden runtime dependency enters Canvas | Critical | Architect, Legal | Source/dependency/asset scan and clean-room review | M1 and release veto / OPEN |
| R-019 | Passing tests are treated as approval despite Proposed ADRs or unsigned gates | High | PM/Program | Status separates implemented, evidenced, approved, and released states | M1 no-go / OPEN |
| R-020 | Renderer, trace, or evidence volume exceeds local memory/disk budgets and corrupts work | High | Canvas/DE, Runtime | Virtualization, quotas, retention, disk-pressure behavior, large-project benchmark | M1 no-go / OPEN |

## Decision triggers

- Any critical control failure immediately sets the affected gate to VETO.
- A new external effect adds a crash-window row and approval capability before
  implementation.
- A new supported platform adds its own containment and durability matrix.
- A new dependency, binary, fixture, asset, font, or icon updates provenance
  evidence in the same change.
- A failed recovery or original-checkout mutation stops dependent work and
  requires a fresh RED regression before remediation.

## Veto authority

| Owner | Non-overridable veto scope |
| --- | --- |
| Product Security | Sandbox, secret, network, process, filesystem, MCP, capability, or cross-project boundary |
| QA/Release | Data loss, original-checkout mutation, recovery failure, repeated effect, or non-reproducible evidence |
| Legal/licensing | Unknown or incompatible code, dependency, asset, binary, fixture, or contributor provenance |
| Data/Evals | Unsupported accuracy, coverage, source-anchor, affected-surface, or reliability claim |
| Principal Architect | Conflicting authorities, unsafe durability model, or unversioned durable protocol |

Vetoes clear only after the failing condition is fixed and evidence is
regenerated. Risk acceptance cannot override these scopes.

## Risk closure evidence

Every closure records:

- Source commit and dirty-state manifest
- Responsible owner and independent reviewer
- Affected platforms and filesystems
- Exact test commands, seeds, repetition count, and outcomes
- Raw evidence location and hashes
- Negative and adversarial cases
- Residual limitation
- Approval date

## Current next dependency

The critical dependency is an accepted sandbox and SQLite/outbox/fencing
contract. ChangeSets and approval receipts cannot safely proceed until both
boundaries are accepted and implemented.
