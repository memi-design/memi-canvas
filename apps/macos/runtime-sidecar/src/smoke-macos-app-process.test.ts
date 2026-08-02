import { describe, expect, it } from "vitest";

import {
  findPackagedRuntimeSidecar,
  formatDirectChildDiagnostic,
  macOsProcessListArguments,
  type ProcessRow,
} from "../../../../scripts/smoke-macos-app-process.js";

const appPid = 41;
const runtimeBun =
  "/Users/runner/work/memi-canvas/memi-canvas/apps/macos/src-tauri/target/debug/bundle/macos/Memi Canvas.app/Contents/Resources/runtime/memi-canvas-bun";
const runtimeEntry =
  "/Users/runner/work/memi-canvas/memi-canvas/apps/macos/src-tauri/target/debug/bundle/macos/Memi Canvas.app/Contents/Resources/runtime/memi-canvas-runtime/main.js";

const packagedRuntime = (pid: number, parentPid: number): ProcessRow => ({
  pid,
  parentPid,
  command: `${runtimeBun} ${runtimeEntry}`,
});
const launcherRuntime = (pid: number, parentPid: number): ProcessRow => ({
  pid,
  parentPid,
  command: `${runtimeBun.replace("/Contents/Resources/", "/Contents/MacOS/../Resources/")} ${runtimeEntry.replace("/Contents/Resources/", "/Contents/MacOS/../Resources/")}`,
});

describe("packaged macOS smoke process proof", () => {
  it("requests untruncated BSD ps command output before comparing bundle paths", () => {
    expect(macOsProcessListArguments()).toEqual([
      "-ww",
      "-axo",
      "pid=,ppid=,command=",
    ]);
  });

  it("finds only the direct app child running the bundled runtime", () => {
    const rows: readonly ProcessRow[] = [
      packagedRuntime(42, appPid),
    ];

    expect(findPackagedRuntimeSidecar(rows, appPid, runtimeBun, runtimeEntry)).toEqual(
      packagedRuntime(42, appPid),
    );
  });

  it("accepts only the launcher's known bundle-local lexical resource paths", () => {
    const rows: readonly ProcessRow[] = [launcherRuntime(42, appPid)];

    expect(findPackagedRuntimeSidecar(rows, appPid, runtimeBun, runtimeEntry)).toEqual(
      launcherRuntime(42, appPid),
    );
  });

  it("rejects a wrapper descendant, global Bun, source entry, and unrelated process", () => {
    const rows: readonly ProcessRow[] = [
      { pid: 42, parentPid: appPid, command: `${runtimeBun} /workspace/main.js` },
      { pid: 43, parentPid: appPid, command: `/opt/homebrew/bin/bun ${runtimeEntry}` },
      { pid: 44, parentPid: appPid, command: "/bin/sh bundled-launcher" },
      packagedRuntime(45, 44),
      packagedRuntime(46, 999),
      { pid: 47, parentPid: appPid, command: runtimeBun },
      { pid: 48, parentPid: appPid, command: `${runtimeBun} ${runtimeEntry}.evil` },
      {
        pid: 49,
        parentPid: appPid,
        command: `${runtimeBun.replace("/Contents/Resources/", "/Contents/MacOS/../../Resources/")} ${runtimeEntry.replace("/Contents/Resources/", "/Contents/MacOS/../../Resources/")}`,
      },
    ];

    expect(findPackagedRuntimeSidecar(rows, appPid, runtimeBun, runtimeEntry)).toBeUndefined();
  });

  it("bounds direct-child diagnostics without accepting the child as proof", () => {
    const rows: readonly ProcessRow[] = [
      { pid: 42, parentPid: appPid, command: `/bin/sh ${"x".repeat(2_000)}` },
      packagedRuntime(43, 999),
    ];

    const diagnostic = formatDirectChildDiagnostic(rows, appPid);
    expect(diagnostic).toMatch(/^directChildren=42:\/bin\/sh /u);
    expect(diagnostic.length).toBeLessThanOrEqual(1_015);
  });
});
