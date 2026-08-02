import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { hashCanonicalValue } from "@memi/canonical-json";

import { CanvasTargetAuthority } from "./index.js";
import {
  NOW,
  cleanupTemporaryDirectories,
  databasePath,
  documentFixture,
  fenceFor,
  ids,
  lookupFor,
  operationFor,
  requestFor,
  sortableId,
  tableCounts,
  verificationFor,
} from "./test-fixtures.js";

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("local canvas target authority", () => {
  it("applies the first operation to a revision-zero document", async () => {
    const path = databasePath();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    expect(authority.activateFence(fenceFor(request))).toMatchObject({
      status: "activated",
      highestFence: 1,
    });

    const outcome = await authority.compareAndApply(request);

    expect(outcome).toMatchObject({
      status: "applied",
      receipt: {
        appliedRevision: 1,
        operationId: request.payload.id,
      },
    });
    expect(
      authority.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 1 });
    expect(tableCounts(path)).toEqual({
      documents: 1,
      target_fences: 1,
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    authority.close();
  });

  it("target-cas-001 rejects a target changed after the reviewed baseline", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const first = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const stale = requestFor(
      document,
      operationFor(document, "2"),
      "2",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(first));
    expect(await authority.compareAndApply(first)).toMatchObject({
      status: "applied",
    });

    expect(await authority.compareAndApply(stale)).toMatchObject({
      status: "not-applied",
      evidence: {
        code: "STALE_TARGET",
      },
    });
    expect(
      authority.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 1, nodes: [{ id: first.payload.payload.node.id }] });
    authority.close();
  });

  it("target-cas-002 serializes two adapter connections from one baseline", async () => {
    const path = databasePath();
    const firstAuthority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const secondAuthority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const first = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const second = requestFor(
      document,
      operationFor(document, "2"),
      "2",
    );
    firstAuthority.createDocument(document);
    firstAuthority.activateFence(fenceFor(first));

    const outcomes = await Promise.all([
      firstAuthority.compareAndApply(first),
      secondAuthority.compareAndApply(second),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      "applied",
      "not-applied",
    ]);
    expect(tableCounts(path)).toMatchObject({
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    firstAuthority.close();
    secondAuthority.close();
  });

  it("target-idem-002 rejects key reuse with another digest without mutation", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const first = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const conflict = requestFor(
      document,
      operationFor(document, "2"),
      "2",
      {
        idempotencySuffix: "1",
        commandActionDigest: hashCanonicalValue("conflicting-command"),
      },
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(first));
    const applied = await authority.compareAndApply(first);
    expect(applied.status).toBe("applied");

    expect(await authority.compareAndApply(conflict)).toMatchObject({
      status: "not-applied",
      evidence: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(await authority.lookup(lookupFor(first))).toMatchObject({
      status: "found",
      receipt:
        applied.status === "applied" ? applied.receipt : undefined,
    });
    expect(
      authority.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 1 });
    authority.close();
  });

  it("target-idem-003 replays the durable receipt after acknowledgement loss", async () => {
    const path = databasePath();
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const interrupted = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
      faults: {
        afterCommit: () => {
          throw new Error("lost acknowledgement");
        },
      },
    });
    interrupted.createDocument(document);
    interrupted.activateFence(fenceFor(request));

    expect(await interrupted.compareAndApply(request)).toMatchObject({
      status: "outcome-unknown",
    });
    interrupted.close();

    const recovered = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    expect(await recovered.compareAndApply(request)).toMatchObject({
      status: "replayed",
      receipt: {
        commandId: request.commandId,
        operationId: request.payload.id,
      },
    });
    expect(tableCounts(path)).toMatchObject({
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    recovered.close();
  });

  it("target-fence-001 rejects an epoch-N worker resumed after N+1 activation", async () => {
    const path = databasePath();
    let releaseApply!: () => void;
    let markPaused!: () => void;
    const paused = new Promise<void>((resolve) => {
      markPaused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const oldWorker = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
      faults: {
        beforeTransaction: async () => {
          markPaused();
          await release;
        },
      },
    });
    const coordinator = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const epochOne = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const epochTwo = requestFor(
      document,
      operationFor(document, "2"),
      "2",
      {
        leaseId: sortableId("lse", "2"),
        fencingEpoch: 2,
      },
    );
    coordinator.createDocument(document);
    coordinator.activateFence(fenceFor(epochOne));
    const lateApply = oldWorker.compareAndApply(epochOne);
    await paused;
    expect(coordinator.activateFence(fenceFor(epochTwo))).toMatchObject({
      status: "activated",
      highestFence: 2,
    });
    releaseApply();

    expect(await lateApply).toMatchObject({
      status: "not-applied",
      evidence: { code: "STALE_FENCE" },
    });
    expect(
      coordinator.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 0 });
    oldWorker.close();
    coordinator.close();
  });

  it("target-fence-002 forbids dispatch before pending fence activation", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);

    expect(await authority.compareAndApply(request)).toMatchObject({
      status: "not-applied",
      evidence: { code: "STALE_FENCE" },
    });
    expect(
      authority.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 0 });
    authority.close();
  });

  it("rejects payload-hash, baseline-revision, and expired-claim mismatches before mutation", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(request));

    expect(
      await authority.compareAndApply({
        ...request,
        payloadHash: hashCanonicalValue("forged-payload"),
      }),
    ).toMatchObject({
      status: "not-applied",
      evidence: { code: "INVALID_REQUEST" },
    });
    expect(
      await authority.compareAndApply({
        ...requestFor(
          document,
          operationFor(document, "2"),
          "2",
        ),
        target: {
          ...request.target,
          baseline: {
            kind: "canvas-revision",
            revision: 1,
            stateHash: document.stateHash,
          },
        },
      }),
    ).toMatchObject({
      status: "not-applied",
      evidence: { code: "STALE_TARGET" },
    });
    expect(
      await authority.compareAndApply({
        ...requestFor(
          document,
          operationFor(document, "3"),
          "3",
        ),
        workerClaim: {
          ...request.workerClaim,
          id: "expired-worker-claim",
          expiresAt: "2026-07-28T11:59:59.000Z",
        },
      }),
    ).toMatchObject({
      status: "not-applied",
      evidence: { code: "STALE_CLAIM" },
    });
    expect(
      authority.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 0 });
    authority.close();
  });

  it("maps parse, CAS, and known operation rejection to not-applied but throws to unknown", async () => {
    const path = databasePath();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(request));

    expect(
      await authority.compareAndApply({
        ...request,
        forbidden: true,
      }),
    ).toMatchObject({
      status: "not-applied",
      evidence: { code: "INVALID_REQUEST" },
    });
    expect(await authority.compareAndApply(request)).toMatchObject({
      status: "applied",
    });

    const current = authority.readDocument(
      ids.project,
      ids.document,
    );
    const validNext = operationFor(current, "2");
    const invalidOperation = {
      ...validNext,
      payload: {
        node: request.payload.payload.node,
      },
    };
    const rejected = requestFor(
      current,
      invalidOperation,
      "2",
    );
    expect(await authority.compareAndApply(rejected)).toMatchObject({
      status: "not-applied",
      evidence: { code: "APPLY_REJECTED" },
    });
    authority.close();

    const throwing = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
      faults: {
        beforeTransaction: () => {
          throw new Error("unexpected target failure");
        },
      },
    });
    expect(await throwing.compareAndApply(rejected)).toMatchObject({
      status: "outcome-unknown",
      error: { code: "INTERNAL_ERROR" },
    });
    throwing.close();
  });

  it("hashes only bounded receipt material and excludes receiptHash", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(request));
    const outcome = await authority.compareAndApply(request);
    expect(outcome.status).toBe("applied");
    if (outcome.status !== "applied") {
      throw new Error("Expected applied receipt.");
    }
    const {
      receiptHash,
      ...hashMaterial
    } = outcome.receipt;

    expect(hashCanonicalValue(hashMaterial)).toBe(receiptHash);
    expect(hashCanonicalValue(outcome.receipt)).not.toBe(receiptHash);
    authority.close();
  });

  it("persists across restart and fails closed for corrupt receipt evidence", async () => {
    const path = databasePath();
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const first = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    first.createDocument(document);
    first.activateFence(fenceFor(request));
    const outcome = await first.compareAndApply(request);
    if (outcome.status !== "applied") {
      throw new Error("Expected applied receipt.");
    }
    first.close();

    const reopened = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    expect(
      await reopened.verify(verificationFor(request, outcome.receipt)),
    ).toMatchObject({
      status: "verified-applied",
      receipt: outcome.receipt,
    });
    reopened.close();

    const database = new DatabaseSync(path);
    database
      .prepare(
        `UPDATE receipts
         SET receipt_json = ?
         WHERE command_id = ?`,
      )
      .run('{"corrupt":true}', request.commandId);
    database.close();

    const corrupt = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    expect(
      await corrupt.verify(
        verificationFor(request, outcome.receipt),
      ),
    ).toMatchObject({
      status: "corrupt",
      code: "RECEIPT_CORRUPT",
    });
    expect(await corrupt.compareAndApply(request)).toMatchObject({
      status: "outcome-unknown",
    });
    expect(
      corrupt.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 1 });
    corrupt.close();
  });

  it("fails closed when a ledger pointer is swapped to another valid receipt", async () => {
    const path = databasePath();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const first = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(first));
    const firstOutcome = await authority.compareAndApply(first);
    if (firstOutcome.status !== "applied") {
      throw new Error("Expected first operation to apply.");
    }
    const current = authority.readDocument(
      ids.project,
      ids.document,
    );
    const second = requestFor(
      current,
      operationFor(current, "2"),
      "2",
    );
    const secondOutcome = await authority.compareAndApply(second);
    if (secondOutcome.status !== "applied") {
      throw new Error("Expected second operation to apply.");
    }
    authority.close();

    const database = new DatabaseSync(path);
    database.exec("PRAGMA foreign_keys = OFF");
    database
      .prepare(
        `UPDATE idempotency_ledger
         SET receipt_hash = ?
         WHERE project_id = ? AND target_id = ?
           AND idempotency_key = ?`,
      )
      .run(
        secondOutcome.receipt.receiptHash,
        first.projectId,
        first.target.id,
        first.idempotencyKey,
      );
    database.close();

    const reopened = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    expect(await reopened.lookup(lookupFor(first))).toMatchObject({
      status: "corrupt",
      code: "LEDGER_CORRUPT",
    });
    expect(await reopened.compareAndApply(first)).toMatchObject({
      status: "outcome-unknown",
    });
    expect(
      reopened.readDocument(ids.project, ids.document),
    ).toMatchObject({ revision: 2 });
    reopened.close();
  });

  it("holds one read snapshot across document and ledger lookup", async () => {
    const path = databasePath();
    let releaseRead!: () => void;
    let markReadPaused!: () => void;
    const readPaused = new Promise<void>((resolve) => {
      markReadPaused = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const observer = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
      faults: {
        afterLookupDocumentRead: async () => {
          markReadPaused();
          await release;
        },
      },
    });
    const writer = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    writer.createDocument(document);
    writer.activateFence(fenceFor(request));

    const lookup = observer.lookup(lookupFor(request));
    await readPaused;
    expect(await writer.compareAndApply(request)).toMatchObject({
      status: "applied",
    });
    releaseRead();

    expect(await lookup).toMatchObject({
      status: "not-found",
      currentTargetHash: document.stateHash,
    });
    expect(await observer.lookup(lookupFor(request))).toMatchObject({
      status: "found",
    });
    observer.close();
    writer.close();
  });

  it("keeps lookup and verification read-only and reports later target mismatch", async () => {
    const path = databasePath();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const document = documentFixture();
    const first = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(first));
    const applied = await authority.compareAndApply(first);
    if (applied.status !== "applied") {
      throw new Error("Expected first operation to apply.");
    }
    expect(await authority.lookup(lookupFor(first))).toMatchObject({
      status: "found",
      receipt: applied.receipt,
    });
    expect(
      await authority.verify(verificationFor(first, applied.receipt)),
    ).toMatchObject({ status: "verified-applied" });

    const current = authority.readDocument(
      ids.project,
      ids.document,
    );
    const second = requestFor(
      current,
      operationFor(current, "2"),
      "2",
    );
    expect(await authority.compareAndApply(second)).toMatchObject({
      status: "applied",
    });
    const beforeReadOnly = tableCounts(path);
    expect(
      await authority.verify(verificationFor(first, applied.receipt)),
    ).toMatchObject({
      status: "mismatch",
      code: "TARGET_HASH_MISMATCH",
    });
    expect(tableCounts(path)).toEqual(beforeReadOnly);
    authority.close();
  });

  it("creates only strict target-authority tables", () => {
    const path = databasePath();
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    const database = new DatabaseSync(path, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT name, sql
         FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as unknown as readonly {
      readonly name: string;
      readonly sql: string;
    }[];

    expect(rows.map((row) => row.name)).toEqual([
      "documents",
      "idempotency_ledger",
      "operations",
      "receipts",
      "target_fences",
    ]);
    expect(
      rows.every((row) => /\bSTRICT\s*$/iu.test(row.sql)),
    ).toBe(true);
    database.close();
    authority.close();
  });
});
