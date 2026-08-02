import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import {
  ContentHashSchema,
  DurableCommandSchema,
  type ContentHash,
  type DurableCommand,
} from "../../protocol/src/index.js";

export { canonicalJson };

export function computeCommandActionDigest(
  input: DurableCommand,
): ContentHash {
  const command = DurableCommandSchema.parse(input);
  const {
    actionDigest: _claimedActionDigest,
    id: _commandId,
    idempotencyKey: _idempotencyKey,
    payloadHash,
    ...commandAction
  } = command;
  return ContentHashSchema.parse(
    hashCanonicalValue({
      commandActionVersion: 1,
      ...commandAction,
      payloadHash,
    }),
  );
}

export function computeCommandDigests(
  input: DurableCommand,
  effectPayload: unknown,
): {
  readonly canonicalPayload: string;
  readonly payloadHash: ContentHash;
  readonly actionDigest: ContentHash;
} {
  const command = DurableCommandSchema.parse(input);
  const canonicalPayload = canonicalJson(effectPayload);
  const payloadHash = ContentHashSchema.parse(
    hashCanonicalValue(effectPayload),
  );
  const actionDigest = computeCommandActionDigest({
    ...command,
    payloadHash,
  });
  return { canonicalPayload, payloadHash, actionDigest };
}

export function bindCommandAction(
  input: DurableCommand,
  effectPayload: unknown,
): DurableCommand {
  const {
    canonicalPayload: _canonicalPayload,
    ...digests
  } = computeCommandDigests(input, effectPayload);
  return DurableCommandSchema.parse({
    ...input,
    ...digests,
  });
}
