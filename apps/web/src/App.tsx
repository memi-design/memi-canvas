import { type ChangeEvent, useMemo, useState } from "react";

import {
  type AppProps,
  type BlockedCell,
  type TraceEvent,
  findSelectedScreen,
  harnessLabel,
  initialCaptureId,
} from "./model";
import { WorkspaceTemplate } from "./WorkspaceTemplate";

export type {
  AgentTask,
  AppProps,
  AvailableCapture,
  BlockedCell,
  Capture,
  CoverageHealth,
  EvidenceLevel,
  FrameKind,
  HarnessOption,
  ImportedProject,
  NonVerifiedCapture,
  ProjectCoverage,
  ProductScreen,
  TraceActorKind,
  TraceEvent,
  TraceEventStatus,
  TraceEventType,
  VerifiedCapture,
} from "./model";

// Page: the stateful M0 vertical slice. The outer App keys this workspace by
// project identity so local state never leaks between projects.
function ProjectWorkspace({ project, onHarnessChange }: AppProps) {
  const [selectedCaptureId, setSelectedCaptureId] = useState(() =>
    initialCaptureId(project),
  );
  const [harness, setHarness] = useState(project.task.harness);
  const [traceEvents, setTraceEvents] = useState<readonly TraceEvent[]>(
    project.trace,
  );
  const [resolutionMessage, setResolutionMessage] = useState<
    string | undefined
  >();
  const selected = useMemo(
    () => findSelectedScreen(project.screens, selectedCaptureId),
    [project.screens, selectedCaptureId],
  );

  function handleHarnessChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextHarness = event.target.value;
    const previousLabel = harnessLabel(project.task, harness);
    const nextLabel = harnessLabel(project.task, nextHarness);
    setHarness(nextHarness);
    setTraceEvents((currentEvents) => [
      ...currentEvents,
      {
        id: `${project.task.id}-routing-${currentEvents.length}`,
        type: "routing",
        status: "complete",
        actorKind: "human",
        actor: "Human",
        action: `Switched harness from ${previousLabel} to ${nextLabel}`,
        timestamp: "Now",
        harness: nextLabel,
        ...(selected
          ? {
              targetCaptureId: selected.capture.id,
              targetLabel: `${selected.screen.name} · ${selected.capture.label}`,
            }
          : {}),
      },
    ]);
    onHarnessChange?.(nextHarness);
  }

  function handleResolve(capture: BlockedCell) {
    const blocker = capture.blocker ?? "Capture evidence is unavailable";
    setResolutionMessage(
      `Resolve capture: ${blocker}. Review source setup or provide the missing fixture.`,
    );
  }

  return (
    <WorkspaceTemplate
      harness={harness}
      onHarnessChange={handleHarnessChange}
      onResolve={handleResolve}
      onSelect={setSelectedCaptureId}
      project={project}
      resolutionMessage={resolutionMessage}
      selected={selected}
      selectedCaptureId={selectedCaptureId}
      traceEvents={traceEvents}
    />
  );
}

export function App(props: AppProps) {
  return <ProjectWorkspace key={props.project.id} {...props} />;
}
