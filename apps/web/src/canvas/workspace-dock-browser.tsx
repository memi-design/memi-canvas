import { useEffect, useRef, type FormEvent } from "react";

import type {
  PreviewReadyEvidence,
  PreviewStatus,
} from "../preview/preview-session.js";
import { DockIcon } from "./workspace-dock-icons.js";

export function isAllowedLocalhostUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const isLocalHost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";

    return (
      url.protocol === "http:" &&
      isLocalHost &&
      url.port.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

function isCurrentDocumentOrigin(value: string): boolean {
  try {
    if (typeof globalThis.location === "undefined") {
      return false;
    }
    const candidate = new URL(value);
    const current = new URL(globalThis.location.origin);
    const loopback = (hostname: string) =>
      hostname === "localhost" || hostname === "127.0.0.1";
    return (
      candidate.origin === current.origin ||
      (candidate.protocol === current.protocol &&
        candidate.port === current.port &&
        loopback(candidate.hostname) &&
        loopback(current.hostname))
    );
  } catch {
    return false;
  }
}

function isBuiltInDemoPreview(value: string): boolean {
  try {
    const candidate = new URL(value);
    return (
      isCurrentDocumentOrigin(value) &&
      (candidate.pathname === "/demo-preview.html" ||
        candidate.pathname === "/demo-preview-error.html")
    );
  } catch {
    return false;
  }
}

function isAllowedPreviewTarget(value: string): boolean {
  return (
    isAllowedLocalhostUrl(value) &&
    (!isCurrentDocumentOrigin(value) || isBuiltInDemoPreview(value))
  );
}

interface BrowserPanelProps {
  readonly browserAddress: string;
  readonly browserDocumentRevision: number | undefined;
  readonly browserLastGood: PreviewReadyEvidence | null | undefined;
  readonly browserProjectId: string | undefined;
  readonly browserReason: string | null | undefined;
  readonly browserRevision: number;
  readonly browserSessionId: string | null | undefined;
  readonly browserStatus: PreviewStatus | undefined;
  readonly browserUnavailableReason: string | undefined;
  readonly browserUrl: string;
  readonly onBrowserAddressChange: (address: string) => void;
  readonly onBrowserNavigate: (url: string) => void;
  readonly onBrowserReady:
    | ((evidence: {
        readonly documentRevision: number;
        readonly projectId: string;
        readonly sessionId: string;
        readonly verifiedAt: string;
      }) => void)
    | undefined;
  readonly onBrowserError:
    | ((reason: string, sessionId: string) => void)
    | undefined;
  readonly onBrowserReload: () => void;
  readonly onBrowserStop: () => void;
  readonly onOpenInHelium: ((url: string) => void) | undefined;
}

// Atomic Design: molecule — controlled localhost address and preview surface.
export function BrowserPanel({
  browserAddress,
  browserDocumentRevision,
  browserLastGood,
  browserProjectId,
  browserReason,
  browserRevision,
  browserSessionId,
  browserStatus = "stopped",
  browserUnavailableReason,
  browserUrl,
  onBrowserError,
  onBrowserReload,
  onBrowserReady,
  onBrowserStop,
  onBrowserAddressChange,
  onBrowserNavigate,
  onOpenInHelium,
}: BrowserPanelProps) {
  const browserAddressAllowed = isAllowedPreviewTarget(browserAddress);
  const browserUrlAllowed = isAllowedPreviewTarget(browserUrl);
  const previewFrame = useRef<HTMLIFrameElement | null>(null);
  const previewFrameUrl = (() => {
    if (
      !isBuiltInDemoPreview(browserUrl) ||
      browserSessionId === null ||
      browserSessionId === undefined ||
      browserProjectId === undefined ||
      browserDocumentRevision === undefined
    ) {
      return browserUrl;
    }
    const url = new URL(browserUrl);
    url.searchParams.set("sessionId", browserSessionId);
    url.searchParams.set("projectId", browserProjectId);
    url.searchParams.set(
      "documentRevision",
      String(browserDocumentRevision),
    );
    return url.href;
  })();

  function requestNavigation(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (browserAddressAllowed) {
      onBrowserNavigate(browserAddress);
    }
  }

  useEffect(() => {
    function receivePreviewEvidence(event: MessageEvent): void {
      if (
        !isBuiltInDemoPreview(previewFrameUrl) ||
        browserSessionId === null ||
        browserSessionId === undefined ||
        browserProjectId === undefined ||
        browserDocumentRevision === undefined ||
        onBrowserReady === undefined ||
        event.source !== previewFrame.current?.contentWindow ||
        event.origin !== new URL(previewFrameUrl).origin ||
        typeof event.data !== "object" ||
        event.data === null
      ) {
        return;
      }
      const data = event.data as Record<string, unknown>;
      if (
        data.sessionId !== browserSessionId ||
        data.projectId !== browserProjectId ||
        data.documentRevision !== browserDocumentRevision
      ) {
        return;
      }
      if (
        data.type === "memi:preview-error" &&
        onBrowserError !== undefined
      ) {
        onBrowserError(
          typeof data.reason === "string"
            ? data.reason
            : "The preview fixture reported an error.",
          browserSessionId,
        );
        return;
      }
      if (data.type !== "memi:preview-ready") {
        return;
      }
      onBrowserReady({
        documentRevision: browserDocumentRevision,
        projectId: browserProjectId,
        sessionId: browserSessionId,
        verifiedAt:
          typeof data.verifiedAt === "string"
            ? data.verifiedAt
            : new Date().toISOString(),
      });
    }
    globalThis.addEventListener("message", receivePreviewEvidence);
    return () => {
      globalThis.removeEventListener("message", receivePreviewEvidence);
    };
  }, [
    browserDocumentRevision,
    browserProjectId,
    browserSessionId,
    onBrowserReady,
    onBrowserError,
    previewFrameUrl,
  ]);

  const statusLabel: Readonly<Record<PreviewStatus, string>> = {
    blocked: "Blocked",
    connecting: "Connecting",
    error: "Error",
    ready: "Ready",
    stale: "Stale",
    stopped: "Stopped",
  };

  return (
    <div className="workspace-dock__browser">
      <form
        aria-label="Preview address"
        className="workspace-dock__address"
        onSubmit={requestNavigation}
        role="form"
      >
        <label htmlFor="workspace-dock-address">Address</label>
        <div>
          <input
            aria-describedby={
              browserAddressAllowed
                ? undefined
                : "workspace-dock-address-error"
            }
            aria-invalid={!browserAddressAllowed}
            aria-label="Preview address"
            autoCapitalize="none"
            autoComplete="off"
            id="workspace-dock-address"
            onChange={(event) =>
              onBrowserAddressChange(event.currentTarget.value)
            }
            spellCheck={false}
            type="url"
            value={browserAddress}
          />
          <button
            aria-label="Open preview"
            disabled={!browserAddressAllowed}
            title="Open preview"
            type="submit"
          >
            <DockIcon name="go" size={15} />
          </button>
        </div>
        {!browserAddressAllowed ? (
          <p id="workspace-dock-address-error" role="alert">
            Enter an HTTP localhost URL with an explicit port.
          </p>
        ) : null}
      </form>

      {browserUnavailableReason ? (
        <div
          className="workspace-dock__unavailable"
          role="status"
        >
          <strong>Preview unavailable</strong>
          <p>{browserUnavailableReason}</p>
        </div>
      ) : browserUrlAllowed && browserStatus !== "stopped" ? (
        <>
          <div
            className="workspace-dock__preview-status"
            data-preview-status={browserStatus}
          >
            <p role="status">
              <span aria-hidden="true" />
              {statusLabel[browserStatus]}
            </p>
            <div>
              <button
                aria-label="Reload preview"
                onClick={onBrowserReload}
                title="Reload preview"
                type="button"
              >
                <DockIcon name="reload" size={15} />
              </button>
              <button
                aria-label="Stop preview"
                onClick={onBrowserStop}
                title="Stop preview"
                type="button"
              >
                <DockIcon name="stop" size={14} />
              </button>
              {onOpenInHelium && browserStatus === "ready" ? (
                <button
                  aria-label="Open preview in Helium"
                  onClick={() => onOpenInHelium(browserUrl)}
                  title="Open preview in Helium"
                  type="button"
                >
                  <DockIcon name="helium" size={15} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="workspace-dock__preview-evidence">
            <span>Demo preview</span>
            <span>Revision {browserDocumentRevision ?? "unknown"}</span>
            {browserReason ? <span>{browserReason}</span> : null}
            {browserLastGood ? (
              <span>Last good {browserLastGood.verifiedAt}</span>
            ) : null}
          </div>
          <iframe
            className="workspace-dock__preview"
            key={`${browserUrl}:${browserRevision}`}
            ref={previewFrame}
            referrerPolicy="no-referrer"
            sandbox="allow-same-origin allow-scripts"
            src={previewFrameUrl}
            title="Local workspace preview"
            onError={() => {
              if (
                onBrowserError !== undefined &&
                browserSessionId !== null &&
                browserSessionId !== undefined
              ) {
                onBrowserError(
                  "The local preview could not be loaded.",
                  browserSessionId,
                );
              }
            }}
          />
        </>
      ) : (
        <div
          className="workspace-dock__unavailable"
          role="status"
        >
          <strong>Preview unavailable</strong>
          <p>A valid local address is required before content can load.</p>
        </div>
      )}
    </div>
  );
}
