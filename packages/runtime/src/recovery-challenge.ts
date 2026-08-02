import { randomBytes } from "node:crypto";

import {
  RecoveryAttemptIdSchema,
  RecoveryChallengeNonceSchema,
  type RecoveryAttemptId,
} from "../../protocol/src/index.js";

import type { RecoveryChallengeFactory } from "./types.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function crockford(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = CROCKFORD[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

export const secureRecoveryChallengeFactory: RecoveryChallengeFactory =
  () => ({
    id: RecoveryAttemptIdSchema.parse(
      `rcv_${crockford(randomBytes(16))}`,
    ) as RecoveryAttemptId,
    nonce: RecoveryChallengeNonceSchema.parse(
      randomBytes(32).toString("base64url"),
    ),
  });
