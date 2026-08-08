import { z } from "zod";

import { isSafeReferenceSourceUrl } from "./reference-security.js";

const referenceText = (maximum: number) => z.string().min(1).max(maximum);

export const canvasReferenceBindingSchema = z.strictObject({
  src: z
    .string()
    .min(1)
    .max(4_096)
    .regex(
      /^(?:\/imports\/artifacts\/art_[0-9A-HJKMNP-TV-Z]{26}\.png|memi-artifact:\/\/localhost\/art_[0-9A-HJKMNP-TV-Z]{26})$/u,
    ),
  alt: z.string().trim().min(1).max(2_048),
  authority: z.string().trim().min(1).max(256),
  appVersion: z.string().trim().min(1).max(128),
  capturedAt: z.iso.datetime(),
  sourceUrl: z.url().max(8_192).refine(isSafeReferenceSourceUrl),
  captureId: referenceText(2_048).optional(),
  contentHash: referenceText(512).optional(),
  sourceRevision: referenceText(2_048).optional(),
  accessibilitySnapshotRef: referenceText(2_048).optional(),
  sourceAnchors: z.array(referenceText(2_048)).max(1_024).optional(),
  componentIds: z.array(referenceText(2_048)).max(1_024).optional(),
});
