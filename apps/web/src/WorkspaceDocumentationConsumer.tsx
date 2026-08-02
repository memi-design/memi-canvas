import {
  parseWorkspaceDocumentation,
  type WorkspaceDocumentation,
  type WorkspaceScreen,
} from "@memi/workspace-documentation";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { TruthBadge } from "./TruthBadge";

const DEFAULT_DOCUMENTATION_URL = "/workspace-documentation.json";
const MAX_DOCUMENTATION_BYTES = 1_048_576;
const VIEWPORTS = ["desktop", "tablet", "mobile"] as const;

type DocumentationView = "screens" | "flows" | "design-system" | "evidence";
type ViewportName = (typeof VIEWPORTS)[number];

export interface CollaborationState {
  readonly title: string;
  readonly status: string;
  readonly harness: string;
}

export type WorkspaceDocumentationLoader = (
  signal?: AbortSignal,
) => Promise<unknown>;

export interface WorkspaceDocumentationConsumerProps {
  readonly loader?: WorkspaceDocumentationLoader;
  readonly collaboration?: CollaborationState;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface ScreenRow {
  readonly id: string;
  readonly route: WorkspaceScreen["route"];
  readonly state: WorkspaceScreen["state"];
  readonly context: WorkspaceScreen["context"];
  readonly cells: Readonly<Partial<Record<ViewportName, WorkspaceScreen>>>;
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function oversizedDocumentationError(): RangeError {
  return new RangeError(
    `Workspace documentation exceeds ${MAX_DOCUMENTATION_BYTES} bytes.`,
  );
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let receivedBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return `${parts.join("")}${decoder.decode()}`;
    }

    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_DOCUMENTATION_BYTES) {
      await reader.cancel("Workspace documentation byte limit exceeded.");
      throw oversizedDocumentationError();
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
}

export async function fetchWorkspaceDocumentation(
  url = DEFAULT_DOCUMENTATION_URL,
  fetcher: Fetcher = globalThis.fetch,
  signal = new AbortController().signal,
): Promise<WorkspaceDocumentation> {
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `Workspace documentation request failed with HTTP ${response.status}.`,
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_DOCUMENTATION_BYTES
  ) {
    throw oversizedDocumentationError();
  }

  const source = await readBoundedResponse(response);

  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Workspace documentation contains invalid JSON.");
  }
  return parseWorkspaceDocumentation(value);
}

const defaultLoader: WorkspaceDocumentationLoader = (signal) =>
  fetchWorkspaceDocumentation(
    DEFAULT_DOCUMENTATION_URL,
    globalThis.fetch,
    signal,
  );

function materializationLabel(
  status: WorkspaceScreen["materialization"]["status"],
): string {
  if (status === "committed") {
    return "Committed canvas";
  }
  if (status === "planned-not-committed") {
    return "Planned, not committed";
  }
  return "Unmaterialized";
}

function captureLabel(status: WorkspaceScreen["capture"]["status"]): string {
  return `${titleCase(status)} capture`;
}

function groupScreens(
  screens: readonly WorkspaceScreen[],
): readonly ScreenRow[] {
  const rows = new Map<string, ScreenRow>();
  for (const screen of screens) {
    const key = [
      screen.route.id,
      screen.state.id,
      screen.context.role,
      screen.context.theme,
      screen.context.locale,
      screen.context.fixture,
    ].join(":");
    const current = rows.get(key);
    rows.set(key, {
      id: key,
      route: screen.route,
      state: screen.state,
      context: screen.context,
      cells: {
        ...current?.cells,
        [screen.viewport.name]: screen,
      },
    });
  }
  return [...rows.values()];
}

function moveMatrixFocus(
  event: KeyboardEvent<HTMLButtonElement>,
): boolean {
  const currentRow = event.currentTarget.closest("tr");
  const body = currentRow?.closest("tbody");
  const rowControls = Array.from(
    currentRow?.querySelectorAll<HTMLButtonElement>(
      "[data-documentation-cell]",
    ) ?? [],
  );
  const rows = Array.from(body?.querySelectorAll("tr") ?? []);
  const column = rowControls.indexOf(event.currentTarget);
  const row = currentRow ? rows.indexOf(currentRow) : -1;
  let target: HTMLButtonElement | undefined;

  if (event.key === "ArrowRight") {
    target = rowControls[Math.min(column + 1, rowControls.length - 1)];
  } else if (event.key === "ArrowLeft") {
    target = rowControls[Math.max(column - 1, 0)];
  } else if (event.key === "Home") {
    target = rowControls[0];
  } else if (event.key === "End") {
    target = rowControls.at(-1);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const targetRow = Math.min(Math.max(row + delta, 0), rows.length - 1);
    target = Array.from(
      rows[targetRow]?.querySelectorAll<HTMLButtonElement>(
        "[data-documentation-cell]",
      ) ?? [],
    )[column];
  }

  if (!target) {
    return false;
  }
  event.preventDefault();
  target.focus();
  return true;
}

// Molecule: a non-visual evidence cell. It never fabricates a screenshot
// preview from canvas materialization or source declarations.
function DocumentationCell({
  screen,
  selected,
  onSelect,
}: {
  readonly screen: WorkspaceScreen;
  readonly selected: boolean;
  readonly onSelect: (screenId: string) => void;
}) {
  const viewport = titleCase(screen.viewport.name);
  const capture = captureLabel(screen.capture.status);
  const materialization = materializationLabel(screen.materialization.status);
  const accessibleName = [
    screen.route.displayName,
    screen.state.name,
    viewport,
    capture,
    materialization,
  ].join(" ");

  return (
    <button
      aria-label={accessibleName}
      aria-pressed={selected}
      className={`documentation-cell documentation-cell--${screen.capture.status}`}
      data-documentation-cell
      onClick={() => onSelect(screen.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(screen.id);
          return;
        }
        moveMatrixFocus(event);
      }}
      type="button"
    >
      <strong>{viewport}</strong>
      <span>
        {screen.viewport.width} × {screen.viewport.height}
      </span>
      <span>{capture}</span>
      <span>{materialization}</span>
      {screen.capture.reason ? <small>{screen.capture.reason}</small> : null}
    </button>
  );
}

// Molecule: an explicit view of the currently selected canonical screen cell.
function SelectedScreenEvidence({
  screen,
}: {
  readonly screen: WorkspaceScreen | undefined;
}) {
  if (!screen) {
    return (
      <section aria-label="Selected screen evidence" className="evidence-card">
        <h2>No screen selected</h2>
        <p>The artifact does not contain a selectable screen cell.</p>
      </section>
    );
  }

  return (
    <section aria-label="Selected screen evidence" className="evidence-card">
      <p className="eyebrow">Selected canonical cell</p>
      <h2>{screen.route.displayName}</h2>
      <code>{screen.route.path}</code>
      <p>{screen.state.name}</p>
      <dl className="truth-dimensions">
        <div>
          <dt>Viewport</dt>
          <dd>
            {titleCase(screen.viewport.name)} · {screen.viewport.width} ×{" "}
            {screen.viewport.height}
          </dd>
        </div>
        <div>
          <dt>Capture</dt>
          <dd>{captureLabel(screen.capture.status)}</dd>
        </div>
        <div>
          <dt>Canvas</dt>
          <dd>{materializationLabel(screen.materialization.status)}</dd>
        </div>
        <div>
          <dt>Verified screenshot</dt>
          <dd>Unavailable</dd>
        </div>
        {screen.materialization.traceRef ? (
          <div>
            <dt>Canonical event</dt>
            <dd>{screen.materialization.traceRef.eventId}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

// Organism: the accessible route/state/viewport evidence matrix.
function DocumentationScreenMatrix({
  documentation,
  selectedScreenId,
  onSelect,
}: {
  readonly documentation: WorkspaceDocumentation;
  readonly selectedScreenId: string | undefined;
  readonly onSelect: (screenId: string) => void;
}) {
  const rows = useMemo(
    () => groupScreens(documentation.screens),
    [documentation.screens],
  );

  return (
    <section aria-label="Screens" className="documentation-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Canonical product documentation</p>
          <h2>Responsive screen matrix</h2>
        </div>
        <p>Canvas status and capture evidence are reported independently.</p>
      </div>
      <div className="matrix-scroll">
        <table aria-label="Responsive screen matrix">
          <thead>
            <tr>
              <th scope="col">Screen</th>
              {VIEWPORTS.map((viewport) => (
                <th key={viewport} scope="col">
                  {titleCase(viewport)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <strong>{row.route.displayName}</strong>
                  <span>{row.state.name}</span>
                  <code>{row.route.path}</code>
                </th>
                {VIEWPORTS.map((viewport) => {
                  const screen = row.cells[viewport];
                  return (
                    <td key={viewport}>
                      {screen ? (
                        <DocumentationCell
                          onSelect={onSelect}
                          screen={screen}
                          selected={screen.id === selectedScreenId}
                        />
                      ) : (
                        <span className="documentation-cell__empty">
                          Not documented
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Organism: flow declarations remain visibly distinct from observed journeys.
function FlowView({
  documentation,
}: {
  readonly documentation: WorkspaceDocumentation;
}) {
  return (
    <section aria-label="Flows" className="documentation-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Declared journeys</p>
          <h2>Flows</h2>
        </div>
        <p>No flow observation authority exists in this artifact.</p>
      </div>
      <div className="documentation-card-grid">
        {documentation.flows.map((flow) => (
          <article className="documentation-card" key={flow.id}>
            <h3>{flow.name}</h3>
            <p className="documentation-card__truth">
              <TruthBadge tone="neutral">Declared</TruthBadge>
              <TruthBadge tone="warning">Not observed</TruthBadge>
            </p>
            <ol>
              {flow.steps.map((step) => (
                <li key={`${flow.id}:${step.order}`}>
                  <strong>{step.trigger}</strong>
                  <span>{step.assertion}</span>
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </section>
  );
}

// Organism: design-system declarations are inert text, never executable CSS.
function DesignSystemView({
  documentation,
}: {
  readonly documentation: WorkspaceDocumentation;
}) {
  return (
    <section aria-label="Design system" className="documentation-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Declaration inventory</p>
          <h2>Design system</h2>
        </div>
        <p>Token values and rendering authority are intentionally unavailable.</p>
      </div>
      <div className="design-system-grid">
        <section className="documentation-card">
          <h3>Declared token identifiers</h3>
          <ul className="token-list">
            {documentation.designSystem.tokens.map((token) => (
              <li key={token.cssVariable}>
                <strong>{token.name}</strong>
                <code>{token.cssVariable}</code>
                <span>{token.sourceFile}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="documentation-card">
          <h3>Components unavailable</h3>
          <p>{documentation.coverage.components.available} available components</p>
          <p>
            The workspace artifact has no component inventory authority.
          </p>
        </section>
      </div>
    </section>
  );
}

// Organism: canonical runtime references only. Collaboration never enters this
// list or changes its sequence.
function EvidenceView({
  documentation,
  selected,
  onTraceSelect,
}: {
  readonly documentation: WorkspaceDocumentation;
  readonly selected: WorkspaceScreen | undefined;
  readonly onTraceSelect: (sequence: number) => void;
}) {
  return (
    <section aria-label="Evidence" className="documentation-view">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Canonical evidence</p>
          <h2>Evidence</h2>
        </div>
        <p>Runtime commit references do not prove visual correctness.</p>
      </div>
      <div className="evidence-grid">
        <SelectedScreenEvidence screen={selected} />
        <section className="documentation-card">
          <h3>Canonical trace</h3>
          <ol aria-label="Canonical trace" className="canonical-trace">
            {documentation.trace.refs.map((ref) => (
              <li key={ref.eventId}>
                <button
                  aria-label={`Inspect canonical event ${ref.sequence}`}
                  onClick={() => onTraceSelect(ref.sequence)}
                  type="button"
                >
                  <strong>Event {ref.sequence}</strong>
                  <span>{ref.eventId}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function ViewButton({
  active,
  children,
  onClick,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

// Template: canonical documentation views plus an optional, isolated
// collaboration surface.
function DocumentationWorkspace({
  collaboration,
  documentation,
}: {
  readonly collaboration: CollaborationState | undefined;
  readonly documentation: WorkspaceDocumentation;
}) {
  const [view, setView] = useState<DocumentationView>("screens");
  const [selectedScreenId, setSelectedScreenId] = useState<string | undefined>(
    documentation.screens[0]?.id,
  );
  const selected = documentation.screens.find(
    (screen) => screen.id === selectedScreenId,
  );
  const committed = documentation.coverage.materialization.committed;
  const inferred = documentation.coverage.captures.inferred;

  function selectTraceTarget(sequence: number) {
    const target = documentation.screens.find(
      (screen) => screen.materialization.traceRef?.sequence === sequence,
    );
    if (target) {
      setSelectedScreenId(target.id);
    }
  }

  return (
    <div className="app-shell documentation-shell">
      <header className="project-header">
        <div>
          <div className="project-header__meta">
            <TruthBadge tone="positive">Validated artifact</TruthBadge>
            <span>{titleCase(documentation.project.importMode)}</span>
          </div>
          <h1>Workspace documentation</h1>
          <p>{documentation.project.id}</p>
        </div>
        <div
          aria-label="Workspace evidence summary"
          className="coverage-summary"
          role="status"
        >
          <strong>0 verified screenshots</strong>
          <span>{committed} committed canvas cells</span>
          <span>{inferred} inferred captures</span>
        </div>
      </header>
      <nav aria-label="Project navigation" className="project-nav">
        <ViewButton
          active={view === "screens"}
          onClick={() => setView("screens")}
        >
          Screens
        </ViewButton>
        <ViewButton
          active={view === "flows"}
          onClick={() => setView("flows")}
        >
          Flows
        </ViewButton>
        <ViewButton
          active={view === "design-system"}
          onClick={() => setView("design-system")}
        >
          Design system
        </ViewButton>
        <ViewButton
          active={view === "evidence"}
          onClick={() => setView("evidence")}
        >
          Evidence
        </ViewButton>
      </nav>
      <main aria-label="Documentation workspace" className="documentation-main">
        {view === "screens" ? (
          <div className="documentation-screen-layout">
            <DocumentationScreenMatrix
              documentation={documentation}
              onSelect={setSelectedScreenId}
              selectedScreenId={selectedScreenId}
            />
            <SelectedScreenEvidence screen={selected} />
          </div>
        ) : null}
        {view === "flows" ? <FlowView documentation={documentation} /> : null}
        {view === "design-system" ? (
          <DesignSystemView documentation={documentation} />
        ) : null}
        {view === "evidence" ? (
          <EvidenceView
            documentation={documentation}
            onTraceSelect={selectTraceTarget}
            selected={selected}
          />
        ) : null}
      </main>
      {collaboration ? (
        <aside aria-label="Collaboration" className="collaboration-strip">
          <div>
            <p className="eyebrow">Optional collaboration state</p>
            <h2>{collaboration.title}</h2>
          </div>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{collaboration.status}</dd>
            </div>
            <div>
              <dt>Harness</dt>
              <dd>{collaboration.harness}</dd>
            </div>
          </dl>
          <p>Separate from canonical documentation and trace authority.</p>
        </aside>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Workspace documentation could not be loaded.";
}

// Page: fetches or injects one untrusted JSON artifact and validates it before
// exposing any project content.
export function WorkspaceDocumentationConsumer({
  collaboration,
  loader = defaultLoader,
}: WorkspaceDocumentationConsumerProps) {
  const [state, setState] = useState<
    | { readonly status: "loading" }
    | {
        readonly status: "ready";
        readonly documentation: WorkspaceDocumentation;
      }
    | { readonly status: "error"; readonly message: string }
  >({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: "loading" });
    void loader(controller.signal)
      .then((value) => parseWorkspaceDocumentation(value))
      .then((documentation) => {
        if (active) {
          setState({ status: "ready", documentation });
        }
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          setState({ status: "error", message: errorMessage(error) });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loader]);

  if (state.status === "loading") {
    return (
      <main
        aria-label="Documentation loading"
        className="load-state"
        role="status"
      >
        <h1>Loading workspace documentation</h1>
        <p>Validating the canonical JSON artifact.</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="load-state load-state--error" role="alert">
        <h1>Documentation unavailable</h1>
        <p>{state.message}</p>
      </main>
    );
  }

  return (
    <DocumentationWorkspace
      collaboration={collaboration}
      documentation={state.documentation}
    />
  );
}
