# M0 Sandbox Feasibility

**Status:** RED / NO-GO for product execution
**Product Security:** NOT APPROVED
**Sandbox decision:** NOT COMPLETE / NOT DECIDED
**Owner:** Security Engineering
**Reviewers:** Architecture, Runtime, Product Security
**Evidence date:** 2026-07-27
**Test revisions:** `3c0de63`, `be67907`, `5b3c054`, `1ae07b1`

## Question and risk

Can the current macOS host run an exact executable against read-only source
roots and isolated writable roots while denying shell, ambient environment,
network, host-file, path-escape, and unbounded-resource access?

The risk is arbitrary repository execution with host authority. A provider
must fail closed, prove the policy applied, bound resources and output, and
prove every descendant stopped. A green regression suite is not a release
decision when any one of those properties is unproven.

## Method

The spike uses `/usr/bin/sandbox-exec` with a generated default-deny profile.
The host was macOS 26.2 arm64 with Node.js 22.22.3 from a user-managed runtime.

Each fixture creates disjoint canonical source, worktree, temp, outside, and
synthetic home roots. The provider accepts only provider-authorized canonical
roots, rejects symlinks in every path component, passes an explicit
environment, invokes no shell, bounds captured output, and terminates the
spawned process group on timeout, abort, or output overflow.

Availability runs a live pair of canaries: an allow-default profile must run
`/usr/bin/true`, and a deny-default profile must reject it. Passing this canary
means the mechanism applies policy on this host. It does not make the provider
security-ready.

The startup-read matrix reduced host reads to the exact Node executable,
`/System/Library/OpenSSL/openssl.cnf`, `/dev/null`, `/dev/urandom`, the
declared roots, and literal `/`. Broad reads of `/System`, `/usr/lib`,
`/usr/share`, `/private/etc`, dyld data, and timezone data were removed.
`sysctl-read` and mach lookup rules were also removed.

## Evidence

| Attack or property | Result | Evidence |
|---|---|---|
| Provider missing or unsupported platform | Pass | Returns `provider-unavailable`; no child-process fallback |
| Live enforcement canary | Pass | Fake provider fails; current `sandbox-exec` passes allow/deny pair |
| Product readiness gate | Pass | `availability.enforced=false`, `ready=false`; execution requires explicit `feasibilityMode` |
| Shell execution | Pass | `sh`, `bash`, and `zsh` rejected even when configured |
| Executable authority | Pass | Exact canonical regular-file allowlist; executable symlinks rejected |
| Argument and environment bounds | Pass | Count, per-value, aggregate UTF-8, and NUL limits enforced before spawn |
| Ambient environment | Pass | Host secret and `HOME` absent; only explicit allowed keys plus fixed sandbox values |
| Source and writable roots | Pass | Source readable but not writable; worktree and temp writable |
| Outside and sensitive reads | Pass | Synthetic home, SSH, outside file, `/private/etc/passwd`, and executable parent listing denied |
| Outside writes and symlink escape | Pass | Direct outside write and writable-root symlink escape denied |
| Root path symlinks | Pass | Final and intermediate symlink components rejected |
| Network | Pass | Loopback and external TCP denied |
| Inherited descriptors | Pass | Already-open host file descriptor is not inherited |
| Timeout and abort | Partial | Main process group is terminated |
| Detached descendant | **Fail** | A child that creates a new process group survives provider group cleanup |
| Direct parent exit with child alive | Partial | `sandbox-exec` did not report completion for the tested child, but absence of all descendants is not verified |
| Output flood | Pass with limitation | Process terminated; retained stdout/stderr stay within byte bounds |
| Output evidence | Partial | All observed chunks are counted and hashed; only the bounded prefix is retained |
| CPU, memory, process, disk quotas | **Fail / absent** | Not enforced by this provider |

Host result: 28 of 28 regression and adversarial tests pass, including a test
that records and cleans up the known detached-descendant escape. That test is
evidence for the NO-GO decision, not a containment pass.

Coverage for `packages/sandbox/src/**/*.ts`:

- Statements: 89.42%
- Branches: 83.08%
- Functions: 92.15%
- Lines: 89.63%

## Result truth and protocol mapping

Every spawned local result includes the generated policy hash, observed and
captured byte counts, an observed-stream SHA-256 digest, and explicit cleanup
evidence. Cleanup is currently:

```text
verified=false
scope=process-group-only
remainingDescendants=unknown
```

The retained text is only a bounded prefix. The hash covers bytes observed by
the parent before stream closure; it does not make discarded content
recoverable and must not be described as an output artifact.

The local provider interface intentionally differs from the canonical
protocol. An eventual adapter would map local `executable` to
`executablePath`, scalar limits to `limits`, and local output byte fields to
`observedByteLength` and `capturedByteLength`. It must also bind the generated
policy hash to the canonical profile and request hashes.

No adapter may emit a canonical `ProcessResult` from this provider while
`cleanupEvidence.verified` is false or the provider readiness gate is false.
Bounded local text must be omitted or explicitly classified during mapping.
The canonical `ProcessResult` cannot currently encode verified descendant
cleanup. The protocol must be extended before any provider adapter is allowed.
A runtime crash during a non-probeable process operation is
`outcome-unknown` and must never trigger automatic retry.

## Blocking limitations

1. `sandbox-exec` is deprecated by Apple.
2. Detached descendants can escape process-group termination.
3. The provider cannot prove that no descendant remains after normal exit.
4. The canonical profile `maximumProcesses` value is not enforced.
5. There are no CPU, memory, process-count, disk-byte, or file-count quotas.
6. Literal `/` read access is required by this Node build and exposes top-level
   root directory entry names.
7. Node startup requires read access to the exact system OpenSSL configuration
   file.
8. Path and executable identity checks are not descriptor-relative or atomic
   with spawn, leaving a time-of-check/time-of-use race.
9. The implementation supports only macOS and has no Linux or Windows
   provider.
10. There is no signed app-bundled helper, App Sandbox entitlement model, VM,
    or container boundary.
11. Canonical request-to-profile hash binding and the result adapter are not
    implemented.
12. Durable outbox/recovery integration is not implemented.

## Decision

Keep this code as bounded M0 feasibility and regression evidence. Do not
enable arbitrary repository execution, do not mark the provider ready, and do
not treat local successful commands as canonical process success.

The next decision must compare at least:

- a signed app-bundled helper with a verifiable containment model,
- an Apple-supported App Sandbox design,
- a VM or container boundary with descendant and resource accounting.

Any candidate must pass detached-process cleanup, CPU, memory, process-count,
disk, crash-recovery, and profile-binding tests before Product Security can
approve it.

## Reproduction

```sh
npx vitest run packages/sandbox/test/contract.test.ts packages/sandbox/test/macos-adversarial.test.ts --reporter=verbose
npx vitest run packages/sandbox/test/contract.test.ts packages/sandbox/test/macos-adversarial.test.ts --coverage --coverage.include='packages/sandbox/src/**/*.ts' --coverage.reporter=text --coverage.reporter=json-summary
npx oxlint packages/sandbox
npm run typecheck
```

The live adversarial suite is explicitly skipped on non-macOS hosts. A skip is
not cross-platform evidence.

## Approval and veto

- Product Security approval: **VETO / NOT APPROVED**
- Architecture review: **APPROVED FOR FEASIBILITY EVIDENCE ONLY**
- Runtime enablement: **BLOCKED**
- Arbitrary repository execution: **BLOCKED**
- Feasibility experiments with `feasibilityMode: true`: allowed only in the
  controlled local test suite with explicit cleanup of the known escape case
- Revisit when a candidate provides verified descendant cleanup and enforceable
  resource quotas
