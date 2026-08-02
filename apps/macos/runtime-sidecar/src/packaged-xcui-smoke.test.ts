import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ContentAddressedArtifactStore } from "@memi/capture-execution";
import { afterAll, describe, expect, it } from "vitest";

import { scenarioFixture } from "../../../../packages/capture-execution/src/test-fixtures.js";
import {
  createNativeCapturePorts,
  type NativeCaptureSpawn,
} from "./native-capture-ports.js";

const shouldRun = process.env.MEMI_XCUI_PACKAGED_SMOKE === "1";
const shouldRunControl =
  process.env.MEMI_XCUI_SMOKE_SKIP_CONTROL !== "1";
const simulatorId = process.env.MEMI_XCUI_SMOKE_SIMULATOR_ID ?? "";
const bundleRoot = resolve(
  process.env.MEMI_XCUI_SMOKE_APP_BUNDLE ??
    "apps/macos/src-tauri/target/debug/bundle/macos/Memi Canvas.app",
);
const helperPath = join(
  bundleRoot,
  "Contents",
  "MacOS",
  "memi-xcui-capture",
);
const runtimePath = join(
  bundleRoot,
  "Contents",
  "MacOS",
  "memi-canvas-runtime",
);
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterAll(async () => {
  if (process.env.MEMI_KEEP_XCUI_SMOKE === "1") {
    process.stderr.write(
      `Preserved XCUITest smoke roots:\n${temporaryRoots.join("\n")}\n`,
    );
    return;
  }
  await Promise.all(
    temporaryRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.runIf(shouldRun).sequential("packaged Memi XCUITest helper", () => {
  it.runIf(shouldRunControl)(
    "runs the packaged helper as an unsandboxed control",
    async () => {
      expect(simulatorId).toMatch(/^[A-F0-9-]{36}$/u);
      await access(helperPath);
      const root = await mkdtemp(join(tmpdir(), "memi-xcui-control-"));
      temporaryRoots.push(root);
      const scenarioPath = join(root, "scenario.json");
      const outputPath = join(root, "evidence.json");
      await writeFile(
        scenarioPath,
        JSON.stringify({
          deviceId: simulatorId,
          bundleId: "design.memi.canvas.capturehost",
          launchId: "packaged-xcui-control",
          scenario: {
            ...scenarioFixture,
            applicationId: "packaged-smoke",
            route: "/packaged-xcui-control",
            state: "Unsandboxed control",
            readinessSelector: null,
            sourceAnchor: null,
          },
        }),
        { mode: 0o600 },
      );

      await execFileAsync(
        helperPath,
        [
          "--device",
          simulatorId,
          "--bundle-id",
          "design.memi.canvas.capturehost",
          "--scenario",
          scenarioPath,
          "--output",
          outputPath,
        ],
        { cwd: root, timeout: 240_000 },
      );
      await access(outputPath);
    },
    240_000,
  );

  it(
    "crosses the production sandbox into CoreSimulator and XCTest",
    async () => {
      expect(
        simulatorId,
        "Set MEMI_XCUI_SMOKE_SIMULATOR_ID to a booted iOS simulator UDID.",
      ).toMatch(/^[A-F0-9-]{36}$/u);
      await Promise.all([access(helperPath), access(runtimePath)]);

      const root = await mkdtemp(join(tmpdir(), "memi-xcui-smoke-"));
      temporaryRoots.push(root);
      const appDataRoot = join(root, "app-data");
      const managedWorktreeRoot = join(root, "worktree");
      await Promise.all([
        mkdir(appDataRoot, { recursive: true }),
        mkdir(managedWorktreeRoot, { recursive: true }),
      ]);
      const ports = await createNativeCapturePorts({
        appDataRoot: await realpath(appDataRoot),
        managedWorktreeRoot: await realpath(managedWorktreeRoot),
        runtimeExecutablePath: await realpath(runtimePath),
        artifactStore: new ContentAddressedArtifactStore(
          join(appDataRoot, "artifacts"),
        ),
        dependencies: {
          spawn: (executable, args, options) => {
            if (
              process.env.MEMI_XCUI_TRACE_PROFILE === "1" &&
              executable === "/usr/bin/sandbox-exec"
            ) {
              process.stderr.write(`Memi XCUITest sandbox profile:\n${
                args[1] ?? ""
              }\n`);
            }
            const child = spawn(executable, [...args], options);
            child.stderr?.on("data", (chunk: Buffer) => {
              process.stderr.write(chunk);
            });
            return child as ReturnType<NativeCaptureSpawn>;
          },
        },
      });

      expect(ports.executables.xcuiRunner).toBe(await realpath(helperPath));
      const evidence = await ports.createXcuiTestPort().runScenario(
        {
          deviceId: simulatorId,
          bundleId: "design.memi.canvas.capturehost",
          launchId: "packaged-xcui-smoke",
          scenario: {
            ...scenarioFixture,
            applicationId: "packaged-smoke",
            route: "/packaged-xcui-smoke",
            state: "Sandbox boundary",
            readinessSelector: null,
            sourceAnchor: null,
          },
        },
        new AbortController().signal,
      );

      expect(evidence.hierarchy.byteLength).toBeGreaterThan(0);
      expect(evidence.geometry.byteLength).toBeGreaterThan(0);
      expect(evidence.sourceAnchor).toBeNull();
    },
    240_000,
  );
});
