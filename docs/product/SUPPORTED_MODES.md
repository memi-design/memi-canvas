# Supported-mode capability contract

- Status: Draft for M0 review
- Product owner: Principal PM
- Contract owners: Product Design, Architecture, Import/runtime, Data/Evals

## Status vocabulary

| Status | Meaning |
|---|---|
| `Supported` | Passes the declared benchmark and release gate |
| `Experimental` | Available with explicit limitations and no general support claim |
| `Demo` | Deterministic fixture behavior, not a live integration |
| `Planned` | Product intent only; unavailable to users |
| `Unsupported` | Deliberately excluded from the milestone |

`Planned`, `Demo`, and `Experimental` cannot be marketed as supported.

## M0 coded-slice matrix

| Source mode | M0 status | Result | Source editing |
|---|---|---|---|
| Deterministic local React fixture | `Demo` | Routes, states, viewports, tokens, coverage, task, trace, and recovery | Simulated proposal only |
| Arbitrary Vite/React repository | `Planned` | None guaranteed in M0 | No |
| Next.js repository | `Planned` | None guaranteed in M0 | No |
| Storybook repository | `Planned` | None guaranteed in M0 | No |
| Static build | `Planned` | None guaranteed in M0 | No |
| Running local URL | `Planned` | None guaranteed in M0 | No |
| Remote URL | `Unsupported` | No capture | No |
| Screenshot folder | `Planned` | Reference frames only | No |
| Blank project | `Demo` | Native draft frames | No source until explicit generation |
| Figma or FigJam | `Unsupported` | No import, export, bridge, or compatibility | No |

## Intended product-mode truth

This table defines the planned authority model. It does not upgrade M0 status.

| Source mode | Frame kinds | Strongest possible evidence | Source ChangeSet eligibility |
|---|---|---|---|
| Repository plus reproducible runtime | CodeFrame and SnapshotFrame | Verified | Yes, with current source anchors |
| Repository without runtime | CodeFrame | Inferred | Only where source mapping is unambiguous |
| Storybook inside repository | CodeFrame and SnapshotFrame | Verified | Yes, within repository scope |
| Static build with source map | SnapshotFrame and CodeFrame where anchors resolve | Observed or Verified | Only for resolved current anchors |
| Static build without source map | SnapshotFrame | Observed | No |
| Running local URL without source | SnapshotFrame | Observed | No |
| Remote URL | SnapshotFrame | Observed | No |
| Screenshot folder | ReferenceFrame | Reference | No |
| Blank project | DraftFrame | Proposed | No source until explicit generation |

## Required support dimensions

A mode is not `Supported` merely because it opens. Its contract must define:

- Discovery denominator
- Route and state coverage
- Viewport set
- Role, theme, and feature-flag handling
- Runtime and asset requirements
- Authentication boundary
- Source-anchor behavior and abstention
- Design-system extraction behavior
- Determinism and cache invalidation
- Resource budgets
- Security and network permissions
- Recovery and partial-result behavior
- Benchmark fixtures
- User-facing limitations

## Planned representative viewports

- Desktop: 1440 by 900
- Tablet: 834 by 1112
- Mobile: 390 by 844

Framework breakpoints are additionally tested at boundary values. Boundary
captures remain verification evidence unless they fail or the user pins them to
the matrix.

## Repository mode

Import is read-only. A repository import must:

- Fingerprint source revision and dirty state
- Preserve a dirty user checkout byte-for-byte
- Use a bounded capture plan
- Use zero model tokens for discovery and coverage
- Record unsupported and blocked cells
- Avoid package installation or script execution without explicit sandboxed
  authorization
- Create source proposals only in an isolated worktree

## URL mode

URL capture does not imply repository ownership.

- Local and remote URL behavior must be distinct.
- Cross-origin navigation is blocked unless explicitly included.
- Authentication and browser storage use an approved local vault.
- Network-body capture is opt-in.
- URL captures are not source-editable without separately linked current
  source anchors.

## Screenshot mode

Screenshots create `ReferenceFrame` objects only.

- They may be grouped, annotated, compared, and attached as task context.
- They may not satisfy route, runtime, source-link, or editability claims.
- Model-generated reconstruction, if added later, creates a separate
  `DraftFrame` with provenance and never upgrades the screenshot itself.

## Blank project mode

Blank projects create `DraftFrame` objects owned by the Memi document.

- Canvas undo and restore apply.
- No source repository is implied.
- Code generation, when introduced, creates a separate proposal and preserves
  the draft as provenance.

## Explicit 1.0 exclusions unless superseded

- Figma and FigJam compatibility
- Native iOS, Android, Flutter, or desktop-app runtime capture
- Production remote mutation
- Arbitrary shell access
- Screenshot-to-source claims
- Hosted cloud authority over the local document

## Promotion gate

A mode advances to `Supported` only when:

1. Product, architecture, security, and data/evals approve its contract.
2. Benchmark precision, recall, coverage, determinism, and abstention pass.
3. Partial, blocked, stale, and unsupported outcomes are user-visible.
4. Recovery leaves user source and evidence intact.
5. Accessibility and keyboard paths pass.
6. Public documentation states the same limitations as the runtime.
