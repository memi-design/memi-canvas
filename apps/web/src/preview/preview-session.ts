export type PreviewStatus =
  | "stopped"
  | "connecting"
  | "ready"
  | "blocked"
  | "error"
  | "stale";

export interface PreviewReadyEvidence {
  readonly documentRevision: number;
  readonly sessionId: string;
  readonly url: string;
  readonly verifiedAt: string;
}

export interface PreviewSession {
  readonly address: string;
  readonly documentRevision: number;
  readonly lastGood: PreviewReadyEvidence | null;
  readonly navigationRevision: number;
  readonly projectId: string;
  readonly reason: string | null;
  readonly sessionId: string | null;
  readonly status: PreviewStatus;
  readonly url: string;
}

export type PreviewSessionAction =
  | { readonly type: "edit-address"; readonly address: string }
  | {
      readonly type: "navigate";
      readonly sessionId: string;
      readonly url: string;
    }
  | {
      readonly type: "reload";
      readonly sessionId: string;
    }
  | {
      readonly type: "ready";
      readonly documentRevision: number;
      readonly projectId: string;
      readonly sessionId: string;
      readonly verifiedAt: string;
    }
  | {
      readonly type: "blocked" | "error";
      readonly reason: string;
      readonly sessionId: string;
    }
  | { readonly type: "stale"; readonly reason: string }
  | {
      readonly type: "document-revision";
      readonly documentRevision: number;
    }
  | { readonly type: "stop" };

export function createPreviewSession(
  address: string,
  context: {
    readonly documentRevision: number;
    readonly projectId: string;
  },
): PreviewSession {
  return {
    address,
    documentRevision: context.documentRevision,
    lastGood: null,
    navigationRevision: 0,
    projectId: context.projectId,
    reason: null,
    sessionId: null,
    status: "stopped",
    url: "",
  };
}

function isCurrentSession(
  state: PreviewSession,
  sessionId: string,
): boolean {
  return state.sessionId !== null && state.sessionId === sessionId;
}

export function previewSessionReducer(
  state: PreviewSession,
  action: PreviewSessionAction,
): PreviewSession {
  switch (action.type) {
    case "edit-address":
      return { ...state, address: action.address };
    case "navigate":
      return {
        ...state,
        address: action.url,
        navigationRevision: state.navigationRevision + 1,
        reason: null,
        sessionId: action.sessionId,
        status: "connecting",
        url: action.url,
      };
    case "reload":
      return state.status === "stopped" || state.url.length === 0
        ? state
        : {
            ...state,
            navigationRevision: state.navigationRevision + 1,
            reason: null,
            sessionId: action.sessionId,
            status: "connecting",
          };
    case "ready":
      if (
        !isCurrentSession(state, action.sessionId) ||
        action.projectId !== state.projectId ||
        action.documentRevision !== state.documentRevision ||
        state.status !== "connecting"
      ) {
        return state;
      }
      return {
        ...state,
        lastGood: {
          documentRevision: action.documentRevision,
          sessionId: action.sessionId,
          url: state.url,
          verifiedAt: action.verifiedAt,
        },
        reason: null,
        status: "ready",
      };
    case "blocked":
    case "error":
      return !isCurrentSession(state, action.sessionId)
        ? state
        : {
            ...state,
            reason: action.reason,
            status: action.type,
          };
    case "stale":
      return state.status === "stopped"
        ? state
        : {
            ...state,
            reason: action.reason,
            status: "stale",
          };
    case "document-revision":
      if (action.documentRevision === state.documentRevision) {
        return state;
      }
      return {
        ...state,
        documentRevision: action.documentRevision,
        reason:
          state.status === "stopped"
            ? state.reason
            : "The canvas changed after this preview was verified.",
        status: state.status === "stopped" ? "stopped" : "stale",
      };
    case "stop":
      return {
        ...state,
        reason: null,
        sessionId: null,
        status: "stopped",
        url: "",
      };
  }
}
