import { z } from "zod";

import {
  ContentHashSchema,
  IsoTimestampSchema,
  SchemaVersionSchema,
  hasUniqueValues,
} from "./common.js";
import {
  ArtifactIdSchema,
  DurableCommandIdSchema,
  ProcessRequestIdSchema,
  ProjectIdSchema,
  SandboxProfileIdSchema,
} from "./ids.js";

export const CanonicalPosixPathSchema = z
  .string()
  .refine((value) => value.startsWith("/"), "Path must be absolute.")
  .refine((value) => !value.includes("\0"), "Path cannot contain NUL.")
  .refine(
    (value) =>
      value === "/" ||
      (!value.endsWith("/") &&
        value.split("/").every((segment) => segment !== "." && segment !== "..")),
    "Path must be lexically canonical.",
  );
export type CanonicalPosixPath = z.infer<
  typeof CanonicalPosixPathSchema
>;

const SandboxLimitsSchema = z.strictObject({
  timeoutMs: z.number().int().positive().max(86_400_000),
  maxStdoutBytes: z.number().int().positive().max(67_108_864),
  maxStderrBytes: z.number().int().positive().max(67_108_864),
});

const MAX_ARGUMENT_COUNT = 256;
const MAX_ARGUMENT_BYTES = 16_384;
const MAX_ARGUMENT_BYTES_TOTAL = 131_072;
const MAX_ENVIRONMENT_ENTRIES = 128;
const MAX_ENVIRONMENT_VALUE_BYTES = 32_768;
const MAX_ENVIRONMENT_BYTES_TOTAL = 131_072;
const utf8Encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

function pathContains(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  return pathContains(left, right) || pathContains(right, left);
}

export const SandboxProfileSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: SandboxProfileIdSchema,
    projectId: ProjectIdSchema,
    provider: z.strictObject({
      kind: z.literal("macos-sandbox-exec"),
      platform: z.literal("darwin"),
      enforcement: z.literal("required"),
    }),
    filesystem: z.strictObject({
      readOnlyRoots: z.array(CanonicalPosixPathSchema).min(1),
      writableRoots: z.array(CanonicalPosixPathSchema).min(1),
      denyOutsideRoots: z.literal(true),
    }),
    network: z.strictObject({
      mode: z.literal("deny"),
    }),
    process: z.strictObject({
      allowedExecutables: z.array(CanonicalPosixPathSchema).min(1),
      maximumProcesses: z.number().int().positive().max(64),
    }),
    environment: z.strictObject({
      inherit: z.literal(false),
      allowedKeys: z
        .array(z.string().regex(/^[A-Z_][A-Z0-9_]*$/u))
        .max(128),
    }),
    limits: SandboxLimitsSchema,
    profileHash: ContentHashSchema,
    createdAt: IsoTimestampSchema,
  })
  .superRefine((profile, context) => {
    for (const [path, values] of [
      ["filesystem.readOnlyRoots", profile.filesystem.readOnlyRoots],
      ["filesystem.writableRoots", profile.filesystem.writableRoots],
      ["process.allowedExecutables", profile.process.allowedExecutables],
      ["environment.allowedKeys", profile.environment.allowedKeys],
    ] as const) {
      if (!hasUniqueValues(values)) {
        context.addIssue({
          code: "custom",
          path: path.split("."),
          message: "Sandbox allowlists must contain unique values.",
        });
      }
    }

    for (const readOnlyRoot of profile.filesystem.readOnlyRoots) {
      for (const writableRoot of profile.filesystem.writableRoots) {
        if (pathsOverlap(readOnlyRoot, writableRoot)) {
          context.addIssue({
            code: "custom",
            path: ["filesystem", "writableRoots"],
            message: "Read-only and writable roots cannot overlap.",
          });
        }
      }
    }
  });
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

export const ProcessRequestSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    id: ProcessRequestIdSchema,
    projectId: ProjectIdSchema,
    commandId: DurableCommandIdSchema,
    sandboxProfileId: SandboxProfileIdSchema,
    sandboxProfileHash: ContentHashSchema,
    executablePath: CanonicalPosixPathSchema,
    args: z.array(z.string()).max(MAX_ARGUMENT_COUNT),
    cwd: CanonicalPosixPathSchema,
    environment: z.record(
      z.string().regex(/^[A-Z_][A-Z0-9_]*$/u),
      z.string(),
    ),
    stdin: z.strictObject({
      kind: z.literal("none"),
    }),
    limits: SandboxLimitsSchema,
    requestedAt: IsoTimestampSchema,
  })
  .superRefine((request, context) => {
    let aggregateArgumentBytes = 0;
    for (const [index, argument] of request.args.entries()) {
      const bytes = utf8ByteLength(argument);
      aggregateArgumentBytes += bytes;
      if (bytes > MAX_ARGUMENT_BYTES || argument.includes("\0")) {
        context.addIssue({
          code: "custom",
          path: ["args", index],
          message: "Process argument exceeds its byte limit or contains NUL.",
        });
      }
    }
    if (aggregateArgumentBytes > MAX_ARGUMENT_BYTES_TOTAL) {
      context.addIssue({
        code: "custom",
        path: ["args"],
        message: "Aggregate process arguments exceed their byte limit.",
      });
    }

    const environmentEntries = Object.entries(request.environment);
    if (environmentEntries.length > MAX_ENVIRONMENT_ENTRIES) {
      context.addIssue({
        code: "custom",
        path: ["environment"],
        message: "Environment contains too many entries.",
      });
    }
    let aggregateEnvironmentBytes = 0;
    for (const [key, value] of environmentEntries) {
      const valueBytes = utf8ByteLength(value);
      aggregateEnvironmentBytes += utf8ByteLength(key) + valueBytes;
      if (valueBytes > MAX_ENVIRONMENT_VALUE_BYTES || value.includes("\0")) {
        context.addIssue({
          code: "custom",
          path: ["environment", key],
          message:
            "Environment value exceeds its byte limit or contains NUL.",
        });
      }
    }
    if (aggregateEnvironmentBytes > MAX_ENVIRONMENT_BYTES_TOTAL) {
      context.addIssue({
        code: "custom",
        path: ["environment"],
        message: "Aggregate environment exceeds its byte limit.",
      });
    }
  });
export type ProcessRequest = z.infer<typeof ProcessRequestSchema>;

export const SandboxDispatchSchema = z
  .strictObject({
    profile: SandboxProfileSchema,
    request: ProcessRequestSchema,
  })
  .superRefine(({ profile, request }, context) => {
    if (
      request.projectId !== profile.projectId ||
      request.sandboxProfileId !== profile.id ||
      request.sandboxProfileHash !== profile.profileHash
    ) {
      context.addIssue({
        code: "custom",
        path: ["request", "sandboxProfileId"],
        message: "Process request is not bound to this sandbox profile.",
      });
    }
    if (!profile.process.allowedExecutables.includes(request.executablePath)) {
      context.addIssue({
        code: "custom",
        path: ["request", "executablePath"],
        message: "Executable is outside the sandbox allowlist.",
      });
    }
    if (
      !profile.filesystem.writableRoots.some((root) =>
        pathContains(root, request.cwd),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["request", "cwd"],
        message: "Working directory must be inside a writable root.",
      });
    }
    for (const key of Object.keys(request.environment)) {
      if (!profile.environment.allowedKeys.includes(key)) {
        context.addIssue({
          code: "custom",
          path: ["request", "environment", key],
          message: "Environment key is outside the sandbox allowlist.",
        });
      }
    }
    for (const key of [
      "timeoutMs",
      "maxStdoutBytes",
      "maxStderrBytes",
    ] as const) {
      if (request.limits[key] > profile.limits[key]) {
        context.addIssue({
          code: "custom",
          path: ["request", "limits", key],
          message: "Process request exceeds its sandbox profile budget.",
        });
      }
    }
  });
export type SandboxDispatch = z.infer<typeof SandboxDispatchSchema>;

const SandboxProviderEvidenceSchema = z.strictObject({
  provider: z.literal("macos-sandbox-exec"),
  platform: z.literal("darwin"),
  enforcement: z.literal("enforced"),
  policyHash: ContentHashSchema,
});

export const VerifiedProcessCleanupEvidenceSchema = z.strictObject({
  kind: z.literal("verified"),
  verified: z.literal(true),
  remainingDescendants: z.literal(0),
  verifiedAt: IsoTimestampSchema,
  evidenceHash: ContentHashSchema,
});
export type VerifiedProcessCleanupEvidence = z.infer<
  typeof VerifiedProcessCleanupEvidenceSchema
>;

export const NotStartedProcessCleanupEvidenceSchema = z.strictObject({
  kind: z.literal("not-started"),
  processStarted: z.literal(false),
});
export type NotStartedProcessCleanupEvidence = z.infer<
  typeof NotStartedProcessCleanupEvidenceSchema
>;

export const ProcessCleanupEvidenceSchema = z.discriminatedUnion("kind", [
  VerifiedProcessCleanupEvidenceSchema,
  NotStartedProcessCleanupEvidenceSchema,
]);
export type ProcessCleanupEvidence = z.infer<
  typeof ProcessCleanupEvidenceSchema
>;

const ProcessOutputSchema = z
  .strictObject({
    observedByteLength: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    capturedByteLength: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    contentHash: ContentHashSchema,
    artifactId: ArtifactIdSchema.nullable(),
    truncated: z.boolean(),
  })
  .superRefine((output, context) => {
    if (output.capturedByteLength > output.observedByteLength) {
      context.addIssue({
        code: "custom",
        path: ["capturedByteLength"],
        message: "Captured bytes cannot exceed observed bytes.",
      });
    }
    if (
      output.truncated !==
      (output.observedByteLength > output.capturedByteLength)
    ) {
      context.addIssue({
        code: "custom",
        path: ["truncated"],
        message: "Output truncation must match observed and captured bytes.",
      });
    }
  });

const ProcessErrorSchema = z.strictObject({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
  message: z.string().trim().min(1),
});

const processResultBase = {
  schemaVersion: SchemaVersionSchema,
  requestId: ProcessRequestIdSchema,
  projectId: ProjectIdSchema,
  commandId: DurableCommandIdSchema,
  sandboxProfileId: SandboxProfileIdSchema,
  sandboxProfileHash: ContentHashSchema,
};

const CompletedProcessResultSchema = z.strictObject({
  ...processResultBase,
  status: z.literal("completed"),
  providerEvidence: SandboxProviderEvidenceSchema,
  cleanupEvidence: VerifiedProcessCleanupEvidenceSchema,
  startedAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema,
  exit: z.strictObject({
    code: z.number().int().nullable(),
    signal: z.string().trim().min(1).nullable(),
  }),
  stdout: ProcessOutputSchema,
  stderr: ProcessOutputSchema,
});

const DeniedProcessResultSchema = z.strictObject({
  ...processResultBase,
  status: z.literal("denied"),
  cleanupEvidence: NotStartedProcessCleanupEvidenceSchema,
  deniedAt: IsoTimestampSchema,
  error: ProcessErrorSchema,
});

const ProviderUnavailableResultSchema = z.strictObject({
  ...processResultBase,
  status: z.literal("provider-unavailable"),
  cleanupEvidence: NotStartedProcessCleanupEvidenceSchema,
  failedAt: IsoTimestampSchema,
  error: ProcessErrorSchema,
});

function executionFailureResult<const Status extends string>(
  status: Status,
) {
  return z.strictObject({
    ...processResultBase,
    status: z.literal(status),
    providerEvidence: SandboxProviderEvidenceSchema,
    cleanupEvidence: VerifiedProcessCleanupEvidenceSchema,
    startedAt: IsoTimestampSchema,
    failedAt: IsoTimestampSchema,
    error: ProcessErrorSchema,
    stdout: ProcessOutputSchema,
    stderr: ProcessOutputSchema,
  });
}

export const ProcessResultSchema = z
  .discriminatedUnion("status", [
    CompletedProcessResultSchema,
    DeniedProcessResultSchema,
    executionFailureResult("timed-out"),
    executionFailureResult("output-limit-exceeded"),
    ProviderUnavailableResultSchema,
    executionFailureResult("failed"),
  ])
  .superRefine((result, context) => {
    if (
      result.status === "completed" &&
      (result.exit.code !== 0 || result.exit.signal !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["exit"],
        message:
          "Completed processes require exit code zero and no signal.",
      });
    }
    if (
      result.status === "completed" &&
      (Date.parse(result.finishedAt) < Date.parse(result.startedAt) ||
        Date.parse(result.cleanupEvidence.verifiedAt) <
          Date.parse(result.finishedAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["cleanupEvidence", "verifiedAt"],
        message:
          "Verified cleanup must occur after successful process completion.",
      });
    }
    if (
      (result.status === "timed-out" ||
        result.status === "output-limit-exceeded" ||
        result.status === "failed") &&
      (Date.parse(result.failedAt) < Date.parse(result.startedAt) ||
        Date.parse(result.cleanupEvidence.verifiedAt) <
          Date.parse(result.failedAt))
    ) {
      context.addIssue({
        code: "custom",
        path: ["cleanupEvidence", "verifiedAt"],
        message:
          "Verified cleanup must occur after the process failure boundary.",
      });
    }
  });
export type ProcessResult = z.infer<typeof ProcessResultSchema>;
