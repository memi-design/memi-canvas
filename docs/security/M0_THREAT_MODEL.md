# M0 Threat Model

- Status: Draft evidence for M0 review
- Security approval: **NOT APPROVED**
- Sandbox decision: **NOT DECIDED**
- ChangeSet security decision: **NOT DECIDED**
- Evidence date: 2026-07-27
- Evidence owner: Product Security
- Required reviewers: Principal Architect, Runtime Engineering, AI Systems,
  Data/Storage, QA/Release, Legal/licensing
- Source checkpoint: `036e9aef9c55527c657d974d8cd6380a578addf3`
  plus the concurrent M0 working tree

This artifact identifies the repository-wide threats and the controls required
before production integration. It does not approve a sandbox, declare the
current prototypes production-safe, or authorize M1.

## Overview

Memi Canvas is intended to be a standalone, local-first product for importing,
visualizing, editing, and verifying software products. Its planned authority
includes a browser client, a privileged local workspace runtime, untrusted
repository and runtime inputs, agent harnesses, durable canvas and task state,
semantic trace, classified evidence, and worktree-backed source ChangeSets.

The current M0 coded slice is a deterministic fixture-backed `Demo`. It does not
provide a production sandbox, live source application, authenticated runtime,
or approved external-agent boundary. Arbitrary repositories, live provider
mutations, source writes, Git effects, and network access remain unavailable or
planned. This distinction is a security control and must remain visible to
users.

The highest-consequence risks are:

1. An untrusted repository or runtime escaping the selected project boundary.
2. A forged, stale, or broadened approval authorizing a mutation.
3. A harness or provider leaking secrets or private state into shared product
   state or trace.
4. Concurrent or malformed writes corrupting the trace, canvas, or recovery
   record.
5. A source proposal modifying the user's real checkout instead of an isolated
   worktree.
6. A privileged local runtime exposing filesystem, process, Git, network, or
   credential authority to an untrusted browser or local process.

## Scope and security objectives

### In scope

- `apps/web/`: the browser-facing workspace and future local-runtime client
- `packages/import-compiler/`: deterministic repository discovery and capture
  planning
- `packages/canvas-document/`: canvas state, operations, and hashes
- `packages/harnesses/`: provider normalization, lifecycle, approval, routing,
  cancellation, resume, and handoff
- `packages/trace/`: append-only semantic history and replay
- `packages/protocol/`: public schemas for manifests, operations, trace,
  artifacts, grants, leases, checkpoints, and recovery
- Future local workspace runtime, sandbox, artifact store, encrypted vault,
  SQLite authority, worktree manager, and ChangeSet application path described
  by the ADRs
- Build dependencies, generated artifacts, test fixtures, and public release
  packaging

### Security objectives

- Preserve the user's selected repository and dirty checkout byte-for-byte
  unless a separately approved ChangeSet is applied to an isolated worktree.
- Keep filesystem, Git, process, network, credential, and authenticated-browser
  authority out of the web client and agent provider.
- Make every mutation attributable, scoped, reviewable, idempotent, and bound
  to current state.
- Keep replay pure and prevent trace or checkpoint recovery from repeating an
  external effect.
- Prevent private provider state, secrets, authentication material, personal
  data, and private reasoning from entering shared or exportable state.
- Fail closed on unknown schema versions, malformed objects, stale hashes,
  expired grants, stale leases, invalid paths, and unsupported event families.
- Keep security failures visible. Partial, blocked, stale, unsupported, and
  corrupt states must never be silently upgraded to verified or complete.

## Assets

| Asset | Why it matters | Required authority |
| --- | --- | --- |
| User repository and dirty working tree | May contain valuable source, uncommitted work, secrets, and proprietary data | User and Git remain authoritative |
| App-managed worktrees | Contain proposed changes and verification results | ChangeSet manager only |
| Filesystem outside the project root | Includes home data, SSH material, credentials, other repositories, and local services | Prohibited by default |
| Git identity and remotes | Can create commits or publish proprietary source | Separate explicit capability and approval |
| Environment variables and secret stores | May contain API, cloud, package, and database credentials | Encrypted vault or scoped broker only |
| Authenticated browser state | Cookies, tokens, storage, and private network responses | Encrypted vault; never an ordinary artifact |
| Canvas documents and operation log | Product truth, user work, and reversible history | Local document authority |
| Tasks, runs, approvals, grants, and leases | Decide what agents may do | SQLite authority and policy enforcement |
| Semantic trace and checkpoints | Audit, recovery, attribution, and evidence integrity | Single durable trace authority |
| Screenshots, DOM snapshots, logs, patches, and reports | May contain customer data, secrets, or authenticated content | Classified artifact store |
| Provider sessions and raw events | Can expose private vendor state or hidden data | Adapter-private memory only |
| Design-system and coverage evidence | Drives accuracy and product claims | Deterministic importer and evidence ledger |
| Local runtime session token | Protects the privileged loopback or socket API | Workspace runtime only |
| Dependency graph and release artifacts | Supply-chain and redistribution risk | Reproducible build and release gate |

## Threat model, trust boundaries, and assumptions

### Actors

| Actor | Trust level | Capabilities and limits |
| --- | --- | --- |
| Human project owner | Trusted for explicit decisions | Selects projects, reviews proposals, grants scoped permissions |
| Browser client | Untrusted presentation tier | May request actions; must not own privileged state or host access |
| Local workspace runtime | Privileged trusted computing base | Owns policy, persistence, filesystem, Git, process, and adapter access |
| Sandbox worker | Contained and disposable | Operates only within granted mounts, resources, network, and time |
| Imported repository | Untrusted data and code | May contain symlinks, special files, scripts, hostile assets, and huge inputs |
| Previewed application | Untrusted active content | May navigate, issue requests, allocate resources, and expose private data |
| Agent harness/provider | Partially trusted external processor | May produce malformed events, request excessive tools, or retain data |
| Local unprivileged process or website | Attacker-controlled | May probe loopback, steal stale tokens, or attempt CSRF and WebSocket hijack |
| Dependency or registry package | Supply-chain input | May be compromised or execute lifecycle scripts |
| Local administrator or physical attacker | Outside application containment | Can rewrite local files and binaries; cryptographic local tamper resistance is not assumed |

### Trust zones

| Zone | Contents | Data permitted | Data prohibited |
| --- | --- | --- | --- |
| Z0 Human decision boundary | Review and approval UI | Exact proposal, scope, consequence, expiry | Hidden scope, implicit privilege expansion |
| Z1 Browser client | React UI and rendered evidence | Public or authorized project data | Direct filesystem, shell, Git, vault, raw provider state |
| Z2 Workspace runtime | Policy engine, SQLite, adapters, supervisors | Validated commands and durable metadata | Unvalidated browser or provider objects |
| Z3 Sandbox and worktree | Imported code, preview process, verification | Explicit project copy or worktree, bounded outputs | Home directory, host credentials, unrelated repos, unrestricted network |
| Z4 Imported source/runtime | Repository files and application behavior | Read-only bounded discovery inputs | Authority over grants, coverage truth, host services |
| Z5 Harness/provider | Model and provider streams | Minimum task context and allowed evidence | Vault contents, raw host environment, unrelated project data |
| Z6 Durable stores | Canvas log, trace, artifacts, vault | Validated, classified, project-scoped data | Authentication artifacts, prohibited content, unredacted sensitive evidence |
| Z7 External network and supply chain | Registries, approved hosts, remotes | Explicit allowlisted traffic | Cloud metadata, private network, arbitrary egress |

### Primary data flows

1. The browser authenticates to the local runtime over a user-private Unix
   socket or loopback session protected by a rotating random token.
2. The runtime receives a project selection and creates a canonical project
   boundary.
3. Deterministic import reads bounded files without executing repository code.
4. Any runtime capture occurs in a disposable sandbox with explicit mounts,
   budgets, and network policy.
5. The runtime builds evidence, canvas, coverage, and task context from validated
   protocol objects.
6. A harness receives only the minimum task context and returns normalized,
   allowlisted semantic events.
7. A mutation becomes a proposal. The user reviews exact operations and grants a
   receipt bound to that proposal.
8. A ChangeSet applies only to an app-managed worktree, verifies expected hashes
   and lease fencing, then records durable outcome and trace.
9. Commit, push, publish, deployment, or broader network access each requires a
   distinct capability and approval.

### Assumptions

- The operating system account and local runtime binary are not already
  compromised.
- A local administrator can rewrite project state; the hash chain detects
  accidental or partial corruption, not a fully privileged attacker who
  recomputes every hash.
- Repository content, preview behavior, provider output, trace files, browser
  messages, screenshots, URLs, and imported manifests are untrusted.
- TypeScript types provide no runtime validation.
- A successful schema parse is not itself authorization. Policy must also check
  identity, current state, capability, target, expiry, usage, and lease.
- The current M0 fixture demo may continue only while it has no privileged live
  mutation path.

## Entry points

| Entry point | Attacker-controlled fields | Primary risks |
| --- | --- | --- |
| Project or repository selection | Root path, directory tree, file metadata | Path escape, symlink following, special files, resource exhaustion |
| Product manifest | Source root, commands, dimensions | Shell execution, path traversal, budget abuse |
| Route, state, token, and source files | Text and byte content | Parser confusion, hash ambiguity, excessive size |
| Package installation and preview startup | Executable, arguments, environment | Lifecycle RCE, process escape, secret access |
| Local HTTP, WebSocket, event, or MCP interfaces | Headers, token, origin, body, IDs | CSRF, token theft, auth bypass, request smuggling, replay |
| Preview browser | URL, navigation, storage, requests, DOM | SSRF, private-network access, XSS, secret capture |
| Canvas operation | IDs, hashes, node payload | Stale write, duplicate-ID collision, malformed geometry |
| Trace JSONL and replay input | Events, ordering, payload, hashes | Corruption, fake history, parser denial of service |
| Provider event stream | Event type, payload, metadata, sequence | Secret leakage, unknown events, oversized payloads |
| Approval and handoff | Run, approval, grant, scope, cursor, target | Forgery, stale approval, permission broadening |
| Artifact ingestion and export | Bytes, media type, filename, metadata | Secret persistence, archive bombs, unsafe rendering |
| ChangeSet and Git operation | Patch paths, modes, symlinks, revision, remote | Worktree escape, TOCTOU, wrong-repo mutation, publication |
| Dependency installation and build | Lockfile, registry package, binary | Compromised package, lifecycle script, provenance failure |

## Prohibited host access

The repository sandbox and any harness tool execution must deny the following
unless a later approved ADR defines an exact, user-visible exception:

- The user's home directory outside the explicitly selected project
- `~/.ssh`, GPG directories, cloud credentials, package-registry credentials,
  keychains, password stores, shell history, and system credential databases
- Environment variables not explicitly brokered for the exact action
- Docker, Podman, containerd, SSH agent, browser debugging, and other privileged
  local sockets
- Other Git repositories, worktrees, remotes, and the user's original checkout
  as a writable mount
- Arbitrary host processes, process inspection, signals, and inherited file
  descriptors
- Cloud metadata endpoints, link-local addresses, loopback services, private
  subnets, multicast, and DNS rebinding targets
- Unapproved external network destinations or redirects
- Authenticated browser cookies, local storage, session storage, cache, and
  response bodies outside the encrypted vault policy
- Device files, FIFOs, sockets, procfs, sysfs, and other special files
- Clipboard, camera, microphone, screen recording, contacts, calendar, and
  accessibility APIs without a separate explicit product capability

## Security invariants

1. Import is read-only and deterministic. It cannot execute project code,
   install packages, or make network requests.
2. Every imported file is a bounded regular file whose canonical path remains
   beneath the authorized canonical project root.
3. The browser never receives direct filesystem, shell, Git, vault, or provider
   credentials.
4. The local runtime rejects non-loopback access, invalid origins, missing or
   stale session tokens, and direct shell strings.
5. Capabilities are closed, least-privilege, project-scoped, action-bound,
   expiring, usage-limited, and independently checked at the effect boundary.
6. Approval binds the human actor, exact operation digest, current target
   revision, scope, consequence, and expiry. Approval for canvas operations
   cannot authorize source, Git, network, or publish effects.
7. Harness switching preserves or narrows the permission ceiling. Any broader
   capability or data boundary requires a new approval.
8. Source mutations occur only in an app-managed worktree. The original checkout
   remains byte-for-byte unchanged.
9. Every mutation validates the expected-before hash, idempotency action digest,
   active lease, fencing epoch, and capability grant before applying.
10. Repeated idempotency keys with identical action digests return the prior
    result. A mismatched digest fails closed.
11. One durable authority allocates trace and operation order. Concurrent writers
    cannot create duplicate sequence numbers or conflicting previous hashes.
12. Replay validates integrity and schema before reducing state and never calls
    tools, Git, network, current-state mutation, or external dispatch.
13. Unknown versions, operation types, and event families fail closed.
14. Provider streams are normalized through event-specific allowlists before
    persistence. Raw provider sessions and private reasoning never enter shared
    state.
15. Authentication and prohibited artifacts never enter the artifact store.
    Sensitive artifacts enter only after complete redaction.
16. Models cannot create, hide, or upgrade coverage status or evidence truth.
17. Blocked, partial, stale, corrupt, unsupported, and omitted results remain
    visible.
18. Commit, push, publish, deploy, and external sharing are separate explicit
    actions and cannot be implied by source-apply approval.

## Attack surface, mitigations, and attacker stories

### Abuse cases

| ID | Abuse case | Impact | Current M0 state | Required disposition |
| --- | --- | --- | --- | --- |
| TM-01 | Repository symlinks a required import file outside the project or to a device, FIFO, or huge file | Host read, hash disclosure, blocking, memory exhaustion | Not controlled by the prototype importer | Block before arbitrary-repository support |
| TM-02 | A manifest uses lexical traversal or a shell executable while still passing structural validation | Host escape or command execution | Schemas are draft and not sufficient authorization | Canonical containment and command policy |
| TM-03 | A package lifecycle script executes during install | Host RCE and credential theft | Installation is unavailable in M0 | Disposable sandbox, scripts disabled by default |
| TM-04 | A preview requests loopback, private-network, link-local, or cloud metadata resources | SSRF and credential disclosure | No production preview sandbox | Network deny by default plus redirect and DNS checks |
| TM-05 | A caller resolves an approval using only a known run and approval ID plus an arbitrary grant string | Unauthorized mutation | Fake harness does not verify a real grant | Signed immutable receipt and effect-bound verification |
| TM-06 | A handoff replaces the original permission ceiling with a broader list | Privilege escalation across harnesses | Handoff packet trusts caller-provided ceiling | Compute subset intersection and reapprove expansion |
| TM-07 | An expired grant or stale lease is used after the target changes | Stale or conflicting write | Protocol shapes exist; enforcement does not | Atomic grant, lease, revision, and fencing validation |
| TM-08 | An existing operation or event ID is reused with different content | Silent request suppression or false success | Existing prototype deduplicates by ID only | Bind idempotency key to action digest |
| TM-09 | Two journal instances append from the same stale snapshot | Duplicate sequence and broken trace chain | Reproduced in M0 review | Single durable writer or transactional allocation |
| TM-10 | Malformed, unknown, or oversized trace JSON is parsed and replayed | Corrupt history, spoofed state, denial of service | JSON is cast without boundary validation | Bounded streaming parse and strict schema/integrity gate |
| TM-11 | Provider output contains a token under an unrecognized field name | Secret persistence and export | Exact-key denylist only | Event-family allowlists and redaction pipeline |
| TM-12 | A malicious local website calls the privileged loopback runtime | Filesystem or agent authority theft | Runtime transport not implemented | Rotating token, origin checks, CSRF defense, socket preference |
| TM-13 | Imported content reaches an HTML, URL, SVG, or CSS execution sink | XSS or local-runtime request forgery | Current React demo uses escaped JSX | CSP, safe renderers, URL policy, no raw HTML |
| TM-14 | An archive, image, DOM snapshot, log, or patch consumes excessive disk or memory | Resource exhaustion and data loss | Artifact store not implemented | Size, type, expansion, count, quota, and retention limits |
| TM-15 | A patch targets `../`, an absolute path, a symlink, submodule, or the wrong worktree | Host or original-checkout mutation | ChangeSet apply is not implemented | Descriptor-relative safe open, path and Git checks |
| TM-16 | A crash occurs between intent, external effect, and trace commit | Ghost or repeated effect | Outbox is schema-only | SQLite intent/outbox reconciliation and verified terminal state |
| TM-17 | A compromised dependency or generated binary enters the release | Supply-chain compromise | Exact lockfile exists; release evidence is incomplete | SBOM, signature/provenance, license and binary review |
| TM-18 | Screenshots or traces include customer data, cookies, or private research | Privacy breach | Synthetic fixtures only | Classification, redaction, consent, retention, export preview |

### Current controls

The following controls reduce risk but are not sufficient for production:

- The current coded slice is labeled `Demo`; arbitrary repository modes and
  source editing are not represented as supported.
- Base import uses fixed fixture paths and performs no model calls, package
  installation, command execution, or network access.
- Protocol objects use strict Zod schemas, closed enums, branded IDs, content
  hash formats, and schema versions.
- Canvas operations check an expected-before document hash.
- Trace records include a SHA-256 hash chain and an integrity verifier.
- Replay code has no direct tool, Git, network, or process call.
- Harness registry selection is explicit and checks declared capabilities.
- Provider normalization removes known provider-session fields from shared
  payloads.
- Shared harness state omits adapter-private state.
- React renders current fixture text through escaped JSX and does not use raw
  HTML sinks.
- Runtime and development dependencies are pinned through `package-lock.json`.
  The 2026-07-27 `npm audit` reported zero known vulnerabilities.
- Open-source policy and provenance documents explicitly block release until
  their evidence and approvals are complete.

### Known control gaps

- Protocol schemas are not yet enforced by all executable modules.
- The importer does not yet reject symlinks, special files, or oversized input.
- Approval responses are not bound to a verified capability grant or action
  digest.
- Handoff can accept a caller-provided permission ceiling without proving it is
  a subset.
- The trace journal lacks a cross-instance writer authority.
- Replay does not itself require successful schema and integrity validation.
- Idempotency IDs are not bound to content.
- Provider payload redaction is a denylist rather than an allowlist.
- No sandbox, worktree-backed ChangeSet executor, local-runtime transport,
  encrypted vault, artifact store, or SQLite outbox has been approved or
  implemented.

## Required sandbox and ChangeSet controls

This section defines security requirements for a future decision. It is not an
approval of a specific sandbox technology or architecture.

### Sandbox requirements

- Start from deny-by-default filesystem, process, network, device, IPC, and
  credential access.
- Use a disposable execution identity and environment. Do not inherit the host
  shell environment, credentials, agents, sockets, or open file descriptors.
- Mount only an app-managed project copy or worktree. The original checkout is
  read-only or absent.
- Canonicalize the project root and perform symlink-safe, descriptor-relative
  file access. Reject devices, FIFOs, sockets, and paths outside the root.
- Disable package lifecycle scripts by default. Any exception is separately
  approved, visible, and executed only inside the sandbox.
- Deny network by default. Approved egress uses exact host, port, protocol, DNS,
  redirect, and IP checks and blocks loopback, private, link-local, multicast,
  and metadata ranges.
- Enforce CPU, memory, process count, file count, output size, disk, browser
  storage, and wall-clock budgets.
- Place every child process in a supervised group. Cancellation, timeout, crash,
  and runtime shutdown terminate the full descendant tree.
- Use an explicit secret broker only when a named action requires one secret.
  Never expose the general host environment or vault.
- Capture bounded stdout, stderr, exit, resource, and cleanup evidence without
  persisting secrets.
- Verify cleanup after success, failure, cancellation, and runtime restart.

### ChangeSet requirements

1. Create an app-managed worktree at a recorded baseline commit and tree hash.
2. Normalize each proposed path relative to that worktree and reject absolute
   paths, traversal, symlink escapes, submodule boundary crossings, and
   case-folding collisions.
3. Represent changes as strict, typed operations with before hashes, after
   hashes, modes, and bounded contents.
4. Build a human-readable diff, target list, blast radius, verification plan,
   and exact consequence.
5. Create an immutable approval receipt bound to the proposal digest, actor,
   project, worktree, baseline revision, target paths, capability set, expiry,
   and maximum uses.
6. Before apply, atomically verify the receipt, current tree hash, expected
   before hashes, active lease, fencing epoch, and idempotency action digest.
7. Apply only to the isolated worktree using symlink-safe file operations.
8. Run bounded verification in the sandbox and preserve passed, failed, and
   blocked evidence.
9. Record prepare, apply, verify, commit, fail, and recovery states through the
   durable outbox and semantic trace.
10. Require separate approvals for commit, push, publish, deploy, or copying
    results into another checkout.
11. On any mismatch, apply nothing further, preserve evidence, and require a
    refreshed proposal and approval.

### Approval and grant requirements

- Approval must be attributable to an authenticated human actor.
- The displayed scope and the enforced scope must be generated from the same
  canonical action digest.
- The runtime must parse and authorize the full grant, not accept a grant ID as
  proof.
- Capability checks occur at the effect boundary, not only in the UI or harness.
- Scope is monotonic during resume and handoff. It can narrow automatically but
  cannot broaden without reapproval.
- Expiry, revocation, use count, target revision, and fencing are checked in the
  same transaction that records intent.
- Rejection, expiration, cancellation, stale state, and invalidation apply
  nothing and remain visible in trace.

## Privacy and redaction rules

### Classification

Every durable artifact or event payload is classified before persistence:

| Class | Persistence rule |
| --- | --- |
| Public | May persist and export when provenance permits |
| Project-private | Persists locally and exports only with explicit confirmation |
| Sensitive | Persists only after complete redaction and policy approval |
| Authentication | Never enters trace or content-addressed artifacts; vault only |
| Prohibited | Reject and do not persist |

### Collection and minimization

- Send harnesses only the selected targets, required evidence, constraints, and
  accepted context.
- Do not request or store private reasoning.
- Do not persist raw provider events, provider session identifiers, cookies,
  authorization headers, environment dumps, or full network bodies.
- Use event-family payload allowlists. Unknown fields are rejected rather than
  recursively copied.
- Large evidence is referenced by artifact ID and verified hash, not embedded in
  trace JSON.
- Keep project, user, and provider identifiers pseudonymous where display names
  are not necessary.

### Redaction

- Redact structured credential fields, headers, cookies, URLs, query values,
  form data, environment variables, source-map contents, logs, DOM snapshots,
  screenshots, and patch context as applicable.
- Scan for seeded canary secrets and common token formats before persistence and
  export. Pattern matching supplements, but does not replace, structured
  allowlists.
- Preserve a redaction manifest that records what was removed without retaining
  the removed secret.
- A redaction failure makes the artifact blocked or prohibited. It never falls
  back to unredacted persistence.
- Diagnostic export previews included, omitted, redacted, missing, and corrupt
  artifacts before confirmation.

### Retention and deletion

- Retention is project-scoped, visible, and configurable.
- Authentication data uses the shortest practical lifetime in the encrypted
  vault.
- Reference counting and quarantine prevent garbage collection from deleting
  live evidence.
- Deletion removes local references and bytes according to policy and records a
  non-sensitive audit event.
- No telemetry or external upload is enabled by default.

## Negative-test plan

The tests below are required evidence for sandbox and M1 approval. Passing unit
tests alone is insufficient; platform-level escape and cleanup tests must run in
the selected sandbox implementation.

| ID | Negative test | Required result | Owner |
| --- | --- | --- | --- |
| SEC-T01 | Required import file is a symlink outside the project | Reject before reading target bytes | Import/runtime |
| SEC-T02 | File is a FIFO, device, socket, sparse giant, or over byte budget | Reject or terminate within budget | Import/runtime |
| SEC-T03 | Root or canonical path contains traversal, case collision, or alternate separator | Reject as outside scope | Runtime/Security |
| SEC-T04 | Manifest selects `/bin/sh`, `cmd`, PowerShell, or a shell `-c` action | Reject direct shell execution | Runtime/Security |
| SEC-T05 | Dependency has a malicious install or postinstall script | Script does not execute on host | Sandbox |
| SEC-T06 | Preview reads home, SSH, keychain, environment, Docker socket, or another repo | Access denied and audited | Sandbox |
| SEC-T07 | Preview attempts loopback, private subnet, metadata IP, DNS rebinding, or redirect escape | Network denied | Sandbox/Browser |
| SEC-T08 | Sandbox forks repeatedly, allocates excessive memory, fills disk, or runs past timeout | Bounded termination and cleanup | Sandbox/QA |
| SEC-T09 | Cancel or crash leaves child and grandchild processes | No descendant remains | Sandbox/QA |
| SEC-T10 | Approval uses arbitrary, expired, revoked, wrong-project, wrong-target, or used-up grant | Effect rejected | AI/Runtime |
| SEC-T11 | Handoff proposes a permission ceiling broader than the task | Packet rejected or reapproval required | AI/Runtime |
| SEC-T12 | Target hash or revision changes after approval | Approval invalidated; nothing applied | ChangeSet |
| SEC-T13 | Same idempotency key carries a different action digest | Fail closed without effect | Storage/Runtime |
| SEC-T14 | Two writers append concurrently to one trace | Unique order and valid hash chain | Storage/Trace |
| SEC-T15 | Trace is truncated, reordered, tampered, unknown-version, unknown-family, or oversized | Open or replay fails closed | Trace/QA |
| SEC-T16 | Replay input contains an effect-like event | No process, Git, network, tool, or current-state call | Trace/QA |
| SEC-T17 | Provider payload contains secrets under known and unknown field names | Secret absent from shared state, trace, logs, and export | AI/Privacy |
| SEC-T18 | Raw provider metadata is nested under alternate keys | Reject unknown payload fields | AI/Privacy |
| SEC-T19 | Browser request has foreign origin, missing token, stale token, or non-loopback source | Runtime rejects request | Runtime/Web |
| SEC-T20 | Imported text contains HTML, SVG, CSS, URL, or script payloads | No executable sink; CSP reports clean | Web/Security |
| SEC-T21 | Artifact is an archive bomb, decompression bomb, malformed image, or over quota | Reject within resource budget | Artifact/QA |
| SEC-T22 | Patch targets absolute, parent, symlink, submodule, `.git`, or original-checkout path | Reject before write | ChangeSet/Security |
| SEC-T23 | Crash is injected at every intent, apply, verify, and commit boundary | Reconcile without ghost or duplicate effect | Storage/QA |
| SEC-T24 | Seeded cookie, token, PII, and authentication artifact enters capture | Authentication rejected; sensitive data redacted | Privacy/QA |
| SEC-T25 | Dependency lock, integrity, license, provenance, or binary inventory is missing | Release gate fails | Supply chain/Legal |

## Validated risks, severity, owner, and remediation

| Risk ID | Severity | Validated condition | Accountable owner | Required remediation | Gate |
| --- | --- | --- | --- | --- | --- |
| M0-SEC-01 | High | Approval accepts an unchecked grant string and is not bound to actor, action digest, revision, expiry, or scope | AI Systems and Runtime | Implement immutable approval receipt and effect-bound grant validation | M1 blocker |
| M0-SEC-02 | High | Handoff can accept a caller-provided permission ceiling without proving it is a subset | AI Systems | Compute monotonic scope and require reapproval for expansion | M1 blocker |
| M0-SEC-03 | High | Two trace journal instances can allocate duplicate sequence numbers and break the hash chain | Storage and Trace | Use one transactional writer with lease and fencing | M1 blocker |
| M0-SEC-04 | High | Importer follows ordinary filesystem paths without canonical containment, symlink, type, or size enforcement | Import/runtime and Sandbox | Add capability-bound safe file access and budgets | Arbitrary-repo blocker |
| M0-SEC-05 | High | Executable boundaries do not consistently parse canonical protocol schemas | Architecture and Runtime | Parse every ingress and reject unknown or malformed data | M1 blocker |
| M0-SEC-06 | Medium | Replay can reduce unchecked events without requiring successful integrity verification | Trace | Couple validation, integrity, ordering, and replay | M1 blocker |
| M0-SEC-07 | Medium | Idempotency IDs are not bound to an action digest | Storage and Canvas/Trace | Persist key-to-digest mapping and reject mismatches | Mutation blocker |
| M0-SEC-08 | Medium | Provider filtering is exact-key denylisting and arbitrary payload can reach trace | AI Systems and Privacy | Event-specific allowlists, classification, redaction, artifact indirection | Live-harness blocker |
| M0-SEC-09 | Medium | Process, canonical path, and allowed-host schema constraints are not sufficient authorization policy | Runtime and Security | Normalize paths, prohibit shells, validate hosts and SSRF boundaries | Sandbox blocker |
| M0-SEC-10 | Medium | Sandbox, ChangeSet executor, vault, artifact store, and local-runtime transport are not implemented or approved | Architecture and Security | Complete threat-informed spikes and ADR decisions | M1 blocker |
| M0-SEC-11 | Release blocker | SBOM, transitive license scan, binary inventory, DCO, NOTICE, and legal approval are incomplete | Legal/licensing and Release | Produce and sign required release evidence | Public-release blocker |

Security, privacy, or evidence-integrity risks marked as blockers cannot be
waived through a general conditional-go decision.

## Severity calibration

### Critical

A finding is critical when it gives an untrusted repository, preview, website,
provider, or remote attacker direct arbitrary host code execution or broad
credential access without a meaningful user action. Examples:

- A repository import executes an install script on the host.
- A browser-origin request reaches an unauthenticated shell or Git endpoint.
- A sandbox escape exposes the home directory, credential store, or host runtime.

No confirmed critical path exists in the current fixture-only demo because it
does not install, execute, network, or apply source changes.

### High

A finding is high when it can authorize unauthorized mutation, escape project
filesystem scope, corrupt authoritative recovery evidence, or disclose secrets
under realistic planned use. Examples:

- Forged or broadened approval applies a source ChangeSet.
- A repository symlink reads outside the authorized project.
- Concurrent trace writers make audit and recovery untrustworthy.
- A stale lease or grant applies an operation to changed state.

### Medium

A finding is medium when it requires local access or additional conditions but
can corrupt project state, leak bounded project data, or cause sustained denial
of service. Examples:

- Malformed trace JSON causes replay failure.
- Idempotency-key reuse suppresses a distinct request.
- Provider payload fields bypass incomplete redaction.
- Artifact parsing exceeds a bounded worker's resources without escaping it.

### Low

A finding is low when impact is limited to non-sensitive presentation,
hardening, or diagnostics and no privileged boundary is crossed. Examples:

- Missing CSP on the current static fixture demo with no injection sink.
- Overly detailed local errors that expose no secret or path outside the
  selected project.
- A test-only fixture issue that cannot enter a shipping artifact.

## Approval and exit state

### Current decision

- M0 fixture demo continuation: **CONDITIONALLY PERMITTED**
  - Synthetic local fixtures only
  - No arbitrary repository claim
  - No package installation or preview execution
  - No live source, Git, network, or publish effect
  - No secrets, authenticated browser state, or customer data
- M1 production integration: **NO-GO**
- Public release: **NO-GO**
- Sandbox architecture: **NOT DECIDED**
- ChangeSet application architecture: **NOT DECIDED**
- Product Security sign-off: **NOT APPROVED**

### Required evidence before approval

- Approved sandbox ADR and process-boundary diagram
- Sandbox feasibility report covering path escape, malicious scripts, SSRF,
  secrets, resource limits, process cleanup, and platform differences
- Worktree-backed ChangeSet design and negative-test evidence
- Approval, grant, lease, fencing, and idempotency conformance tests
- Single-authority trace and crash-window evidence
- Protocol parsing at every executable boundary
- Privacy classification, redaction, retention, and export evidence
- Loopback or socket authentication, origin, CSRF, and CSP evidence
- Supply-chain, provenance, SBOM, license, and legal approval
- Product Security, Architecture, QA/Release, Privacy, and Legal signatures

### Signatures

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Product Security | Unassigned | **NOT APPROVED** | Not signed |
| Principal Architect | Unassigned | REVIEW REQUIRED | Not signed |
| Runtime Engineering | Unassigned | REVIEW REQUIRED | Not signed |
| AI Systems | Unassigned | REVIEW REQUIRED | Not signed |
| Data/Storage | Unassigned | REVIEW REQUIRED | Not signed |
| QA/Release | Unassigned | REVIEW REQUIRED | Not signed |
| Privacy | Unassigned | REVIEW REQUIRED | Not signed |
| Legal/licensing | Unassigned | REVIEW REQUIRED | Not signed |

Repository: local Memi Canvas checkout
Version: 036e9aef9c55527c657d974d8cd6380a578addf3 plus concurrent uncommitted M0 working tree
