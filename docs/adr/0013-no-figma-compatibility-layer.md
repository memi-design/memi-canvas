# ADR 0013: Do not build a Figma compatibility layer

- Status: Proposed
- Required before: M1 implementation
- Owners: Founder/Product Lead, Principal Architect

## Context

Canvas is a local-first product-understanding and verified-change environment,
not a Figma clone. Carrying the existing plugin, bridge, Code Connect, or file
model would preserve product bloat and introduce licensing and runtime coupling.

## Decision

M1 and 1.0 have no Figma or FigJam import, export, plugin, bridge,
synchronization, Code Connect, account, file, API, runtime, or compatibility
surface. Product schemas use Canvas concepts and must not mirror undocumented
Figma structures.

Open standards such as SVG, PNG, JSON, DTCG tokens, and Git remain valid when
they do not create a Figma dependency.

## Consequences

- Existing Figma services are retired rather than ported.
- Reference screenshots remain annotation-only.
- Future interoperability requires a new ADR and cannot alter core authorities.

## Acceptance evidence

- The dependency and source scan finds no Figma runtime or credential path.
- Golden setup and import tests pass on a machine with no Figma installation.
- Public documentation makes no Figma-parity claim.
