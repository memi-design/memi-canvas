import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { hashCanonicalValue } from "@memi/canonical-json";
import { applyCanvasOperation } from "@memi/canvas-document";

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
  sortableId,
} from "./test-fixtures.js";

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("canvas target edge cases", () => {
  it("advances fences monotonically and replays only exact activation", () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const epochOne = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const epochThree = requestFor(
      document,
      operationFor(document, "3"),
      "3",
      {
        leaseId: sortableId("lse", "3"),
        fencingEpoch: 3,
      },
    );
    const conflictingEpochOne = requestFor(
      document,
      operationFor(document, "2"),
      "2",
      {
        leaseId: sortableId("lse", "2"),
        fencingEpoch: 1,
      },
    );
    authority.createDocument(document);

    expect(authority.activateFence(fenceFor(epochOne))).toMatchObject({
      status: "activated",
    });
    expect(authority.activateFence(fenceFor(epochOne))).toMatchObject({
      status: "replayed",
    });
    expect(
      authority.activateFence({
        ...fenceFor(conflictingEpochOne),
      }),
    ).toMatchObject({
      status: "rejected",
      code: "FENCE_IDENTITY_CONFLICT",
    });
    expect(authority.activateFence(fenceFor(epochThree))).toMatchObject({
      status: "activated",
      highestFence: 3,
    });
    expect(authority.activateFence(fenceFor(epochOne))).toMatchObject({
      status: "rejected",
      code: "STALE_FENCE",
      highestFence: 3,
    });
    authority.close();
  });

  it("makes document creation idempotent only for exact content", () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    expect(authority.createDocument(document)).toEqual(document);
    expect(authority.createDocument(document)).toEqual(document);

    const changed = applyCanvasOperation(
      document,
      operationFor(document, "1"),
    );
    expect(() => authority.createDocument(changed)).toThrow(
      /different content/i,
    );
    authority.close();
  });

  it("returns verified-not-applied and rejects forged expectations", async () => {
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
    const {
      challenge: _challenge,
      requestDigest: _requestDigest,
      ...lookupIdentity
    } = lookupFor(request);
    const verificationMaterial = {
      ...lookupIdentity,
      expectedResultingHash: hashCanonicalValue("expected-result"),
      expectedReceiptHash: hashCanonicalValue("expected-receipt"),
      challenge: {
        id: sortableId("rcv", "2"),
        nonce: "b".repeat(43),
        issuedAt: NOW,
      },
    };
    const verification = {
      ...verificationMaterial,
      requestDigest: hashCanonicalValue(verificationMaterial),
    };
    expect(await authority.verify(verification)).toMatchObject({
      status: "verified-not-applied",
    });

    const applied = await authority.compareAndApply(request);
    expect(applied.status).toBe("applied");
    expect(await authority.verify(verification)).toMatchObject({
      status: "mismatch",
      code: "EXPECTED_EVIDENCE_MISMATCH",
    });
    authority.close();
  });

  it("maps unavailable and corrupt target reads without mutating", async () => {
    const path = databasePath();
    const document = documentFixture();
    const request = requestFor(
      document,
      operationFor(document, "1"),
      "1",
    );
    const authority = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    authority.createDocument(document);
    authority.close();
    expect(await authority.lookup(lookupFor(request))).toMatchObject({
      status: "unavailable",
    });

    const database = new DatabaseSync(path);
    database
      .prepare(
        `UPDATE documents
         SET document_json = ?
         WHERE project_id = ? AND target_id = ?`,
      )
      .run('{"corrupt":true}', request.projectId, request.target.id);
    database.close();
    const corrupt = new CanvasTargetAuthority({
      databasePath: path,
      clock: () => NOW,
    });
    expect(await corrupt.lookup(lookupFor(request))).toMatchObject({
      status: "corrupt",
      code: "TARGET_CORRUPT",
    });
    corrupt.close();
  });
});
