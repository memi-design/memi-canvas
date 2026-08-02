# Memi Canvas convergence release plan

Status: active WIP recovery plan
Baseline: `6559bb4` plus the current uncommitted convergence slice
Release type: public development source, not a production binary release

## Recovery finding

The 24-hour run did not produce a releasable checkpoint. It produced a broad architectural replacement across the editor, protocol, runtime, import, and macOS layers without a Git commit. The old hardcoded Buzzr project surface was removed and replaced with repository-general foundations, but the critical runtime-capture proof is still missing.

The recovery rule is therefore: preserve the useful source, exclude machine-local artifacts, publish the truth, and resume from small gated milestones.

## Gate 0 — publishable WIP source

- Remove machine-specific paths, debug scripts, generated binaries, build directories, and local state.
- Confirm no secrets or source-repository contents are included.
- Run typecheck, lint, build, and the bounded importer suite.
- Document current architecture and explicit no-go boundaries.
- Preserve the private pre-public history locally, then publish a clean root commit containing only the curated convergence snapshot to `memi-design/memi-canvas`. Historical Buzzr-derived assets and source inventories must not remain recoverable from the public repository.

Exit: the public repository can be cloned, installed, inspected, and verified without relying on this machine.

## Gate 1 — one editor authority

- Make Canvas Document V3 and immutable operations authoritative for creation, transforms, style, hierarchy, components, history, import materialization, and agent patches.
- Remove production snapshot bridges and full-node-array history.
- Keep pointer previews, guides, hover, and camera gestures memory-only.
- Restore document, page, camera, panels, history, imports, and reviews after restart.

Exit: one action produces one traceable operation and one undo entry across web and macOS.

## Gate 2 — professional creation surface

- Finish selection, camera, frames, nested groups, layers reparenting, snapping, clipboard images, and paste-at-cursor.
- Finish text, fills, strokes, effects, independent radii, auto layout, constraints, variables, components, instances, vectors, prototypes, and whiteboards.
- Build the responsive Memi landing-page demo through the public editor UI at desktop, tablet, and mobile sizes.
- Hold 55 fps at 2,000 design nodes and p95 pointer latency below 50 ms.

Exit: a designer can build a complete responsive product without reaching for code to compensate for missing canvas controls.

## Gate 3 — truthful Buzzr import proof

- Use the real Buzzr Expo checkout as read-only authority.
- Approve one bounded no-admin build/capture recipe in a Memi-managed worktree.
- Capture at least one multi-screen user flow with real simulator pixels, hierarchy, geometry, fixture fingerprint, and source revision.
- Build a source-backed design-system page for tokens, typography, components, navigation, spacing, radii, and assets.
- Render explicit retryable diagnostic cards for failures; never render placeholders.

Exit: at least one real Buzzr screen is captured through the importer and displayed with evidence. A launch prompt, synthetic fixture, or passing adapter test is not sufficient.

## Gate 4 — agent and source convergence

- Route deterministic edits through the source compiler before a model.
- Connect Codex and Claude adapters through the same operation and change-proposal contracts.
- Run proposals in child worktrees with revision, permission, budget, and cancellation checks.
- Review canvas, code, preview, token usage, and verification evidence before merge.
- Keep the original checkout unchanged until explicit promotion.

Exit: one visual selection can become a verified code change, survive restart, and promote without stale-revision or dirty-workspace loss.

## Gate 5 — release acceptance

- Reach 80% coverage for the canonical editor, runtime, import, persistence, and adapters.
- Pass browser and packaged macOS E2E, accessibility, reduced-motion, visual-regression, performance, crash, disk-pressure, cancellation, and recovery suites.
- Complete dependency, license, asset, icon, fixture, secret, SBOM, and provenance review.
- Publish signed checksums for any distributable app artifact.

Exit: tag the first pre-release only after Product Security, QA, and licensing gates are recorded. Until then, GitHub contains development source only.
