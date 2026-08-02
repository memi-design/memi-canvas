import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  acquireRuntimeLease,
  monitorParentProcess,
  optionalParentPid,
} from "./runtime-lease.js";

const directories: string[] = [];

async function appData(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "memi-runtime-lease-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("runtime sidecar lease", () => {
  it("exclusively claims and releases the private runtime lease", async () => {
    const root = await appData();
    const first = await acquireRuntimeLease({ appData: root, pid: 101, nonce: "a".repeat(32) });
    await expect(acquireRuntimeLease({ appData: root, pid: 102, nonce: "b".repeat(32), processExists: () => true })).rejects.toThrow("already active");
    expect(JSON.parse(await readFile(first.path, "utf8"))).toMatchObject({ pid: 101 });
    await first.release();
    await expect(readFile(first.path, "utf8")).rejects.toThrow();
  });

  it("reclaims only a dead, valid prior lease", async () => {
    const root = await appData();
    const stale = await acquireRuntimeLease({ appData: root, pid: 101, nonce: "a".repeat(32) });
    const next = await acquireRuntimeLease({ appData: root, pid: 102, nonce: "b".repeat(32), processExists: (pid) => pid === 102 });
    expect(JSON.parse(await readFile(next.path, "utf8"))).toMatchObject({ pid: 102 });
    await stale.release();
    expect(await readFile(next.path, "utf8")).toContain("102");
    await next.release();
  });

  it("stops the sidecar when its declared parent exits", () => {
    const callbacks: (() => void)[] = [];
    const clear = vi.fn();
    const onParentExit = vi.fn();
    const stop = monitorParentProcess({
      parentPid: 321,
      processExists: () => false,
      onParentExit,
      setInterval: (callback) => { callbacks.push(callback); return 7; },
      clearInterval: clear,
    });
    callbacks[0]!();
    expect(onParentExit).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledWith(7);
    stop();
    expect(clear).toHaveBeenCalledOnce();
  });

  it("accepts only a bounded positive parent pid", () => {
    expect(optionalParentPid("42")).toBe(42);
    expect(optionalParentPid("0")).toBeNull();
    expect(optionalParentPid("42\n")).toBeNull();
  });
});
