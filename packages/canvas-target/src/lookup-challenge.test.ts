import { hashCanonicalValue } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import { CanvasTargetAuthority } from "./index.js";
import {
  NOW,
  cleanupTemporaryDirectories,
  databasePath,
  documentFixture,
  lookupFor,
  operationFor,
  requestFor,
  sortableId,
} from "./test-fixtures.js";

afterEach(() => {
  cleanupTemporaryDirectories();
});

describe("canvas target lookup challenge evidence", () => {
  it("binds not-found evidence to the exact request at lookup time", async () => {
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
    });
    const document = documentFixture();
    const effect = requestFor(
      document,
      operationFor(document, "A"),
      "A",
    );
    authority.createDocument(document);
    const {
      challenge: _fixtureChallenge,
      requestDigest: _fixtureDigest,
      ...identity
    } = lookupFor(effect);
    const material = {
      ...identity,
      challenge: {
        id: sortableId("rcv", "A"),
        nonce: "a".repeat(43),
        issuedAt: NOW,
      },
    };
    const request = {
      ...material,
      requestDigest: hashCanonicalValue(material),
    };

    const result = await authority.lookup(request);
    expect(result).toMatchObject({
      status: "not-found",
      requestDigest: request.requestDigest,
      checkedAt: NOW,
      currentTargetHash: document.stateHash,
    });
    const {
      evidenceHash,
      ...evidenceMaterial
    } = result as typeof result & { readonly evidenceHash: string };
    expect(evidenceHash).toBe(
      hashCanonicalValue(evidenceMaterial),
    );
    authority.close();
  });

  it("rejects a preserved digest after identity mutation without reading the target", async () => {
    let documentReads = 0;
    const authority = new CanvasTargetAuthority({
      databasePath: databasePath(),
      clock: () => NOW,
      faults: {
        afterLookupDocumentRead: () => {
          documentReads += 1;
        },
      },
    });
    const document = documentFixture();
    const effect = requestFor(
      document,
      operationFor(document, "B"),
      "B",
    );
    authority.createDocument(document);
    const request = lookupFor(effect);
    const forgedBaseline = hashCanonicalValue("forged-baseline");
    const forged = {
      ...request,
      target: {
        ...request.target,
        expectedBeforeHash: forgedBaseline,
        baseline: {
          kind: "canvas-revision" as const,
          revision: 0,
          stateHash: forgedBaseline,
        },
      },
      expectedBeforeHash: forgedBaseline,
    };

    await expect(authority.lookup(forged)).resolves.toMatchObject({
      status: "mismatch",
      code: "RECEIPT_IDENTITY_MISMATCH",
      requestDigest: request.requestDigest,
    });
    expect(documentReads).toBe(0);
    authority.close();
  });
});
