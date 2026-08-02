import { describe, expect, it } from "vitest";

import {
  createDeterministicCanvasV3ReplayFixture,
  findFirstFailingCanvasV3ReplayIndex,
  replayCanvasV3Operations,
  verifyCanvasV3ReplayFixture,
} from "./v3-replay-property.js";
import {
  applyCanvasOperationV3,
  hashCanvasDocumentV3,
} from "./v3-engine.js";
import { revertCanvasOperationV3 } from "./v3-reversion.js";

describe("CanvasDocumentV3 deterministic replay property", () => {
  it("replays and inverts 10,000 mixed operations with exact hash restoration", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(10_000);
    const result = verifyCanvasV3ReplayFixture(fixture);

    expect(result.operationCount).toBe(10_000);
    expect(result.atomicBatchCount).toBeGreaterThan(0);
    expect(result.replayedHash).toBe(fixture.expectedFinalHash);
    expect(result.restoredHash).toBe(fixture.initial.stateHash);
  // The proof intentionally replays 10,000 operations. Coverage instrumentation on
  // a cold macOS GitHub runner is materially slower than local execution, so keep a
  // bounded CI allowance without reducing the invariant or the operation count.
  }, 120_000);

  it("covers destructive, hierarchy, component, and representative entity actions", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(128);
    const actionTypes = new Set(
      fixture.operations.map((operation) => operation.action.type),
    );

    expect([...actionTypes]).toEqual(
      expect.arrayContaining([
        "node.delete",
        "node.reparent",
        "node.text",
        "node.layout",
        "instance.override",
        "component.define",
        "variable-collection.define",
        "variable.define",
        "asset.define",
        "prototype.define",
        "evidence.define",
        "reconstruction.define",
      ]),
    );
  });

  it("rejects stale reversion fences before it can restore a document", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(32);
    const operation = fixture.operations.at(-1)!;
    const resulting = fixture.operations.reduce(applyCanvasOperationV3, fixture.initial);

    expect(() =>
      revertCanvasOperationV3(
        { ...resulting, operationCursor: null },
        operation,
      ),
    ).toThrow(/exact resulting document/);
    expect(() =>
      revertCanvasOperationV3(resulting, {
        ...operation,
        expectedBeforeHash: `sha256:${"a".repeat(64)}`,
      }),
    ).toThrow(/operation proof is invalid/);
    expect(() =>
      revertCanvasOperationV3(resulting, {
        ...operation,
        resultingHash: `sha256:${"b".repeat(64)}`,
      }),
    ).toThrow(/exact resulting document/);
    expect(() =>
      revertCanvasOperationV3(resulting, {
        ...operation,
        expectedRevision: operation.expectedRevision + 1,
      }),
    ).toThrow(/exact resulting document/);
    expect(hashCanvasDocumentV3(resulting)).toBe(resulting.stateHash);
  });

  it("reverses same-type atomic batch actions in LIFO order", () => {
    const fixture = createDeterministicCanvasV3ReplayFixture(32);
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
