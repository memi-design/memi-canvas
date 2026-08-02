import { describe, expect, it, vi } from "vitest";

import {
  createFrameStateScheduler,
  projectVisibleItems,
  type ViewportProjection,
} from "./canvas-performance.js";

describe("canvas performance scheduling", () => {
  it("coalesces functional state updates into one frame without dropping input", () => {
    let state = { x: 0 };
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const commit = vi.fn(
      (update: (current: typeof state) => typeof state) => {
        state = update(state);
      },
    );
    const scheduler = createFrameStateScheduler(commit, {
      requestFrame,
      cancelFrame: vi.fn(),
    });

    scheduler.schedule((current) => ({ x: current.x + 4 }));
    scheduler.schedule((current) => ({ x: current.x + 7 }));
    scheduler.schedule({ x: 20 });

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();

    frames[0]?.(16);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ x: 20 });
  });

  it("commits synchronously when animation frames are unavailable", () => {
    let state = 1;
    const commit = vi.fn((update: (current: number) => number) => {
      state = update(state);
    });
    const scheduler = createFrameStateScheduler(commit, {
      requestFrame: undefined,
      cancelFrame: undefined,
    });

    scheduler.schedule((current) => current + 2);
    scheduler.schedule((current) => current * 3);

    expect(commit).toHaveBeenCalledTimes(2);
    expect(state).toBe(9);
  });

  it("cancels pending work so stale input cannot commit later", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const cancelFrame = vi.fn((frameId: number) => {
      frames.delete(frameId);
    });
    const commit = vi.fn();
    const scheduler = createFrameStateScheduler<number>(commit, {
      requestFrame(callback) {
        frames.set(1, callback);
        return 1;
      },
      cancelFrame,
    });

    scheduler.schedule(2);
    scheduler.cancel();

    expect(cancelFrame).toHaveBeenCalledWith(1);
    expect(frames.size).toBe(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it("flushes pending work before a new gesture can capture stale state", () => {
    let state = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    const scheduler = createFrameStateScheduler<number>(
      (update) => {
        state = update(state);
      },
      {
        requestFrame(callback) {
          callbacks.set(1, callback);
          return 1;
        },
        cancelFrame(frameId) {
          callbacks.delete(frameId);
        },
      },
    );

    scheduler.schedule((current) => current + 5);
    scheduler.flush();
    scheduler.schedule((current) => current + 7);
    scheduler.flush();

    expect(state).toBe(12);
    expect(callbacks.size).toBe(0);
  });
});

describe("canvas viewport projection", () => {
  const viewport: ViewportProjection = {
    height: 600,
    translationX: 0,
    translationY: 0,
    width: 900,
    zoom: 1,
  };

  it("returns an immutable projection with overscan and pinned items", () => {
    const items = [
      {
        id: "visible",
        position: { x: 100, y: 100 },
        size: { height: 80, width: 120 },
      },
      {
        id: "overscan",
        position: { x: 940, y: 100 },
        size: { height: 40, width: 40 },
      },
      {
        id: "offscreen",
        position: { x: 2_000, y: 2_000 },
        size: { height: 80, width: 120 },
      },
      {
        id: "pinned",
        position: { x: 3_000, y: 3_000 },
        size: { height: 80, width: 120 },
      },
    ] as const;

    const projected = projectVisibleItems(
      items,
      (item) => ({
        height: item.size.height,
        width: item.size.width,
        x: item.position.x,
        y: item.position.y,
      }),
      viewport,
      {
        overscan: 64,
        pinnedIds: ["pinned"],
      },
    );

    expect(projected.map((item) => item.id)).toEqual([
      "visible",
      "overscan",
      "pinned",
    ]);
    expect(projected).not.toBe(items);
    expect(items).toHaveLength(4);
  });

  it("keeps connector-like bounds that cross the viewport", () => {
    const connectors = [
      { id: "crossing", x1: -500, x2: 1_500, y1: 300, y2: 300 },
      { id: "offscreen", x1: 2_000, x2: 2_500, y1: 900, y2: 900 },
    ] as const;

    const projected = projectVisibleItems(
      connectors,
      (connector) => ({
        height: Math.abs(connector.y2 - connector.y1),
        width: Math.abs(connector.x2 - connector.x1),
        x: Math.min(connector.x1, connector.x2),
        y: Math.min(connector.y1, connector.y2),
      }),
      viewport,
    );

    expect(projected.map((connector) => connector.id)).toEqual(["crossing"]);
  });
});
