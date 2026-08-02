import { afterEach, describe, expect, it } from "vitest";

import { CanvasTargetAuthority } from "./index.js";
import {
  NOW,
  cleanupTemporaryDirectories,
  databasePath,
  documentFixture,
  fenceFor,
  lookupFor,
  operationFor,
  requestFor,
} from "./test-fixtures.js";

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("canvas target same-instance concurrency", () => {
  it("isolates concurrent reads and writes and drains a read after close", async () => {
    const path = databasePath();
    let releaseFirst!: () => void;
    let markFirstPaused!: () => void;
    let readCount = 0;
    const firstPaused = new Promise<void>((resolve) => {
      markFirstPaused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
      faults: {
        afterLookupDocumentRead: async () => {
          readCount += 1;
          if (readCount === 1) {
            markFirstPaused();
            await release;
          }
        },
      },
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(request));

    const firstLookup = authority.lookup(lookupFor(request));
    await firstPaused;
    const secondLookup = await authority.lookup(lookupFor(request));
    const applied = await authority.compareAndApply(request);

    let closeError: unknown;
    try {
      authority.close();
      authority.close();
    } catch (error) {
      closeError = error;
    }
    releaseFirst();
    const firstResult = await firstLookup;

    expect(secondLookup).toMatchObject({
      status: "not-found",
      currentTargetHash: document.stateHash,
    });
    expect(applied).toMatchObject({ status: "applied" });
    expect(closeError).toBeUndefined();
    expect(firstResult).toMatchObject({
      status: "not-found",
      currentTargetHash: document.stateHash,
    });
    expect(await authority.lookup(lookupFor(request))).toMatchObject({
      status: "unavailable",
    });
  });

  it("lets an accepted effect finish before close releases the writer", async () => {
    let markTransactionPaused!: () => void;
    let releaseTransaction!: () => void;
    const transactionPaused = new Promise<void>((resolve) => {
      markTransactionPaused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
      faults: {
        beforeTransaction: async () => {
          markTransactionPaused();
          await release;
        },
      },
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(request));

    const application = authority.compareAndApply(request);
    await transactionPaused;
    authority.close();
    releaseTransaction();

    expect(await application).toMatchObject({ status: "applied" });
    expect(await authority.lookup(lookupFor(request))).toMatchObject({
      status: "unavailable",
    });
  });
});
