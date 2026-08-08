import { z } from "zod";

const safeText = (maximum: number) =>
  z.string().trim().min(1).max(maximum);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const contentHash = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const reconstructionFidelitySchema = z.strictObject({
  geometryWithinOnePoint: z.boolean(),
  screenshotHiddenSsim: z.number().finite().min(0).max(1),
  verifiedAt: z.iso.datetime({ offset: true }),
});

export const EditableReconstructionV1Schema = z
  .strictObject({
    captureId: safeText(256),
    evidenceNodeId: safeText(256),
    frameId: safeText(256),
    geometryWithinOnePoint: z.boolean().nullable(),
    layers: z.record(
      safeText(160),
      z.strictObject({
        confidence: z.number().finite().min(0).max(1),
        evidenceRefs: z.array(safeText(256)).min(1).max(128),
        nodeId: safeText(256),
      }),
    ),
    reviewStatus: z.enum(["needs-review", "verified"]),
    screenshotHiddenSsim: z.number().finite().min(0).max(1).nullable(),
  })
  .superRefine((reconstruction, context) => {
    if (
      reconstruction.reviewStatus === "verified" &&
      (reconstruction.geometryWithinOnePoint !== true ||
        reconstruction.screenshotHiddenSsim === null ||
        reconstruction.screenshotHiddenSsim < 0.985)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Verified reconstructions require one-point geometry and SSIM >= 0.985.",
        path: ["reviewStatus"],
      });
    }
  });

export type EditableReconstructionV1 = z.infer<
  typeof EditableReconstructionV1Schema
>;

const runtimeCaptureLayerSchema = z
  .strictObject({
    content: z
      .strictObject({
        iconName: z.string().max(512).optional(),
        imageRef: z.string().trim().min(1).max(160).optional(),
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
    layerId: safeText(256),
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
        justify: z
          .enum(["start", "center", "end", "space-between"])
          .optional(),
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
    name: safeText(512),
    parentLayerId: safeText(256).optional(),
    semanticKey: safeText(160),
    source: z.strictObject({
      astPath: z.array(safeText(256)).min(1).max(128),
      atomicLevel: z
        .enum(["atom", "molecule", "organism", "template", "page"])
        .optional(),
      componentId: z.string().trim().min(1).max(512).nullable().optional(),
      exportName: z.string().trim().min(1).max(512).nullable().optional(),
      range: z.strictObject({
        end: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
      }),
      routeId: safeText(512).optional(),
      sourceAnchor: safeText(4_096),
      sourceContentHash: contentHash,
      stateId: safeText(512).optional(),
    }),
    style: z
      .strictObject({
        fill: z.string().trim().min(1).max(160).optional(),
        fontFamily: z.string().trim().min(1).max(512).optional(),
        fontSize: nonnegative.optional(),
        fontWeight: z.number().int().min(1).max(1_000).optional(),
        letterSpacing: finite.optional(),
        lineHeight: nonnegative.optional(),
        opacity: z.number().finite().min(0).max(1).optional(),
        shadow: z.string().trim().min(1).max(512).optional(),
        stroke: z.string().trim().min(1).max(160).optional(),
        textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
        textColor: z.string().trim().min(1).max(160).optional(),
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

export const RuntimeCaptureScreenV1Schema = z
  .strictObject({
    app: z.strictObject({
      appVersion: safeText(128),
      buildRevision: safeText(256),
      environment: z.enum(["simulator", "device"]),
      productId: safeText(256),
    }),
    artifact: z.strictObject({
      alt: z.string().max(4_096),
      artifactId: safeText(160),
      hash: contentHash,
      height: z.number().int().positive().max(32_768),
      kind: z.enum(["image/png", "image/jpeg"]),
      src: safeText(8_192),
      sourceUrl: safeText(8_192).optional(),
      width: z.number().int().positive().max(32_768),
    }),
    authority: z.literal("local_capture"),
    binding: z.strictObject({
      coverageCellId: safeText(512),
      normalizedPath: z.string().startsWith("/").max(2_048),
      routeId: safeText(512),
      sourceAnchor: safeText(4_096),
      sourceContentHash: contentHash.nullable(),
      stateId: safeText(512),
      viewport: z.strictObject({
        height: z.number().finite().positive().max(32_768),
        name: z.literal("mobile"),
        scale: z.number().finite().positive().max(8).optional(),
        width: z.number().finite().positive().max(32_768),
      }),
    }),
    captureId: safeText(256),
    capturedAt: z.iso.datetime({ offset: true }),
    evidence: z.strictObject({
      accessibilitySnapshotRef: safeText(2_048).optional(),
      captureMethod: z.literal("ios-simulator-screenshot"),
      componentIds: z.array(safeText(2_048)).max(1_024).optional(),
      label: z.literal("Local capture"),
      sourceAnchors: z.array(safeText(4_096)).max(1_024).optional(),
      truthLabel: z.literal("Local capture"),
      verifier: z.enum(["manual", "automated"]).optional(),
    }),
    layers: z.array(runtimeCaptureLayerSchema).max(1_000),
    repository: z.strictObject({
      dirty: z.boolean(),
      dirtyFileFingerprint: contentHash,
      revision: safeText(256),
      rootPath: z.string().startsWith("/").max(8_192),
      sourceFingerprint: contentHash,
    }),
    reconstructionFidelity: reconstructionFidelitySchema.optional(),
    schemaVersion: z.literal(1),
    screenId: safeText(256),
    screenName: safeText(512),
  })
  .superRefine((capture, context) => {
    const layerIds = capture.layers.map(({ layerId }) => layerId);
    const semanticKeys = capture.layers.map(({ semanticKey }) => semanticKey);
    if (new Set(layerIds).size !== layerIds.length) {
      context.addIssue({
        code: "custom",
        message: "Runtime capture layer IDs must be unique.",
        path: ["layers"],
      });
    }
    if (new Set(semanticKeys).size !== semanticKeys.length) {
      context.addIssue({
        code: "custom",
        message: "Runtime capture semantic keys must be unique.",
        path: ["layers"],
      });
    }
    const ids = new Set(layerIds);
    capture.layers.forEach((layer, index) => {
      if (
        layer.parentLayerId !== undefined &&
        !ids.has(layer.parentLayerId)
      ) {
        context.addIssue({
          code: "custom",
          message: "Runtime capture layer parent is missing.",
          path: ["layers", index, "parentLayerId"],
        });
      }
      const seen = new Set<string>([layer.layerId]);
      let parentId = layer.parentLayerId;
      while (parentId !== undefined) {
        if (seen.has(parentId)) {
          context.addIssue({
            code: "custom",
            message: "Runtime capture layer hierarchy contains a cycle.",
            path: ["layers", index, "parentLayerId"],
          });
          break;
        }
        seen.add(parentId);
        parentId = capture.layers.find(
          ({ layerId }) => layerId === parentId,
        )?.parentLayerId;
      }
    });
  });

export type RuntimeCaptureScreenV1 = z.infer<
  typeof RuntimeCaptureScreenV1Schema
>;
