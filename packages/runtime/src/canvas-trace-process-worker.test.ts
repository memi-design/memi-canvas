import { DatabaseSync } from "node:sqlite";
import { existsSync, writeFileSync } from "node:fs";
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
import { sortableId } from "./test-fixtures.js";

const configuration =
  process.env.MEMI_CANVAS_TRACE_PROCESS_WORKER === undefined
    ? undefined
    : (JSON.parse(
        process.env.MEMI_CANVAS_TRACE_PROCESS_WORKER,
      ) as {
        readonly databasePath: string;
        readonly commandId: string;
        readonly suffix: string;
        readonly claim?: CommitClaim;
        readonly resultPath?: string;
        readonly readyPath?: string;
        readonly startPath?: string;
      });

class ForbiddenExecutor implements EffectExecutor {
  async execute(): Promise<never> {
    throw new Error("Process commit worker cannot execute effects.");
  }
}

class VerificationOnlyTarget implements CanvasTargetAdapter {
  readonly #databasePath: string;

  constructor(databasePath: string) {
    this.#databasePath = databasePath;
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

  verify(request: TargetVerificationRequest) {
    const database = new DatabaseSync(this.#databasePath, {
      readOnly: true,
    });
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
      checkedAt: "2026-07-28T12:00:00.000Z",
    };
    return TargetVerificationResultSchema.parse({
      ...material,
      evidenceHash: hashCanonicalValue(material),
    });
  }
}

describe("canonical trace OS process worker", () => {
    it("commits its assigned command", async () => {
      if (configuration === undefined) {
        expect(configuration).toBeUndefined();
        return;
      }
      const value = configuration;
      const runtime = new DurableRuntime({
        databasePath: value.databasePath,
        clock: () => "2026-07-28T12:00:00.000Z",
        effectExecutor: new ForbiddenExecutor(),
        canvasTarget: new VerificationOnlyTarget(value.databasePath),
        recoveryChallengeFactory: () => ({
          id: RecoveryAttemptIdSchema.parse(
            sortableId("rcv", value.suffix),
          ),
          nonce: value.suffix.toLowerCase().repeat(43),
        }),
        traceEventIdFactory: () =>
          TraceEventIdSchema.parse(sortableId("evt", value.suffix)),
      });
      const claim =
        value.claim ??
        runtime.claimEffectCommit({
          commandId: value.commandId as CommitClaim["commandId"],
          workerId: `process-${value.suffix}`,
          claimTtlMilliseconds: 30_000,
        });
      if (
        value.readyPath !== undefined &&
        value.startPath !== undefined
      ) {
        writeFileSync(value.readyPath, "ready", "utf8");
        while (!existsSync(value.startPath)) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      let receipt;
      try {
        receipt = await runtime.verifyAndCommit({ claim });
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
        receipt = await runtime.verifyAndCommit({ claim });
      }
      expect(receipt).toMatchObject({ commandId: value.commandId });
      if (value.resultPath !== undefined) {
        writeFileSync(value.resultPath, JSON.stringify(receipt), "utf8");
      }
      runtime.close();
    });
});
