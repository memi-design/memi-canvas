import {
  LegacyCanvasIdMappingReceiptV2Schema,
  type LegacyCanvasIdKindV2,
  type LegacyCanvasIdMappingReceiptV2,
} from "@memi/protocol";

import { hashValue } from "./hash.js";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function digestToSortableBody(digest: string): string {
  const hex = digest.slice("sha256:".length);
  let remaining = BigInt(`0x${hex}`);
  let encoded = "";
  while (remaining > 0n) {
    encoded = CROCKFORD_BASE32[Number(remaining % 32n)]! + encoded;
    remaining /= 32n;
  }
  return encoded.padStart(52, "0").slice(0, 26);
}

export function mapLegacyCanvasIdV2(
  kind: LegacyCanvasIdKindV2,
  legacyId: string,
): LegacyCanvasIdMappingReceiptV2 {
  const digest = hashValue({
    namespace: "memi-canvas-v2-id",
    strategy: "sha256-crockford-v1",
    kind,
    legacyId,
  });
  const prefixByKind = {
    project: "prj",
    document: "doc",
    node: "nod",
    component: "cmp",
    operation: "opn",
  } as const;
  return Object.freeze(
    LegacyCanvasIdMappingReceiptV2Schema.parse({
      strategy: "sha256-crockford-v1",
      kind,
      legacyId,
      canonicalId: `${prefixByKind[kind]}_${digestToSortableBody(digest)}`,
      digest,
    }),
  );
}
