import { type ChangeEvent, useMemo, useState } from "react";

import {
  type AdapterRuntimeConnection,
  type GlobalAgentSettings,
  type GlobalHarnessId,
  type GlobalModelId,
  type GlobalPermissionPolicy,
  type GlobalReasoningEffort,
  GLOBAL_HARNESS_CATALOG,
  globalHarnessDefinition,
  settingsForHarness,
} from "./global-settings.js";
import "./global-settings.css";

export interface GlobalSettingsPanelProps {
  readonly initialSettings: GlobalAgentSettings;
  readonly onClose: () => void;
  readonly onSave: (settings: GlobalAgentSettings) => boolean;
  readonly runtimeConnections?: readonly AdapterRuntimeConnection[];
  readonly storageAvailable: boolean;
}

const reasoningOptions: readonly {
  readonly id: GlobalReasoningEffort;
  readonly label: string;
}[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra high" },
];

const permissionOptions: readonly {
  readonly description: string;
  readonly id: GlobalPermissionPolicy;
  readonly label: string;
}[] = [
  {
    id: "inspect-only",
    label: "Inspect only",
    description: "Read project context without proposing file changes.",
  },
  {
    id: "approval",
    label: "Ask before changes",
    description: "Require human approval before any durable change.",
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Allow changes within the selected project scope.",
  },
];

function RuntimeTruth({
  connection,
  harnessLabel,
}: {
  readonly connection: AdapterRuntimeConnection | undefined;
  readonly harnessLabel: string;
}) {
  const connected = connection?.state === "connected";
  return (
    <section
      aria-label="Agent runtime status"
      className="global-settings-runtime"
    >
      <header>
        <span>Runtime truth</span>
        <strong>{harnessLabel}</strong>
      </header>
      <div className="global-settings-runtime__badges">
        <span className="global-settings-badge global-settings-badge--declared">
          Declared compatible
        </span>
        <span
          className={`global-settings-badge ${
            connected
              ? "global-settings-badge--connected"
              : "global-settings-badge--offline"
          }`}
        >
          {connected ? "Connected runtime" : "Not connected"}
        </span>
      </div>
      <p>
        {connected
          ? `${connection.runtimeLabel ?? harnessLabel} reported a connection. Execution still happens through a separately started run.`
          : "Execution is unavailable until a runtime adapter reports a live connection."}
      </p>
    </section>
  );
}

function PermissionOptions({
  onChange,
  value,
}: {
  readonly onChange: (permission: GlobalPermissionPolicy) => void;
  readonly value: GlobalPermissionPolicy;
}) {
  return (
    <fieldset className="global-settings-permissions">
      <legend>Permission</legend>
      <p>Choose the durable-change boundary for future agent runs.</p>
      <div>
        {permissionOptions.map((option) => (
          <label key={option.id}>
            <input
              checked={value === option.id}
              name="permission"
              onChange={() => onChange(option.id)}
              type="radio"
              value={option.id}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Atomic Design: page — global human/agent policy editor with explicit truth.
export function GlobalSettingsPanel({
  initialSettings,
  onClose,
  onSave,
  runtimeConnections = [],
  storageAvailable,
}: GlobalSettingsPanelProps) {
  const [draft, setDraft] = useState(initialSettings);
  const [saveFailed, setSaveFailed] = useState(false);
  const harness = globalHarnessDefinition(draft.harnessId);
  const model = harness.models.find(({ id }) => id === draft.modelId);
  const runtimeConnection = useMemo(
    () =>
      runtimeConnections.find(
        ({ harnessId }) => harnessId === draft.harnessId,
      ),
    [draft.harnessId, runtimeConnections],
  );

  function changeHarness(event: ChangeEvent<HTMLSelectElement>) {
    setDraft((current) =>
      settingsForHarness(
        current,
        event.target.value as GlobalHarnessId,
      ),
    );
  }

  function changeModel(event: ChangeEvent<HTMLSelectElement>) {
    setDraft((current) => ({
      ...current,
      modelId: event.target.value as GlobalModelId,
    }));
  }

  return (
    <main className="global-settings">
      <header className="global-settings-header">
        <button
          aria-label="Back to project Home"
          onClick={onClose}
          type="button"
        >
          ←
        </button>
        <div>
          <span>Workspace settings</span>
          <h1>Agent and browser</h1>
          <p>Defaults for new tasks. These settings do not start an agent.</p>
        </div>
      </header>

      {!storageAvailable || saveFailed ? (
        <div className="global-settings-alert" role="alert">
          <strong>
            {saveFailed
              ? "Settings were not saved."
              : "Settings cannot be persisted."}
          </strong>
          <span>
            {saveFailed
              ? "Local storage rejected the update. Review the settings or storage availability and try again."
              : "Changes apply to this session only because local storage is unavailable."}
          </span>
        </div>
      ) : null}

      <div className="global-settings-layout">
        <section className="global-settings-card">
          <header>
            <span>Agent defaults</span>
            <strong>Plan first · approval required</strong>
          </header>

          <div className="global-settings-field-grid">
            <label>
              <span>Harness</span>
              <select
                aria-label="Harness"
                onChange={changeHarness}
                value={draft.harnessId}
              >
                {GLOBAL_HARNESS_CATALOG.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>{harness.note}</small>
            </label>

            <label>
              <span>Model</span>
              <select
                aria-label="Model"
                onChange={changeModel}
                value={draft.modelId}
              >
                {harness.models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>{model?.note}</small>
            </label>

            <label>
              <span>Reasoning</span>
              <select
                aria-label="Reasoning"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    reasoningEffort: event.target
                      .value as GlobalReasoningEffort,
                  }))
                }
                value={draft.reasoningEffort}
              >
                {reasoningOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>Affects effort only after a compatible run starts.</small>
            </label>
          </div>

          <RuntimeTruth
            connection={runtimeConnection}
            harnessLabel={harness.label}
          />

          <PermissionOptions
            onChange={(permissionPolicy) =>
              setDraft((current) => ({
                ...current,
                permissionPolicy,
              }))
            }
            value={draft.permissionPolicy}
          />
        </section>

        <aside className="global-settings-aside">
          <section aria-label="Browser policy">
            <header>
              <span>Browser</span>
              <strong>Helium</strong>
            </header>
            <div className="global-settings-browser-mark">H</div>
            <p>
              Preview navigation accepts localhost or 127.0.0.1 on an explicit
              local HTTP port.
            </p>
            <ul>
              <li>Remote URLs are blocked</li>
              <li>Credentials in URLs are blocked</li>
              <li>The editor origin cannot embed itself</li>
            </ul>
          </section>

          <section>
            <header>
              <span>Safety</span>
              <strong>Current defaults</strong>
            </header>
            <dl>
              <div>
                <dt>Planning</dt>
                <dd>Always first</dd>
              </div>
              <div>
                <dt>Computer actions</dt>
                <dd>Human approval</dd>
              </div>
              <div>
                <dt>Durable changes</dt>
                <dd>
                  {permissionOptions.find(
                    ({ id }) => id === draft.permissionPolicy,
                  )?.label}
                </dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>

      <footer className="global-settings-footer">
        <button onClick={onClose} type="button">
          Cancel
        </button>
        <button
          className="global-settings-save"
          onClick={() => {
            const saved = onSave(draft);
            if (saved) {
              onClose();
            } else {
              setSaveFailed(true);
            }
          }}
          type="button"
        >
          Save settings
        </button>
      </footer>
    </main>
  );
}
