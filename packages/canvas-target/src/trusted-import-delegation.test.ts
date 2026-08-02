import { hashCanonicalValue } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CanvasOperation,
  TargetEffectRequest,
} from "@memi/protocol";

import { CanvasTargetAuthority } from "./index.js";
import {
  NOW,
  cleanupTemporaryDirectories,
  databasePath,
  documentFixture,
  fenceFor,
  operationFor,
  requestFor,
  tableCounts,
} from "./test-fixtures.js";

afterEach(cleanupTemporaryDirectories);

const IMPORT_ACTOR_ID = "memi-import-pipeline";
const IMPORT_AUTHORITY_PRINCIPAL_ID = "import-runtime";

function operationWithActor(
  operation: CanvasOperation,
  actorId: string,
): CanvasOperation {
  const material = {
    schemaVersion: operation.schemaVersion,
    id: operation.id,
    documentId: operation.documentId,
    actorId,
    occurredAt: operation.occurredAt,
    type: operation.type,
    payload: operation.payload,
    expectedBeforeHash: operation.expectedBeforeHash,
  };
  return {
    ...operation,
    actorId,
    actionDigest: hashCanonicalValue(material),
  };
}

function targetFixture(suffix = "A") {
  const path = databasePath();
  const authority = new CanvasTargetAuthority({
    databasePath: path,
    clock: () => NOW,
  });
  const document = authority.createDocument(documentFixture());
  const direct = requestFor(
    document,
    operationFor(document, suffix),
    suffix,
  );
  return { authority, direct, document, path };
}

function unequalRequest(
  direct: TargetEffectRequest,
  actorId = IMPORT_ACTOR_ID,
): Record<string, unknown> {
  const payload = operationWithActor(direct.payload, actorId);
  return {
    ...direct,
    issuerId: IMPORT_AUTHORITY_PRINCIPAL_ID,
    operationActionDigest: payload.actionDigest,
    payloadHash: hashCanonicalValue(payload),
    payload,
    lease: {
      ...direct.lease,
      holderId: IMPORT_AUTHORITY_PRINCIPAL_ID,
    },
  };
}

async function expectNoMutation(
  fixture: ReturnType<typeof targetFixture>,
  request: Record<string, unknown>,
): Promise<void> {
  fixture.authority.activateFence(
    fenceFor(request as unknown as TargetEffectRequest),
  );
  const beforeCounts = tableCounts(fixture.path);
  const beforeDocument = fixture.authority.readDocument(
    fixture.document.projectId,
    fixture.document.id,
  );

  const outcome =
    await fixture.authority.compareAndApply(request);

  expect(outcome).toMatchObject({
    status: "not-applied",
    evidence: { code: "INVALID_REQUEST" },
  });
  expect(tableCounts(fixture.path)).toEqual(beforeCounts);
  expect(
    fixture.authority.readDocument(
      fixture.document.projectId,
      fixture.document.id,
    ),
  ).toEqual(beforeDocument);
}

describe("canvas target delegated import identity", () => {
  it("preserves same-identity legacy direct application", async () => {
    const fixture = targetFixture();
    fixture.authority.activateFence(fenceFor(fixture.direct));

    const outcome =
      await fixture.authority.compareAndApply(fixture.direct);

    expect(outcome.status).toBe("applied");
    expect(tableCounts(fixture.path)).toMatchObject({
      documents: 1,
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    fixture.authority.close();
  });

  it("applies the canonical distinct actor and authority identities", async () => {
    const fixture = targetFixture();
    const request = unequalRequest(fixture.direct);
    fixture.authority.activateFence(
      fenceFor(request as unknown as TargetEffectRequest),
    );

    const outcome =
      await fixture.authority.compareAndApply(request);

    expect(outcome.status).toBe("applied");
    expect(tableCounts(fixture.path)).toMatchObject({
      documents: 1,
      operations: 1,
      receipts: 1,
      idempotency_ledger: 1,
    });
    fixture.authority.close();
  });

  it.each([
    ["generic foreign actor", "caller-recomputed-actor"],
    ["noncanonical import actor", "import-runtime-worker"],
  ])("rejects %s before target mutation", async (_label, actorId) => {
    const fixture = targetFixture();

    await expectNoMutation(
      fixture,
      unequalRequest(fixture.direct, actorId),
    );
    fixture.authority.close();
  });

  it("rejects payload-hash tamper before target mutation", async () => {
    const fixture = targetFixture();
    const request = unequalRequest(fixture.direct);

    await expectNoMutation(fixture, {
      ...request,
      payloadHash: `sha256:${"f".repeat(64)}`,
    });
    fixture.authority.close();
  });
});
