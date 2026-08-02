import { z } from "zod";

import { ContentHashSchema, IsoTimestampSchema } from "./common.js";
import { ArtifactIdSchema } from "./ids.js";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();

export const RuntimeCaptureLayerV1Schema = z
  .strictObject({
    content: z
      .strictObject({
        iconName: z.string().max(512).optional(),
        imageRef: ArtifactIdSchema.optional(),
        placeholder: z.string().max(4_096).optional(),
        selected: z.boolean().optional(),
        text: z.string().max(1_000_000).optional(),
        value: z.string().max(4_096).optional(),
      })
      .default({}),
    geometry: z.strictObject({
      clip: z.boolean().optional(),
      cornerRadius: nonnegative.optional(),
      height: nonnegative,
      rotation: finite.default(0),
      width: nonnegative,
      x: finite,
      y: finite,
    }),
    kind: z.enum([
      "frame",
      "group",
      "text",
      "shape",
      "image",
      "component-instance",
      "icon",
    ]),
    layerId: text(256),
    layout: z
      .strictObject({
        align: z.enum(["start", "center", "end", "stretch"]).optional(),
        flex: z
          .strictObject({
            direction: z.enum(["row", "column"]),
            wrap: z.boolean().optional(),
          })
          .optional(),
        gap: nonnegative.optional(),
        justify: z.enum(["start", "center", "end", "space-between"]).optional(),
        padding: z
          .strictObject({
            bottom: nonnegative,
            left: nonnegative,
            right: nonnegative,
            top: nonnegative,
          })
          .optional(),
        position: z.literal("absolute"),
      })
      .optional(),
    name: text(512),
    parentLayerId: text(256).optional(),
    semanticKey: text(160),
    source: z.strictObject({
      astPath: z.array(text(256)).min(1).max(128),
      atomicLevel: z
        .enum(["atom", "molecule", "organism", "template", "page"])
        .optional(),
      componentId: text(512).nullable().optional(),
      exportName: text(512).nullable().optional(),
      range: z.strictObject({
        end: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
      }),
      routeId: text(512).optional(),
      sourceAnchor: text(4_096),
      sourceContentHash: ContentHashSchema,
      stateId: text(512).optional(),
    }),
    style: z
      .strictObject({
        fill: text(160).optional(),
        fontFamily: text(512).optional(),
        fontSize: nonnegative.optional(),
        fontWeight: z.number().int().min(1).max(1_000).optional(),
        letterSpacing: finite.optional(),
        lineHeight: nonnegative.optional(),
        opacity: finite.min(0).max(1).optional(),
        shadow: text(512).optional(),
        stroke: text(160).optional(),
        textColor: text(160).optional(),
      })
      .default({}),
    zIndex: z.number().int(),
  })
  .superRefine((layer, context) => {
    if (layer.source.range.end < layer.source.range.start) {
      context.addIssue({
        code: "custom",
        message: "Layer source range end must not precede its start.",
        path: ["source", "range", "end"],
      });
    }
    if (layer.kind === "text" && layer.content.text === undefined) {
      context.addIssue({
        code: "custom",
        message: "Runtime text layers require text content.",
        path: ["content", "text"],
      });
    }
  });

export type RuntimeCaptureLayerV1 = z.infer<typeof RuntimeCaptureLayerV1Schema>;

export const RuntimeCaptureScreenV1Schema = z
  .strictObject({
    app: z.strictObject({
      appVersion: text(128),
      buildRevision: text(256),
      environment: z.enum(["simulator", "device"]),
      productId: text(256),
    }),
    artifact: z.strictObject({
      alt: z.string().max(4_096),
      artifactId: ArtifactIdSchema,
      hash: ContentHashSchema,
      height: z.number().int().positive().max(32_768),
      kind: z.enum(["image/png", "image/jpeg"]),
      src: text(8_192),
      sourceUrl: text(8_192).optional(),
      width: z.number().int().positive().max(32_768),
    }),
    authority: z.literal("local_capture"),
    binding: z.strictObject({
      coverageCellId: text(512),
      normalizedPath: z.string().startsWith("/").max(2_048),
      routeId: text(512),
      sourceAnchor: text(4_096),
      sourceContentHash: ContentHashSchema.nullable(),
      stateId: text(512),
      viewport: z.strictObject({
        height: finite.positive().max(32_768),
        name: z.literal("mobile"),
        scale: finite.positive().max(8).optional(),
        width: finite.positive().max(32_768),
      }),
    }),
    captureId: text(256),
    capturedAt: IsoTimestampSchema,
    evidence: z.strictObject({
      accessibilitySnapshotRef: text(2_048).optional(),
      captureMethod: z.literal("ios-simulator-screenshot"),
      componentIds: z.array(text(2_048)).max(1_024).optional(),
      label: z.literal("Local capture"),
      sourceAnchors: z.array(text(4_096)).max(1_024).optional(),
      truthLabel: z.literal("Local capture"),
      verifier: z.enum(["manual", "automated"]).optional(),
    }),
    layers: z.array(RuntimeCaptureLayerV1Schema).max(1_000),
    repository: z.strictObject({
      dirty: z.boolean(),
      dirtyFileFingerprint: ContentHashSchema,
      revision: text(256),
      rootPath: z.string().startsWith("/").max(8_192),
      sourceFingerprint: ContentHashSchema,
    }),
    schemaVersion: z.literal(1),
    screenId: text(256),
    screenName: text(512),
  })
  .superRefine((capture, context) => {
    const layerIds = capture.layers.map(({ layerId }) => layerId);
    const semanticKeys = capture.layers.map(({ semanticKey }) => semanticKey);
    if (new Set(layerIds).size !== layerIds.length) {
      context.addIssue({
        code: "custom",
        message: "Layer IDs must be unique.",
        path: ["layers"],
      });
    }
    if (new Set(semanticKeys).size !== semanticKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Semantic keys must be unique.",
        path: ["layers"],
      });
    }
    const ids = new Set(layerIds);
    capture.layers.forEach((layer, index) => {
      if (layer.parentLayerId !== undefined && !ids.has(layer.parentLayerId)) {
        context.addIssue({
          code: "custom",
          message: "Layer parent is missing.",
          path: ["layers", index, "parentLayerId"],
        });
      }
    });
  });

export type RuntimeCaptureScreenV1 = z.infer<
  typeof RuntimeCaptureScreenV1Schema
>;
