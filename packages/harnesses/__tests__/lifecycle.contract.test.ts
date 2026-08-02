import { describe, expect, it } from "vitest";

import { FakeHarnessAdapter } from "../src/index.js";
import {
  type ContractEvent,
  fakeHarnessOptions,
  taskEnvelope,
} from "./fixtures.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("harness lifecycle", () => {
  it("pauses before a protected tool call until the approval is resolved", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const iterator = (
      adapter.start({
        runId: "run-approval",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    expect((await iterator.next()).value.type).toBe(
      "message.assistant.delta",
    );
    expect((await iterator.next()).value).toMatchObject({
      type: "approval.requested",
      payload: {
        approvalId: "approval-canvas-apply",
        scopes: ["canvas:apply"],
        expectedBeforeHash: "sha256:node-before",
      },
    });

    let nextEventSettled = false;
    const nextEvent = iterator.next().then((result) => {
      nextEventSettled = true;
      return result;
    });

    await flushMicrotasks();
    expect(nextEventSettled).toBe(false);

    await adapter.resolveApproval({
      runId: "run-approval",
      approvalId: "approval-canvas-apply",
      decision: "approved",
      grantId: "grant-1",
    });

    expect((await nextEvent).value).toMatchObject({
      type: "approval.resolved",
      payload: {
        approvalId: "approval-canvas-apply",
        decision: "approved",
        grantId: "grant-1",
      },
    });
    expect((await iterator.next()).value.type).toBe("tool.call.started");
  });

  it("cancels cooperatively and resumes after a cursor without duplicate events", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const iterator = (
      adapter.start({
        runId: "run-cancel",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.value.sequence).toBe(1);

    await adapter.cancel({
      runId: "run-cancel",
      reason: "human-interrupted",
    });

    const cancelled = await iterator.next();
    expect(cancelled.value).toMatchObject({
      type: "run.cancelled",
      sequence: 2,
      payload: { reason: "human-interrupted" },
    });
    expect((await iterator.next()).done).toBe(true);

    const resumedEvents: ContractEvent[] = [];
    const resumedStream = adapter.resume({
      runId: "run-resumed",
      previousRunId: "run-cancel",
      task: taskEnvelope,
      afterSequence: 1,
    }) as AsyncIterable<ContractEvent>;

    for await (const event of resumedStream) {
      resumedEvents.push(event);

      if (event.type === "approval.requested") {
        await adapter.resolveApproval({
          runId: "run-resumed",
          approvalId: "approval-canvas-apply",
          decision: "approved",
          grantId: "grant-resumed",
        });
      }
    }

    expect(resumedEvents[0]).toMatchObject({
      type: "run.resumed",
      payload: {
        previousRunId: "run-cancel",
        afterSequence: 1,
      },
    });
    expect(resumedEvents.every((event) => event.sequence > 1)).toBe(true);
    expect(new Set(resumedEvents.map((event) => event.eventId)).size).toBe(
      resumedEvents.length,
    );
    expect(
      resumedEvents.filter(
        (event) =>
          event.type === "message.assistant.delta" &&
          event.sequence === first.value.sequence,
      ),
    ).toHaveLength(0);
  });

  it("resumes from an emitted approval cursor without bypassing approval", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const original = (
      adapter.start({
        runId: "run-before-approval",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    expect((await original.next()).value.sequence).toBe(1);
    const approval = await original.next();
    expect(approval.value).toMatchObject({
      sequence: 2,
      type: "approval.requested",
    });

    await adapter.cancel({
      runId: "run-before-approval",
      reason: "handoff-at-approval",
    });
    expect((await original.next()).value.type).toBe("run.cancelled");

    const resumed = (
      adapter.resume({
        runId: "run-after-approval",
        previousRunId: "run-before-approval",
        task: taskEnvelope,
        afterSequence: approval.value.sequence,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    expect((await resumed.next()).value.type).toBe("run.resumed");
    const repeatedApproval = await resumed.next();
    expect(repeatedApproval.value.type).toBe("approval.requested");

    let protectedToolSettled = false;
    const protectedTool = resumed.next().then((result) => {
      protectedToolSettled = true;
      return result;
    });
    await flushMicrotasks();
    expect(protectedToolSettled).toBe(false);

    await adapter.resolveApproval({
      runId: "run-after-approval",
      approvalId: "approval-canvas-apply",
      decision: "approved",
      grantId: "grant-after-resume",
    });

    expect((await protectedTool).value.type).toBe(
      "approval.resolved",
    );
    expect((await resumed.next()).value.type).toBe(
      "tool.call.started",
    );
  });

  it("rejects concurrent starts and resumes that reuse an active run id", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const active = adapter.start({
      runId: "run-active",
      task: taskEnvelope,
    });

    expect(() =>
      adapter.start({
        runId: "run-active",
        task: taskEnvelope,
      }),
    ).toThrow('Run "run-active" already exists.');

    const previous = (
      adapter.start({
        runId: "run-previous",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();
    await previous.next();
    await adapter.cancel({
      runId: "run-previous",
      reason: "prepare-resume",
    });
    await previous.next();

    expect(() =>
      adapter.resume({
        runId: "run-active",
        previousRunId: "run-previous",
        task: taskEnvelope,
        afterSequence: 1,
      }),
    ).toThrow('Run "run-active" already exists.');

    expect(active).toBeDefined();
  });

  it("resolves approval atomically and rejects a conflicting second decision", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const iterator = (
      adapter.start({
        runId: "run-atomic-approval",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    await iterator.next();
    expect((await iterator.next()).value.type).toBe(
      "approval.requested",
    );

    await adapter.resolveApproval({
      runId: "run-atomic-approval",
      approvalId: "approval-canvas-apply",
      decision: "approved",
      grantId: "grant-atomic",
    });
    await expect(
      adapter.resolveApproval({
        runId: "run-atomic-approval",
        approvalId: "approval-canvas-apply",
        decision: "rejected",
        grantId: "grant-conflicting",
      }),
    ).rejects.toThrow("already resolved with a different decision");
    await expect(
      adapter.cancel({
        runId: "run-atomic-approval",
        reason: "cancel-after-approval",
      }),
    ).rejects.toThrow("approval resolution is awaiting consumption");

    expect((await iterator.next()).value).toMatchObject({
      type: "approval.resolved",
      payload: {
        decision: "approved",
        grantId: "grant-atomic",
      },
    });
    expect((await iterator.next()).value.type).toBe(
      "tool.call.started",
    );
  });

  it("treats the same approval resolution as idempotent", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const iterator = (
      adapter.start({
        runId: "run-idempotent-approval",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.next();
    const resolution = {
      runId: "run-idempotent-approval",
      approvalId: "approval-canvas-apply",
      decision: "approved" as const,
      grantId: "grant-idempotent",
    };

    await expect(
      adapter.resolveApproval(resolution),
    ).resolves.toBeUndefined();
    await expect(
      adapter.resolveApproval(resolution),
    ).resolves.toBeUndefined();
    expect((await iterator.next()).value.type).toBe(
      "approval.resolved",
    );
    expect((await iterator.next()).value.type).toBe(
      "tool.call.started",
    );
  });

  it("does not report approval success after cancellation wins", async () => {
    const adapter = new FakeHarnessAdapter(fakeHarnessOptions());
    const iterator = (
      adapter.start({
        runId: "run-cancel-wins",
        task: taskEnvelope,
      }) as AsyncIterable<ContractEvent>
    )[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.next();
    await adapter.cancel({
      runId: "run-cancel-wins",
      reason: "human-cancelled",
    });

    await expect(
      adapter.resolveApproval({
        runId: "run-cancel-wins",
        approvalId: "approval-canvas-apply",
        decision: "approved",
        grantId: "grant-too-late",
      }),
    ).rejects.toThrow("was cancelled before approval");
    expect((await iterator.next()).value).toMatchObject({
      type: "run.cancelled",
      payload: { reason: "human-cancelled" },
    });
  });
});
