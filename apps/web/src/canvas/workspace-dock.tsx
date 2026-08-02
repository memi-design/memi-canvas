import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import "../theme/studio-tokens.css";
import "./workspace-dock.css";
import type { AgentPatchReview } from "./agent-patch.js";
import type {
  CanvasRuntimeRestorePreview,
  CanvasRuntimeSnapshot,
} from "./canvas-runtime-port.js";
import type {
  PreviewReadyEvidence,
  PreviewStatus,
} from "../preview/preview-session.js";
import {
  DockIcon,
  type DockIconName,
} from "./workspace-dock-icons.js";
import { workspaceDockPanelContent } from "./workspace-dock-panels.js";

export { isAllowedLocalhostUrl } from "./workspace-dock-browser.js";

export type WorkspaceDockTab =
  | "inspect"
  | "browser"
  | "runs"
  | "files"
  | "settings";

export interface WorkspaceDockTraceItem {
  readonly id: string;
  readonly action: string;
  readonly targetNodeId?: string;
  readonly harnessId?: string;
}

export interface WorkspaceDockHistoryItem {
  readonly id: number | string;
  readonly label: string;
}

export interface WorkspaceDockFileItem {
  readonly id: string;
  readonly name: string;
  readonly kind?: "node" | "page";
  readonly detail?: string;
}

export interface WorkspaceDockSettings {
  readonly harness: string;
  readonly model: string;
  readonly reasoning: string;
  readonly permission: string;
  readonly connected?: boolean;
}

export interface WorkspaceDockProps {
  readonly activeTab: WorkspaceDockTab;
  readonly agentPatchReview?: AgentPatchReview | null;
  readonly browserAddress: string;
  readonly browserRevision: number;
  readonly browserDocumentRevision?: number;
  readonly browserLastGood?: PreviewReadyEvidence | null;
  readonly browserProjectId?: string;
  readonly browserReason?: string | null;
  readonly browserSessionId?: string | null;
  readonly browserStatus?: PreviewStatus;
  readonly browserUnavailableReason?: string;
  readonly browserUrl: string;
  readonly collapsed: boolean;
  readonly files: readonly WorkspaceDockFileItem[];
  readonly history: readonly WorkspaceDockHistoryItem[];
  readonly inspectContent?: ReactNode;
  readonly inspectorWidth: number;
  readonly onActiveTabChange: (tab: WorkspaceDockTab) => void;
  readonly onApplyAgentPatch?: () => void;
  readonly onApproveAgentPatch?: () => void;
  readonly onBrowserAddressChange: (address: string) => void;
  readonly onBrowserNavigate: (url: string) => void;
  readonly onBrowserReady?: (evidence: {
    readonly documentRevision: number;
    readonly projectId: string;
    readonly sessionId: string;
    readonly verifiedAt: string;
  }) => void;
  readonly onBrowserError?: (reason: string, sessionId: string) => void;
  readonly onBrowserReload: () => void;
  readonly onBrowserStop: () => void;
  readonly onCancelRestore?: () => void;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onConfirmRestore?: () => void;
  readonly onOpenInHelium?: (url: string) => void;
  readonly onSplitRatioChange: (ratio: number) => void;
  readonly onRejectAgentPatch?: () => void;
  readonly onRequestAgentChanges?: () => void;
  readonly onRestoreCheckpoint?: () => void;
  readonly onRollbackAgentPatch?: () => void;
  readonly onCancelRuntime?: () => void;
  readonly onVerifyAgentPatch?: () => void;
  readonly restorePreview?: CanvasRuntimeRestorePreview | null;
  readonly runtimeSnapshot?: CanvasRuntimeSnapshot | null;
  readonly settings: WorkspaceDockSettings;
  readonly settingsContent?: ReactNode;
  readonly splitRatio: number;
  readonly trace: readonly WorkspaceDockTraceItem[];
}

interface DockTabDefinition {
  readonly id: WorkspaceDockTab;
  readonly icon: DockIconName;
  readonly label: string;
}

const DOCK_TABS: readonly DockTabDefinition[] = [
  { id: "inspect", icon: "inspect", label: "Inspect" },
  { id: "browser", icon: "browser", label: "Browser" },
  { id: "runs", icon: "runs", label: "Runs" },
  { id: "files", icon: "files", label: "Files" },
  { id: "settings", icon: "settings", label: "Settings" },
];

const MIN_SPLIT_WIDTH = 400;
const MAX_SPLIT_WIDTH = 960;
const FIXED_EDITOR_WIDTH = 568;
const RESIZE_STEP = 16;

function splitMaximum(viewportWidth = globalThis.innerWidth): number {
  return Math.max(
    MIN_SPLIT_WIDTH,
    Math.min(MAX_SPLIT_WIDTH, viewportWidth - FIXED_EDITOR_WIDTH),
  );
}

function clampSplitWidth(
  width: number,
  viewportWidth = globalThis.innerWidth,
): number {
  return Math.min(
    splitMaximum(viewportWidth),
    Math.max(MIN_SPLIT_WIDTH, Math.round(width)),
  );
}

// Atomic Design: organism — a controlled Codex-style workspace side dock.
export function WorkspaceDock(props: WorkspaceDockProps) {
  const activeTab = DOCK_TABS.find((tab) => tab.id === props.activeTab);
  const [splitWidth, setSplitWidth] = useState(() =>
    clampSplitWidth(globalThis.innerWidth * props.splitRatio),
  );
  const resizeGesture = useRef<{
    readonly pointerId: number;
    readonly startWidth: number;
    readonly startX: number;
  } | null>(null);

  useEffect(() => {
    function reclampSplit(): void {
      setSplitWidth(
        clampSplitWidth(globalThis.innerWidth * props.splitRatio),
      );
    }

    globalThis.addEventListener("resize", reclampSplit);
    return () => globalThis.removeEventListener("resize", reclampSplit);
  }, [props.splitRatio]);

  useEffect(() => {
    setSplitWidth(
      clampSplitWidth(globalThis.innerWidth * props.splitRatio),
    );
  }, [props.splitRatio]);

  if (!activeTab) {
    return null;
  }

  const splitActive =
    !props.collapsed &&
    (props.activeTab === "browser" || props.activeTab === "runs");
  const inspectorWidth = Math.min(
    640,
    Math.max(240, Math.round(props.inspectorWidth)),
  );
  const dockWidth = splitActive ? splitWidth : inspectorWidth;
  const dockStyle = {
    "--workspace-dock-width": `${dockWidth}px`,
  } as CSSProperties;

  function updateSplitWidth(width: number): void {
    const requested = clampSplitWidth(width);
    const ratio = Math.min(
      0.8,
      Math.max(0.25, requested / globalThis.innerWidth),
    );
    const next = clampSplitWidth(globalThis.innerWidth * ratio);
    setSplitWidth(next);
    props.onSplitRatioChange(ratio);
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>): void {
    resizeGesture.current = {
      pointerId: event.pointerId,
      startWidth: splitWidth,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function continueResize(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = resizeGesture.current;

    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    updateSplitWidth(
      gesture.startWidth + gesture.startX - event.clientX,
    );
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>): void {
    if (resizeGesture.current?.pointerId !== event.pointerId) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    resizeGesture.current = null;
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case "ArrowLeft":
        updateSplitWidth(splitWidth + RESIZE_STEP);
        break;
      case "ArrowRight":
        updateSplitWidth(splitWidth - RESIZE_STEP);
        break;
      case "Home":
        updateSplitWidth(MIN_SPLIT_WIDTH);
        break;
      case "End":
        updateSplitWidth(splitMaximum());
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  function navigateTabs(
    event: KeyboardEvent<HTMLButtonElement>,
    tabIndex: number,
  ): void {
    const lastIndex = DOCK_TABS.length - 1;
    let nextIndex: number | undefined;

    switch (event.key) {
      case "ArrowLeft":
        nextIndex = tabIndex === 0 ? lastIndex : tabIndex - 1;
        break;
      case "ArrowRight":
        nextIndex = tabIndex === lastIndex ? 0 : tabIndex + 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = lastIndex;
        break;
    }

    if (nextIndex === undefined) {
      return;
    }

    const nextTab = DOCK_TABS[nextIndex];

    if (!nextTab) {
      return;
    }

    event.preventDefault();
    props.onActiveTabChange(nextTab.id);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`#workspace-dock-tab-${nextTab.id}`)
      ?.focus();
  }

  return (
    <aside
      aria-label="Workspace"
      className={
        props.collapsed
          ? "workspace-dock workspace-dock--collapsed"
          : splitActive
            ? "workspace-dock workspace-dock--split"
            : "workspace-dock"
      }
      data-atomic-level="organism"
      data-layout={
        props.collapsed ? "collapsed" : splitActive ? "split" : "inspector"
      }
      style={dockStyle}
    >
      {splitActive ? (
        <div
          aria-label="Resize workspace"
          aria-orientation="vertical"
          aria-valuemax={splitMaximum()}
          aria-valuemin={MIN_SPLIT_WIDTH}
          aria-valuenow={splitWidth}
          className="workspace-dock__resize-handle"
          onKeyDown={resizeWithKeyboard}
          onPointerCancel={finishResize}
          onPointerDown={startResize}
          onPointerMove={continueResize}
          onPointerUp={finishResize}
          role="separator"
          tabIndex={0}
        />
      ) : null}
      <header className="workspace-dock__header">
        <strong>{activeTab.label}</strong>
        <button
          aria-label={
            props.collapsed ? "Expand workspace" : "Collapse workspace"
          }
          aria-expanded={!props.collapsed}
          onClick={() => props.onCollapsedChange(!props.collapsed)}
          title={
            props.collapsed ? "Expand workspace" : "Collapse workspace"
          }
          type="button"
        >
          <DockIcon
            name={props.collapsed ? "expand" : "collapse"}
            size={16}
          />
        </button>
      </header>

      <div
        aria-label="Workspace tools"
        className="workspace-dock__tabs"
        role="tablist"
      >
        {DOCK_TABS.map((tab, tabIndex) => (
          <button
            aria-controls={`workspace-dock-panel-${tab.id}`}
            aria-label={tab.label}
            aria-selected={props.activeTab === tab.id}
            id={`workspace-dock-tab-${tab.id}`}
            key={tab.id}
            onClick={() => props.onActiveTabChange(tab.id)}
            onKeyDown={(event) => navigateTabs(event, tabIndex)}
            role="tab"
            tabIndex={props.activeTab === tab.id ? 0 : -1}
            title={`${tab.label} workspace`}
            type="button"
          >
            <DockIcon name={tab.icon} />
          </button>
        ))}
      </div>

      {!props.collapsed ? (
        <section
          aria-labelledby={`workspace-dock-tab-${props.activeTab}`}
          className="workspace-dock__panel"
          id={`workspace-dock-panel-${props.activeTab}`}
          role="tabpanel"
        >
          {workspaceDockPanelContent(props)}
        </section>
      ) : null}
    </aside>
  );
}
