import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CommandDigestError,
  DurableRuntime,
  IdempotencyConflictError,
} from "./index.js";
import {
  MutableClock,
  PROJECT_ID,
  RecordingEffectExecutor,
  alternateLeaseId,
  alternateOutboxId,
  approvalFor,
  commandSubmission,
  contentHash,
  durableCommand,
  grantFor,
  sortableId,
} from "./test-fixtures.js";
import { ProjectIdSchema } from "../../protocol/src/index.js";

const temporaryDirectories: string[] = [];

function runtimeFixture() {
  const directory = mkdtempSync(
    join(tmpdir(), "memi-runtime-command-"),
  );
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "runtime.sqlite");
  const clock = new MutableClock();
  const executor = new RecordingEffectExecutor();
  const runtime = new DurableRuntime({
    databasePath,
    clock: clock.now,
    effectExecutor: executor,
  });

  return { clock, databasePath, executor, runtime };
}

function authorize(
  runtime: DurableRuntime,
  command: ReturnType<typeof durableCommand>,
): void {
  runtime.registerGrant(grantFor(command));
  runtime.registerApprovalReceipt(approvalFor(command));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("durable commands and idempotency", () => {
  it("atomically persists command intent, authority uses, and outbox", () => {
    const { runtime } = runtimeFixture();
    const command = durableCommand();
    const submission = commandSubmission(command);
    authorize(runtime, command);

    const accepted = runtime.submitCommand(submission);

    expect(accepted).toMatchObject({
      commandId: command.id,
      state: "intent",
      actionDigest: command.actionDigest,
    });
    expect(runtime.getOutboxForCommand(command.id)).toMatchObject({
      id: submission.outboxId,
      commandId: command.id,
      phase: "intent",
      actionDigest: command.actionDigest,
    });
    expect(
      runtime.getGrantUsage(command.authority.capabilityGrantId),
    ).toBe(1);
    expect(
      runtime.getApprovalUsage(
        command.authority.approvalReceiptId,
      ),
    ).toBe(1);
    runtime.close();
  });

  it("binds an idempotency key to one action digest", () => {
    const { runtime } = runtimeFixture();
    const command = durableCommand();
    authorize(runtime, command);
    const first = runtime.submitCommand(commandSubmission(command));

    const replayCommand = durableCommand({
      id: sortableId("cmd", "2"),
    });
    const replay = runtime.submitCommand(
      commandSubmission(replayCommand, alternateOutboxId("2")),
    );
    expect(replay).toEqual(first);
    expect(
      runtime.getGrantUsage(command.authority.capabilityGrantId),
    ).toBe(1);

    const conflicting = durableCommand({
      id: sortableId("cmd", "3"),
      target: {
        kind: "canvas-document",
        id: "canvas:document:product",
        expectedBeforeHash: contentHash("d"),
        baseline: {
          kind: "canvas-revision",
          revision: 2,
          stateHash: contentHash("d"),
        },
      },
    });
    expect(() =>
      runtime.submitCommand(
        commandSubmission(conflicting, alternateOutboxId("3")),
      ),
    ).toThrow(
      expect.objectContaining<Partial<IdempotencyConflictError>>({
        code: "IDEMPOTENCY_DIGEST_CONFLICT",
        idempotencyKey: command.idempotencyKey,
      }),
    );
    expect(runtime.getCommand(conflicting.id)).toBeUndefined();
    runtime.close();
  });

  it("rejects payload substitution and non-bounded JSON before authority use", () => {
    const { runtime } = runtimeFixture();
    const command = durableCommand();
    authorize(runtime, command);

    expect(() =>
      runtime.submitCommand({
        ...commandSubmission(command),
        effectPayload: {
          operation: "delete-document",
          token: "space.compact",
        },
      }),
    ).toThrow(
      expect.objectContaining<Partial<CommandDigestError>>({
        code: "PAYLOAD_HASH_MISMATCH",
      }),
    );
    expect(runtime.getGrantUsage(
      command.authority.capabilityGrantId,
    )).toBe(0);
    expect(runtime.getCommand(command.id)).toBeUndefined();

    expect(() =>
      runtime.submitCommand({
        ...commandSubmission(command),
        effectPayload: { payload: "x".repeat(1_048_577) },
      }),
    ).toThrow(
      expect.objectContaining<Partial<CommandDigestError>>({
        code: "INVALID_EFFECT_PAYLOAD",
      }),
    );
    expect(runtime.getGrantUsage(
      command.authority.capabilityGrantId,
    )).toBe(0);
    runtime.close();
  });

  it("rejects adversarial JSON without invoking accessors", () => {
    const { runtime } = runtimeFixture();
    const command = durableCommand();
    authorize(runtime, command);
    let accessorCalls = 0;
    const accessorPayload = {};
    Object.defineProperty(accessorPayload, "operation", {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return "set-token";
      },
    });
    const symbolPayload = {
      operation: "set-token",
      [Symbol("hidden")]: "hidden",
    };
    const sparsePayload: unknown[] = [];
    sparsePayload.length = 1;
    const extraKeyArray = [1] as unknown[] & {
      extra?: string;
    };
    extraKeyArray.extra = "hidden";
    const cyclicPayload: { self?: unknown } = {};
    cyclicPayload.self = cyclicPayload;
    const hiddenPayload = {};
    Object.defineProperty(hiddenPayload, "hidden", {
      enumerable: false,
      value: true,
    });
    const deepPayload = JSON.parse(
      `${'{"nested":'.repeat(65)}null${"}".repeat(65)}`,
    );

    for (const effectPayload of [
      accessorPayload,
      symbolPayload,
      sparsePayload,
      extraKeyArray,
      cyclicPayload,
      hiddenPayload,
      Object.create({ inherited: true }),
      { invalid: Number.POSITIVE_INFINITY },
      undefined,
      deepPayload,
    ]) {
      expect(() =>
        runtime.submitCommand({
          ...commandSubmission(command),
          effectPayload,
        }),
      ).toThrow(
        expect.objectContaining<Partial<CommandDigestError>>({
          code: "INVALID_EFFECT_PAYLOAD",
        }),
      );
    }
    expect(accessorCalls).toBe(0);
    expect(runtime.getGrantUsage(
      command.authority.capabilityGrantId,
    )).toBe(0);
    runtime.close();
  });

  it("canonicalizes object key order before hashing", () => {
    const { runtime } = runtimeFixture();
    const command = durableCommand();
    authorize(runtime, command);

    expect(
      runtime.submitCommand({
        ...commandSubmission(command),
        effectPayload: {
          token: "space.compact",
          operation: "set-token",
        },
      }),
    ).toMatchObject({ commandId: command.id });
    runtime.close();
  });

  it("rolls back command and authority uses when outbox insertion fails", () => {
    const { runtime } = runtimeFixture();
    const first = durableCommand();
    authorize(runtime, first);
    const firstSubmission = commandSubmission(first);
    runtime.submitCommand(firstSubmission);

    const second = durableCommand({
      id: sortableId("cmd", "4"),
      idempotencyKey: sortableId("idem", "4"),
    });

    expect(() =>
      runtime.submitCommand(
        commandSubmission(second, firstSubmission.outboxId),
      ),
    ).toThrow();
    expect(runtime.getCommand(second.id)).toBeUndefined();
    expect(
      runtime.getGrantUsage(first.authority.capabilityGrantId),
    ).toBe(1);
    expect(
      runtime.getApprovalUsage(
        first.authority.approvalReceiptId,
      ),
    ).toBe(1);
    runtime.close();
  });

  it("converges concurrent cross-connection idempotent submissions", async () => {
    const fixture = runtimeFixture();
    const secondRuntime = new DurableRuntime({
      databasePath: fixture.databasePath,
      clock: fixture.clock.now,
      effectExecutor: fixture.executor,
    });
    const firstCommand = durableCommand();
    const secondCommand = durableCommand({
      id: sortableId("cmd", "5"),
    });
    authorize(fixture.runtime, firstCommand);

    const results = await Promise.all([
      Promise.resolve().then(() =>
        fixture.runtime.submitCommand(
          commandSubmission(firstCommand),
        ),
      ),
      Promise.resolve().then(() =>
        secondRuntime.submitCommand(
          commandSubmission(
            secondCommand,
            alternateOutboxId("5"),
          ),
        ),
      ),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(
      [firstCommand.id, secondCommand.id].filter(
        (id) => fixture.runtime.getCommand(id) !== undefined,
      ),
    ).toHaveLength(1);
    expect(
      fixture.runtime.getGrantUsage(
        firstCommand.authority.capabilityGrantId,
      ),
    ).toBe(1);
    fixture.runtime.close();
    secondRuntime.close();
  });

  it("scopes idempotency keys to a project", () => {
    const { runtime } = runtimeFixture();
    const first = durableCommand();
    const secondProjectId = ProjectIdSchema.parse(
      sortableId("prj", "2"),
    );
    expect(secondProjectId).not.toBe(PROJECT_ID);
    const second = durableCommand({
      id: sortableId("cmd", "A"),
      projectId: secondProjectId,
      authority: {
        capabilityGrantId: sortableId("grt", "A"),
        approvalReceiptId: sortableId("apr", "A"),
        leaseId: alternateLeaseId("A"),
        fencingEpoch: 1,
      },
    });
    authorize(runtime, first);
    authorize(runtime, second);

    const firstAccepted = runtime.submitCommand(
      commandSubmission(first),
    );
    const secondAccepted = runtime.submitCommand(
      commandSubmission(second, alternateOutboxId("A")),
    );
    expect(secondAccepted.commandId).toBe(second.id);
    expect(secondAccepted.commandId).not.toBe(firstAccepted.commandId);

    const replay = durableCommand({
      id: sortableId("cmd", "B"),
      projectId: secondProjectId,
      authority: second.authority,
    });
    expect(
      runtime.submitCommand(
        commandSubmission(replay, alternateOutboxId("B")),
      ),
    ).toEqual(secondAccepted);
    expect(runtime.getCommand(first.id)?.projectId).toBe(PROJECT_ID);
    expect(runtime.getCommand(second.id)?.projectId).toBe(
      secondProjectId,
    );
    expect(
      runtime.getGrantUsage(first.authority.capabilityGrantId),
    ).toBe(1);
    expect(
      runtime.getGrantUsage(second.authority.capabilityGrantId),
    ).toBe(1);
    runtime.close();
  });
});
