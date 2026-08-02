# ADR 0002: Use one local workspace runtime and a web client

- Status: Proposed
- Required before: M1 implementation
- Owner: Principal Architect

## Context

Canvas needs browser interaction plus controlled filesystem, Git, process,
artifact, and harness access. Duplicating domain logic across a desktop shell,
web server, and Rust supervisor would increase state divergence and recovery
risk.

## Decision

One local workspace runtime owns filesystem and Git access, persistence,
approved process supervision, harness adapters, and versioned HTTP, event, and
MCP interfaces. The React web client communicates only through those interfaces.

The runtime binds to a user-private Unix socket where possible or loopback with
a rotating random session token. The browser cannot access the filesystem,
shell, Git, credentials, or harness processes directly.

A future Tauri shell may own window lifecycle, native dialogs, and updates. It
must not duplicate project, import, document, trace, task, or ChangeSet logic.

## Consequences

- The runtime is the only privileged local process.
- Domain packages remain UI- and transport-independent.
- Hosted collaboration is not part of the M1 authority model.

## Acceptance evidence

- A process-boundary diagram and threat model are approved.
- Restart preserves durable state without browser-local authority.
- Tests reject non-loopback access, stale tokens, and direct shell strings.
