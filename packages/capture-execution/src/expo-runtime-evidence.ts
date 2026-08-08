import {
  RuntimeCaptureLayerV1Schema,
  type CaptureScenarioV2,
  type RuntimeCaptureLayerV1,
} from "@memi/protocol";

import { CaptureExecutionError } from "./executor.js";

export interface ExpoRuntimeEvidenceV1 {
  readonly version: 1;
  readonly nonce?: string;
  readonly sourceRevision?: string;
  readonly runtimeToken?: string;
  readonly route: string;
  readonly state: string;
  readonly readinessSelector: string | null;
  readonly readinessMatched: boolean;
  readonly blank: boolean;
  readonly splash: boolean;
  readonly errorBoundary: boolean;
  readonly semanticCapture?: Readonly<{
    appVersion: string;
    layers: readonly RuntimeCaptureLayerV1[];
  }>;
}

export interface VerifyExpoRuntimeEvidenceInput {
  readonly scenario: CaptureScenarioV2;
  readonly bytes: Uint8Array;
  readonly expectedRoute?: string;
  readonly expectedNonce?: string;
  readonly expectedSourceRevision?: string;
  readonly expectedRuntimeToken?: string;
}

export function isExpoManagedRuntimeReady(
  bytes: Uint8Array,
  expectedRuntimeToken: string,
): boolean {
  const value = new TextDecoder().decode(bytes);
  if (value === `MEMI_CAPTURE_READY_V1:${expectedRuntimeToken}`) return true;
  const match = value.match(/^MEMI_CAPTURE_EVIDENCE_V1:(\{[^\r\n]*\})$/u);
  if (match === null) return false;
  try {
    const candidate = JSON.parse(match[1]!) as Readonly<Record<string, unknown>>;
    return (
      candidate.version === 1 &&
      candidate.runtimeToken === expectedRuntimeToken
    );
  } catch {
    return false;
  }
}

export function verifyExpoRuntimeEvidence(
  input: VerifyExpoRuntimeEvidenceInput,
): ExpoRuntimeEvidenceV1 {
  const markers = [
    ...new TextDecoder()
      .decode(input.bytes)
      .matchAll(/MEMI_CAPTURE_EVIDENCE_V1:(\{[^\r\n]*\})/gu),
  ];
  if (markers.length !== 1) {
    throw new CaptureExecutionError(
      "verify",
      markers.length === 0
        ? "RUNTIME_EVIDENCE_MISSING"
        : "RUNTIME_EVIDENCE_AMBIGUOUS",
      true,
      "Expo runtime must provide exactly one capture attestation.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(markers[0]![1]!);
  } catch {
    throw new CaptureExecutionError(
      "verify",
      "RUNTIME_EVIDENCE_INVALID",
      true,
      "Expo runtime capture attestation is invalid JSON.",
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1
  ) {
    throw new CaptureExecutionError(
      "verify",
      "RUNTIME_EVIDENCE_INVALID",
      true,
      "Expo runtime capture attestation has an invalid schema.",
    );
  }
  const candidate = value as ExpoRuntimeEvidenceV1;
  let semanticCapture: ExpoRuntimeEvidenceV1["semanticCapture"];
  if (candidate.semanticCapture !== undefined) {
    if (
      typeof candidate.semanticCapture !== "object" ||
      candidate.semanticCapture === null ||
      typeof candidate.semanticCapture.appVersion !== "string" ||
      candidate.semanticCapture.appVersion.trim().length === 0 ||
      candidate.semanticCapture.appVersion.length > 128
    ) {
      throw new CaptureExecutionError(
        "extract-layers",
        "SEMANTIC_RECONSTRUCTION_EVIDENCE_INVALID",
        true,
        "Expo semantic reconstruction evidence has an invalid schema.",
      );
    }
    const parsedLayers = RuntimeCaptureLayerV1Schema.array()
      .max(1_000)
      .safeParse(candidate.semanticCapture.layers);
    if (!parsedLayers.success) {
      throw new CaptureExecutionError(
        "extract-layers",
        "SEMANTIC_RECONSTRUCTION_EVIDENCE_INVALID",
        true,
        "Expo semantic reconstruction layers failed strict validation.",
      );
    }
    semanticCapture = Object.freeze({
      appVersion: candidate.semanticCapture.appVersion,
      layers: Object.freeze(
        parsedLayers.data.map((layer) => Object.freeze(layer)),
      ),
    });
  }
  const evidence: ExpoRuntimeEvidenceV1 = Object.freeze({
    ...candidate,
    ...(semanticCapture === undefined ? {} : { semanticCapture }),
  });
  const failure = [
    [
      input.expectedNonce !== undefined &&
        evidence.nonce !== input.expectedNonce,
      "ATTESTATION_NONCE_MISMATCH",
    ],
    [
      input.expectedSourceRevision !== undefined &&
        evidence.sourceRevision !== input.expectedSourceRevision,
      "ATTESTATION_REVISION_MISMATCH",
    ],
    [
      input.expectedRuntimeToken !== undefined &&
        evidence.runtimeToken !== input.expectedRuntimeToken,
      "ATTESTATION_RUNTIME_MISMATCH",
    ],
    [
      evidence.route !== (input.expectedRoute ?? input.scenario.route),
      "ROUTE_MISMATCH",
    ],
    [evidence.state !== input.scenario.state, "STATE_MISMATCH"],
    [
      evidence.readinessSelector !== input.scenario.readinessSelector ||
        evidence.readinessMatched !== true,
      "READINESS_NOT_REACHED",
    ],
    [evidence.blank !== false, "BLANK_SCREEN"],
    [evidence.splash !== false, "SPLASH_SCREEN"],
    [evidence.errorBoundary !== false, "ERROR_BOUNDARY"],
  ].find(([invalid]) => invalid);
  if (failure !== undefined) {
    throw new CaptureExecutionError(
      "verify",
      failure[1] as string,
      true,
      "Expo runtime evidence contradicted the planned capture scenario.",
    );
  }
  return evidence;
}
