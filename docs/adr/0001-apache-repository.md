# ADR 0001: Build Canvas in an Apache-2.0 standalone repository

- Status: Proposed
- Required before: M1 implementation
- Owners: Founder/Product Lead, Principal Architect, Legal

## Context

The existing Memi and Studio code contains multiple licensing histories and
product assumptions. Canvas must be independently distributable, auditable, and
usable without inheriting Figma or source-available-only dependencies.

## Decision

Canvas is developed in a new repository under Apache-2.0. Every imported source
file, test, fixture, generated asset, and interface receives a signed provenance
disposition before it enters the repository:

- compatible reuse;
- copyright-holder relicensing;
- optional external invocation;
- clean-room reimplementation; or
- retirement.

Conceptual similarity is not evidence of compatible provenance. Clean-room work
uses new contracts and public behavior, without copying incompatible source or
tests.

## Consequences

- Existing code is not migrated wholesale.
- The provenance ledger and dependency SBOM are release evidence.
- An unresolved or incompatible dependency blocks the affected implementation.

## Acceptance evidence

- Legal accepts the license and contributor policy.
- Every reused M1 module has a recorded disposition.
- Dependency scanning finds no FSL-only or Figma-runtime requirement.
