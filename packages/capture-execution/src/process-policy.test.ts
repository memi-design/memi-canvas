import { execFile } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import {
  buildSandboxProfile,
  type ProcessExecutionPolicy,
  ProcessGroupRunner,
  validateProcessRecipe,
} from "./process-policy.js";

const execFileAsync = promisify(execFile);

function commandPolicy(
  args: readonly string[],
  root = "/managed",
): ProcessExecutionPolicy {
  return {
    allowedCommands: [
      {
        executable: "/usr/local/bin/npm",
        arguments: args.map((value) => ({ kind: "literal", value })),
      },
    ],
    allowedCwdRoots: [root],
    sandboxEnvironment: {
      home: `${root}/.sandbox-home`,
      temporaryDirectory: `${root}/.sandbox-tmp`,
      path: "",
    },
    sandbox: {
      executable: "/usr/bin/sandbox-exec",
      allowedReadRoots: [root, "/System", "/usr", "/bin"],
      allowedWriteRoots: [
        `${root}/.sandbox-home`,
        `${root}/.sandbox-tmp`,
      ],
      network: "none",
    },
  };
}

describe("process execution policy", () => {
  it("accepts exact executables with argument arrays and contained cwd", () => {
    expect(
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: ["run", "dev", "--", "--port", "4173"],
          cwd: "/managed/project",
        },
        commandPolicy(["run", "dev", "--", "--port", "4173"]),
      ),
    ).toEqual({
      executable: "/usr/local/bin/npm",
      args: ["run", "dev", "--", "--port", "4173"],
      cwd: "/managed/project",
    });
  });

  it("supports bounded integer and safe-token argument rules", () => {
    const policy: ProcessExecutionPolicy = {
      ...commandPolicy([], "/managed"),
      allowedCommands: [
        {
          executable: "/usr/local/bin/npm",
          arguments: [
            { kind: "safe-token" },
            { kind: "integer", minimum: 1_024, maximum: 65_535 },
          ],
        },
      ],
    };
    expect(
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: ["preview", "4173"],
          cwd: "/managed",
        },
        policy,
      ).args,
    ).toEqual(["preview", "4173"]);
    for (const args of [
      ["bad token", "4173"],
      ["preview", "port"],
      ["preview", "80"],
      ["preview", "70000"],
      ["preview"],
    ]) {
      expect(() =>
        validateProcessRecipe(
          {
            executable: "/usr/local/bin/npm",
            args,
            cwd: "/managed",
          },
          policy,
        ),
      ).toThrow(/allowlist/i);
    }
  });

  it("accepts only exact loopback Expo project URLs", () => {
    const targetPolicy: ProcessExecutionPolicy = {
      ...commandPolicy([], "/managed"),
      allowedCommands: [
        {
          executable: "/usr/bin/xcrun",
          arguments: [
            { kind: "literal", value: "simctl" },
            { kind: "literal", value: "openurl" },
            { kind: "safe-token" },
            { kind: "expo-project-url" },
          ],
        },
      ],
    };
    expect(
      validateProcessRecipe(
        {
          executable: "/usr/bin/xcrun",
          args: [
            "simctl",
            "openurl",
            "MEMI-SIMULATOR",
            "exp://127.0.0.1:19000/--/dashboard?tab=following",
          ],
          cwd: "/managed",
        },
        targetPolicy,
      ),
    ).toBeDefined();
    for (const url of [
      "exp://example.com:19000/--/dashboard",
      "https://127.0.0.1:19000/--/dashboard",
      "exp://user:secret@127.0.0.1:19000/--/dashboard",
      "exp://127.0.0.1:19000/--/dashboard#fragment",
      "exp://127.0.0.1:70000/--/dashboard",
    ]) {
      expect(() =>
        validateProcessRecipe(
          {
            executable: "/usr/bin/xcrun",
            args: ["simctl", "openurl", "MEMI-SIMULATOR", url],
            cwd: "/managed",
          },
          targetPolicy,
        ),
      ).toThrow(/allowlist/i);
    }
  });

  it("accepts only a declared development-client wrapper around loopback Metro", () => {
    const targetPolicy: ProcessExecutionPolicy = {
      ...commandPolicy([], "/managed"),
      allowedCommands: [
        {
          executable: "/usr/bin/xcrun",
          arguments: [
            { kind: "literal", value: "simctl" },
            { kind: "literal", value: "openurl" },
            { kind: "safe-token" },
            { kind: "expo-development-client-url", scheme: "example" },
          ],
        },
      ],
    };
    expect(
      validateProcessRecipe(
        {
          executable: "/usr/bin/xcrun",
          args: [
            "simctl",
            "openurl",
            "MEMI-SIMULATOR",
            "example://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A19000%2F--%2Fdashboard",
          ],
          cwd: "/managed",
        },
        targetPolicy,
      ),
    ).toBeDefined();
    for (const url of [
      "example://expo-development-client/?url=https%3A%2F%2Fexample.com",
      "other://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A19000",
      "example://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A70000",
      "example://another-host/?url=http%3A%2F%2F127.0.0.1%3A19000",
    ]) {
      expect(() =>
        validateProcessRecipe(
          {
            executable: "/usr/bin/xcrun",
            args: ["simctl", "openurl", "MEMI-SIMULATOR", url],
            cwd: "/managed",
          },
          targetPolicy,
        ),
      ).toThrow(/allowlist/i);
    }
  });

  it("binds standalone Expo deep links to the discovered application scheme", () => {
    const targetPolicy: ProcessExecutionPolicy = {
      ...commandPolicy([], "/managed"),
      allowedCommands: [
        {
          executable: "/usr/bin/xcrun",
          arguments: [
            { kind: "literal", value: "simctl" },
            { kind: "literal", value: "openurl" },
            { kind: "safe-token" },
            { kind: "expo-standalone-url", scheme: "buzzr" },
          ],
        },
      ],
    };
    expect(
      validateProcessRecipe(
        {
          executable: "/usr/bin/xcrun",
          args: [
            "simctl",
            "openurl",
            "MEMI-SIMULATOR",
            "buzzr:///team/Boston%20Celtics?__memi_capture=01J00000000000000000000000&__memi_state=default",
          ],
          cwd: "/managed",
        },
        targetPolicy,
      ),
    ).toBeDefined();
    for (const url of [
      "other:///team/Boston%20Celtics",
      "buzzr://user:secret@team/path",
      "buzzr:///team/../settings",
      "buzzr:///team/path?token=secret",
      "buzzr:///team/path?__memi_capture=bad&__memi_state=default",
      "buzzr:///team/path#fragment",
    ]) {
      expect(() =>
        validateProcessRecipe(
          {
            executable: "/usr/bin/xcrun",
            args: ["simctl", "openurl", "MEMI-SIMULATOR", url],
            cwd: "/managed",
          },
          targetPolicy,
        ),
      ).toThrow(/allowlist/i);
    }
  });

  it("rejects shell strings, unknown executables, and cwd escapes", () => {
    const policy = commandPolicy(["run", "dev"]);
    expect(() =>
      validateProcessRecipe(
        {
          executable: "/bin/sh",
          args: ["-c", "npm run dev"],
          cwd: "/managed/project",
        },
        policy,
      ),
    ).toThrow(/allowlist/i);
    expect(() =>
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: ["run\u0000dev"],
          cwd: "/managed/project",
        },
        policy,
      ),
    ).toThrow(/allowlist/i);
    expect(() =>
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: ["run", "dev"],
          cwd: "/outside",
        },
        policy,
      ),
    ).toThrow(/working directory/i);
    expect(() =>
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: ["a", "b"],
          cwd: "/managed/project",
        },
        {
          ...commandPolicy(["a", "b"]),
          maximumArguments: 1,
        },
      ),
    ).toThrow(/argument count/i);
  });

  it("preserves a copied environment without exposing mutation", () => {
    const environment = { MEMI_CAPTURE: "1" };
    const recipe = validateProcessRecipe(
      {
        executable: "/usr/local/bin/npm",
        args: [],
        cwd: "/managed",
        environment,
      },
      {
        ...commandPolicy([], "/managed"),
        allowedEnvironmentKeys: ["MEMI_CAPTURE"],
      },
    );
    environment.MEMI_CAPTURE = "changed";
    expect(recipe.environment).toEqual({ MEMI_CAPTURE: "1" });
    expect(Object.isFrozen(recipe.environment)).toBe(true);
    expect(() =>
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: [],
          cwd: "/managed",
          environment: { NODE_OPTIONS: "--require=/tmp/inject.js" },
        },
        commandPolicy([], "/managed"),
      ),
    ).toThrow(/environment/i);
    expect(() =>
      validateProcessRecipe(
        {
          executable: "/usr/local/bin/npm",
          args: [],
          cwd: "/managed",
          environment: { MEMI_CAPTURE: "bad\nvalue" },
        },
        {
          ...commandPolicy([], "/managed"),
          allowedEnvironmentKeys: ["MEMI_CAPTURE"],
        },
      ),
    ).toThrow(/environment/i);
  });

  it("cancels the entire detached process group", async () => {
    const kill = vi.fn();
    const child = {
      pid: 42,
      once: vi.fn(),
      stdout: null,
      stderr: null,
    };
    let capturedOptions: SpawnOptions | undefined;
    const spawn = vi.fn(
      (
        _executable: string,
        _args: readonly string[],
        options: SpawnOptions,
      ) => {
        capturedOptions = options;
        return child;
      },
    );
    const runner = new ProcessGroupRunner({
      spawn,
      kill,
      setTimer: (callback) => {
        callback();
        return 1;
      },
      clearTimer: vi.fn(),
    });
    const controller = new AbortController();

    const runningProcess = runner.start(
      {
        executable: "/usr/local/bin/npm",
        args: ["run", "dev"],
        cwd: "/managed/project",
      },
      commandPolicy(["run", "dev"]),
      controller.signal,
    );
    controller.abort();
    await runningProcess.cancelled;

    expect(spawn).toHaveBeenCalledWith(
      "/usr/bin/sandbox-exec",
      expect.arrayContaining([
        "-p",
        "/usr/local/bin/npm",
        "run",
        "dev",
      ]),
      expect.objectContaining({ shell: false, detached: true }),
    );
    expect(capturedOptions?.env).toMatchObject({
      HOME: "/managed/.sandbox-home",
      TMPDIR: "/managed/.sandbox-tmp",
      PATH: "",
    });
    expect(capturedOptions?.env?.HOME).not.toBe(process.env.HOME);
    expect(capturedOptions?.env?.PATH).not.toBe(process.env.PATH);
    expect(kill).toHaveBeenCalledWith(-42, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-42, "SIGKILL");
  });

  it("fails closed without a PID and handles an already-aborted process", async () => {
    const missingPidRunner = new ProcessGroupRunner({
      spawn: vi.fn(() => ({
        pid: undefined,
        once: vi.fn(),
        stdout: null,
        stderr: null,
      })),
      kill: vi.fn(),
      setTimer: vi.fn(),
      clearTimer: vi.fn(),
    });
    const recipe = {
      executable: "/usr/local/bin/npm",
      args: ["run", "dev"],
      cwd: "/managed/project",
    };
    const policy = commandPolicy(["run", "dev"]);
    expect(() =>
      missingPidRunner.start(
        recipe,
        policy,
        new AbortController().signal,
      ),
    ).toThrow(/PID/u);

    const kill = vi.fn(() => {
      throw new Error("already exited");
    });
    const controller = new AbortController();
    controller.abort();
    const runner = new ProcessGroupRunner({
      spawn: vi.fn(() => ({
        pid: 43,
        once: vi.fn(),
        stdout: null,
        stderr: null,
      })),
      kill,
      setTimer: (callback) => {
        callback();
        return 1;
      },
      clearTimer: vi.fn(),
    });
    const running = runner.start(recipe, policy, controller.signal);
    await running.cancelled;
    running.cancel();
    expect(kill).toHaveBeenCalledTimes(2);
  });

  it("finishes cancellation when the child exits during the grace period", async () => {
    let exit: (() => void) | undefined;
    const clearTimer = vi.fn();
    const runner = new ProcessGroupRunner({
      spawn: vi.fn(() => ({
        pid: 44,
        once: vi.fn((_event: string, callback: (...args: unknown[]) => void) => {
          exit = callback;
        }),
        stdout: null,
        stderr: null,
      })),
      kill: vi.fn(),
      setTimer: vi.fn(() => 2),
      clearTimer,
    });
    const controller = new AbortController();
    const running = runner.start(
      {
        executable: "/usr/local/bin/npm",
        args: [],
        cwd: "/managed",
      },
      commandPolicy([], "/managed"),
      controller.signal,
    );
    controller.abort();
    exit?.();
    await running.cancelled;
    expect(clearTimer).toHaveBeenCalledWith(2);
  });

  it("denies a malicious write outside trusted roots", async () => {
    const managed = await mkdtemp(join(tmpdir(), "memi-sandbox-"));
    const outside = join(
      await mkdtemp(join(tmpdir(), "memi-outside-")),
      "stolen",
    );
    const policy = commandPolicy([], managed);
    await expect(
      execFileAsync("/usr/bin/sandbox-exec", [
        "-p",
        buildSandboxProfile(policy),
        "/usr/bin/touch",
        outside,
      ]),
    ).rejects.toThrow();
    await expect(access(outside)).rejects.toThrow();
  });

  it("generates a macOS-valid loopback-only profile", async () => {
    const managed = await mkdtemp(join(tmpdir(), "memi-sandbox-"));
    const policy = {
      ...commandPolicy([], managed),
      sandbox: {
        ...commandPolicy([], managed).sandbox,
        network: "loopback" as const,
      },
    };
    const profile = buildSandboxProfile(policy);
    expect(profile).toContain('ip "localhost:*"');
    expect(profile).not.toContain('ip "127.0.0.1:*"');
    await expect(
      execFileAsync("/usr/bin/sandbox-exec", [
        "-p",
        profile,
        "/usr/bin/true",
      ]),
    ).resolves.toBeDefined();
  });

  it("grants directory metadata without granting directory contents", () => {
    const policy = commandPolicy([], "/managed");
    const profile = buildSandboxProfile({
      ...policy,
      sandbox: {
        ...policy.sandbox,
        allowedReadMetadataLiterals: ["/Applications"],
      },
    });

    expect(profile).toContain(
      '(allow file-read-metadata (literal "/Applications"))',
    );
    expect(profile).not.toContain(
      '(allow file-read* (literal "/Applications"))',
    );
    expect(profile).not.toContain(
      '(allow file-read* (subpath "/Applications"))',
    );
  });

  it("accepts an exact distributed-notification Mach service name", () => {
    const policy = commandPolicy([], "/managed");
    const profile = buildSandboxProfile({
      ...policy,
      sandbox: {
        ...policy.sandbox,
        allowedMachLookupGlobals: [
          "com.apple.distributed_notifications@Uv3",
        ],
      },
    });

    expect(profile).toContain(
      '(allow mach-lookup (global-name "com.apple.distributed_notifications@Uv3"))',
    );
  });
});
