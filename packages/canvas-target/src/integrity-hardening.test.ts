import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  TargetEffectRequestSchema,
  type TargetReceipt,
} from "@memi/protocol";

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

interface AppliedFixture {
  readonly path: string;
  readonly request: ReturnType<typeof requestFor>;
  readonly receipt: TargetReceipt;
}

async function appliedFixture(): Promise<AppliedFixture> {
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
  const outcome = await authority.compareAndApply(request);
  if (outcome.status !== "applied") {
    throw new Error("Expected target fixture to apply.");
  }
  authority.close();
  return { path, request, receipt: outcome.receipt };
}

function mutateDatabase(
  path: string,
  operation: (database: DatabaseSync) => void,
): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("PRAGMA ignore_check_constraints = ON");
    operation(database);
  } finally {
    database.close();
  }
}

async function expectLedgerCorrupt(
  fixture: AppliedFixture,
): Promise<void> {
  const authority = new CanvasTargetAuthority({
    databasePath: fixture.path,
    clock: () => NOW,
  });
  expect(
    await authority.lookup(lookupFor(fixture.request)),
  ).toMatchObject({
    status: "corrupt",
    code: "LEDGER_CORRUPT",
  });
  expect(
    await authority.verify(
      verificationFor(fixture.request, fixture.receipt),
    ),
  ).toMatchObject({
    status: "corrupt",
    code: "LEDGER_CORRUPT",
  });
  authority.close();
}

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("canvas target replay and integrity hardening", () => {
  it("replays immutable action identity under a fresh fence and claim after acknowledgement loss", async () => {
    const path = databasePath();
    const document = documentFixture();
    const original = requestFor(
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
    interrupted.activateFence(fenceFor(original));
    expect(await interrupted.compareAndApply(original)).toMatchObject({
      status: "outcome-unknown",
    });
    interrupted.close();

    const fresh = TargetEffectRequestSchema.parse({
      ...original,
      lease: {
        id: sortableId("lse", "2"),
        holderId: original.issuerId,
        fencingEpoch: 2,
      },
      workerClaim: {
        id: "fresh-worker-claim",
        fencingEpoch: 2,
        expiresAt: "2026-07-28T13:05:00.000Z",
      },
    });
    const recovered = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => "2026-07-28T13:00:00.000Z",
    });
    recovered.activateFence(fenceFor(fresh));

    const replay = await recovered.compareAndApply(fresh);

    expect(replay).toMatchObject({
      status: "replayed",
      receipt: {
        leaseId: original.lease.id,
        fencingEpoch: original.lease.fencingEpoch,
        workerClaimId: original.workerClaim.id,
        workerClaimFencingEpoch:
          original.workerClaim.fencingEpoch,
      },
    });
    expect(tableCounts(path)).toMatchObject({
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    recovered.close();
  });

  it("rejects an immutable replay under a superseded incoming fence", async () => {
    const path = databasePath();
    const document = documentFixture();
    const original = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    authority.createDocument(document);
    authority.activateFence(fenceFor(original));
    expect(await authority.compareAndApply(original)).toMatchObject({
      status: "applied",
    });
    const successor = TargetEffectRequestSchema.parse({
      ...original,
      lease: {
        id: sortableId("lse", "2"),
        holderId: original.issuerId,
        fencingEpoch: 2,
      },
      workerClaim: {
        id: "successor-worker-claim",
        fencingEpoch: 2,
        expiresAt: "2026-07-28T12:05:00.000Z",
      },
    });
    authority.activateFence(fenceFor(successor));

    expect(await authority.compareAndApply(original)).toMatchObject({
      status: "not-applied",
      evidence: { code: "STALE_FENCE" },
    });
    expect(tableCounts(path)).toMatchObject({
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    authority.close();
  });

  it("rejects an immutable replay under an expired incoming claim", async () => {
    const path = databasePath();
    let now = NOW;
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => now,
    });
    authority.createDocument(document);
    authority.activateFence(fenceFor(request));
    expect(await authority.compareAndApply(request)).toMatchObject({
      status: "applied",
    });
    now = "2026-07-28T12:06:00.000Z";

    expect(await authority.compareAndApply(request)).toMatchObject({
      status: "not-applied",
      evidence: { code: "STALE_CLAIM" },
    });
    expect(tableCounts(path)).toMatchObject({
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    authority.close();
  });

  it.each([
    ["deleted operation", (database: DatabaseSync) => {
      database.exec("DELETE FROM operations");
    }],
    ["swapped valid operation JSON", (database: DatabaseSync) => {
      const alternate = operationFor(documentFixture(), "Z");
      database
        .prepare("UPDATE operations SET operation_json = ?")
        .run(canonicalJson(alternate));
    }],
    ["mutated resulting hash", (database: DatabaseSync) => {
      database
        .prepare("UPDATE operations SET resulting_hash = ?")
        .run(hashCanonicalValue("other-result"));
    }],
    ["mutated revision", (database: DatabaseSync) => {
      database.exec("UPDATE operations SET applied_revision = 9");
    }],
    ["mutated timestamp", (database: DatabaseSync) => {
      database
        .prepare("UPDATE operations SET applied_at = ?")
        .run("2026-07-28T12:10:00.000Z");
    }],
  ] as const)(
    "fails closed for %s",
    async (_label, mutation) => {
      const fixture = await appliedFixture();
      mutateDatabase(fixture.path, mutation);
      await expectLedgerCorrupt(fixture);
    },
  );

  it("detects a rehashed receipt whose idempotency key no longer matches its ledger", async () => {
    const fixture = await appliedFixture();
    mutateDatabase(fixture.path, (database) => {
      const row = database
        .prepare("SELECT receipt_json FROM receipts")
        .get() as { readonly receipt_json: string };
      const receipt = JSON.parse(row.receipt_json) as TargetReceipt;
      const changed = {
        ...receipt,
        idempotencyKey: sortableId("idem", "Z"),
      };
      const { receiptHash: _oldHash, ...material } = changed;
      const next = {
        ...material,
        receiptHash: hashCanonicalValue(material),
      };
      database
        .prepare(
          `UPDATE receipts
           SET receipt_hash = ?, receipt_json = ?`,
        )
        .run(next.receiptHash, canonicalJson(next));
      database
        .prepare(
          `UPDATE idempotency_ledger
           SET receipt_hash = ?`,
        )
        .run(next.receiptHash);
    });
    await expectLedgerCorrupt(fixture);
  });

  it.each([
    ["project_id", sortableId("prj", "Z")],
    ["target_id", sortableId("doc", "Z")],
    ["command_id", sortableId("cmd", "Z")],
  ] as const)(
    "validates receipt table %s metadata",
    async (column, value) => {
      const fixture = await appliedFixture();
      mutateDatabase(fixture.path, (database) => {
        database
          .prepare(`UPDATE receipts SET ${column} = ?`)
          .run(value);
      });
      await expectLedgerCorrupt(fixture);
    },
  );

  it.each([
    ["task_id", sortableId("tsk", "Z")],
    ["run_id", sortableId("run", "Z")],
    ["outbox_id", sortableId("obx", "Z")],
    ["command_id", sortableId("cmd", "Z")],
    ["command_action_digest", hashCanonicalValue("command")],
    ["operation_action_digest", hashCanonicalValue("operation")],
    ["payload_hash", hashCanonicalValue("payload")],
    ["expected_before_hash", hashCanonicalValue("before")],
    ["lease_id", sortableId("lse", "Z")],
    ["lease_holder_id", "another-holder"],
    ["fencing_epoch", 9],
    ["worker_claim_id", "another-worker"],
    ["worker_claim_epoch", 9],
    ["resulting_hash", hashCanonicalValue("result")],
    ["operation_id", sortableId("opn", "Z")],
    ["applied_revision", 9],
    ["applied_at", "2026-07-28T12:10:00.000Z"],
    ["adapter_contract_version", 9],
  ] as const)(
    "detects receipt-to-ledger mismatch for %s",
    async (column, value) => {
      const fixture = await appliedFixture();
      mutateDatabase(fixture.path, (database) => {
        database
          .prepare(`UPDATE idempotency_ledger SET ${column} = ?`)
          .run(value);
      });
      await expectLedgerCorrupt(fixture);
    },
  );

  it("binds the complete document record including appliedOperations", async () => {
    const fixture = await appliedFixture();
    const database = new DatabaseSync(fixture.path);
    const before = database
      .prepare(
        `SELECT document_json, document_record_hash
         FROM documents`,
      )
      .get() as {
      readonly document_json: string;
      readonly document_record_hash: string;
    };
    const document = JSON.parse(
      before.document_json,
    ) as Record<string, unknown>;
    expect(before.document_record_hash).toBe(
      hashCanonicalValue(document),
    );
    database
      .prepare("UPDATE documents SET document_json = ?")
      .run(
        canonicalJson({
          ...document,
          appliedOperations: [],
        }),
      );
    database.close();

    const authority = new CanvasTargetAuthority({
      databasePath: fixture.path,
      clock: () => NOW,
    });
    expect(() =>
      authority.readDocument(ids.project, ids.document),
    ).toThrow(/corrupt|integrity/i);
    expect(
      await authority.lookup(lookupFor(fixture.request)),
    ).toMatchObject({
      status: "corrupt",
      code: "TARGET_CORRUPT",
    });
    expect(
      await authority.verify(
        verificationFor(fixture.request, fixture.receipt),
      ),
    ).toMatchObject({
      status: "corrupt",
      code: "TARGET_CORRUPT",
    });
    const nextRequest = requestFor(
      documentFixture(),
      operationFor(documentFixture(), "2"),
      "2",
    );
    expect(await authority.compareAndApply(nextRequest)).toMatchObject({
      status: "outcome-unknown",
    });
    authority.close();
  });
});
