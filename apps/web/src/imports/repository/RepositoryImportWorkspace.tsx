export const REPOSITORY_IMPORT_STAGES = [
  { id: "validate", label: "Validate" },
  { id: "inventory", label: "Inventory" },
  { id: "plan", label: "Plan" },
  { id: "prepare-fixtures", label: "Prepare fixtures" },
  { id: "build", label: "Build" },
  { id: "launch", label: "Launch" },
  { id: "capture", label: "Capture" },
  { id: "extract-layers", label: "Extract layers" },
  { id: "verify", label: "Verify" },
  { id: "save", label: "Save" },
] as const;

export type RepositoryImportStage =
  (typeof REPOSITORY_IMPORT_STAGES)[number]["id"];

export type RepositoryImportJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "ready-to-commit"
  | "committed"
  | "failed"
  | "cancelled";

export interface RepositoryImportFailureView {
  readonly id: string;
  readonly route: string;
  readonly state?: string;
  readonly sourcePath?: string;
  readonly code: string;
  readonly message: string;
  readonly remediation: string;
  readonly retryable: boolean;
}

export interface RepositoryImportJobView {
  readonly id: string;
  readonly state: RepositoryImportJobStatus;
  readonly stage: RepositoryImportStage;
  readonly progress?: {
    readonly total: number;
    readonly captured: number;
    readonly failed: number;
    readonly remaining: number;
  };
  readonly currentApplication?: string;
  readonly currentScenario?: string;
  readonly activity?: string;
  readonly elapsedMs: number;
  readonly failures: readonly RepositoryImportFailureView[];
}

function boundedProgress(
  progress: RepositoryImportJobView["progress"],
): number | undefined {
  if (progress === undefined || progress.total <= 0) return undefined;
  const completed = progress.captured + progress.failed;
  return Math.round(
    Math.min(1, Math.max(0, completed / progress.total)) * 100,
  );
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function stageState(
  stageIndex: number,
  currentIndex: number,
): "complete" | "current" | "pending" {
  if (stageIndex < currentIndex) return "complete";
  if (stageIndex === currentIndex) return "current";
  return "pending";
}

function summarizeFailureMessage(message: string): string {
  const headline = message
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (headline === undefined) return "Import failed before a readable diagnostic was produced.";
  return headline;
}

function FailureList({
  failures,
}: {
  readonly failures: readonly RepositoryImportFailureView[];
}) {
  if (failures.length === 0) return null;
  const visibleFailures = failures.slice(0, 3);
  const hiddenFailureCount = failures.length - visibleFailures.length;
  return (
    <section
      aria-labelledby="repository-import-failures-title"
      className="repository-import-failures"
    >
      <div className="repository-import-section-heading">
        <h3 id="repository-import-failures-title">Needs attention</h3>
        <span>{failures.length}</span>
      </div>
      <ul>
        {visibleFailures.map((failure) => {
          const scenario = failure.state
            ? `${failure.route} · ${failure.state}`
            : failure.route;
          return (
            <li key={failure.id}>
              <div className="repository-import-failure__heading">
                <h4>{scenario}</h4>
                <code>{failure.code}</code>
              </div>
              {failure.sourcePath === undefined ? null : (
                <code className="repository-import-failure__source">
                  {failure.sourcePath}
                </code>
              )}
              <p title={failure.message}>
                {summarizeFailureMessage(failure.message)}
              </p>
              <p className="repository-import-failure__remediation">
                {failure.remediation}
              </p>
              <span>
                {failure.retryable ? "Retry available" : "Manual fix required"}
              </span>
            </li>
          );
        })}
      </ul>
      {hiddenFailureCount > 0 ? (
        <p className="repository-import-failures__overflow">
          {hiddenFailureCount} more failure{hiddenFailureCount === 1 ? "" : "s"} in logs
        </p>
      ) : null}
    </section>
  );
}

/**
 * Atomic Design: organism.
 * Presents a durable repository import without owning runtime state.
 */
export function RepositoryImportWorkspace({
  job,
  onCancel,
  onResume,
  onRetryFailed,
  onRevealLogs,
}: {
  readonly job: RepositoryImportJobView;
  readonly onCancel?: (() => void) | undefined;
  readonly onResume?: (() => void) | undefined;
  readonly onRetryFailed?: (() => void) | undefined;
  readonly onRevealLogs?: (() => void) | undefined;
}) {
  const currentStageIndex = REPOSITORY_IMPORT_STAGES.findIndex(
    ({ id }) => id === job.stage,
  );
  const percent = boundedProgress(job.progress);
  const hasRetryableFailure = job.failures.some(
    (failure) => failure.retryable,
  );
  const captured = job.progress?.captured ?? 0;
  const failed = job.progress?.failed ?? 0;
  const remaining = job.progress?.remaining ?? 0;

  return (
    <div className="repository-import-workspace">
      <ol aria-label="Import stages" className="repository-import-stages">
        {REPOSITORY_IMPORT_STAGES.map((stage, index) => {
          const state = stageState(index, currentStageIndex);
          const stateLabel =
            state === "current"
              ? "current stage"
              : state === "complete"
                ? "complete"
                : "pending";
          return (
            <li
              aria-current={state === "current" ? "step" : undefined}
              aria-label={`${stage.label}, ${stateLabel}`}
              data-state={state}
              key={stage.id}
            >
              <span aria-hidden="true" />
              {stage.label}
            </li>
          );
        })}
      </ol>

      <section
        aria-label="Import progress"
        className="repository-import-progress"
      >
        <div className="repository-import-progress__heading">
          <div>
            <span>
              {REPOSITORY_IMPORT_STAGES[currentStageIndex]?.label ??
                "Preparing"}
            </span>
            <strong>
              {percent === undefined
                ? "Discovering scenarios…"
                : `${percent}%`}
            </strong>
          </div>
          <time>{formatElapsed(job.elapsedMs)}</time>
        </div>
        <div
          aria-label="Repository import progress"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percent}
          aria-valuetext={percent === undefined ? "Working" : `${percent}%`}
          className="repository-import-progress__track"
          role="progressbar"
        >
          <span
            className={
              percent === undefined
                ? "repository-import-progress__indeterminate"
                : "repository-import-progress__value"
            }
            style={
              percent === undefined
                ? undefined
                : { inlineSize: `${percent}%` }
            }
          />
        </div>
        <div className="repository-import-counts">
          <span aria-label={`${captured} captured`}>
            <strong>{captured}</strong> captured
          </span>
          <span
            aria-label={`${failed} failed`}
            data-tone={failed > 0 ? "danger" : undefined}
          >
            <strong>{failed}</strong> failed
          </span>
          <span aria-label={`${remaining} remaining`}>
            <strong>{remaining}</strong> remaining
          </span>
        </div>
      </section>

      <section
        aria-label="Current import activity"
        className="repository-import-current"
      >
        <div>
          <span>Current application</span>
          <strong>{job.currentApplication ?? "Preparing application"}</strong>
        </div>
        {job.currentScenario === undefined ? null : (
          <div>
            <span>Scenario</span>
            <strong>{job.currentScenario}</strong>
          </div>
        )}
        <p aria-atomic="true" aria-live="polite" role="status">
          <span aria-hidden="true" />
          {job.activity ?? "Waiting for the next durable checkpoint"}
        </p>
      </section>

      <FailureList failures={job.failures} />

      <footer className="repository-import-actions">
        <button
          disabled={onRevealLogs === undefined}
          onClick={onRevealLogs}
          type="button"
        >
          Reveal logs
        </button>
        <div>
          {job.state === "paused" || job.state === "failed" ? (
            <button
              disabled={onResume === undefined}
              onClick={onResume}
              type="button"
            >
              Resume import
            </button>
          ) : null}
          {job.failures.length > 0 ? (
            <button
              disabled={
                !hasRetryableFailure || onRetryFailed === undefined
              }
              onClick={onRetryFailed}
              type="button"
            >
              Retry failed
            </button>
          ) : null}
          {job.state === "running" || job.state === "queued" ? (
            <button
              className="repository-import-actions__cancel"
              disabled={onCancel === undefined}
              onClick={onCancel}
              type="button"
            >
              Cancel import
            </button>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
