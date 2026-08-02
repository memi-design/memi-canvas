import type { ChangeEvent } from "react";

import {
  type AgentTask,
  type SelectedScreen,
  coverageLabel,
  evidenceLabel,
} from "./model";
import { TruthBadge } from "./TruthBadge";

// Organism: selection truth and the explicit agent work surface.
export function CollaborationInspector({
  selected,
  task,
  harness,
  onHarnessChange,
}: {
  readonly selected: SelectedScreen | undefined;
  readonly task: AgentTask;
  readonly harness: string;
  readonly onHarnessChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <aside
      aria-label="Inspector and collaboration"
      className="inspector-panel"
      data-workspace-region
      tabIndex={-1}
    >
      <section
        aria-label="Selected screen context"
        className="inspector-section"
      >
        <p className="eyebrow">Selected context</p>
        {selected ? (
          <>
            <h2>{selected.screen.name}</h2>
            <p className="route">{selected.screen.route}</p>
            <p>{selected.screen.state}</p>
            <p>
              {selected.capture.label} · {selected.capture.dimensions}
            </p>
            <dl className="truth-dimensions">
              <div>
                <dt>Frame authority</dt>
                <dd>{selected.capture.frameKind}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>{evidenceLabel(selected.capture.evidenceLevel)}</dd>
              </div>
              <div>
                <dt>Coverage health</dt>
                <dd>{coverageLabel(selected.capture.coverageHealth)}</dd>
              </div>
              {selected.capture.sourceRevision ? (
                <div>
                  <dt>Source revision</dt>
                  <dd>{selected.capture.sourceRevision}</dd>
                </div>
              ) : null}
              {selected.capture.sourceAnchor ? (
                <div>
                  <dt>Source anchor</dt>
                  <dd>{selected.capture.sourceAnchor}</dd>
                </div>
              ) : null}
              {selected.capture.runtimeEvidence ? (
                <div>
                  <dt>Runtime evidence</dt>
                  <dd>{selected.capture.runtimeEvidence}</dd>
                </div>
              ) : null}
              {selected.capture.evidenceLevel === "verified" ? (
                <div>
                  <dt>Validation</dt>
                  <dd>Validation passed</dd>
                </div>
              ) : null}
              {selected.capture.missingEvidence ? (
                <div>
                  <dt>Missing evidence</dt>
                  <dd>{selected.capture.missingEvidence}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <p>Select a screen capture to inspect its evidence.</p>
        )}
      </section>

      <article
        aria-label={`Agent task: ${task.title}`}
        className="agent-task"
      >
        <div className="agent-task__heading">
          <div>
            <p className="eyebrow">Demo agent task</p>
            <h2>{task.title}</h2>
          </div>
          <TruthBadge tone="warning">{task.status}</TruthBadge>
        </div>

        <dl className="task-facts">
          <div>
            <dt>Target</dt>
            <dd>
              {selected
                ? `${selected.screen.name} · ${selected.capture.label}`
                : "No target"}
            </dd>
          </div>
          <div>
            <dt>Permission</dt>
            <dd>Canvas write</dd>
          </div>
          <div>
            <dt>Latest action</dt>
            <dd>Proposal prepared for human review</dd>
          </div>
        </dl>
        <p className="permission-consequence">
          Reversible canvas proposal only. No source write, commit, push, or
          deploy.
        </p>

        <label className="field">
          <span>Harness</span>
          <select onChange={onHarnessChange} value={harness}>
            {task.harnesses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </article>
    </aside>
  );
}
