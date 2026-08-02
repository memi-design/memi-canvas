import { useState, type KeyboardEvent } from "react";

import {
  CANVAS_MODELS,
  type PromptMode,
} from "./harness-config.js";
import { EditorIcon } from "./icons.js";
import type { HistoryEntry, WorkbenchNode } from "./model.js";
import type { PermissionPolicy } from "./harness-config.js";
import "./agent-composer.css";

export interface CollaborationTraceItem {
  readonly id: string;
  readonly action: string;
  readonly targetNodeId: string;
  readonly harnessId?: string;
}

export function nextTraceSequence(
  trace: readonly CollaborationTraceItem[],
): number {
  const ordinals = trace.flatMap((item) => {
    const match = /^workbench-trace-(\d+)$/u.exec(item.id);
    const ordinal = Number(match?.[1]);
    return Number.isSafeInteger(ordinal) && ordinal > 0 ? [ordinal] : [];
  });
  return Math.max(trace.length, ...ordinals, 0) + 1;
}

interface PromptDockProps {
  readonly documentRevision: number;
  readonly harnessId: string;
  readonly harnessOptions: ReadonlyArray<{
    readonly disabled?: boolean;
    readonly id: string;
    readonly label: string;
  }>;
  readonly modelId: string;
  readonly modelOptions?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly onHarnessChange: (harnessId: string) => void;
  readonly onModelChange: (modelId: string) => void;
  readonly onPromptChange: (prompt: string) => void;
  readonly onPromptModeChange: (mode: PromptMode) => void;
  readonly onSettingsToggle: () => void;
  readonly onSubmit: () => void;
  readonly prompt: string;
  readonly promptMode: PromptMode;
  readonly permissionPolicy: PermissionPolicy;
  readonly runtimeConnected: boolean;
  readonly selectedNode: WorkbenchNode | undefined;
  readonly settingsOpen: boolean;
}

function submitOnReturn(
  event: KeyboardEvent<HTMLTextAreaElement>,
  canSubmit: boolean,
  onSubmit: () => void,
) {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing
  ) {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }
}

const PROMPT_MODE_HELP: Readonly<Record<PromptMode, string>> = {
  plan: "Plan inspects the selected context and prepares steps without changing it.",
  propose: "Propose requests an editable patch that remains reviewable.",
  apply: "Apply requests approval-gated changes through editor commands.",
};

// Atomic Design: organism — Xcode-style collaboration composer.
export function PromptDock({
  documentRevision,
  harnessId,
  harnessOptions,
  modelId,
  modelOptions = CANVAS_MODELS,
  onHarnessChange,
  onModelChange,
  onPromptChange,
  onPromptModeChange,
  onSettingsToggle,
  onSubmit,
  prompt,
  promptMode,
  permissionPolicy,
  runtimeConnected,
  selectedNode,
  settingsOpen,
}: PromptDockProps) {
  const [composerExpanded, setComposerExpanded] = useState(settingsOpen);
  const expanded = composerExpanded;
  const canSubmit =
    selectedNode !== undefined && prompt.trim().length > 0;
  const selectedHarnessLabel =
    harnessOptions.find((option) => option.id === harnessId)?.label ??
    harnessId;
  const selectedModelLabel =
    modelOptions.find((option) => option.id === modelId)?.label ?? modelId;
  const runtimeStatus = runtimeConnected
    ? "Connected runtime · execution remains approval-gated"
    : "No runtime adapter · prompts are prepared locally";

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    setComposerExpanded(false);
    onSubmit();
  };

  const cancelDraft = () => {
    onPromptChange("");
    setComposerExpanded(false);
  };

  return (
    <section
      aria-label="Agent prompt"
      className="canvas-prompt-dock"
      data-expanded={expanded}
      data-state={canSubmit ? "ready" : "blocked"}
    >
      <div className="canvas-context-row">
        {selectedNode ? (
          <div className="canvas-context-chip">
            <EditorIcon name="context" size={13} />
            <span>{selectedNode.name}</span>
          </div>
        ) : (
          <div
            className="canvas-context-chip canvas-context-chip--empty"
            title="Select a layer or canvas object to give the agent a precise target"
          >
            <EditorIcon name="context" size={13} />
            <span>No selection</span>
          </div>
        )}
        {selectedNode ? (
          <>
            <span className="canvas-context-chip">
              Revision {documentRevision}
            </span>
            <span className="canvas-context-chip">
              {permissionPolicy}
            </span>
            {selectedNode.component?.source?.sourceAnchor ??
            selectedNode.source?.sourceAnchor ? (
              <span
                className="canvas-context-chip"
                title={
                  selectedNode.component?.source?.sourceAnchor ??
                  selectedNode.source?.sourceAnchor
                }
              >
                {(
                  selectedNode.component?.source?.sourceAnchor ??
                  selectedNode.source?.sourceAnchor ??
                  ""
                )
                  .split("/")
                  .at(-1)}
              </span>
            ) : null}
            <details className="canvas-context-preview">
              <summary>Review context</summary>
              <dl>
                <div>
                  <dt>Node</dt>
                  <dd>{selectedNode.id}</dd>
                </div>
                <div>
                  <dt>Kind</dt>
                  <dd>{selectedNode.kind}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {selectedNode.component?.source?.sourceAnchor ??
                      selectedNode.source?.sourceAnchor ??
                      "Canvas-only"}
                  </dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>
                    {runtimeConnected
                      ? "Connected runtime"
                      : "Disconnected"}
                  </dd>
                </div>
              </dl>
            </details>
          </>
        ) : null}
        <button
          aria-label={expanded ? "Collapse prompt" : "Expand prompt"}
          className="canvas-prompt-expand"
          data-tooltip={expanded ? "Collapse composer" : "Expand composer"}
          onClick={() => setComposerExpanded(!expanded)}
          title={expanded ? "Collapse composer" : "Expand composer"}
          type="button"
        >
          <EditorIcon
            name={expanded ? "chevron-down" : "chevron-right"}
            size={14}
          />
        </button>
      </div>
      <div
        aria-label="Agent configuration"
        className="canvas-prompt-controls"
        role="toolbar"
      >
        <span
          className="canvas-adapter-badge"
          data-connected={runtimeConnected}
          title={
            runtimeConnected
              ? "A runtime is connected; execution remains approval-gated"
              : "Harness adapter disconnected; prompts are prepared locally"
          }
        >
          {runtimeConnected ? "Runtime ready" : "Disconnected"}
        </span>
        <div className="canvas-prompt-controls__configuration">
          <label
            className="canvas-prompt-field"
            data-help={PROMPT_MODE_HELP[promptMode]}
          >
            <span>Mode</span>
            <select
              aria-label="Prompt mode"
              onChange={(event) =>
                onPromptModeChange(event.currentTarget.value as PromptMode)
              }
              title={`${PROMPT_MODE_HELP[promptMode]} Current mode: ${promptMode}.`}
              value={promptMode}
            >
              <option value="plan">Plan</option>
              <option value="propose">Propose</option>
              <option value="apply">Apply</option>
            </select>
          </label>
          <label
            className="canvas-prompt-field"
            data-help={`Execution harness: ${selectedHarnessLabel}. Availability is determined by the connected runtime.`}
          >
            <span>Harness</span>
            <select
              aria-label="Agent harness"
              onChange={(event) =>
                onHarnessChange(event.currentTarget.value)
              }
              title={`Execution harness: ${selectedHarnessLabel}. Availability is determined by the connected runtime.`}
              value={harnessId}
            >
              {harnessOptions.map((option) => (
                <option
                  disabled={option.disabled}
                  key={option.id}
                  value={option.id}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label
            className="canvas-prompt-field"
            data-help={`Model preference: ${selectedModelLabel}. Execution depends on the connected harness.`}
          >
            <span>Model</span>
            <select
              aria-label="Model"
              onChange={(event) =>
                onModelChange(event.currentTarget.value)
              }
              title={`Model preference: ${selectedModelLabel}. Execution depends on the connected harness.`}
              value={modelId}
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <button
            aria-label="Prompt settings"
            aria-pressed={settingsOpen}
            data-tooltip="Model, reasoning, permissions, and browser settings"
            onClick={() => {
              setComposerExpanded(true);
              onSettingsToggle();
            }}
            title="Model, reasoning, permissions, and browser settings"
            type="button"
          >
            <EditorIcon name="settings" />
          </button>
        </div>
      </div>
      <textarea
        aria-label="Prompt"
        onChange={(event) => onPromptChange(event.currentTarget.value)}
        onFocus={() => setComposerExpanded(true)}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            setComposerExpanded(false);
            return;
          }
          submitOnReturn(event, canSubmit, submit);
        }}
        placeholder="Ask Memi about this selection…"
        rows={expanded ? 4 : 1}
        value={prompt}
      />
      <div className="canvas-prompt-actions">
        {prompt.length > 0 ? (
          <button
            aria-label="Cancel prompt"
            className="canvas-prompt-cancel"
            data-tooltip="Clear draft · Escape"
            onClick={cancelDraft}
            title="Clear draft · Escape"
            type="button"
          >
            Cancel
          </button>
        ) : null}
        <button
          aria-label="Submit prompt"
          className="canvas-prompt-submit"
          data-tooltip={
            selectedNode === undefined
              ? "Select a canvas object first"
              : prompt.trim().length === 0
                ? "Write a prompt first"
                : "Submit · Return or Command-Return"
          }
          disabled={!canSubmit}
          onClick={submit}
          title={
            selectedNode === undefined
              ? "Select a canvas object first"
              : prompt.trim().length === 0
                ? "Write a prompt first"
                : "Submit · Return or Command-Return"
          }
          type="button"
        >
          <EditorIcon name="send" />
        </button>
      </div>
      <div className="canvas-prompt-foot">
        <output aria-live="polite" className="canvas-prompt-status" role="status">
          {runtimeStatus}
        </output>
        {expanded ? (
          <span className="canvas-prompt-shortcuts">
            Return submit · Shift-Return new line
          </span>
        ) : null}
      </div>
    </section>
  );
}

interface ActivityDrawerProps {
  readonly history: readonly HistoryEntry[];
  readonly onClose: () => void;
  readonly trace: readonly CollaborationTraceItem[];
}

// Atomic Design: organism — on-demand trace and semantic history.
export function ActivityDrawer({
  history,
  onClose,
  trace,
}: ActivityDrawerProps) {
  return (
    <aside aria-label="Agent activity drawer" className="canvas-activity-drawer">
      <header>
        <strong>Activity</strong>
        <button aria-label="Close activity" onClick={onClose} type="button">
          ×
        </button>
      </header>
      <ol aria-label="Trace" role="log">
        {trace.map((item) => (
          <li key={item.id}>
            <span>{item.action}</span>
            <small>{item.targetNodeId}</small>
          </li>
        ))}
      </ol>
      <h3>History</h3>
      <ol aria-label="Semantic history">
        {history.map((entry) => (
          <li key={entry.id}>{entry.label}</li>
        ))}
      </ol>
    </aside>
  );
}
