import {
  existsSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  RecoveryAttemptIdSchema,
  TargetVerificationResultSchema,
  TraceEventIdSchema,
  type TargetVerificationRequest,
} from "../../protocol/src/index.js";
import {
  DurableRuntime,
  type CanvasTargetAdapter,
  type CommitClaim,
  type EffectExecutor,
} from "./index.js";
import { MutableClock, sortableId } from "./test-fixtures.js";

const BARRIER_TIMEOUT_MS = 10_000;

interface WorkerConfiguration {
  readonly databasePath: string;
  readonly commandId: string;
  readonly suffix: string;
  readonly claim?: CommitClaim;
  readonly initialClock: string;
  readonly afterBarrierClock?: string;
  readonly verificationCheckedAt: string;
  readonly resultPath: string;
  readonly launchReadyPath?: string;
  readonly launchStartPath?: string;
  readonly claimReadyPath?: string;
  readonly claimStartPath?: string;
  readonly targetReadyPath?: string;
  readonly targetStartPath?: string;
  readonly expectedErrorCodes?: readonly string[];
}

function parseConfiguration(): WorkerConfiguration | undefined {
  const raw = process.env.MEMI_CANVAS_TRACE_CONCURRENCY_WORKER;
  if (raw === undefined) return undefined;
  const value = JSON.parse(raw) as WorkerConfiguration;
  const root = dirname(resolve(value.databasePath));
  const paths = [
    value.resultPath,
    value.launchReadyPath,
    value.launchStartPath,
    value.claimReadyPath,
    value.claimStartPath,
    value.targetReadyPath,
    value.targetStartPath,
  ].filter((path): path is string => path !== undefined);
  if (
    typeof value.commandId !== "string" ||
    !/^[A-Z0-9]$/u.test(value.suffix) ||
    paths.some((path) => dirname(resolve(path)) !== root)
  ) {
    throw new Error("Concurrency worker configuration is not confined.");
  }
  return value;
}

const configuration = parseConfiguration();

function publishJson(path: string, value: unknown): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(value), {
    encoding: "utf8",
    flag: "wx",
  });
  renameSync(temporaryPath, path);
}

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Process commit worker cannot execute effects.");
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + BARRIER_TIMEOUT_MS;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for process barrier: ${path}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

class ControlledVerificationTarget implements CanvasTargetAdapter {
  readonly #configuration: WorkerConfiguration;
  readonly #clock: MutableClock;

  constructor(
    configurationValue: WorkerConfiguration,
    clock: MutableClock,
  ) {
    this.#configuration = configurationValue;
    this.#clock = clock;
  }

  activateFence(): never {
    throw new Error("Process commit worker cannot activate fences.");
  }

  compareAndApply(): never {
    throw new Error("Process commit worker cannot apply effects.");
  }

  lookup(): never {
    throw new Error("Process commit worker cannot perform lookup.");
  }

  async verify(request: TargetVerificationRequest) {
    const database = new DatabaseSync(
      this.#configuration.databasePath,
      { readOnly: true },
    );
    const row = database
      .prepare(
        `SELECT receipt_json FROM target_receipts
         WHERE command_id = ?`,
      )
      .get(request.commandId) as { readonly receipt_json: string };
    database.close();
    const receipt = JSON.parse(row.receipt_json);
    const material = {
      schemaVersion: 1 as const,
      status: "verified-applied" as const,
      receipt,
      currentTargetHash: receipt.resultingHash,
      requestDigest: request.requestDigest,
      checkedAt: this.#configuration.verificationCheckedAt,
    };
    const result = TargetVerificationResultSchema.parse({
      ...material,
      evidenceHash: hashCanonicalValue(material),
    });
    if (
      this.#configuration.targetReadyPath !== undefined &&
      this.#configuration.targetStartPath !== undefined
    ) {
      publishJson(
        this.#configuration.targetReadyPath,
        {
          pid: process.pid,
          requestDigest: request.requestDigest,
          verificationAttemptId: request.challenge.id,
          targetReceiptHash: receipt.receiptHash,
          evidenceHash: result.evidenceHash,
        },
      );
      await waitForFile(this.#configuration.targetStartPath);
      const afterBarrier = this.#configuration.afterBarrierClock;
      if (afterBarrier !== undefined) {
        this.#clock.advance(
          Date.parse(afterBarrier) -
            Date.parse(this.#configuration.initialClock),
        );
      }
    }
    return result;
  }
}

function errorResult(error: unknown) {
  const candidate = error as {
    readonly name?: unknown;
    readonly code?: unknown;
    readonly message?: unknown;
  };
  return {
    status: "error" as const,
    error: {
      name:
        typeof candidate.name === "string"
          ? candidate.name
          : "UnknownError",
      ...(typeof candidate.code === "string"
        ? { code: candidate.code }
        : {}),
      message:
        typeof candidate.message === "string"
          ? candidate.message
          : "Unknown worker error.",
    },
  };
}

describe("controlled canonical trace concurrency worker", () => {
  it("runs one bounded process schedule", async () => {
    if (configuration === undefined) {
      expect(configuration).toBeUndefined();
      return;
    }
    const value = configuration;
    if (
      value.launchReadyPath !== undefined &&
      value.launchStartPath !== undefined
    ) {
      publishJson(value.launchReadyPath, { pid: process.pid });
      await waitForFile(value.launchStartPath);
    }
    const clock = new MutableClock(value.initialClock);
    const runtime = new DurableRuntime({
      databasePath: value.databasePath,
      clock: clock.now,
      effectExecutor: new ForbiddenExecutor(),
      canvasTarget: new ControlledVerificationTarget(value, clock),
      recoveryChallengeFactory: () => ({
        id: RecoveryAttemptIdSchema.parse(
          sortableId("rcv", value.suffix),
        ),
        nonce: value.suffix.toLowerCase().repeat(43),
      }),
      traceEventIdFactory: () =>
        TraceEventIdSchema.parse(sortableId("evt", value.suffix)),
    });
    let result:
      | {
          readonly status: "committed";
          readonly receipt: Awaited<
            ReturnType<DurableRuntime["verifyAndCommit"]>
          >;
        }
      | ReturnType<typeof errorResult>;
    try {
      const claim =
        value.claim ??
        runtime.claimEffectCommit({
          commandId: value.commandId as CommitClaim["commandId"],
          workerId: `process-${value.suffix}`,
          claimTtlMilliseconds: 30_000,
        });
      if (
        value.claimReadyPath !== undefined &&
        value.claimStartPath !== undefined
      ) {
        publishJson(value.claimReadyPath, { pid: process.pid, claim });
        await waitForFile(value.claimStartPath);
      }
      const receipt = await runtime.verifyAndCommit({ claim });
      result = { status: "committed", receipt };
    } catch (error) {
      result = errorResult(error);
    } finally {
      runtime.close();
    }
    publishJson(value.resultPath, result);
    if (value.expectedErrorCodes === undefined) {
      expect(result.status).toBe("committed");
    } else {
      expect(result).toMatchObject({
        status: "error",
        error: {
          code: expect.stringMatching(
            new RegExp(
              `^(${value.expectedErrorCodes.join("|")})$`,
              "u",
            ),
          ),
        },
      });
    }
  }, 15_000);
});
