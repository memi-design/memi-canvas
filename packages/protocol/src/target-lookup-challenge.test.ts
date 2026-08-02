import { describe, expect, it } from "vitest";

import {
  TargetLookupRequestSchema,
  TargetLookupResultSchema,
} from "./target-authority.js";

const hash = (character: string) =>
  `sha256:${character.repeat(64)}`;

describe("target lookup challenge protocol", () => {
  it("requires a closed runtime challenge and bound result evidence", () => {
    const request = {
      schemaVersion: 1,
      projectId: `prj_${"0".repeat(25)}A`,
      target: {
        kind: "canvas-document",
        id: `doc_${"0".repeat(25)}A`,
        expectedBeforeHash: hash("a"),
        baseline: {
          kind: "canvas-revision",
          revision: 1,
          stateHash: hash("a"),
        },
      },
      idempotencyKey: `idem_${"0".repeat(25)}A`,
      commandId: `cmd_${"0".repeat(25)}A`,
      commandActionDigest: hash("b"),
      operationActionDigest: hash("c"),
      expectedBeforeHash: hash("a"),
      challenge: {
        id: `rcv_${"0".repeat(25)}A`,
        nonce: "a".repeat(43),
        issuedAt: "2026-07-28T12:00:00.000Z",
      },
      requestDigest: hash("d"),
    } as const;
    expect(TargetLookupRequestSchema.parse(request)).toEqual(request);

    const result = {
      schemaVersion: 1,
      status: "not-found",
      requestDigest: request.requestDigest,
      checkedAt: "2026-07-28T12:00:00.000Z",
      currentTargetHash: hash("a"),
      evidenceHash: hash("e"),
    } as const;
    expect(TargetLookupResultSchema.parse(result)).toEqual(result);
    expect(() =>
      TargetLookupResultSchema.parse({
        ...result,
        requestDigest: undefined,
      }),
    ).toThrow();
  });
});
