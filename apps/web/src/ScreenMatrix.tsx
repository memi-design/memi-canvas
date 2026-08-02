import type { KeyboardEvent } from "react";

import {
  type AvailableCapture,
  type BlockedCell,
  type Capture,
  type ProductScreen,
  captureAccessibleName,
  isBlockedCell,
  titleCase,
} from "./model";

function moveMatrixFocus(
  event: KeyboardEvent<HTMLButtonElement>,
): boolean {
  const currentRow = event.currentTarget.closest("tr");
  const body = currentRow?.closest("tbody");
  const rowControls = Array.from(
    currentRow?.querySelectorAll<HTMLButtonElement>(
      "[data-matrix-control]",
    ) ?? [],
  );
  const rows = Array.from(body?.querySelectorAll("tr") ?? []);
  const currentColumnIndex = rowControls.indexOf(event.currentTarget);
  const currentRowIndex = currentRow ? rows.indexOf(currentRow) : -1;
  const lastColumnIndex = rowControls.length - 1;
  let target: HTMLButtonElement | undefined;

  if (event.key === "ArrowRight") {
    target = rowControls[Math.min(currentColumnIndex + 1, lastColumnIndex)];
  } else if (event.key === "ArrowLeft") {
    target = rowControls[Math.max(currentColumnIndex - 1, 0)];
  } else if (event.key === "Home") {
    target = rowControls[0];
  } else if (event.key === "End") {
    target = rowControls[lastColumnIndex];
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const rowDelta = event.key === "ArrowDown" ? 1 : -1;
    const targetRowIndex = Math.min(
      Math.max(currentRowIndex + rowDelta, 0),
      rows.length - 1,
    );
    target = Array.from(
      rows[targetRowIndex]?.querySelectorAll<HTMLButtonElement>(
        "[data-matrix-control]",
      ) ?? [],
    )[currentColumnIndex];
  }

  if (!target) {
    return false;
  }

  event.preventDefault();
  target.focus();
  return true;
}

// Molecule: a matrix control that keeps frame, evidence, and coverage truth
// distinct. Blocked cells are recovery actions and never pretend to be frames.
function CaptureCell({
  capture,
  isSelected,
  screenItem,
  onResolve,
  onSelect,
}: {
  readonly capture: Capture;
  readonly isSelected: boolean;
  readonly screenItem: ProductScreen;
  readonly onResolve: (capture: BlockedCell) => void;
  readonly onSelect: (captureId: string) => void;
}) {
  const blocked = isBlockedCell(capture);

  function activate() {
    if (blocked) {
      onResolve(capture);
    } else {
      onSelect(capture.id);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
      return;
    }

    moveMatrixFocus(event);
  }

  if (blocked) {
    const blocker = capture.blocker ?? "Capture evidence is unavailable";
    const attempted = capture.attemptedEvidence ?? "No evidence recorded";

    return (
      <button
        aria-label={captureAccessibleName(screenItem, capture)}
        className="capture-cell capture-cell--blocked"
        data-matrix-control
        onClick={activate}
        onKeyDown={handleKeyDown}
        type="button"
      >
        <span className="capture-cell__blocked">
          <strong>Blocked</strong>
          <span>{blocker}</span>
          <span>Attempted: {attempted}</span>
          <span className="capture-cell__action">Resolve capture</span>
        </span>
        <span className="capture-cell__meta">
          <strong>{capture.dimensions}</strong>
          <span>Blocked</span>
        </span>
      </button>
    );
  }

  return (
    <button
      aria-label={captureAccessibleName(screenItem, capture)}
      aria-pressed={isSelected}
      className={`capture-cell capture-cell--${capture.coverageHealth}`}
      data-matrix-control
      onClick={activate}
      onKeyDown={handleKeyDown}
      type="button"
    >
      <span aria-hidden="true" className="capture-cell__preview">
        <span className="capture-cell__chrome" />
        <span className="capture-cell__body" />
      </span>
      <span className="capture-cell__meta">
        <strong>{capture.dimensions}</strong>
        <span>
          {titleCase(capture.evidenceLevel)} ·{" "}
          {titleCase(capture.coverageHealth)}
        </span>
      </span>
    </button>
  );
}

// Molecule: a non-spatial path to the same screen selection state.
function ScreenOutline({
  screens,
  onSelect,
}: {
  readonly screens: readonly ProductScreen[];
  readonly onSelect: (captureId: string) => void;
}) {
  return (
    <nav aria-label="Screen outline" className="screen-outline">
      <strong>Outline</strong>
      <ul>
        {screens.flatMap((screenItem) =>
          screenItem.captures
            .filter(
              (capture): capture is AvailableCapture =>
                !isBlockedCell(capture),
            )
            .map((capture) => (
              <li key={`${screenItem.id}:${capture.id}`}>
                <button
                  aria-label={`Outline ${screenItem.name} ${screenItem.state} ${capture.label}`}
                  onClick={() => onSelect(capture.id)}
                  type="button"
                >
                  {screenItem.name} · {screenItem.state} · {capture.label}
                </button>
              </li>
            )),
        )}
      </ul>
    </nav>
  );
}

// Organism: the complete responsive route/state matrix.
export function ScreenMatrix({
  resolutionMessage,
  screens,
  selectedCaptureId,
  onResolve,
  onSelect,
}: {
  readonly resolutionMessage: string | undefined;
  readonly screens: readonly ProductScreen[];
  readonly selectedCaptureId: string;
  readonly onResolve: (capture: BlockedCell) => void;
  readonly onSelect: (captureId: string) => void;
}) {
  return (
    <section aria-labelledby="screen-matrix-title" className="matrix-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Product evidence</p>
          <h2 id="screen-matrix-title">Responsive screen matrix</h2>
        </div>
        <p>Route and state evidence across representative viewports.</p>
      </div>

      <ScreenOutline onSelect={onSelect} screens={screens} />

      {resolutionMessage ? (
        <p
          aria-label="Capture resolution"
          className="resolution-status"
          role="status"
        >
          {resolutionMessage}
        </p>
      ) : null}

      <div className="matrix-scroll">
        <table aria-label="Responsive screen matrix">
          <thead>
            <tr>
              <th scope="col">Screen</th>
              <th scope="col">Desktop</th>
              <th scope="col">Tablet</th>
              <th scope="col">Mobile</th>
            </tr>
          </thead>
          <tbody>
            {screens.map((screenItem) => (
              <tr key={screenItem.id}>
                <th scope="row">
                  <strong>{screenItem.name}</strong>
                  <span>{screenItem.state}</span>
                  <code>{screenItem.route}</code>
                </th>
                {screenItem.captures.map((capture) => (
                  <td key={capture.id}>
                    <CaptureCell
                      capture={capture}
                      isSelected={selectedCaptureId === capture.id}
                      onResolve={onResolve}
                      onSelect={onSelect}
                      screenItem={screenItem}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
