import { hashCanonicalValue } from "@memi/canonical-json";
import { describe, expect, it } from "vitest";

import * as targetAuthority from "./target-authority.js";
import {
  TargetVerificationRequestSchema,
  TargetVerificationResultSchema,
} from "./target-authority.js";

const hash = (character: string) =>
  `sha256:${character.repeat(64)}`;
const now = "2026-07-28T12:00:00.000Z";

function request(suffix: string, issuedAt = now) {
  const material = {
    schemaVersion: 1 as const,
    projectId: `prj_${"0".repeat(25)}A`,
    target: {
      kind: "canvas-document" as const,
      id: `doc_${"0".repeat(25)}A`,
      expectedBeforeHash: hash("a"),
      baseline: {
        kind: "canvas-revision" as const,
        revision: 1,
        stateHash: hash("a"),
      },
    },
    idempotencyKey: `idem_${"0".repeat(25)}A`,
    commandId: `cmd_${"0".repeat(25)}A`,
    commandActionDigest: hash("b"),
    operationActionDigest: hash("c"),
    expectedBeforeHash: hash("a"),
    expectedResultingHash: hash("d"),
    expectedReceiptHash: hash("e"),
    challenge: {
      id: `rcv_${"0".repeat(25)}${suffix}`,
      nonce: suffix.toLowerCase().repeat(43),
      issuedAt,
    },
  };
  return {
    ...material,
    requestDigest: hashCanonicalValue(material),
  };
}

function result(
  verification: ReturnType<typeof request>,
  checkedAt = now,
) {
  const material = {
    schemaVersion: 1 as const,
    status: "mismatch" as const,
    code: "EXPECTED_EVIDENCE_MISMATCH" as const,
    message: "Expected verification evidence differs.",
    requestDigest: verification.requestDigest,
    checkedAt,
  };
  return {
    ...material,
    evidenceHash: hashCanonicalValue(material),
  };
}

type Validation = {
  readonly accepted: boolean;
  readonly reason?: string;
};

function validate(
  verification: unknown,
  evidence: unknown,
  observedAt = now,
): Validation {
  const authority = targetAuthority as unknown as {
    readonly validateTargetVerificationEvidence: (
      request: unknown,
      result: unknown,
      now: string,
    ) => Validation;
  };
  return authority.validateTargetVerificationEvidence(
    verification,
    evidence,
    observedAt,
  );
}

describe("target verification challenge protocol", () => {
  it("requires closed challenge-bound verification requests and results", () => {
    const verification = request("A");
    const evidence = result(verification);
    expect(
      TargetVerificationRequestSchema.parse(verification),
    ).toEqual(verification);
    expect(TargetVerificationResultSchema.parse(evidence)).toEqual(
      evidence,
    );
    expect(validate(verification, evidence)).toEqual({
      accepted: true,
      result: evidence,
    });
    expect(
      TargetVerificationRequestSchema.safeParse({
        ...verification,
        challenge: undefined,
      }).success,
    ).toBe(false);
    expect(
      TargetVerificationResultSchema.safeParse({
        ...evidence,
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["preplayed challenge", "preplay"],
    ["checked before challenge", "before"],
    ["future checkedAt", "future"],
    ["expired checkedAt", "expired"],
    ["tampered evidence", "tamper"],
    ["missing digest", "missing"],
  ] as const)("rejects %s", (_label, failure) => {
    const verification = request("B");
    let evidence: Record<string, unknown> =
      failure === "before"
        ? result(verification, "2026-07-28T11:59:59.000Z")
        : failure === "future"
          ? result(verification, "2026-07-28T12:00:01.000Z")
          : result(verification);
    let observedAt = now;
    if (failure === "preplay") {
      evidence = result(request("C"));
    } else if (failure === "expired") {
      observedAt = "2026-07-28T12:00:31.000Z";
    } else if (failure === "tamper") {
      evidence = { ...evidence, evidenceHash: hash("f") };
    } else if (failure === "missing") {
      const { requestDigest: _digest, ...missing } = evidence;
      evidence = missing;
    }

    expect(
      validate(verification, evidence, observedAt),
    ).toMatchObject({ accepted: false });
  });
});
