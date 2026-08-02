import { useEffect, useMemo, useState } from "react";

import {
  normalizeFigmaJsonExport,
  prepareFigmaUrlImport,
  type FigmaImportResult,
} from "./figma-import.js";
import "./figma-import-dialog.css";

export interface FigmaImportDialogProps {
  readonly onClose: () => void;
  readonly onImport: (result: FigmaImportResult) => void;
}

type ImportMode = "json" | "url";

function localFileKey(serialized: string): string {
  let hash = 2_166_136_261;
  for (const character of serialized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `local-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

// Atomic Design: organism — a bounded local import workflow and its truth state.
export function FigmaImportDialog({
  onClose,
  onImport,
}: FigmaImportDialogProps) {
  const [mode, setMode] = useState<ImportMode>("url");
  const [url, setUrl] = useState("");
  const [json, setJson] = useState("");
  const [message, setMessage] = useState<{
    readonly kind: "error" | "status";
    readonly text: string;
  }>();
  const tabs = useMemo(
    () =>
      [
        { id: "url" as const, label: "Figma URL" },
        { id: "json" as const, label: "Local JSON export" },
      ] as const,
    [],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    globalThis.addEventListener("keydown", handleKeyDown);
    return () => globalThis.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function checkUrl() {
    try {
      const preparation = prepareFigmaUrlImport(url.trim());
      setMessage({ kind: "status", text: preparation.message });
    } catch (error) {
      setMessage({
        kind: "error",
        text: error instanceof Error ? error.message : "The Figma URL is invalid.",
      });
    }
  }

  function importJson() {
    try {
      const result = normalizeFigmaJsonExport(json, {
        fileKey: localFileKey(json),
      });
      onImport(result);
    } catch (error) {
      setMessage({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : "The Figma JSON export could not be imported.",
      });
    }
  }

  async function readFile(file: File | undefined) {
    if (file === undefined) {
      return;
    }
    try {
      setJson(await file.text());
      setMessage(undefined);
    } catch {
      setMessage({
        kind: "error",
        text: "The selected Figma JSON export could not be read.",
      });
    }
  }

  return (
    <div className="figma-import-backdrop" onPointerDown={onClose}>
      <section
        aria-labelledby="figma-import-title"
        aria-modal="true"
        className="figma-import-dialog"
        onPointerDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <h2 id="figma-import-title">Import from Figma</h2>
            <p>Use a file link or an offline JSON export.</p>
          </div>
          <button
            aria-label="Close Figma import"
            className="figma-import-dialog__close"
            onClick={onClose}
            type="button"
          >
            <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
              <path d="m7 7 10 10M17 7 7 17" />
            </svg>
          </button>
        </header>

        <div aria-label="Figma import source" className="figma-import-tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={mode === tab.id}
              key={tab.id}
              onClick={() => {
                setMode(tab.id);
                setMessage(undefined);
              }}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <div className="figma-import-dialog__body" key="figma-url-import">
            <label>
              <span>Figma file URL</span>
              <input
                autoFocus
                onChange={(event) => {
                  setUrl(event.target.value);
                  setMessage(undefined);
                }}
                placeholder="https://www.figma.com/design/…"
                type="url"
                value={url}
              />
            </label>
            <p className="figma-import-dialog__hint">
              Memi validates the file identity locally. Live REST import remains
              unavailable until you explicitly configure a Figma token.
            </p>
            <button
              className="figma-import-dialog__primary"
              disabled={url.trim() === ""}
              onClick={checkUrl}
              type="button"
            >
              Check Figma URL
            </button>
          </div>
        ) : (
          <div className="figma-import-dialog__body" key="figma-json-import">
            <label className="figma-import-file">
              <span>Choose JSON file</span>
              <input
                accept=".json,application/json"
                onChange={(event) => void readFile(event.target.files?.[0])}
                type="file"
              />
            </label>
            <label>
              <span>Figma JSON export</span>
              <textarea
                onChange={(event) => {
                  setJson(event.target.value);
                  setMessage(undefined);
                }}
                placeholder="Paste a Figma REST or plugin JSON export"
                rows={8}
                value={json}
              />
            </label>
            <p className="figma-import-dialog__hint">
              Parsed on this device. Pages, frames, components, styles, text,
              and source provenance are preserved without uploading the file.
            </p>
            <button
              className="figma-import-dialog__primary"
              disabled={json.trim() === ""}
              onClick={importJson}
              type="button"
            >
              Import local Figma JSON
            </button>
          </div>
        )}

        {message ? (
          <p
            className={`figma-import-dialog__message figma-import-dialog__message--${message.kind}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        ) : null}
      </section>
    </div>
  );
}
