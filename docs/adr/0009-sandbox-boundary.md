# ADR 0009: Require an enforcing platform sandbox for process effects

- Status: Proposed
- Required before: M1 implementation
- Owners: Principal Architect, Product Security, Runtime Engineering

## Context

Repository import and visual capture may need package installation, builds,
preview servers, browser drivers, and Git inspection. A process can read
credentials, mutate the user checkout, open network connections, create
descendants, and emit sensitive output unless an operating-system boundary
prevents it.

Zod schemas, canonical path strings, executable allowlists, `cwd`, environment
filtering, and Node `child_process` options validate intent. They do not create
a security boundary. Filesystem paths can change through symlinks and races,
and a child can invoke capabilities that JavaScript did not model.

## Decision

Every `sandbox.process` command requires:

- a durable command with an exact action digest;
- an unexpired capability grant and, when required, human approval bound to the
  exact target, baseline, expected-before hash, capabilities, consequence, and
  bounded use;
- an active lease with the current fencing epoch;
- a versioned `SandboxProfile` and `ProcessRequest` bound by profile hash; and
- an enforcing platform provider that returns explicit enforcement evidence.

Authorization uses are reserved with the durable intent and checked again at
dispatch. Validation without provider enforcement returns `denied` or
`provider-unavailable`; it never falls back to an unsandboxed child process.

### M0 profile

The closed M0 profile is:

- provider `macos-sandbox-exec` on `darwin`;
- source roots read-only;
- isolated worktree and temporary roots writable;
- access outside declared roots denied;
- network denied;
- executable path resolved before dispatch and present in an absolute-path
  allowlist;
- arguments passed as an array with no shell command string;
- inherited environment disabled with an explicit key allowlist;
- no stdin;
- positive timeout, process-count, stdout, and stderr ceilings; and
- bounded output stored as classified hash and artifact metadata, never
  unbounded inline text.

The request working directory must resolve inside a writable root. Read-only
and writable roots cannot overlap.

### Canonicalization and race resistance

Protocol path validation is lexical only. The provider must perform operating
system canonicalization and capability checks immediately before spawn:

- resolve every root, executable, and working directory against existing
  filesystem objects;
- inspect each path component without following an untrusted final symlink;
- reject symlinks, special files, aliases, and read/write root overlap;
- use handles or file descriptors where the platform supports them to reduce
  check/use races; and
- reject a path if its identity changes between authorization and spawn.

A successful `SandboxDispatchSchema` parse is not evidence that these checks
occurred.

### Provider limits

M0 supports only a macOS provider. Linux namespaces, Bubblewrap, containers,
Windows AppContainer, and remote sandboxes are not implied by the protocol and
are unsupported until each has its own threat review, conformance suite, and
accepted ADR update.

`sandbox-exec` is platform-specific and is not treated as a portable container,
a Node security feature, or proof against provider and operating-system
defects. Startup probes provider availability on the current OS build and runs
a denial canary for filesystem and network access before enabling process
commands. Missing tools, rejected profiles, unavailable enforcement, or failed
canaries produce `provider-unavailable`.

The provider must supervise the process tree, enforce timeout and output
budgets, terminate descendants, and report one terminal result:
`completed`, `denied`, `timed-out`, `output-limit-exceeded`,
`provider-unavailable`, or `failed`. Completion and execution-failure records
carry policy-hash enforcement evidence. Preflight denial and provider
unavailability do not fabricate enforcement evidence.

### Recovery

Process execution is outcome-unknown after a crash unless a provider supplies a
separate durable, trustworthy completion receipt. Target hashes alone cannot
prove that a process did not execute or produce side effects. M0 therefore
blocks ambiguous process intents for human recovery and never automatically
replays them.

## Consequences

- Process features are fail-closed outside a verified macOS provider in M0.
- Import, static analysis, and canvas work that require no process continue to
  function when the provider is unavailable.
- A future platform provider expands an explicit compatibility matrix rather
  than weakening the canonical contract.
- Product UI must distinguish policy denial, provider unavailability, timeout,
  output limit, process failure, and outcome-unknown recovery.

## Acceptance evidence

- Denial canaries prove source write, root escape, symlink escape, network
  access, unapproved executable, environment injection, and descendant escape
  are blocked.
- Race tests replace path components between authorization and spawn and prove
  fail-closed behavior.
- Timeout and output-budget tests terminate the complete process tree.
- Unsupported platforms and missing providers never call an unsandboxed spawn.
- Crash-window tests prove ambiguous process effects are not automatically
  replayed.
