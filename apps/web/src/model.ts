export type CoverageHealth =
  | "current"
  | "partial"
  | "blocked"
  | "stale"
  | "not-captured";

export type FrameKind =
  | "CodeFrame"
  | "DraftFrame"
  | "SnapshotFrame"
  | "ReferenceFrame";

export type EvidenceLevel =
  | "verified"
  | "observed"
  | "inferred"
  | "reference"
  | "proposed";

interface MatrixCellBase {
  readonly id: string;
  readonly viewport: string;
  readonly label: string;
  readonly dimensions: string;
}

export interface VerifiedCapture extends MatrixCellBase {
  readonly coverageHealth: Exclude<CoverageHealth, "blocked">;
  readonly frameKind: FrameKind;
  readonly evidenceLevel: "verified";
  readonly sourceRevision: string;
  readonly sourceAnchor: string;
  readonly runtimeEvidence: string;
  readonly validationResult: "passed";
  readonly missingEvidence?: string;
}

export interface NonVerifiedCapture extends MatrixCellBase {
  readonly coverageHealth: Exclude<CoverageHealth, "blocked">;
  readonly frameKind: FrameKind;
  readonly evidenceLevel: Exclude<EvidenceLevel, "verified">;
  readonly sourceRevision?: string;
  readonly sourceAnchor?: string;
  readonly runtimeEvidence?: string;
  readonly missingEvidence?: string;
}

export type AvailableCapture = VerifiedCapture | NonVerifiedCapture;

export interface BlockedCell extends MatrixCellBase {
  readonly coverageHealth: "blocked";
  readonly blocker?: string;
  readonly attemptedEvidence?: string;
}

export type Capture = AvailableCapture | BlockedCell;

export interface ProductScreen {
  readonly id: string;
  readonly name: string;
  readonly route: string;
  readonly state: string;
  readonly captures: readonly Capture[];
}

export interface ProjectCoverage {
  readonly requiredCaptureIds: readonly string[];
}

export interface HarnessOption {
  readonly id: string;
  readonly label: string;
}

export interface AgentTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly harness: string;
  readonly harnesses: readonly HarnessOption[];
}

export type TraceEventType =
  | "context"
  | "routing"
  | "task"
  | "plan"
  | "proposal"
  | "approval";

export type TraceEventStatus = "complete" | "active" | "waiting";
export type TraceActorKind = "human" | "agent" | "system";

export interface TraceEvent {
  readonly id: string;
  readonly type: TraceEventType;
  readonly status: TraceEventStatus;
  readonly actorKind: TraceActorKind;
  readonly actor: string;
  readonly action: string;
  readonly timestamp: string;
  readonly harness?: string;
  readonly targetCaptureId?: string;
  readonly targetLabel?: string;
}

export interface ImportedProject {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly coverage: ProjectCoverage;
  readonly screens: readonly ProductScreen[];
  readonly selectedCaptureId: string;
  readonly task: AgentTask;
  readonly trace: readonly TraceEvent[];
}

export interface AppProps {
  readonly project: ImportedProject;
  readonly onHarnessChange?: (harnessId: string) => void;
}

export interface SelectedScreen {
  readonly screen: ProductScreen;
  readonly capture: AvailableCapture;
}

export function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function evidenceLabel(evidenceLevel: EvidenceLevel): string {
  return `${titleCase(evidenceLevel)} evidence`;
}

export function coverageLabel(coverageHealth: CoverageHealth): string {
  return `${titleCase(coverageHealth)} coverage`;
}

export function isBlockedCell(capture: Capture): capture is BlockedCell {
  return capture.coverageHealth === "blocked";
}

export function isVerifiedCapture(
  capture: Capture,
): capture is VerifiedCapture {
  return (
    !isBlockedCell(capture) &&
    capture.evidenceLevel === "verified" &&
    capture.coverageHealth === "current" &&
    capture.validationResult === "passed" &&
    capture.sourceRevision.length > 0 &&
    capture.sourceAnchor.length > 0 &&
    capture.runtimeEvidence.length > 0
  );
}

export function findSelectedScreen(
  screens: readonly ProductScreen[],
  selectedCaptureId: string,
): SelectedScreen | undefined {
  for (const screenItem of screens) {
    const capture = screenItem.captures.find(
      (candidate) => candidate.id === selectedCaptureId,
    );

    if (capture && !isBlockedCell(capture)) {
      return { screen: screenItem, capture };
    }
  }

  return undefined;
}

function firstAvailableCaptureId(
  screens: readonly ProductScreen[],
): string | undefined {
  for (const screenItem of screens) {
    const capture = screenItem.captures.find(
      (candidate) => !isBlockedCell(candidate),
    );
    if (capture) {
      return capture.id;
    }
  }

  return undefined;
}

export function initialCaptureId(project: ImportedProject): string {
  if (findSelectedScreen(project.screens, project.selectedCaptureId)) {
    return project.selectedCaptureId;
  }

  return firstAvailableCaptureId(project.screens) ?? project.selectedCaptureId;
}

export function harnessLabel(task: AgentTask, harnessId: string): string {
  return (
    task.harnesses.find((candidate) => candidate.id === harnessId)?.label ??
    harnessId
  );
}

export function captureAccessibleName(
  screenItem: ProductScreen,
  capture: Capture,
): string {
  if (isBlockedCell(capture)) {
    const blocker = capture.blocker ?? "Capture evidence is unavailable";
    return `${screenItem.name} ${screenItem.state} ${capture.label}, Blocked coverage: ${blocker}. Resolve capture`;
  }

  return `${screenItem.name} ${screenItem.state} ${capture.label}, ${capture.frameKind}, ${evidenceLabel(capture.evidenceLevel)}, ${coverageLabel(capture.coverageHealth)}`;
}
