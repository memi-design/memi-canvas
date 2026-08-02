import { hashCanonicalValue } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasTargetAuthority } from "./index.js";
import {
  NOW,
  cleanupTemporaryDirectories,
  databasePath,
  documentFixture,
  fenceFor,
  operationFor,
  requestFor,
  sortableId,
  verificationFor,
} from "./test-fixtures.js";

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("canvas target verification challenge evidence", () => {
  type ChallengedVerification = ReturnType<
    typeof verificationFor
  > & {
    readonly challenge: {
      readonly id: string;
      readonly nonce: string;
      readonly issuedAt: string;
    };
    readonly requestDigest: string;
  };

  it("binds verified-applied evidence to the exact challenge at target time", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const effect = requestFor(
      document,
      operationFor(document, "C"),
      "C",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(effect));
    const applied = await authority.compareAndApply(effect);
    expect(applied.status).toBe("applied");
    if (applied.status !== "applied") {
      throw new Error("Expected applied fixture.");
    }
    const verification = verificationFor(
      effect,
      applied.receipt,
    ) as ChallengedVerification;

    const evidence = await authority.verify(verification);
    expect(evidence).toMatchObject({
      status: "verified-applied",
      requestDigest: verification.requestDigest,
      checkedAt: NOW,
    });
    const { evidenceHash, ...material } = evidence as unknown as {
      readonly evidenceHash: string;
      readonly [key: string]: unknown;
    };
    expect(evidenceHash).toBe(hashCanonicalValue(material));
    authority.close();
  });

  it("rejects a preserved digest mutation and stale challenge before reading the target", async () => {
    let reads = 0;
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
      faults: {
        afterLookupDocumentRead: () => {
          reads += 1;
        },
      },
    });
    const document = documentFixture();
    const effect = requestFor(
      document,
      operationFor(document, "D"),
      "D",
    );
    authority.createDocument(document);
    authority.activateFence(fenceFor(effect));
    const applied = await authority.compareAndApply(effect);
    if (applied.status !== "applied") {
      throw new Error("Expected applied fixture.");
    }
    const verification = verificationFor(
      effect,
      applied.receipt,
    ) as ChallengedVerification;
    const forgedHash = hashCanonicalValue("forged-baseline");
    const forged = {
      ...verification,
      target: {
        ...verification.target,
        expectedBeforeHash: forgedHash,
        baseline: {
          kind: "canvas-revision" as const,
          revision: 0,
          stateHash: forgedHash,
        },
      },
      expectedBeforeHash: forgedHash,
    };
    const staleMaterial = {
      ...verification,
      challenge: {
        id: sortableId("rcv", "E"),
        nonce: "e".repeat(43),
        issuedAt: "2026-07-28T11:59:29.000Z",
      },
    };
    const {
      requestDigest: _staleDigest,
      ...staleHashMaterial
    } = staleMaterial;
    const stale = {
      ...staleHashMaterial,
      requestDigest: hashCanonicalValue(staleHashMaterial),
    };

    await expect(authority.verify(forged)).resolves.toMatchObject({
      status: "mismatch",
      requestDigest: verification.requestDigest,
    });
    await expect(authority.verify(stale)).resolves.toMatchObject({
      status: "mismatch",
      requestDigest: stale.requestDigest,
      checkedAt: NOW,
    });
    expect(reads).toBe(0);
    authority.close();
  });
});
