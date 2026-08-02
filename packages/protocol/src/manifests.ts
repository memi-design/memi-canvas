import { z } from "zod";
import { hashCanonicalValue } from "@memi/canonical-json";
import {
  ContentHashSchema,
  ContainedRelativeSourcePathSchema,
  GitRevisionSchema,
  SafeDisplayLabelSchema,
  SafeRoutePathSchema,
  SchemaVersionSchema,
  hasUniqueValues,
} from "./common.js";
import {
  ArtifactIdSchema,
  CapturePlanIdSchema,
  CoverageCellIdSchema,
  FlowIdSchema,
  ProjectIdSchema,
  RouteIdSchema,
  StateIdSchema,
} from "./ids.js";

const ProcessCommandSchema = z.strictObject({
  executable: z.string().trim().min(1),
  args: z.array(z.string()),
});

const RepositorySourceSchema = z.strictObject({
  kind: z.literal("repository"),
  root: z.string().startsWith("/"),
  revision: GitRevisionSchema,
  dirty: z.boolean(),
  dirtyFileFingerprint: ContentHashSchema,
});

const StaticBuildSourceSchema = z.strictObject({
  kind: z.literal("static-build"),
  root: z.string().startsWith("/"),
  contentFingerprint: ContentHashSchema,
});

const RunningUrlSourceSchema = z.strictObject({
  kind: z.literal("running-url"),
  url: z.url().refine((url) => {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  }, "M1 running URLs must be loopback-local."),
});

const ScreenshotFolderSourceSchema = z.strictObject({
  kind: z.literal("screenshot-folder"),
  root: z.string().startsWith("/"),
  contentFingerprint: ContentHashSchema,
});

const BlankSourceSchema = z.strictObject({
  kind: z.literal("blank"),
});

const FrameworkSchema = z.strictObject({
  kind: z.enum([
    "vite-react",
    "nextjs",
    "storybook",
    "static-html",
    "unknown",
  ]),
  confidence: z.enum(["verified", "inferred", "unknown"]),
});

const productManifestBase = {
  schemaVersion: SchemaVersionSchema,
  projectId: ProjectIdSchema,
  dimensions: z.strictObject({
    roles: z.array(z.string().trim().min(1)),
    themes: z.array(z.string().trim().min(1)),
    locales: z.array(z.string().trim().min(1)),
    flags: z.array(z.string().trim().min(1)),
    fixtures: z.array(z.string().trim().min(1)),
  }),
};

const RepositoryManifestSchema = z.strictObject({
  ...productManifestBase,
  importMode: z.literal("repository"),
  source: RepositorySourceSchema,
  framework: FrameworkSchema,
  commands: z.strictObject({
    install: ProcessCommandSchema,
    preview: ProcessCommandSchema,
  }),
});

const StorybookManifestSchema = z.strictObject({
  ...productManifestBase,
  importMode: z.literal("storybook"),
  source: RepositorySourceSchema,
  framework: FrameworkSchema,
  commands: z.strictObject({
    install: ProcessCommandSchema,
    preview: ProcessCommandSchema,
  }),
});

const StaticBuildManifestSchema = z.strictObject({
  ...productManifestBase,
  importMode: z.literal("static-build"),
  source: StaticBuildSourceSchema,
  framework: FrameworkSchema,
  commands: z.strictObject({
    preview: ProcessCommandSchema,
  }),
});

const RunningUrlManifestSchema = z.strictObject({
  ...productManifestBase,
  importMode: z.literal("running-url"),
  source: RunningUrlSourceSchema,
});

const ScreenshotFolderManifestSchema = z.strictObject({
  ...productManifestBase,
  importMode: z.literal("screenshot-folder"),
  source: ScreenshotFolderSourceSchema,
});

const BlankManifestSchema = z.strictObject({
  ...productManifestBase,
  importMode: z.literal("blank"),
  source: BlankSourceSchema,
});

export const ProductManifestSchema = z.discriminatedUnion("importMode", [
  RepositoryManifestSchema,
  StorybookManifestSchema,
  StaticBuildManifestSchema,
  RunningUrlManifestSchema,
  ScreenshotFolderManifestSchema,
  BlankManifestSchema,
]);
export type ProductManifest = z.infer<typeof ProductManifestSchema>;

const RouteSchema = z
  .strictObject({
    id: RouteIdSchema,
    displayName: SafeDisplayLabelSchema,
    path: SafeRoutePathSchema,
    sourceScreen: z
      .string()
      .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/u)
      .optional(),
    sourceOwnership: z.enum([
      "code-owned",
      "canvas-owned",
      "snapshot",
      "reference-only",
    ]),
    sourceFile: ContainedRelativeSourcePathSchema.optional(),
    authentication: z.enum(["public", "authenticated", "role-restricted"]),
    parameters: z.array(z.string().trim().min(1)),
  })
  .superRefine((route, context) => {
    if (route.sourceOwnership === "code-owned" && route.sourceFile === undefined) {
      context.addIssue({
        code: "custom",
        path: ["sourceFile"],
        message: "Code-owned routes require a source file.",
      });
    }
    if (
      route.sourceOwnership === "code-owned" &&
      route.sourceScreen === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceScreen"],
        message: "Code-owned routes require a source screen symbol.",
      });
    }
  });

export const RouteManifestSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    routes: z.array(RouteSchema),
  })
  .superRefine((manifest, context) => {
    if (!hasUniqueValues(manifest.routes.map((route) => route.id))) {
      context.addIssue({
        code: "custom",
        path: ["routes"],
        message: "Route IDs must be unique.",
      });
    }
  });
export type RouteManifest = z.infer<typeof RouteManifestSchema>;

const StateSchema = z.strictObject({
  id: StateIdSchema,
  routeId: RouteIdSchema,
  name: SafeDisplayLabelSchema,
  kind: z.enum([
    "default",
    "loading",
    "empty",
    "error",
    "success",
    "overlay",
    "validation",
    "permission",
  ]),
  provenance: z.enum(["declared", "observed", "inferred"]),
});

export const StateManifestSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    states: z.array(StateSchema),
  })
  .superRefine((manifest, context) => {
    if (!hasUniqueValues(manifest.states.map((state) => state.id))) {
      context.addIssue({
        code: "custom",
        path: ["states"],
        message: "State IDs must be unique.",
      });
    }
  });
export type StateManifest = z.infer<typeof StateManifestSchema>;

const SafeFlowLabelSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const FlowStepSchema = z.strictObject({
  order: z.number().int().positive(),
  routeId: RouteIdSchema,
  stateId: StateIdSchema,
  trigger: SafeFlowLabelSchema,
  assertion: SafeFlowLabelSchema,
});

const FlowSchema = z
  .strictObject({
    id: FlowIdSchema,
    name: SafeDisplayLabelSchema,
    provenance: z.literal("declared"),
    steps: z.array(FlowStepSchema).min(1),
  })
  .superRefine((flow, context) => {
    for (const [index, step] of flow.steps.entries()) {
      if (step.order !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "order"],
          message: "Flow steps must use contiguous 1-based order.",
        });
      }
    }
  });

export const FlowManifestSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    sourceContentFingerprint: ContentHashSchema,
    compilerFingerprint: ContentHashSchema,
    sourceFile: ContainedRelativeSourcePathSchema,
    routeManifestDigest: ContentHashSchema,
    stateManifestDigest: ContentHashSchema,
    flows: z.array(FlowSchema),
  })
  .superRefine((manifest, context) => {
    if (!hasUniqueValues(manifest.flows.map((flow) => flow.id))) {
      context.addIssue({
        code: "custom",
        path: ["flows"],
        message: "Flow IDs must be unique.",
      });
    }
  });
export type FlowManifest = z.infer<typeof FlowManifestSchema>;

export interface FlowManifestBindingInput {
  readonly flowManifest: unknown;
  readonly routeManifest: unknown;
  readonly stateManifest: unknown;
  readonly sourceContentFingerprint: unknown;
  readonly compilerFingerprint: unknown;
}

export function validateFlowManifestBindings(
  input: FlowManifestBindingInput,
): FlowManifest {
  const flowManifest = FlowManifestSchema.parse(input.flowManifest);
  const routeManifest = RouteManifestSchema.parse(input.routeManifest);
  const stateManifest = StateManifestSchema.parse(input.stateManifest);
  const sourceContentFingerprint = ContentHashSchema.parse(
    input.sourceContentFingerprint,
  );
  const compilerFingerprint = ContentHashSchema.parse(input.compilerFingerprint);

  if (
    flowManifest.projectId !== routeManifest.projectId ||
    flowManifest.projectId !== stateManifest.projectId
  ) {
    throw new Error("Flow manifest project binding does not match.");
  }
  if (
    flowManifest.sourceContentFingerprint !== sourceContentFingerprint ||
    flowManifest.compilerFingerprint !== compilerFingerprint
  ) {
    throw new Error("Flow manifest source or compiler binding does not match.");
  }
  if (
    flowManifest.routeManifestDigest !== hashCanonicalValue(routeManifest) ||
    flowManifest.stateManifestDigest !== hashCanonicalValue(stateManifest)
  ) {
    throw new Error("Flow manifest route or state digest binding does not match.");
  }

  const routeIds = new Set(routeManifest.routes.map((route) => route.id));
  const states = new Map(
    stateManifest.states.map((state) => [state.id, state] as const),
  );
  for (const flow of flowManifest.flows) {
    for (const step of flow.steps) {
      if (!routeIds.has(step.routeId)) {
        throw new Error(`Flow step references unknown route "${step.routeId}".`);
      }
      const state = states.get(step.stateId);
      if (state === undefined) {
        throw new Error(`Flow step references unknown state "${step.stateId}".`);
      }
      if (state.routeId !== step.routeId) {
        throw new Error(
          `Flow step state "${step.stateId}" does not belong to route "${step.routeId}".`,
        );
      }
    }
  }

  return flowManifest;
}

export const FrameKindSchema = z.enum([
  "code-frame",
  "draft-frame",
  "snapshot-frame",
  "reference-frame",
]);
export type FrameKind = z.infer<typeof FrameKindSchema>;

export const FrameAuthoritySchema = z.enum([
  "product-source",
  "canvas-document",
  "evidence-store",
  "external-reference",
]);
export type FrameAuthority = z.infer<typeof FrameAuthoritySchema>;

export const EvidenceLevelSchema = z.enum([
  "verified",
  "observed",
  "inferred",
  "reference",
  "proposed",
]);
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;

export const CoverageHealthSchema = z.enum([
  "current",
  "partial",
  "blocked",
  "stale",
  "not-captured",
]);
export type CoverageHealth = z.infer<typeof CoverageHealthSchema>;

const REASON_REQUIRED_HEALTH = new Set([
  "partial",
  "blocked",
  "stale",
  "not-captured",
]);

const CoverageCellSchema = z
  .strictObject({
    id: CoverageCellIdSchema,
    routeId: RouteIdSchema,
    stateId: StateIdSchema,
    role: z.string().trim().min(1),
    theme: z.string().trim().min(1),
    locale: z.string().trim().min(1),
    fixture: z.string().trim().min(1),
    viewport: z.strictObject({
      name: z.string().trim().min(1),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
    health: CoverageHealthSchema,
    evidenceLevel: EvidenceLevelSchema.nullable(),
    frameKind: FrameKindSchema.nullable(),
    reason: z.string().trim().min(1).optional(),
    evidenceArtifactIds: z.array(ArtifactIdSchema),
    evidenceHash: ContentHashSchema.optional(),
  })
  .superRefine((cell, context) => {
    if (
      cell.evidenceLevel === "verified" &&
      cell.evidenceArtifactIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["evidenceArtifactIds"],
        message: "Verified evidence requires an artifact.",
      });
    }

    if (
      REASON_REQUIRED_HEALTH.has(cell.health) &&
      cell.reason === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: `${cell.health} cells require a reason.`,
      });
    }

    if (cell.health === "blocked" && cell.frameKind !== null) {
      context.addIssue({
        code: "custom",
        path: ["frameKind"],
        message: "Blocked coverage cells cannot fabricate a frame.",
      });
    }

    if ((cell.frameKind === null) !== (cell.evidenceLevel === null)) {
      context.addIssue({
        code: "custom",
        path: ["frameKind"],
        message: "Frame kind and evidence level must appear together.",
      });
    }
  });

export const CoverageLedgerSchema = z
  .strictObject({
    schemaVersion: SchemaVersionSchema,
    projectId: ProjectIdSchema,
    capturePlanId: CapturePlanIdSchema,
    cells: z.array(CoverageCellSchema),
  })
  .superRefine((ledger, context) => {
    if (!hasUniqueValues(ledger.cells.map((cell) => cell.id))) {
      context.addIssue({
        code: "custom",
        path: ["cells"],
        message: "Coverage cell IDs must be unique.",
      });
    }
  });
export type CoverageLedger = z.infer<typeof CoverageLedgerSchema>;

const DesignTokenSchema = z.strictObject({
  name: z.string().trim().min(1),
  cssVariable: z.string().regex(/^--[a-z0-9-]+$/u),
  value: z.string().trim().min(1),
  sourceFile: z.string().trim().min(1),
  provenance: z.literal("declared"),
});

export const DesignSystemManifestSchema = z.strictObject({
  schemaVersion: SchemaVersionSchema,
  projectId: ProjectIdSchema,
  tokens: z.array(DesignTokenSchema),
});
export type DesignSystemManifest = z.infer<
  typeof DesignSystemManifestSchema
>;
