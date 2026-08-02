# ADR 0003: Use a hybrid DOM and SVG spatial renderer

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Canvas Engineering

## Context

The canvas must show hundreds of product frames, route relationships, evidence,
selection state, and accessible controls. A single giant DOM becomes expensive,
while a canvas-only renderer weakens semantics, text fidelity, and accessibility.

## Decision

Use a camera-controlled hybrid renderer:

- DOM for interactive frames, text, inspectors, and accessible controls;
- SVG for connectors, selection halos, flow edges, and lightweight overlays;
- virtualization for off-screen frames;
- content-addressed thumbnails for inactive CodeFrames; and
- semantic document nodes independent of renderer objects.

Atomic Design applies to product UI components. Renderer primitives do not
become domain authorities.

## Consequences

- The document model can be tested without a browser.
- Visual fidelity and accessibility stay inspectable in normal DOM tooling.
- Renderer-specific caches are disposable and never persisted as truth.

## Acceptance evidence

- The M0 spike meets agreed pan, zoom, memory, and frame-time budgets.
- A 250-frame fixture remains keyboard navigable.
- Renderer restart reproduces the same document from operations and artifacts.
