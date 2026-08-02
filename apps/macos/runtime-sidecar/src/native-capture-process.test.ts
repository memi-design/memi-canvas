import { EventEmitter } from "node:events";
import { spawn as nodeSpawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import type { ProcessExecutionPolicy } from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import { hashExecutable } from "./native-capture-evidence.js";
import {
  boundedFailureEvidence,
  createNodeWorkerNativeBuildCommandPort,
  createDirectSimulatorCommandPort,
  defaultNativeDependencies,
  NODE_NATIVE_BUILD_WORKER,
  type NativeCaptureSpawn,
  type NativeProcessBroker,
  SANDBOX_EXECUTABLE,
} from "./native-capture-process.js";

async function executable(path: string): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function spawnFixture(): NativeCaptureSpawn {
  return vi.fn((_, __, ___) => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.pid = 4_242;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    queueMicrotask(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("exit", 0, null);
    });
    return child;
  });
}

describe("direct simulator command port", () => {
  it("owns the complete native-build process group so cancellation cannot orphan Xcode scripts", () => {
    expect(NODE_NATIVE_BUILD_WORKER).toContain("detached: true");
    expect(NODE_NATIVE_BUILD_WORKER).toContain("process.kill(-child.pid, signal)");
  });

  it("retains an actionable CocoaPods diagnostic when a verbose stack trace follows it", () => {
    const evidence = boundedFailureEvidence(
      [Buffer.from("Downloading dependencies\n[!] There were changes to the podfile in deployment mode:\nR expo-dev-client\n")],
      [Buffer.from(`pod stack trace\n${"stack line\n".repeat(2_000)}`)],
    );

    expect(evidence).toContain("There were changes to the podfile in deployment mode");
    expect(evidence).toContain("R expo-dev-client");
    expect(evidence.length).toBeLessThanOrEqual(8_192);
  });

  it("retains the user login session instead of detaching simctl", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-direct-simctl-"));
    const appData = join(parent, "app-data");
    const worktree = join(parent, "worktree");
    const simctl = await executable(join(parent, "tools", "simctl"));
    await Promise.all([mkdir(appData), mkdir(worktree)]);
    const canonicalAppData = await realpath(appData);
    const canonicalWorktree = await realpath(worktree);
    const canonicalSimctl = await realpath(simctl);
    const spawn = spawnFixture();
    const broker: NativeProcessBroker = {
      roots: [canonicalAppData, canonicalWorktree],
      allowedExecutables: new Set([canonicalSimctl]),
      executableHashes: {
        [canonicalSimctl]: await hashExecutable(canonicalSimctl),
      },
      sandboxExecutable: SANDBOX_EXECUTABLE,
      dependencies: {
        spawn,
        kill: vi.fn(),
        setTimer: vi.fn(() => 1),
        clearTimer: vi.fn(),
      },
      maximumOutputBytes: 1024,
      terminationGraceMs: 0,
    };
    const policy: ProcessExecutionPolicy = {
      allowedCommands: [{
        executable: canonicalSimctl,
        arguments: [
          { kind: "literal", value: "openurl" },
          { kind: "literal", value: "DEVICE" },
          { kind: "literal", value: "buzzr://open" },
        ],
      }],
      allowedCwdRoots: [canonicalAppData, canonicalWorktree],
      sandboxEnvironment: {
        home: homedir(),
        temporaryDirectory: join(canonicalAppData, "tmp"),
        path: "",
      },
      sandbox: {
        executable: SANDBOX_EXECUTABLE,
        allowedReadRoots: [canonicalAppData, canonicalWorktree, homedir(), "/System", "/usr"],
        allowedWriteRoots: [canonicalAppData, homedir()],
        allowHostHome: true,
        network: "none",
      },
    };

    await expect(
      createDirectSimulatorCommandPort(broker).execute(
        {
          executable: canonicalSimctl,
          args: ["openurl", "DEVICE", "buzzr://open"],
          cwd: canonicalWorktree,
        },
        policy,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ stdout: new Uint8Array(), stderr: "" });

    expect(spawn).toHaveBeenCalledWith(
      canonicalSimctl,
      ["openurl", "DEVICE", "buzzr://open"],
      expect.objectContaining({ detached: false, shell: false }),
    );
  });

  it("offloads an approved Xcode build through the trusted Node worker", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-"));
    const appData = join(parent, "app-data");
    const worktree = join(parent, "worktree");
    const node = await executable(join(parent, "tools", "node"));
    const xcodebuild = await executable(join(parent, "tools", "xcodebuild"));
    await Promise.all([mkdir(appData), mkdir(worktree)]);
    const canonicalAppData = await realpath(appData);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(node);
    const canonicalXcodebuild = await realpath(xcodebuild);
    const spawn = spawnFixture();
    const broker: NativeProcessBroker = {
      roots: [canonicalAppData, canonicalWorktree],
      allowedExecutables: new Set([canonicalNode, canonicalXcodebuild]),
      executableHashes: {
        [canonicalNode]: await hashExecutable(canonicalNode),
        [canonicalXcodebuild]: await hashExecutable(canonicalXcodebuild),
      },
      sandboxExecutable: SANDBOX_EXECUTABLE,
      dependencies: {
        spawn,
        kill: vi.fn(),
        setTimer: vi.fn(() => 1),
        clearTimer: vi.fn(),
      },
      maximumOutputBytes: 1024,
      terminationGraceMs: 0,
    };
    const policy: ProcessExecutionPolicy = {
      allowedCommands: [{
        executable: canonicalXcodebuild,
        arguments: [{ kind: "literal", value: "-version" }],
      }],
      allowedCwdRoots: [canonicalAppData, canonicalWorktree],
      sandboxEnvironment: {
        home: homedir(),
        temporaryDirectory: join(canonicalAppData, "tmp"),
        path: "",
      },
      sandbox: {
        executable: SANDBOX_EXECUTABLE,
        allowedReadRoots: [canonicalAppData, canonicalWorktree, homedir(), "/System", "/usr"],
        allowedWriteRoots: [canonicalAppData, homedir()],
        allowHostHome: true,
        network: "none",
      },
    };

    await expect(
      createNodeWorkerNativeBuildCommandPort(broker, {
        nodeExecutable: canonicalNode,
        nativeBuildExecutable: canonicalXcodebuild,
      }).execute(
        {
          executable: canonicalXcodebuild,
          args: ["-version"],
          cwd: canonicalWorktree,
        },
        policy,
        new AbortController().signal,
      ),
    ).resolves.toEqual({ stdout: new Uint8Array(), stderr: "" });

    const call = vi.mocked(spawn).mock.calls[0]!;
    expect(call[0]).toBe(canonicalNode);
    expect(call[1].slice(0, 3)).toEqual(["--input-type=module", "-e", expect.any(String)]);
    expect(call[2]).toEqual(expect.objectContaining({ detached: false, shell: false }));
    const encodedRecipe = call[1][3]!;
    expect(JSON.parse(Buffer.from(encodedRecipe, "base64url").toString("utf8"))).toEqual({
      executable: canonicalXcodebuild,
      args: ["-version"],
      cwd: canonicalWorktree,
      environment: expect.objectContaining({ HOME: homedir() }),
    });
  });

  it("executes the validated build inside Node and forwards its output", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-live-"));
    const appData = join(parent, "app-data");
    const worktree = join(parent, "worktree");
    await Promise.all([mkdir(appData), mkdir(worktree)]);
    const canonicalAppData = await realpath(appData);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(process.execPath);
    const outputScript = "process.stdout.write('node-worker-build\\n')";
    const broker: NativeProcessBroker = {
      roots: [canonicalAppData, canonicalWorktree],
      allowedExecutables: new Set([canonicalNode]),
      executableHashes: {
        [canonicalNode]: await hashExecutable(canonicalNode),
      },
      sandboxExecutable: SANDBOX_EXECUTABLE,
      dependencies: defaultNativeDependencies,
      maximumOutputBytes: 1024,
      terminationGraceMs: 500,
    };
    const policy: ProcessExecutionPolicy = {
      allowedCommands: [{
        executable: canonicalNode,
        arguments: [
          { kind: "literal", value: "-e" },
          { kind: "literal", value: outputScript },
        ],
      }],
      allowedCwdRoots: [canonicalAppData, canonicalWorktree],
      sandboxEnvironment: {
        home: homedir(),
        temporaryDirectory: join(canonicalAppData, "tmp"),
        path: "",
      },
      sandbox: {
        executable: SANDBOX_EXECUTABLE,
        allowedReadRoots: [canonicalAppData, canonicalWorktree, homedir(), "/System", "/usr"],
        allowedWriteRoots: [canonicalAppData, homedir()],
        allowHostHome: true,
        network: "none",
      },
    };

    const result = await createNodeWorkerNativeBuildCommandPort(broker, {
      nodeExecutable: canonicalNode,
      nativeBuildExecutable: canonicalNode,
    }).execute(
      {
        executable: canonicalNode,
        args: ["-e", outputScript],
        cwd: canonicalWorktree,
      },
      policy,
      new AbortController().signal,
    );

    expect(new TextDecoder().decode(result.stdout)).toBe("node-worker-build\n");
    expect(result.stderr).toBe("");
  });

  it("drains verbose native-build output when the outer worker output is not read", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-drain-"));
    const worktree = join(parent, "worktree");
    const temporaryDirectory = join(parent, "tmp");
    await Promise.all([mkdir(worktree), mkdir(temporaryDirectory)]);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(process.execPath);
    const encodedRecipe = Buffer.from(JSON.stringify({
      executable: canonicalNode,
      args: ["-e", "process.stdout.write('x'.repeat(512 * 1024));"],
      cwd: canonicalWorktree,
      environment: {
        HOME: homedir(),
        PATH: process.env.PATH ?? "",
        TMPDIR: temporaryDirectory,
      },
    }), "utf8").toString("base64url");
    const worker = nodeSpawn(canonicalNode, [
      "--input-type=module",
      "-e",
      NODE_NATIVE_BUILD_WORKER,
      encodedRecipe,
    ], {
      cwd: canonicalWorktree,
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const outcome = await Promise.race([
        new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolvePromise) => {
          worker.once("exit", (code, signal) => resolvePromise({ code, signal }));
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("Worker output blocked the native build.")), 2_000);
        }),
      ]);

      expect(outcome).toEqual({ code: 0, signal: null });
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
      }
    }
  });

  it("retains complete Xcode build-settings output instead of only its diagnostics tail", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-settings-"));
    const worktree = join(parent, "worktree");
    const temporaryDirectory = join(parent, "tmp");
    await Promise.all([mkdir(worktree), mkdir(temporaryDirectory)]);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(process.execPath);
    const encodedRecipe = Buffer.from(JSON.stringify({
      executable: canonicalNode,
      args: [
        "-e",
        [
          "process.stdout.write('PODS_XCFRAMEWORKS_BUILD_DIR = /tmp/memi/XCFrameworkIntermediates\\n');",
          "process.stdout.write('x'.repeat(32 * 1024));",
        ].join(""),
        "--",
        "-showBuildSettings",
      ],
      cwd: canonicalWorktree,
      environment: {
        HOME: homedir(),
        PATH: process.env.PATH ?? "",
        TMPDIR: temporaryDirectory,
      },
    }), "utf8").toString("base64url");
    const worker = nodeSpawn(canonicalNode, [
      "--input-type=module",
      "-e",
      NODE_NATIVE_BUILD_WORKER,
      encodedRecipe,
    ], {
      cwd: canonicalWorktree,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    worker.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    try {
      await expect(new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolvePromise) => {
        worker.once("exit", (code, signal) => resolvePromise({ code, signal }));
      })).resolves.toEqual({ code: 0, signal: null });
      expect(stdout).toContain(
        "PODS_XCFRAMEWORKS_BUILD_DIR = /tmp/memi/XCFrameworkIntermediates",
      );
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
      }
    }
  });

  it("uses a managed temporary transcript instead of an Xcode output pipe", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-log-"));
    const worktree = join(parent, "worktree");
    const temporaryDirectory = join(parent, "tmp");
    await Promise.all([mkdir(worktree), mkdir(temporaryDirectory)]);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(process.execPath);
    const encodedRecipe = Buffer.from(JSON.stringify({
      executable: canonicalNode,
      args: ["-e", "setTimeout(() => process.stdout.write('native-build-transcript\\n'.repeat(8192)), 150);"],
      cwd: canonicalWorktree,
      environment: {
        HOME: homedir(),
        PATH: process.env.PATH ?? "",
        TMPDIR: temporaryDirectory,
      },
    }), "utf8").toString("base64url");
    const worker = nodeSpawn(canonicalNode, [
      "--input-type=module",
      "-e",
      NODE_NATIVE_BUILD_WORKER,
      encodedRecipe,
    ], {
      cwd: canonicalWorktree,
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const diagnostics = join(temporaryDirectory, "memi-native-build-diagnostics");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const entries = await readdir(diagnostics).catch(() => [] as string[]);
        if (entries.some((entry) => entry.startsWith("native-build-"))) break;
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
      }
      await expect(readdir(diagnostics)).resolves.toEqual(
        expect.arrayContaining([expect.stringMatching(/^native-build-/u)]),
      );
      await expect(new Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>((resolvePromise) => {
        worker.once("exit", (code, signal) => resolvePromise({ code, signal }));
      })).resolves.toEqual({ code: 0, signal: null });
      await expect(readdir(diagnostics)).resolves.toEqual([]);
    } finally {
      if (worker.exitCode === null && worker.signalCode === null) {
        worker.kill("SIGKILL");
      }
    }
  });

  it("cleans up an uncooperative native build before the outer cancellation deadline", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-cancel-"));
    const appData = join(parent, "app-data");
    const worktree = join(parent, "worktree");
    await Promise.all([mkdir(appData), mkdir(worktree)]);
    const canonicalAppData = await realpath(appData);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(process.execPath);
    const stubbornBuild = [
      "process.on('SIGTERM', () => undefined);",
      "setTimeout(() => process.exit(0), 2500);",
    ].join("");
    const broker: NativeProcessBroker = {
      roots: [canonicalAppData, canonicalWorktree],
      allowedExecutables: new Set([canonicalNode]),
      executableHashes: {
        [canonicalNode]: await hashExecutable(canonicalNode),
      },
      sandboxExecutable: SANDBOX_EXECUTABLE,
      dependencies: defaultNativeDependencies,
      maximumOutputBytes: 1024,
      terminationGraceMs: 2_000,
    };
    const policy: ProcessExecutionPolicy = {
      allowedCommands: [{
        executable: canonicalNode,
        arguments: [
          { kind: "literal", value: "-e" },
          { kind: "literal", value: stubbornBuild },
        ],
      }],
      allowedCwdRoots: [canonicalAppData, canonicalWorktree],
      sandboxEnvironment: {
        home: homedir(),
        temporaryDirectory: join(canonicalAppData, "tmp"),
        path: "",
      },
      sandbox: {
        executable: SANDBOX_EXECUTABLE,
        allowedReadRoots: [canonicalAppData, canonicalWorktree, homedir(), "/System", "/usr"],
        allowedWriteRoots: [canonicalAppData, homedir()],
        allowHostHome: true,
        network: "none",
      },
    };
    const controller = new AbortController();
    const startedAt = Date.now();
    const execution = createNodeWorkerNativeBuildCommandPort(broker, {
      nodeExecutable: canonicalNode,
      nativeBuildExecutable: canonicalNode,
    }).execute(
      {
        executable: canonicalNode,
        args: ["-e", stubbornBuild],
        cwd: canonicalWorktree,
      },
      policy,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);

    await expect(execution).rejects.toThrow("Native command was cancelled.");
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it("terminates native-build descendants that escape Xcode's process group", async () => {
    const parent = await mkdtemp(join(tmpdir(), "memi-node-build-worker-descendant-"));
    const appData = join(parent, "app-data");
    const worktree = join(parent, "worktree");
    await Promise.all([mkdir(appData), mkdir(worktree)]);
    const canonicalAppData = await realpath(appData);
    const canonicalWorktree = await realpath(worktree);
    const canonicalNode = await realpath(process.execPath);
    const descendantPidPath = join(canonicalWorktree, "descendant.pid");
    const nestedBuild = [
      "const { spawn } = require('node:child_process');",
      "const { writeFileSync } = require('node:fs');",
      "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { stdio: 'ignore', detached: true });",
      "writeFileSync(process.argv[1], String(child.pid));",
      "setInterval(() => {}, 1000);",
    ].join("");
    const broker: NativeProcessBroker = {
      roots: [canonicalAppData, canonicalWorktree],
      allowedExecutables: new Set([canonicalNode]),
      executableHashes: {
        [canonicalNode]: await hashExecutable(canonicalNode),
      },
      sandboxExecutable: SANDBOX_EXECUTABLE,
      dependencies: defaultNativeDependencies,
      maximumOutputBytes: 1024,
      terminationGraceMs: 2_000,
    };
    const policy: ProcessExecutionPolicy = {
      allowedCommands: [{
        executable: canonicalNode,
        arguments: [
          { kind: "literal", value: "-e" },
          { kind: "literal", value: nestedBuild },
          { kind: "literal", value: descendantPidPath },
        ],
      }],
      allowedCwdRoots: [canonicalAppData, canonicalWorktree],
      sandboxEnvironment: {
        home: homedir(),
        temporaryDirectory: join(canonicalAppData, "tmp"),
        path: "",
      },
      sandbox: {
        executable: SANDBOX_EXECUTABLE,
        allowedReadRoots: [canonicalAppData, canonicalWorktree, homedir(), "/System", "/usr"],
        allowedWriteRoots: [canonicalAppData, homedir()],
        allowHostHome: true,
        network: "none",
      },
    };
    const controller = new AbortController();
    const execution = createNodeWorkerNativeBuildCommandPort(broker, {
      nodeExecutable: canonicalNode,
      nativeBuildExecutable: canonicalNode,
    }).execute(
      {
        executable: canonicalNode,
        args: ["-e", nestedBuild, descendantPidPath],
        cwd: canonicalWorktree,
      },
      policy,
      controller.signal,
    );

    try {
      let descendantPidText: string | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        descendantPidText = await readFile(descendantPidPath, "utf8").catch(() => null);
        if (descendantPidText !== null) break;
        await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 50));
      }
      expect(descendantPidText).not.toBeNull();
      controller.abort();
      await expect(execution).rejects.toThrow("Native command was cancelled.");
      const descendantPid = Number(descendantPidText);
      expect(() => process.kill(descendantPid, 0)).toThrow();
    } finally {
      const descendantPid = Number(await readFile(descendantPidPath, "utf8").catch(() => "0"));
      if (Number.isInteger(descendantPid) && descendantPid > 0) {
        try {
          process.kill(descendantPid, "SIGKILL");
        } catch {
          // The expected path: the worker already tore down its process group.
        }
      }
    }
  });
});
