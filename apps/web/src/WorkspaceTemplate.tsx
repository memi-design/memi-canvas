import type { ChangeEvent, KeyboardEvent } from "react";

import { CollaborationInspector } from "./CollaborationInspector";
import { coverageSummary } from "./coverage";
import {
  type BlockedCell,
  type ImportedProject,
  type SelectedScreen,
  type TraceEvent,
} from "./model";
import { ScreenMatrix } from "./ScreenMatrix";
import { TraceDeck } from "./TraceDeck";
import { TruthBadge } from "./TruthBadge";

function handleRegionCycle(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "F6") {
    return;
  }

  const regions = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-workspace-region]",
    ),
  );
  if (regions.length === 0) {
    return;
  }

  event.preventDefault();
  const activeRegion = document.activeElement?.closest<HTMLElement>(
    "[data-workspace-region]",
  );
  const currentIndex = activeRegion ? regions.indexOf(activeRegion) : -1;
  const offset = event.shiftKey ? -1 : 1;
  const startIndex = currentIndex < 0 ? (event.shiftKey ? 0 : -1) : currentIndex;
  const nextIndex =
    (startIndex + offset + regions.length) % regions.length;
  regions[nextIndex]?.focus();
}

// Template: the M0 workspace shell composed from screen, inspector, task, and
// trace organisms.
export function WorkspaceTemplate({
  project,
  resolutionMessage,
  selectedCaptureId,
  selected,
  harness,
  traceEvents,
  onHarnessChange,
  onResolve,
  onSelect,
}: {
  readonly project: ImportedProject;
  readonly resolutionMessage: string | undefined;
  readonly selectedCaptureId: string;
  readonly selected: SelectedScreen | undefined;
  readonly harness: string;
  readonly traceEvents: readonly TraceEvent[];
  readonly onHarnessChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly onResolve: (capture: BlockedCell) => void;
  readonly onSelect: (captureId: string) => void;
}) {
  const summary = coverageSummary(project);

  return (
    <div className="app-shell" onKeyDown={handleRegionCycle}>
      <header
        className="project-header"
        data-workspace-region
        tabIndex={-1}
      >
        <div>
          <div className="project-header__meta">
            <TruthBadge tone="neutral">Demo</TruthBadge>
            <span>{project.status}</span>
          </div>
          <h1>{project.title}</h1>
          <p>
            Demo · Fixture-backed; no live model or repository write occurred.
          </p>
        </div>
        <div
          aria-label="Import coverage"
          className="coverage-summary"
          role="status"
        >
          <strong>
            {summary.verified} of {summary.required} required states verified
          </strong>
          <span>{summary.partial} partial</span>
          <span>{summary.blocked} blocked</span>
          <TruthBadge tone={summary.complete ? "positive" : "warning"}>
            {summary.complete ? "Complete" : "Incomplete"}
          </TruthBadge>
        </div>
      </header>

      <nav
        aria-label="Project navigation"
        className="project-nav"
        data-workspace-region
        tabIndex={-1}
      >
        <button aria-current="page" type="button">
          Screens
        </button>
        <button type="button">Flows</button>
        <button type="button">Components</button>
        <button type="button">Design system</button>
        <button type="button">Tasks</button>
        <button type="button">Evidence</button>
      </nav>

      <div className="workspace-grid">
        <main
          aria-label="Canvas workspace"
          data-workspace-region
          tabIndex={-1}
        >
          <ScreenMatrix
            onResolve={onResolve}
            onSelect={onSelect}
            resolutionMessage={resolutionMessage}
            screens={project.screens}
            selectedCaptureId={selectedCaptureId}
          />
        </main>
        <CollaborationInspector
          harness={harness}
          onHarnessChange={onHarnessChange}
          selected={selected}
          task={project.task}
        />
      </div>

      <TraceDeck events={traceEvents} onLocate={onSelect} />
    </div>
  );
}
