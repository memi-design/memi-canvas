import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ContentAddressedArtifactStore,
  type ProcessExecutionPolicy,
  type ProcessRecipe,
} from "@memi/capture-execution";
import { describe, expect, it, vi } from "vitest";

import {
  createNativeCapturePorts,
  type NativeCaptureSpawn,
  type NativeCaptureToolExecutables,
} from "./native-capture-ports.js";

async function executable(
  path: string,
  body = "#!/bin/sh\nexit 0\n",
): Promise<string> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, body, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function spawnFixture(): NativeCaptureSpawn {
  return vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      stdout: PassThrough;
      stderr: PassThrough;
    };
    child.pid = 7_777;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setTimeout(() => {
      child.stdout.end();
      child.stderr.end();
      child.emit("exit", 0, null);
    }, 0);
    return child;
  });
}

async function authorityFixture() {
  const parent = await mkdtemp(join(tmpdir(), "memi-tool-authority-"));
  const appDataRoot = join(parent, "app-data");
  const managedWorktreeRoot = join(parent, "worktree");
  await mkdir(appDataRoot);
  await mkdir(managedWorktreeRoot);
  const toolsRoot = join(appDataRoot, "tools");
  const tools: NativeCaptureToolExecutables = {
    node: await executable(join(toolsRoot, "node")),
    cmake: await executable(join(toolsRoot, "cmake")),
    xcrun: await executable(join(toolsRoot, "xcrun")),
    simctl: await executable(join(toolsRoot, "simctl")),
    xcodebuild: await executable(join(toolsRoot, "xcodebuild")),
    maestro: await executable(join(toolsRoot, "maestro")),
    npm: await executable(join(toolsRoot, "npm")),
    npx: await executable(join(toolsRoot, "npx")),
    pod: await executable(join(toolsRoot, "pod")),
    xcuiRunner: await executable(join(toolsRoot, "memi-xcui-capture")),
  };
  const artifactStore = new ContentAddressedArtifactStore(
    join(appDataRoot, "artifacts"),
  );
  const spawn = spawnFixture();
  const testBrowserLauncher = {
    launch: vi.fn(async () => ({}) as never),
  };
  const createPorts = () =>
    createNativeCapturePorts({
      appDataRoot,
      managedWorktreeRoot,
      artifactStore,
      toolExecutables: tools,
      dependencies: {
        spawn,
        kill: vi.fn(),
        setTimer: () => 1,
        clearTimer: vi.fn(),
      },
      testBrowserLauncher,
    });
  return {
    appDataRoot,
    artifactStore,
    createPorts,
    managedWorktreeRoot,
    spawn,
    tools,
  };
}

function sandboxedRecipe(
  cwd: string,
  executable: string,
): ProcessRecipe {
  return {
    executable: "/usr/bin/sandbox-exec",
    args: ["-p", "(version 1)\n(deny default)", executable],
    cwd,
  };
}

function processPolicy(
  root: string,
  executable: string,
): ProcessExecutionPolicy {
  return {
    allowedCommands: [{
      executable,
      arguments: [{ kind: "literal", value: "run" }],
    }],
    allowedCwdRoots: [root],
    sandboxEnvironment: {
      home: join(root, ".home"),
      temporaryDirectory: join(root, ".tmp"),
      path: "",
    },
    sandbox: {
      executable: "/usr/bin/sandbox-exec",
      allowedReadRoots: [root, "/System", "/usr"],
      allowedWriteRoots: [root],
      network: "loopback",
    },
  };
}

async function approvalFingerprint(
  ports: Awaited<ReturnType<typeof createNativeCapturePorts>>,
  managedWorktreeRoot: string,
): Promise<string> {
  const application = {
    id: "app_react",
    label: "React",
    platform: "react-web" as const,
    relativeRoot: ".",
  };
  const unit = {
    applicationId: "app_react",
    platform: "react-web",
    root: ".",
    displayName: "React",
    status: "supported",
    pipelineStages: [],
    manifestPaths: ["package.json"],
    buildRecipe: {
      executable: "npm",
      args: ["run", "dev"],
      cwd: ".",
      purpose: "launch",
    },
    routes: [],
    scenarios: [],
    cacheKey: `sha256:${"c".repeat(64)}`,
    errors: [],
  } as const;
  const canonicalRoot = await realpath(managedWorktreeRoot);
  const adapter = ports.adapterFor(application, unit, {
    managedRootPath: canonicalRoot,
    applicationRootPath: canonicalRoot,
  });
  if (adapter === null) {
    throw new Error("React adapter was unavailable in test fixture.");
  }
  return (
    await ports.approvalAuthority.describe({
      application,
      unit,
      adapter,
      recipe: unit.buildRecipe,
    })
  ).environmentFingerprint;
}

describe("native capture tool authority", () => {
  it("binds every adapter tool hash into the approval fingerprint", async () => {
    const state = await authorityFixture();
    const first = await state.createPorts();
    const firstFingerprint = await approvalFingerprint(
      first,
      state.managedWorktreeRoot,
    );

    await executable(
      state.tools.maestro,
      "#!/bin/sh\n# changed after first authority\nexit 0\n",
    );
    const second = await state.createPorts();
    const secondFingerprint = await approvalFingerprint(
      second,
      state.managedWorktreeRoot,
    );

    expect(secondFingerprint).not.toBe(firstFingerprint);
  });

  it("rejects a changed native adapter tool immediately before spawn", async () => {
    const state = await authorityFixture();
    const ports = await state.createPorts();
    await executable(
      state.tools.xcrun,
      "#!/bin/sh\n# replaced after approval\nexit 0\n",
    );

    await expect(
      ports.commandPort.execute(
        sandboxedRecipe(
          state.managedWorktreeRoot,
          state.tools.xcrun,
        ),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/executable integrity changed/i);
    expect(state.spawn).not.toHaveBeenCalled();
  });

  it("rejects a changed long-running tool immediately before spawn", async () => {
    const state = await authorityFixture();
    const ports = await state.createPorts();
    await executable(
      state.tools.npm,
      "#!/bin/sh\n# replaced after approval\nexit 0\n",
    );

    expect(() =>
      ports.processStarter.start(
        {
          executable: state.tools.npm,
          args: ["run"],
          cwd: state.managedWorktreeRoot,
        },
        processPolicy(state.managedWorktreeRoot, state.tools.npm),
        new AbortController().signal,
      )).toThrow(/executable integrity changed/i);
    expect(state.spawn).not.toHaveBeenCalled();
  });
});
