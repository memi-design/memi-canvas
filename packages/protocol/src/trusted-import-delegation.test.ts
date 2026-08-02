import { hashCanonicalValue } from "@memi/canonical-json";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupTemporaryDirectories,
  documentFixture,
  operationFor,
  requestFor,
} from "../../canvas-target/src/test-fixtures.js";
import {
  TargetEffectRequestSchema,
  type CanvasOperation,
  type TargetEffectRequest,
} from "./index.js";

afterEach(cleanupTemporaryDirectories);

const IMPORT_ACTOR_ID = "memi-import-pipeline";
const IMPORT_AUTHORITY_PRINCIPAL_ID = "import-runtime";

function directRequest(): TargetEffectRequest {
  const document = documentFixture();
  return requestFor(document, operationFor(document, "A"), "A");
}

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

function unequalRequest(
  actorId = IMPORT_ACTOR_ID,
): Record<string, unknown> {
  const direct = directRequest();
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

describe("target effect trusted import identity delegation", () => {
  it("retains same-identity legacy direct requests", () => {
    const request = directRequest();

    expect(TargetEffectRequestSchema.parse(request)).toEqual(request);
  });

  it("accepts the canonical import actor under import-runtime authority", () => {
    const request = unequalRequest();

    expect(TargetEffectRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    ["generic foreign actor", "caller-recomputed-actor"],
    ["noncanonical import actor", "import-runtime-worker"],
  ])(
    "rejects %s even with caller-recomputed payload hashes",
    (_label, actorId) => {
      expect(() =>
        TargetEffectRequestSchema.parse(
          unequalRequest(actorId),
        ),
      ).toThrow();
    },
  );

  it("rejects canonical actor delegation from any other principal", () => {
    const request = unequalRequest();

    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        issuerId: "other-runtime",
        lease: {
          ...(request.lease as Record<string, unknown>),
          holderId: "other-runtime",
        },
      }),
    ).toThrow();
  });

  it("retains exact lease-holder equality with the authority principal", () => {
    const request = unequalRequest();

    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        lease: {
          ...(request.lease as Record<string, unknown>),
          holderId: IMPORT_ACTOR_ID,
        },
      }),
    ).toThrow();
  });

  it("keeps signed delegation proof out of the target request surface", () => {
    const request = unequalRequest();

    expect(() =>
      TargetEffectRequestSchema.parse({
        ...request,
        trustedDelegationProof: "caller-supplied",
      }),
    ).toThrow();
  });
});
