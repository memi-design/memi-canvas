import { describe, expect, it } from "vitest";

import {
  ProcessRequestSchema,
  ProcessResultSchema,
  SandboxDispatchSchema,
  SandboxProfileSchema,
} from "../src/index.js";
import { hash, ids, nextHash, timestamp } from "./fixtures.js";

const profile = {
  schemaVersion: 1,
  id: "sbx_01J00000000000000000000000",
  projectId: ids.project,
  provider: {
    kind: "macos-sandbox-exec",
    platform: "darwin",
    enforcement: "required",
  },
  filesystem: {
    readOnlyRoots: ["/workspace/source"],
    writableRoots: ["/workspace/worktree", "/workspace/temp"],
    denyOutsideRoots: true,
  },
  network: { mode: "deny" },
  process: {
    allowedExecutables: ["/usr/bin/node", "/usr/bin/git"],
    maximumProcesses: 4,
  },
  environment: {
    inherit: false,
    allowedKeys: ["CI", "PATH"],
  },
  limits: {
    timeoutMs: 60_000,
    maxStdoutBytes: 1_000_000,
    maxStderrBytes: 1_000_000,
  },
  profileHash: hash,
  createdAt: timestamp,
} as const;

const request = {
  schemaVersion: 1,
  id: "prq_01J00000000000000000000000",
  projectId: ids.project,
  commandId: "cmd_01J00000000000000000000000",
  sandboxProfileId: profile.id,
  sandboxProfileHash: profile.profileHash,
  executablePath: "/usr/bin/node",
  args: ["--version"],
  cwd: "/workspace/worktree",
  environment: { CI: "1", PATH: "/usr/bin" },
  stdin: { kind: "none" },
  limits: {
    timeoutMs: 10_000,
    maxStdoutBytes: 100_000,
    maxStderrBytes: 100_000,
  },
  requestedAt: timestamp,
} as const;

const providerEvidence = {
  provider: "macos-sandbox-exec",
  platform: "darwin",
  enforcement: "enforced",
  policyHash: hash,
} as const;

const emptyOutput = {
  observedByteLength: 0,
  capturedByteLength: 0,
  contentHash: nextHash,
  artifactId: null,
  truncated: false,
} as const;

const verifiedCleanup = {
  kind: "verified",
  verified: true,
  remainingDescendants: 0,
  verifiedAt: "2026-07-28T12:00:01.000Z",
  evidenceHash: hash,
} as const;

const notStartedCleanup = {
  kind: "not-started",
  processStarted: false,
} as const;

describe("SandboxProfile", () => {
  it("accepts a closed, deny-by-default macOS M0 profile", () => {
    expect(SandboxProfileSchema.parse(profile)).toEqual(profile);
  });

  it("rejects inherited environments, network access, and overlapping roots", () => {
    expect(
      SandboxProfileSchema.safeParse({
        ...profile,
        environment: { ...profile.environment, inherit: true },
      }).success,
    ).toBe(false);
    expect(
      SandboxProfileSchema.safeParse({
        ...profile,
        network: { mode: "allow" },
      }).success,
    ).toBe(false);
    expect(
      SandboxProfileSchema.safeParse({
        ...profile,
        filesystem: {
          ...profile.filesystem,
          writableRoots: ["/workspace/source/output"],
        },
      }).success,
    ).toBe(false);
  });

  it("requires canonical absolute roots and executable paths", () => {
    expect(
      SandboxProfileSchema.safeParse({
        ...profile,
        process: {
          ...profile.process,
          allowedExecutables: ["node"],
        },
      }).success,
    ).toBe(false);
    expect(
      SandboxProfileSchema.safeParse({
        ...profile,
        filesystem: {
          ...profile.filesystem,
          readOnlyRoots: ["/workspace/../secret"],
        },
      }).success,
    ).toBe(false);
  });
});

describe("ProcessRequest and sandbox dispatch", () => {
  it("binds every request to an exact profile hash and bounded process action", () => {
    expect(ProcessRequestSchema.parse(request)).toEqual(request);
    expect(
      SandboxDispatchSchema.parse({ profile, request }).request,
    ).toEqual(request);
  });

  it("rejects shell strings, disallowed executables, environment keys, and cwd escapes", () => {
    for (const invalidRequest of [
      { ...request, executablePath: "/bin/sh" },
      { ...request, environment: { SECRET: "do-not-pass" } },
      { ...request, cwd: "/workspace/source" },
      { ...request, cwd: "/workspace/worktree/../source" },
    ]) {
      expect(
        SandboxDispatchSchema.safeParse({
          profile,
          request: invalidRequest,
        }).success,
      ).toBe(false);
    }
    expect(
      ProcessRequestSchema.safeParse({
        ...request,
        command: "node --version",
      }).success,
    ).toBe(false);
  });

  it("rejects request budgets that exceed the bound profile", () => {
    expect(
      SandboxDispatchSchema.safeParse({
        profile,
        request: {
          ...request,
          limits: {
            ...request.limits,
            timeoutMs: profile.limits.timeoutMs + 1,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("bounds individual and aggregate argv and environment bytes", () => {
    expect(
      ProcessRequestSchema.safeParse({
        ...request,
        args: ["a".repeat(16_385)],
      }).success,
    ).toBe(false);
    expect(
      ProcessRequestSchema.safeParse({
        ...request,
        args: Array.from({ length: 9 }, () => "a".repeat(16_384)),
      }).success,
    ).toBe(false);
    expect(
      ProcessRequestSchema.safeParse({
        ...request,
        environment: { CI: "a".repeat(32_769) },
      }).success,
    ).toBe(false);
    expect(
      ProcessRequestSchema.safeParse({
        ...request,
        environment: Object.fromEntries(
          Array.from({ length: 5 }, (_, index) => [
            `VALUE_${index}`,
            "a".repeat(32_768),
          ]),
        ),
      }).success,
    ).toBe(false);
  });
});

describe("ProcessResult", () => {
  it("requires enforced provider evidence and bounded output metadata on completion", () => {
    const completed = {
      schemaVersion: 1,
      requestId: request.id,
      projectId: ids.project,
      commandId: request.commandId,
      sandboxProfileId: profile.id,
      sandboxProfileHash: profile.profileHash,
      status: "completed",
      providerEvidence,
      cleanupEvidence: verifiedCleanup,
      startedAt: timestamp,
      finishedAt: "2026-07-28T12:00:01.000Z",
      exit: { code: 0, signal: null },
      stdout: emptyOutput,
      stderr: emptyOutput,
    } as const;

    expect(ProcessResultSchema.parse(completed)).toEqual(completed);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        providerEvidence: {
          ...providerEvidence,
          enforcement: "best-effort",
        },
      }).success,
    ).toBe(false);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        stdout: { ...emptyOutput, inlineText: "unbounded output" },
      }).success,
    ).toBe(false);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        exit: { code: 1, signal: null },
      }).success,
    ).toBe(false);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        exit: { code: null, signal: "SIGTERM" },
      }).success,
    ).toBe(false);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        cleanupEvidence: {
          kind: "process-group-only",
          verified: false,
          remainingDescendants: "unknown",
        },
      }).success,
    ).toBe(false);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        cleanupEvidence: {
          ...verifiedCleanup,
          remainingDescendants: 1,
        },
      }).success,
    ).toBe(false);
    const { cleanupEvidence: _cleanupEvidence, ...withoutCleanup } = completed;
    expect(ProcessResultSchema.safeParse(withoutCleanup).success).toBe(false);
  });

  it("keeps observed and captured output bytes truthful", () => {
    const completed = {
      schemaVersion: 1,
      requestId: request.id,
      projectId: ids.project,
      commandId: request.commandId,
      sandboxProfileId: profile.id,
      sandboxProfileHash: profile.profileHash,
      status: "completed",
      providerEvidence,
      cleanupEvidence: verifiedCleanup,
      startedAt: timestamp,
      finishedAt: "2026-07-28T12:00:01.000Z",
      exit: { code: 0, signal: null },
      stdout: {
        ...emptyOutput,
        observedByteLength: 12,
        capturedByteLength: 8,
        truncated: true,
      },
      stderr: emptyOutput,
    } as const;

    expect(ProcessResultSchema.safeParse(completed).success).toBe(true);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        stdout: {
          ...completed.stdout,
          capturedByteLength: 13,
        },
      }).success,
    ).toBe(false);
    expect(
      ProcessResultSchema.safeParse({
        ...completed,
        stdout: {
          ...completed.stdout,
          truncated: false,
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    "denied",
    "timed-out",
    "output-limit-exceeded",
    "provider-unavailable",
    "failed",
  ] as const)("accepts the explicit terminal status %s", (status) => {
    const terminal =
      status === "provider-unavailable"
        ? {
            schemaVersion: 1,
            requestId: request.id,
            projectId: ids.project,
            commandId: request.commandId,
            sandboxProfileId: profile.id,
            sandboxProfileHash: profile.profileHash,
            status,
            cleanupEvidence: notStartedCleanup,
            failedAt: timestamp,
            error: {
              code: "SANDBOX_PROVIDER_UNAVAILABLE",
              message: "No enforcing provider is available.",
            },
          }
        : status === "denied"
          ? {
              schemaVersion: 1,
              requestId: request.id,
              projectId: ids.project,
              commandId: request.commandId,
              sandboxProfileId: profile.id,
              sandboxProfileHash: profile.profileHash,
              status,
              cleanupEvidence: notStartedCleanup,
              deniedAt: timestamp,
              error: {
                code: "SANDBOX_POLICY_DENIED",
                message: "Executable is outside the allowlist.",
              },
            }
          : {
              schemaVersion: 1,
              requestId: request.id,
              projectId: ids.project,
              commandId: request.commandId,
              sandboxProfileId: profile.id,
              sandboxProfileHash: profile.profileHash,
              status,
              providerEvidence,
              cleanupEvidence: verifiedCleanup,
              startedAt: timestamp,
              failedAt: "2026-07-28T12:00:01.000Z",
              error: {
                code: "PROCESS_EXECUTION_FAILED",
                message: "The process did not complete.",
              },
              stdout: emptyOutput,
              stderr: emptyOutput,
            };

    expect(ProcessResultSchema.parse(terminal).status).toBe(status);
  });

  it("keeps pre-spawn outcomes explicit and free of fabricated cleanup proof", () => {
    const denied = {
      schemaVersion: 1,
      requestId: request.id,
      projectId: ids.project,
      commandId: request.commandId,
      sandboxProfileId: profile.id,
      sandboxProfileHash: profile.profileHash,
      status: "denied",
      cleanupEvidence: notStartedCleanup,
      deniedAt: timestamp,
      error: {
        code: "SANDBOX_POLICY_DENIED",
        message: "Executable is outside the allowlist.",
      },
    } as const;

    expect(ProcessResultSchema.safeParse(denied).success).toBe(true);
    expect(
      ProcessResultSchema.safeParse({
        ...denied,
        cleanupEvidence: verifiedCleanup,
      }).success,
    ).toBe(false);
  });
});
