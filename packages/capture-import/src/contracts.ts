import { z } from "zod";

import {
  CaptureArtifactSchemaV2,
  CaptureFailureSchemaV1,
  CaptureScenarioSchemaV2,
  ImportJobDraftSchemaV2,
  ImportJobSnapshotSchemaV2,
  ImportPlatformSchema,
  type CaptureArtifactV2,
  type CaptureFailureV1,
  type CaptureScenarioV2,
  type ImportApplicationV2,
  type ImportJobDraftV2,
  type ImportJobSnapshotV2,
} from "@memi/protocol";

export {
  CaptureArtifactSchemaV2,
  CaptureFailureSchemaV1,
  CaptureScenarioSchemaV2,
  ImportJobDraftSchemaV2,
  ImportJobSnapshotSchemaV2,
};
export type {
  CaptureArtifactV2,
  CaptureFailureV1,
  CaptureScenarioV2,
  ImportApplicationV2,
  ImportJobDraftV2,
  ImportJobSnapshotV2,
};

export function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

export function parseCaptureScenarioV2(input: unknown): CaptureScenarioV2 {
  return deepFreeze(CaptureScenarioSchemaV2.parse(input));
}

export function parseCaptureArtifactV2(input: unknown): CaptureArtifactV2 {
  return deepFreeze(CaptureArtifactSchemaV2.parse(input));
}

export function parseCaptureFailureV1(input: unknown): CaptureFailureV1 {
  return deepFreeze(CaptureFailureSchemaV1.parse(input));
}

export function parseImportJobDraftV2(input: unknown): ImportJobDraftV2 {
  return deepFreeze(ImportJobDraftSchemaV2.parse(input));
}

export function parseImportJobSnapshotV2(
  input: unknown,
): ImportJobSnapshotV2 {
  return deepFreeze(ImportJobSnapshotSchemaV2.parse(input));
}

export const CaptureAdapterCapabilitySchemaV1 = z.enum([
  "discover",
  "prepare",
  "launch",
  "capture",
  "collect",
  "cleanup",
]);
export type CaptureAdapterCapabilityV1 = z.infer<
  typeof CaptureAdapterCapabilitySchemaV1
>;

const REQUIRED_CAPABILITIES =
  CaptureAdapterCapabilitySchemaV1.options;

export const CaptureAdapterMetadataSchemaV1 = z
  .strictObject({
    id: z.string().trim().min(1).max(160),
    platform: ImportPlatformSchema,
    version: z.string().trim().min(1).max(64),
    capabilities: z
      .array(CaptureAdapterCapabilitySchemaV1)
      .length(REQUIRED_CAPABILITIES.length),
  })
  .superRefine(({ capabilities }, context) => {
    if (new Set(capabilities).size !== capabilities.length) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "Capture adapter capabilities must be unique.",
      });
    }
  });
export type CaptureAdapterMetadataV1 = z.infer<
  typeof CaptureAdapterMetadataSchemaV1
>;

export function parseCaptureAdapterMetadataV1(
  input: unknown,
): CaptureAdapterMetadataV1 {
  return deepFreeze(CaptureAdapterMetadataSchemaV1.parse(input));
}

export interface CaptureAdapterContextV1 {
  readonly job: ImportJobSnapshotV2;
  readonly signal: AbortSignal;
}

export interface CapturePreparationV1 {
  readonly id: string;
  readonly application: ImportApplicationV2;
  readonly repository: ImportJobSnapshotV2["repository"];
}

export interface CaptureLaunchV1 {
  readonly id: string;
  readonly preparationId: string;
}

export interface RawCaptureV1 {
  readonly id: string;
  readonly scenarioId: CaptureScenarioV2["id"];
}

export interface CaptureAdapterV1 {
  readonly metadata: CaptureAdapterMetadataV1;
  discover(
    context: CaptureAdapterContextV1,
  ): Promise<readonly ImportApplicationV2[]>;
  prepare(
    context: CaptureAdapterContextV1,
    application: ImportApplicationV2,
    scenarios: readonly CaptureScenarioV2[],
  ): Promise<CapturePreparationV1>;
  launch(
    context: CaptureAdapterContextV1,
    preparation: CapturePreparationV1,
  ): Promise<CaptureLaunchV1>;
  capture(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1,
    scenario: CaptureScenarioV2,
  ): Promise<RawCaptureV1>;
  collect(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1,
    capture: RawCaptureV1,
  ): Promise<CaptureArtifactV2>;
  cleanup(
    context: CaptureAdapterContextV1,
    launch: CaptureLaunchV1 | null,
  ): Promise<void>;
}
