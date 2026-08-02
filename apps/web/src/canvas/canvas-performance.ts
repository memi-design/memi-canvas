export type FrameStateUpdate<State> =
  | State
  | ((current: State) => State);

export interface FrameStateScheduler<State> {
  readonly cancel: () => void;
  readonly flush: () => void;
  readonly schedule: (update: FrameStateUpdate<State>) => void;
}

interface FrameSchedulerOptions {
  readonly requestFrame?:
    | ((callback: FrameRequestCallback) => number)
    | undefined;
  readonly cancelFrame?: ((frameId: number) => void) | undefined;
}

function updater<State>(
  update: FrameStateUpdate<State>,
): (current: State) => State {
  return typeof update === "function"
    ? (update as (current: State) => State)
    : () => update;
}

export function createFrameStateScheduler<State>(
  commit: (update: (current: State) => State) => void,
  options: FrameSchedulerOptions = {},
): FrameStateScheduler<State> {
  const requestFrame =
    "requestFrame" in options
      ? options.requestFrame
      : globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame =
    "cancelFrame" in options
      ? options.cancelFrame
      : globalThis.cancelAnimationFrame?.bind(globalThis);
  let frameId: number | null = null;
  let pending: ((current: State) => State) | null = null;

  const commitPending = () => {
    const next = pending;
    pending = null;
    if (next !== null) {
      commit(next);
    }
  };
  const flushFrame = () => {
    frameId = null;
    commitPending();
  };

  return {
    cancel() {
      if (frameId !== null) {
        cancelFrame?.(frameId);
      }
      frameId = null;
      pending = null;
    },
    flush() {
      if (frameId !== null) {
        cancelFrame?.(frameId);
      }
      frameId = null;
      commitPending();
    },
    schedule(update) {
      const next = updater(update);
      const previous = pending;
      pending =
        previous === null
          ? next
          : (current) => next(previous(current));

      if (requestFrame === undefined) {
        flushFrame();
        return;
      }
      if (frameId !== null) {
        return;
      }
      try {
        frameId = requestFrame(flushFrame);
      } catch {
        flushFrame();
      }
    },
  };
}

export interface ViewportProjection {
  readonly height: number;
  readonly translationX: number;
  readonly translationY: number;
  readonly width: number;
  readonly zoom: number;
}

export interface ProjectionBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

interface ProjectionOptions {
  readonly overscan?: number;
  readonly pinnedIds?: readonly string[];
}

function isVisible(
  bounds: ProjectionBounds,
  viewport: ViewportProjection,
  overscan: number,
): boolean {
  const left = viewport.translationX + bounds.x * viewport.zoom;
  const top = viewport.translationY + bounds.y * viewport.zoom;
  const right = left + bounds.width * viewport.zoom;
  const bottom = top + bounds.height * viewport.zoom;
  return (
    right >= -overscan &&
    bottom >= -overscan &&
    left <= viewport.width + overscan &&
    top <= viewport.height + overscan
  );
}

export function projectVisibleItems<Item extends { readonly id: string }>(
  items: readonly Item[],
  boundsFor: (item: Item) => ProjectionBounds | undefined,
  viewport: ViewportProjection,
  options: ProjectionOptions = {},
): readonly Item[] {
  const overscan = Math.max(0, options.overscan ?? 128);
  const pinnedIds = new Set(options.pinnedIds ?? []);
  return items.filter((item) => {
    if (pinnedIds.has(item.id)) {
      return true;
    }
    const bounds = boundsFor(item);
    return bounds !== undefined && isVisible(bounds, viewport, overscan);
  });
}
