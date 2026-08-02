import type {
  CaptureAdapterV1,
  CaptureLaunchV1,
} from "@memi/capture-import";
import {
  CaptureArtifactSchemaV2,
  CaptureFailureSchemaV1,
  type CaptureArtifactV2,
  type CaptureFailureV1,
  type CaptureScenarioV2,
  type ImportApplicationV2,
  type ImportJobSnapshotV2,
  type ImportJobStage,
} from "@memi/protocol";

import { BoundedRedactedLog, redactLogMessage } from "./redacted-log.js";

export type CaptureExecutionResult =
  | Readonly<{ kind: "captured"; artifact: CaptureArtifactV2 }>
  | Readonly<{ kind: "failed"; failure: CaptureFailureV1 }>;

export interface CaptureExecutionRequest {
  readonly adapter: CaptureAdapterV1;
  readonly application: ImportApplicationV2;
  readonly scenario: CaptureScenarioV2;
  readonly job: ImportJobSnapshotV2;
  readonly signal: AbortSignal;
  readonly now?: () => Date;
}

export class CaptureExecutionError extends Error {
  constructor(
    readonly stage: ImportJobStage,
    readonly code: string,
    readonly retryable: boolean,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CaptureExecutionError(
      "capture",
      "CAPTURE_CANCELLED",
      true,
      "Capture was cancelled.",
    );
  }
}

async function atStage<Value>(
  stage: ImportJobStage,
  code: string,
  retryable: boolean,
  operation: () => Promise<Value>,
): Promise<Value> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CaptureExecutionError) {
      throw error;
    }
    throw new CaptureExecutionError(stage, code, retryable, error);
  }
}

function remediation(stage: ImportJobStage): string {
  const remedies: Partial<Record<ImportJobStage, string>> = {
    validate: "Confirm the adapter matches the detected application.",
    inventory: "Retry route discovery and inspect the adapter logs.",
    "prepare-fixtures":
      "Confirm the managed worktree and deterministic fixture recipe.",
    build:
      "Quit Xcode and Simulator, wait for the local build service to clear, then retry this scenario.",
    launch: "Confirm the approved launch recipe and loopback port.",
    capture: "Confirm route readiness and retry this scenario.",
    "extract-layers":
      "Retry hierarchy collection or keep the screenshot as pixel authority.",
  };
  return remedies[stage] ?? "Inspect the redacted logs and retry.";
}

function failureFromError(
  error: CaptureExecutionError,
  scenario: CaptureScenarioV2,
  log: BoundedRedactedLog,
  now: () => Date,
): CaptureFailureV1 {
  log.append(error.message);
  return CaptureFailureSchemaV1.parse({
    scenarioId: scenario.id,
    code: error.code,
    stage: error.stage,
    message: redactLogMessage(error.message),
    remediation: remediation(error.stage),
    logTail: log.snapshot(),
    retryable: error.retryable,
    occurredAt: now().toISOString(),
  });
}

function assertArtifactAuthority(
  artifact: CaptureArtifactV2,
  request: CaptureExecutionRequest,
): void {
  const expectedWidth =
    request.scenario.viewport.width * request.scenario.viewport.scale;
  const expectedHeight =
    request.scenario.viewport.height * request.scenario.viewport.scale;
  if (
    artifact.scenarioId !== request.scenario.id ||
    (request.job.repository.sourceRevision !== null &&
      artifact.sourceRevision !== request.job.repository.sourceRevision) ||
    artifact.dimensions.width !== expectedWidth ||
    artifact.dimensions.height !== expectedHeight ||
    artifact.dimensions.scale !== request.scenario.viewport.scale ||
    artifact.verification.stableFrameHash !== artifact.screenshotHash
  ) {
    throw new CaptureExecutionError(
      "verify",
      "EVIDENCE_AUTHORITY_MISMATCH",
      false,
      "Capture evidence does not match the requested scenario authority.",
    );
  }
}

export async function executeCaptureScenario(
  request: CaptureExecutionRequest,
): Promise<CaptureExecutionResult> {
  const now = request.now ?? (() => new Date());
  const log = new BoundedRedactedLog();
  const context = Object.freeze({
    job: request.job,
    signal: request.signal,
  });
  let launch: CaptureLaunchV1 | null = null;
  let result: CaptureExecutionResult;
  try {
    throwIfAborted(request.signal);
    const applications = await atStage(
      "inventory",
      "DISCOVERY_FAILED",
      false,
      () => request.adapter.discover(context),
    );
    if (
      request.adapter.metadata.platform !== request.application.platform ||
      !applications.some(
        (application) => application.id === request.application.id,
      )
    ) {
      throw new CaptureExecutionError(
        "validate",
        "ADAPTER_APPLICATION_MISMATCH",
        false,
        "Capture adapter does not own the requested application.",
      );
    }
    throwIfAborted(request.signal);
    const preparation = await atStage(
      "prepare-fixtures",
      "PREPARATION_FAILED",
      true,
      () =>
        request.adapter.prepare(
          context,
          request.application,
          [request.scenario],
        ),
    );
    throwIfAborted(request.signal);
    launch = await atStage("launch", "LAUNCH_FAILED", true, () =>
      request.adapter.launch(context, preparation),
    );
    throwIfAborted(request.signal);
    const rawCapture = await atStage(
      "capture",
      "CAPTURE_FAILED",
      true,
      () =>
        request.adapter.capture(
          context,
          launch as CaptureLaunchV1,
          request.scenario,
        ),
    );
    throwIfAborted(request.signal);
    const artifact = await atStage(
      "extract-layers",
      "COLLECTION_FAILED",
      true,
      () =>
        request.adapter.collect(
          context,
          launch as CaptureLaunchV1,
          rawCapture,
        ),
    );
    const parsedArtifact = CaptureArtifactSchemaV2.parse(artifact);
    assertArtifactAuthority(parsedArtifact, request);
    result = Object.freeze({
      kind: "captured",
      artifact: parsedArtifact,
    });
  } catch (error) {
    const stageError =
      error instanceof CaptureExecutionError
        ? error
        : new CaptureExecutionError(
            "capture",
            "CAPTURE_FAILED",
            true,
            error,
          );
    result = Object.freeze({
      kind: "failed",
      failure: failureFromError(
        stageError,
        request.scenario,
        log,
        now,
      ),
    });
  }

  try {
    await request.adapter.cleanup(context, launch);
  } catch (cleanupError) {
    if (result.kind === "captured") {
      result = Object.freeze({
        kind: "failed",
        failure: failureFromError(
          new CaptureExecutionError(
            "capture",
            "CLEANUP_FAILED",
            true,
            cleanupError,
          ),
          request.scenario,
          log,
          now,
        ),
      });
    }
  }
  return result;
}
