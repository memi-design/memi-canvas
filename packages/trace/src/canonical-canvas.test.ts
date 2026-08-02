import { describe, expect, it } from "vitest";

import * as trace from "./index.js";

const idBody = "01J00000000000000000000000";
const nextIdBody = "01J00000000000000000000001";
const hash = (character: string) =>
  `sha256:${character.repeat(64)}`;

const body = {
  schemaVersion: 1,
  family: "canvas.operation.committed",
  projectId: `prj_${idBody}`,
  taskId: `tsk_${idBody}`,
  runId: `run_${idBody}`,
  actor: { kind: "agent", id: "runtime-authority" },
  commandId: `cmd_${idBody}`,
  outboxId: `obx_${idBody}`,
  target: {
    kind: "canvas-document",
    id: `doc_${idBody}`,
  },
  idempotencyKey: `idem_${idBody}`,
  commandActionDigest: hash("a"),
  operationActionDigest: hash("b"),
  expectedBeforeHash: hash("c"),
  resultingHash: hash("d"),
  targetReceiptHash: hash("e"),
  verificationRequestDigest: hash("f"),
  verificationEvidenceHash: hash("1"),
  verificationCheckedAt: "2026-07-28T12:00:00.000Z",
  operationId: `opn_${idBody}`,
  appliedRevision: 1,
  leaseId: `lse_${idBody}`,
  fencingEpoch: 3,
} as const;

type CanonicalTrace = {
  readonly buildCanvasOperationCommittedEvent: (
    body: unknown,
    allocation: unknown,
  ) => Record<string, unknown>;
  readonly verifyCanvasOperationCommittedChain: (
    events: readonly unknown[],
  ) => {
    readonly valid: boolean;
    readonly eventCount: number;
  };
  readonly replayCanvasOperationCommittedEvents: (
    events: readonly unknown[],
  ) => unknown;
};

function canonicalTrace(): CanonicalTrace {
  return trace as unknown as CanonicalTrace;
}

describe("pure canonical canvas trace", () => {
  it("builds deterministic authority-allocated events and verifies their chain", () => {
    const {
      buildCanvasOperationCommittedEvent,
      verifyCanvasOperationCommittedChain,
    } = canonicalTrace();
    const first = buildCanvasOperationCommittedEvent(body, {
      eventId: `evt_${idBody}`,
      sequence: 1,
      occurredAt: "2026-07-28T12:00:01.000Z",
      previousEventHash: null,
    });
    const reorderedBody = Object.fromEntries(
      Object.entries({
        ...body,
        commandId: `cmd_${nextIdBody}`,
        outboxId: `obx_${nextIdBody}`,
        idempotencyKey: `idem_${nextIdBody}`,
        operationId: `opn_${nextIdBody}`,
        appliedRevision: 2,
      }).reverse(),
    );
    const second = buildCanvasOperationCommittedEvent(
      reorderedBody,
      {
        eventId: `evt_${nextIdBody}`,
        sequence: 2,
        occurredAt: "2026-07-28T12:00:02.000Z",
        previousEventHash: first.eventHash,
      },
    );

    expect(first.eventActionDigest).not.toBe(
      first.commandActionDigest,
    );
    expect(second.previousEventHash).toBe(first.eventHash);
    expect(
      verifyCanvasOperationCommittedChain([first, second]),
    ).toMatchObject({ valid: true, eventCount: 2 });
  });

  it("fails closed for extra builder fields and tampered or discontinuous chains", () => {
    const {
      buildCanvasOperationCommittedEvent,
      verifyCanvasOperationCommittedChain,
      replayCanvasOperationCommittedEvents,
    } = canonicalTrace();
    const first = buildCanvasOperationCommittedEvent(body, {
      eventId: `evt_${idBody}`,
      sequence: 1,
      occurredAt: "2026-07-28T12:00:01.000Z",
      previousEventHash: null,
    });

    expect(() =>
      buildCanvasOperationCommittedEvent(
        { ...body, targetAdapter: "forbidden" },
        {
          eventId: `evt_${nextIdBody}`,
          sequence: 2,
          occurredAt: "2026-07-28T12:00:02.000Z",
          previousEventHash: first.eventHash,
        },
      ),
    ).toThrow();
    expect(
      verifyCanvasOperationCommittedChain([
        { ...first, resultingHash: hash("9") },
      ]),
    ).toMatchObject({ valid: false, eventCount: 1 });
    expect(
      verifyCanvasOperationCommittedChain([
        first,
        {
          ...first,
          id: `evt_${nextIdBody}`,
          sequence: 3,
          previousEventHash: first.eventHash,
        },
      ]),
    ).toMatchObject({ valid: false, eventCount: 2 });
    expect(() =>
      replayCanvasOperationCommittedEvents([
        { ...first, eventHash: hash("8") },
      ]),
    ).toThrow(/integrity/i);
  });

  it("replays only verified closed operation state without invoking an external boundary", () => {
    const {
      buildCanvasOperationCommittedEvent,
      replayCanvasOperationCommittedEvents,
    } = canonicalTrace();
    const event = buildCanvasOperationCommittedEvent(body, {
      eventId: `evt_${idBody}`,
      sequence: 1,
      occurredAt: "2026-07-28T12:00:01.000Z",
      previousEventHash: null,
    });

    expect(
      replayCanvasOperationCommittedEvents([event]),
    ).toEqual({
      projectId: body.projectId,
      lastSequence: 1,
      lastEventHash: event.eventHash,
      operations: [
        {
          eventId: event.id,
          sequence: 1,
          commandId: body.commandId,
          outboxId: body.outboxId,
          target: body.target,
          operationId: body.operationId,
          appliedRevision: 1,
          resultingHash: body.resultingHash,
        },
      ],
    });
  });
});
