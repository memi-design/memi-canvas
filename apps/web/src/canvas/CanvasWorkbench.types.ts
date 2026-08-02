import type { CanvasCamera } from "./canvas-camera.js";
import type {
  CanvasPageNavigation,
  NavigatorMode,
} from "./CanvasSidebar.js";
import type {
  CanvasWorkbenchProject,
  Point,
  SceneState,
  WorkbenchNode,
} from "./model.js";
import type {
  PermissionPolicy,
  PromptMode,
  ReasoningEffort,
} from "./harness-config.js";
import type { CanvasAutosave } from "./persistence.js";
import type { AgentPatch } from "./agent-patch.js";
import type { CanvasRuntimePortV1 } from "./canvas-runtime-port.js";
import type { SelectionContextCapsuleV1 } from "./selection-context-capsule.js";
import type {
  CanvasDocumentV3,
  CanvasDocumentV3PersistencePort,
  CanvasPageId,
  WorkspaceSessionDraftV1,
} from "@memi/protocol";
import type { CanvasDocumentV3PersistencePolicy } from "@memi/canvas-document";
import type { SelectionState } from "./model.js";
import type { CanvasReconstructionReview } from "./reconstruction-review.js";

export interface AgentSelectionContext {
  readonly capsule: SelectionContextCapsuleV1;
  readonly documentId: string;
  readonly harnessId: string;
  readonly nodeIds: readonly string[];
  readonly revision: number;
  readonly prompt: string;
  readonly promptMode: PromptMode;
  readonly modelId: string;
  readonly permissionPolicy: PermissionPolicy;
  readonly reasoningEffort: ReasoningEffort;
}

export interface CanvasAgentDefaults {
  readonly harnessId: string;
  readonly modelId: string;
  readonly modelOptions: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly permissionPolicy: PermissionPolicy;
  readonly reasoningEffort: ReasoningEffort;
}

export interface CanvasWorkspaceSessionState {
  readonly activity: Readonly<
    Omit<
      WorkspaceSessionDraftV1["activity"],
      "conflictedOverlayIds"
    >
  > & {
    readonly conflictedOverlayIds: readonly string[];
  };
  readonly camera: CanvasCamera;
  readonly documentRevision: number;
  readonly panels: Readonly<WorkspaceSessionDraftV1["panels"]>;
  readonly selection: SelectionState;
  readonly viewportSize: {
    readonly height: number;
    readonly width: number;
  };
}

/** Durable authority supplied by the production runtime for a Canvas V3 session. */
export interface CanvasWorkbenchV3Session {
  readonly activePageId: CanvasPageId;
  readonly document: CanvasDocumentV3;
  readonly persistence: CanvasDocumentV3PersistencePort;
  readonly persistencePolicy?: CanvasDocumentV3PersistencePolicy;
}

export interface CanvasWorkbenchProps {
  readonly agentDefaults?: CanvasAgentDefaults;
  readonly agentPatch?: AgentPatch | null;
  readonly authorityProject?: CanvasWorkbenchProject;
  readonly initialNavigatorMode?: NavigatorMode;
  readonly initialWorkspaceSession?: WorkspaceSessionDraftV1;
  readonly project: CanvasWorkbenchProject;
  readonly reconstructionReviews?: readonly CanvasReconstructionReview[];
  readonly runtimePort?: CanvasRuntimePortV1;
  /**
   * Required by the production integration. It remains optional temporarily
   * so legacy isolated view tests can compile while the consumer migration
   * lands; CanvasWorkbench itself must fail closed when it is absent.
   */
  readonly v3Session?: CanvasWorkbenchV3Session;
  readonly onHarnessChange?: (harnessId: string) => void;
  readonly onOpenInHelium?: (url: string) => void;
  readonly onOpenSourceInCode?: (sourcePath: string) => void;
  readonly onOpenSourceInCursor?: (sourcePath: string) => void;
  readonly onNavigatorModeChange?: (mode: NavigatorMode) => void;
  readonly onExit?: () => void;
  readonly onSceneChange?: (scene: SceneState) => void;
  readonly onSendAgentContext?: (context: AgentSelectionContext) => void;
  readonly onWorkspaceSessionChange?: (
    state: CanvasWorkspaceSessionState,
  ) => void;
  readonly pageNavigation?: CanvasPageNavigation;
  readonly persistence?: CanvasAutosave;
  readonly workspaceWarning?: string;
}

export type PointerGesture =
  | {
      readonly type: "create";
      readonly pointerId: number;
      readonly initialNodes: readonly WorkbenchNode[];
      readonly node: WorkbenchNode;
      readonly originCanvas: Point;
      readonly originViewport: Point;
      readonly points: readonly Point[];
      readonly dragged: boolean;
      readonly tool: Exclude<
        import("./commands.js").ProfessionalCanvasTool,
        "select" | "pan" | "Scale"
      >;
      readonly camera: CanvasCamera;
    }
  | {
      readonly type: "pan";
      readonly pointerId: number;
      readonly origin: Point;
      readonly camera: CanvasCamera;
    }
  | {
      readonly type: "move";
      readonly pointerId: number;
      readonly origin: Point;
      readonly nodeIds: readonly string[];
      readonly nodeName: string;
      readonly initialNodes: readonly WorkbenchNode[];
      readonly positions: Readonly<Record<string, Point>>;
      readonly duplicated: boolean;
      readonly camera: CanvasCamera;
    }
  | {
      readonly type: "resize";
      readonly pointerId: number;
      readonly origin: Point;
      readonly nodeId: string;
      readonly nodeName: string;
      readonly initialNodes: readonly WorkbenchNode[];
      readonly camera: CanvasCamera;
      readonly size: {
        readonly width: number;
        readonly height: number;
      };
    }
  | {
      readonly type: "marquee";
      readonly pointerId: number;
      readonly origin: Point;
      readonly current: Point;
      readonly additive: boolean;
      readonly initialSelectedIds: readonly string[];
      readonly camera: CanvasCamera;
    };

export interface SelectionMarquee {
  readonly active: boolean;
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface CanvasContextMenuState {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}
