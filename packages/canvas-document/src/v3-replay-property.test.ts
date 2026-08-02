import { describe, expect, it } from "vitest";

import {
  createDeterministicCanvasV3ReplayFixture,
  findFirstFailingCanvasV3ReplayIndex,
  replayCanvasV3Operations,
  verifyCanvasV3ReplayFixture,
} from "./v3-replay-property.js";

describe("CanvasDocumentV3 deterministic replay property", () => {
  it("replays and inverts 10,000 mixed operations with exact hash restoration", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(10_000);
    const result = verifyCanvasV3ReplayFixture(fixture);

    expect(result.operationCount).toBe(10_000);
    expect(result.atomicBatchCount).toBeGreaterThan(0);
    expect(result.replayedHash).toBe(fixture.expectedFinalHash);
    expect(result.restoredHash).toBe(fixture.initial.stateHash);
  }, 60_000);

  it("reverses same-type atomic batch actions in LIFO order", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(8);
    const batch = fixture.operations.find(
      (operation) =>
        operation.action.type === "atomic.batch" &&
        operation.action.payload.actions.every(
          (action) => action.type === "node.transform",
        ),
    );

    expect(batch?.action.type).toBe("atomic.batch");
    expect(batch?.inverseAction.type).toBe("atomic.batch");
    if (
      batch?.action.type === "atomic.batch" &&
      batch.inverseAction.type === "atomic.batch"
    ) {
      expect(batch.inverseAction.payload.actions.map((action) =>
        "nodeId" in action.payload ? action.payload.nodeId : null,
      )).toEqual(
        [...batch.action.payload.actions]
          .reverse()
          .map((action) => ("nodeId" in action.payload ? action.payload.nodeId : null)),
      );
    }
  });

  it("locates the first corrupt operation for bounded replay diagnostics", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(32);
    const corrupted = [...fixture.operations];
    corrupted[17] = {
      ...corrupted[17]!,
      actionDigest: `sha256:${"f".repeat(64)}`,
    };

    expect(findFirstFailingCanvasV3ReplayIndex(fixture.initial, corrupted)).toBe(
      17,
    );
    expect(() => replayCanvasV3Operations(fixture.initial, corrupted)).toThrow(
      /firstFailingOperation=17/,
    );
  });
});
