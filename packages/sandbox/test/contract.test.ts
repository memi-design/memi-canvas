import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MacOSSandboxExecProvider } from "../src/index";
import {
  createSandboxFixture,
  removeSandboxFixture,
  sandboxRequest,
  type SandboxFixture,
} from "./helpers";

const fixtures: SandboxFixture[] = [];

async function fixture(): Promise<SandboxFixture> {
  const created = await createSandboxFixture();
  fixtures.push(created);
  return created;
}

function providerFor(
  sandboxFixture: SandboxFixture,
  overrides: Partial<ConstructorParameters<typeof MacOSSandboxExecProvider>[0]> =
    {},
): MacOSSandboxExecProvider {
  return new MacOSSandboxExecProvider({
    allowedExecutables: [process.execPath],
    allowedEnvironmentKeys: [],
    authorizedSourceRoots: [sandboxFixture.sourceRoot],
    authorizedWorktreeRoots: [sandboxFixture.worktreeRoot],
    authorizedTempRoots: [sandboxFixture.tempRoot],
    feasibilityMode: true,
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(removeSandboxFixture));
});

describe("macOS sandbox-exec provider contract", () => {
  it("reports the provider as available but not security-ready", async () => {
    const provider = new MacOSSandboxExecProvider({
      allowedExecutables: [process.execPath],
      allowedEnvironmentKeys: ["LANG"],
      authorizedSourceRoots: [],
      authorizedWorktreeRoots: [],
      authorizedTempRoots: [],
    });

    await expect(provider.availability()).resolves.toMatchObject({
      providerId: "macos-sandbox-exec",
      platform: "darwin",
      available: true,
      enforced: false,
      ready: false,
      networkMode: "deny",
    });
  });

  it("requires a live allow/deny canary before reporting enforcement", async () => {
    const provider = new MacOSSandboxExecProvider({
      allowedExecutables: [process.execPath],
      allowedEnvironmentKeys: [],
      authorizedSourceRoots: [],
      authorizedWorktreeRoots: [],
      authorizedTempRoots: [],
      sandboxExecutable: process.execPath,
    });

    await expect(provider.availability()).resolves.toMatchObject({
      available: false,
      enforced: false,
      ready: false,
    });
  });

  it("refuses execution unless explicitly placed in feasibility mode", async () => {
    const testFixture = await fixture();
    const provider = new MacOSSandboxExecProvider({
      allowedExecutables: [process.execPath],
      allowedEnvironmentKeys: [],
      authorizedSourceRoots: [testFixture.sourceRoot],
      authorizedWorktreeRoots: [testFixture.worktreeRoot],
      authorizedTempRoots: [testFixture.tempRoot],
    });

    await expect(
      provider.run(sandboxRequest(testFixture)),
    ).resolves.toMatchObject({
      status: "provider-unavailable",
      reason: "security-gate-failed",
      enforced: false,
    });
  });

  it("refuses unsupported platforms without spawning an unenforced fallback", async () => {
    const provider = new MacOSSandboxExecProvider({
      allowedExecutables: [process.execPath],
      allowedEnvironmentKeys: [],
      authorizedSourceRoots: [],
      authorizedWorktreeRoots: [],
      authorizedTempRoots: [],
      platform: "linux",
    });
    const testFixture = await fixture();

    const result = await provider.run(sandboxRequest(testFixture));

    expect(result).toMatchObject({
      status: "provider-unavailable",
      enforced: false,
      reason: "unsupported-platform",
    });
  });

  it("rejects executables outside the exact canonical allowlist", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture, {
      allowedExecutables: ["/usr/bin/true"],
    });

    const result = await provider.run(sandboxRequest(testFixture));

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "executable-not-allowed",
    });
  });

  it.each(["/bin/sh", "/bin/bash", "/bin/zsh"])(
    "rejects shell interpreter %s even when configuration allowlists it",
    async (shell) => {
      const testFixture = await fixture();
      const provider = providerFor(testFixture, {
        allowedExecutables: [shell],
      });

      const result = await provider.run(
        sandboxRequest(testFixture, {
          executable: shell,
          args: ["-c", "exit 0"],
        }),
      );

      expect(result).toMatchObject({
        status: "denied",
        enforced: true,
        reason: "shell-interpreter-prohibited",
      });
    },
  );

  it("rejects environment keys outside the explicit allowlist", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture, {
      allowedEnvironmentKeys: ["LANG"],
    });

    const result = await provider.run(
      sandboxRequest(testFixture, {
        environment: {
          LANG: "C",
          MEMI_SANDBOX_SECRET: "must-not-enter",
        },
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "environment-key-not-allowed",
    });
  });

  it("rejects a cwd outside the isolated worktree and temp roots", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);

    const result = await provider.run(
      sandboxRequest(testFixture, { cwd: testFixture.sourceRoot }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "cwd-outside-writable-roots",
    });
  });

  it("rejects a root path that is itself a symlink", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const linkedSource = join(testFixture.root, "linked-source");
    await symlink(testFixture.sourceRoot, linkedSource, "dir");

    const result = await provider.run(
      sandboxRequest(testFixture, { sourceRoots: [linkedSource] }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "symlink-root-prohibited",
    });
  });

  it("rejects symlinks in intermediate root path components", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const nestedOutside = join(testFixture.outsideRoot, "nested");
    const linkedOutside = join(testFixture.root, "linked-outside");
    await mkdir(nestedOutside);
    await symlink(testFixture.outsideRoot, linkedOutside, "dir");

    const result = await provider.run(
      sandboxRequest(testFixture, {
        sourceRoots: [join(linkedOutside, "nested")],
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "symlink-root-prohibited",
    });
  });

  it("requires positive time and output bounds", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);

    const result = await provider.run(
      sandboxRequest(testFixture, {
        timeoutMs: 0,
        maxStdoutBytes: 0,
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "invalid-resource-bounds",
    });
  });

  it("rejects oversized arguments and environment values before spawning", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture, {
      allowedEnvironmentKeys: ["CI"],
    });

    await expect(
      provider.run(
        sandboxRequest(testFixture, {
          args: ["x".repeat(16_385)],
        }),
      ),
    ).resolves.toMatchObject({
      status: "denied",
      enforced: true,
      reason: "request-too-large",
    });
    await expect(
      provider.run(
        sandboxRequest(testFixture, {
          environment: { CI: "x".repeat(32_769) },
        }),
      ),
    ).resolves.toMatchObject({
      status: "denied",
      enforced: true,
      reason: "request-too-large",
    });
  });

  it("rejects source roots that are not bound into provider authorization", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);

    const result = await provider.run(
      sandboxRequest(testFixture, {
        sourceRoots: [testFixture.outsideRoot],
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "root-not-authorized",
    });
  });

  it("rejects writable roots that are not bound into provider authorization", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);

    const result = await provider.run(
      sandboxRequest(testFixture, {
        worktreeRoot: testFixture.outsideRoot,
        cwd: testFixture.outsideRoot,
      }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "root-not-authorized",
    });
  });

  it("rejects an executable symlink even when its target is allowlisted", async () => {
    const testFixture = await fixture();
    const provider = providerFor(testFixture);
    const linkedExecutable = join(testFixture.worktreeRoot, "linked-node");
    await symlink(process.execPath, linkedExecutable, "file");

    const result = await provider.run(
      sandboxRequest(testFixture, { executable: linkedExecutable }),
    );

    expect(result).toMatchObject({
      status: "denied",
      enforced: true,
      reason: "executable-symlink-prohibited",
    });
  });
});
