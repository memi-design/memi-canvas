import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  approveNativeDependencyPreparationPlan,
  assertNativeDependencyPreparationApproval,
  createNativeDependencyPreparationPlan,
  type NativeDependencyPreparationPolicy,
} from "./native-dependency-preparation.js";

const POLICY: NativeDependencyPreparationPolicy = {
  contract: "memi.native-dependency-preparation-policy.v1",
  network: "locked-dependency-downloads",
  npmLifecycleScripts: "disabled",
  cocoapodsHooks: "enabled",
  requireLockfiles: true,
  sandboxProfileFingerprint:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

async function makeManagedExpoFixture(): Promise<{
  readonly worktreeRoot: string;
  readonly platformRoot: string;
  readonly nodeExecutable: string;
  readonly npmExecutable: string;
  readonly podExecutable: string;
}> {
  const worktreeRoot = await mkdtemp(
    join(tmpdir(), "memi-native-dependency-plan-"),
  );
  const platformRoot = join(worktreeRoot, "apps", "mobile");
  await mkdir(join(platformRoot, "ios"), { recursive: true });
  await writeFile(
    join(platformRoot, "package.json"),
    JSON.stringify({
      name: "fixture-mobile",
      private: true,
      packageManager: "npm@10.9.2",
    }),
  );
  await writeFile(
    join(platformRoot, "package-lock.json"),
    JSON.stringify({
      name: "fixture-mobile",
      lockfileVersion: 3,
      packages: {},
    }),
  );
  await writeFile(
    join(platformRoot, "ios", "Podfile"),
    "platform :ios, '17.0'\n",
  );
  await writeFile(
    join(platformRoot, "ios", "Podfile.lock"),
    "PODS:\n  - Expo (54.0.0)\n",
  );
  const toolRoot = await mkdtemp(
    join(tmpdir(), "memi-native-dependency-tools-"),
  );
  const nodeExecutable = join(toolRoot, "bin", "node");
  const npmExecutable = join(toolRoot, "bin", "npm");
  const canonicalNpm = join(
    toolRoot,
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  const npmRuntimeModule = join(
    toolRoot,
    "lib",
    "node_modules",
    "npm",
    "lib",
    "cli.js",
  );
  const podExecutable = join(toolRoot, "pod");
  await mkdir(join(toolRoot, "bin"), { recursive: true });
  await mkdir(join(toolRoot, "lib", "node_modules", "npm", "bin"), {
    recursive: true,
  });
  await mkdir(join(toolRoot, "lib", "node_modules", "npm", "lib"), {
    recursive: true,
  });
  await Promise.all([
    writeFile(
      nodeExecutable,
      "#!/bin/sh\nprintf '%s\\n' \"$@\"\n",
    ),
    writeFile(canonicalNpm, "require('../lib/cli.js')\n"),
    writeFile(npmRuntimeModule, "module.exports = () => undefined\n"),
    writeFile(podExecutable, "#!/bin/sh\nexit 0\n"),
  ]);
  await symlink(canonicalNpm, npmExecutable);
  await Promise.all([
    chmod(nodeExecutable, 0o755),
    chmod(canonicalNpm, 0o755),
    chmod(podExecutable, 0o755),
  ]);
  return {
    worktreeRoot,
    platformRoot,
    nodeExecutable,
    npmExecutable,
    podExecutable,
  };
}

function input(
  fixture: Awaited<ReturnType<typeof makeManagedExpoFixture>>,
  overrides: Partial<
    Parameters<typeof createNativeDependencyPreparationPlan>[0]
  > = {},
) {
  return {
    managedWorktreeRoot: fixture.worktreeRoot,
    platformRoot: fixture.platformRoot,
    repositoryRevision: "a".repeat(40),
    adapterVersion: "expo-ios@2.0.0",
    nodeExecutable: fixture.nodeExecutable,
    npmExecutable: fixture.npmExecutable,
    podExecutable: fixture.podExecutable,
    policy: POLICY,
    ...overrides,
  };
}

describe("native dependency preparation authority", () => {
  it("plans an exact local Hermes release selection after CocoaPods", async () => {
    const fixture = await makeManagedExpoFixture();
    await writeFile(
      join(fixture.platformRoot, "ios", "Podfile.lock"),
      "PODS:\n  - hermes-engine (0.81.5):\n    - hermes-engine/Pre-built (= 0.81.5)\n",
    );

    const plan = await createNativeDependencyPreparationPlan(input(fixture));
    const canonicalPlatformRoot = await realpath(fixture.platformRoot);

    expect(plan.commands.at(-1)).toEqual({
      id: "hermes-release-selection",
      executable: await realpath(fixture.nodeExecutable),
      args: [
        join(
          canonicalPlatformRoot,
          "node_modules",
          "react-native",
          "sdks",
          "hermes-engine",
          "utils",
          "replace_hermes_version.js",
        ),
        "-c",
        "Release",
        "-r",
        "0.81.5",
        "-p",
        join(canonicalPlatformRoot, "ios", "Pods"),
      ],
      cwd: join(canonicalPlatformRoot, "ios", "Pods"),
      lockfileRelativePaths: ["ios/Podfile.lock"],
      risk: {
        network: "none",
        scripts: "deterministic-hermes-release-selection",
        writes: ["ios/Pods/hermes-engine/**"],
      },
    });
  });

  it("plans exact locked npm and CocoaPods commands without executing them", async () => {
    const fixture = await makeManagedExpoFixture();

    const plan = await createNativeDependencyPreparationPlan(
      input(fixture),
    );
    const canonicalNpm = await realpath(fixture.npmExecutable);
    const canonicalNode = await realpath(fixture.nodeExecutable);
    const canonicalPod = await realpath(fixture.podExecutable);

    expect(plan.commands).toEqual([
      {
        id: "npm-ci",
        executable: canonicalNode,
        args: [
          canonicalNpm,
          "ci",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ],
        cwd: plan.platformRoot,
        lockfileRelativePaths: ["package-lock.json"],
        risk: {
          network: "downloads-lockfile-pinned-packages",
          scripts: "npm-lifecycle-scripts-disabled",
          writes: [
            "node_modules/**",
            "$SANDBOX_HOME/.npm/**",
          ],
        },
      },
      {
        id: "pod-install",
        executable: canonicalPod,
        args: ["install", "--no-repo-update"],
        cwd: join(plan.platformRoot, "ios"),
        lockfileRelativePaths: ["ios/Podfile.lock"],
        risk: {
          network: "may-download-lockfile-pinned-pod-artifacts",
          scripts: "cocoapods-hooks-and-podspec-code-enabled",
          writes: [
            "ios/Pods/**",
            "ios/*.xcworkspace/**",
            "ios/Podfile.lock",
            "$SANDBOX_HOME/.cocoapods/**",
            "$SANDBOX_HOME/Library/Caches/CocoaPods/**",
          ],
        },
      },
    ]);
    expect(plan.approval).toEqual({
      status: "pending",
      requiresExplicitApproval: true,
    });
    expect(plan.lockfiles.map(({ relativePath }) => relativePath)).toEqual([
      "package-lock.json",
      "ios/Podfile.lock",
    ]);
    expect(plan.manifests.map(({ relativePath }) => relativePath)).toEqual([
      "package.json",
      "ios/Podfile",
    ]);
    expect(plan.tools).toEqual([
      {
        tool: "node",
        requestedPath: fixture.nodeExecutable,
        canonicalPath: canonicalNode,
        requestedPathMetadataSha256: expect.stringMatching(
          /^sha256:[a-f0-9]{64}$/u,
        ),
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        byteLength: 29,
      },
      {
        tool: "npm",
        requestedPath: fixture.npmExecutable,
        canonicalPath: canonicalNpm,
        requestedPathMetadataSha256: expect.stringMatching(
          /^sha256:[a-f0-9]{64}$/u,
        ),
        runtimeTreeSha256: expect.stringMatching(
          /^sha256:[a-f0-9]{64}$/u,
        ),
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        byteLength: 25,
      },
      {
        tool: "pod",
        requestedPath: fixture.podExecutable,
        canonicalPath: canonicalPod,
        requestedPathMetadataSha256: expect.stringMatching(
          /^sha256:[a-f0-9]{64}$/u,
        ),
        sha256: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        byteLength: 17,
      },
    ]);
    expect(plan.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.commands)).toBe(true);
  });

  it("omits CocoaPods when the application has no native Podfile", async () => {
    const fixture = await makeManagedExpoFixture();
    const webRoot = join(fixture.worktreeRoot, "apps", "web");
    await mkdir(webRoot, { recursive: true });
    await writeFile(
      join(webRoot, "package.json"),
      JSON.stringify({ name: "web", packageManager: "npm@10.9.2" }),
    );
    await writeFile(
      join(webRoot, "package-lock.json"),
      JSON.stringify({ name: "web", lockfileVersion: 3, packages: {} }),
    );

    const plan = await createNativeDependencyPreparationPlan(
      input(
        { ...fixture, platformRoot: webRoot },
        { podExecutable: undefined },
      ),
    );

    expect(plan.commands.map(({ id }) => id)).toEqual(["npm-ci"]);
  });

  it("rejects unlocked dependency inputs and mismatched package managers", async () => {
    const fixture = await makeManagedExpoFixture();
    await writeFile(
      join(fixture.platformRoot, "package.json"),
      JSON.stringify({
        name: "fixture-mobile",
        packageManager: "yarn@4.0.0",
      }),
    );
    await expect(
      createNativeDependencyPreparationPlan(input(fixture)),
    ).rejects.toThrow(/npm package manager/i);

    await writeFile(
      join(fixture.platformRoot, "package.json"),
      JSON.stringify({ name: "fixture-mobile" }),
    );
    await writeFile(join(fixture.platformRoot, "package-lock.json"), "");
    await expect(
      createNativeDependencyPreparationPlan(input(fixture)),
    ).rejects.toThrow(/package-lock/i);

    await writeFile(
      join(fixture.platformRoot, "package-lock.json"),
      JSON.stringify({ name: "fixture-mobile", lockfileVersion: 3 }),
    );
    await writeFile(join(fixture.platformRoot, "ios", "Podfile.lock"), "");
    await expect(
      createNativeDependencyPreparationPlan(input(fixture)),
    ).rejects.toThrow(/Podfile.lock/u);
  });

  it("rejects non-absolute tools, shell launchers, and platform escapes", async () => {
    const fixture = await makeManagedExpoFixture();
    for (const overrides of [
      { npmExecutable: "npm" },
      { npmExecutable: "/bin/sh" },
      { podExecutable: "/usr/bin/env" },
      { platformRoot: join(fixture.worktreeRoot, "..", "outside") },
    ]) {
      await expect(
        createNativeDependencyPreparationPlan(
          input(fixture, overrides),
        ),
      ).rejects.toThrow();
    }
  });

  it("rejects platform roots that escape through symlinks", async () => {
    const fixture = await makeManagedExpoFixture();
    const outside = await mkdtemp(join(tmpdir(), "memi-outside-"));
    await symlink(outside, join(fixture.worktreeRoot, "linked-app"));

    await expect(
      createNativeDependencyPreparationPlan(
        input(fixture, {
          platformRoot: join(fixture.worktreeRoot, "linked-app"),
        }),
      ),
    ).rejects.toThrow(/managed worktree/i);
  });

  it("rejects a Podfile symlink that escapes the platform root", async () => {
    const fixture = await makeManagedExpoFixture();
    const outside = await mkdtemp(join(tmpdir(), "memi-podfile-outside-"));
    const externalPodfile = join(outside, "Podfile");
    await writeFile(externalPodfile, "platform :ios, '17.0'\n");
    await rm(join(fixture.platformRoot, "ios", "Podfile"));
    await symlink(
      externalPodfile,
      join(fixture.platformRoot, "ios", "Podfile"),
    );

    await expect(
      createNativeDependencyPreparationPlan(input(fixture)),
    ).rejects.toThrow(/symlink/i);
  });

  it("binds fingerprints to revision, lockfiles, platform, adapter, and policy", async () => {
    const fixture = await makeManagedExpoFixture();
    const baseline = await createNativeDependencyPreparationPlan(
      input(fixture),
    );
    const mutations = [
      { repositoryRevision: "b".repeat(40) },
      { adapterVersion: "expo-ios@2.0.1" },
      {
        policy: {
          ...POLICY,
          sandboxProfileFingerprint:
            "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      },
    ];
    for (const mutation of mutations) {
      const changed = await createNativeDependencyPreparationPlan(
        input(fixture, mutation),
      );
      expect(changed.fingerprint).not.toBe(baseline.fingerprint);
    }

    await writeFile(
      join(fixture.platformRoot, "package-lock.json"),
      JSON.stringify({
        name: "fixture-mobile",
        lockfileVersion: 3,
        packages: { "node_modules/react": { version: "19.0.0" } },
      }),
    );
    const changedLockfile =
      await createNativeDependencyPreparationPlan(input(fixture));
    expect(changedLockfile.fingerprint).not.toBe(
      baseline.fingerprint,
    );

    await writeFile(
      join(fixture.platformRoot, "ios", "Podfile"),
      "platform :ios, '18.0'\n",
    );
    const changedPodfile =
      await createNativeDependencyPreparationPlan(input(fixture));
    expect(changedPodfile.fingerprint).not.toBe(
      changedLockfile.fingerprint,
    );
  });

  it("canonicalizes policy key order before fingerprinting", async () => {
    const fixture = await makeManagedExpoFixture();
    const baseline = await createNativeDependencyPreparationPlan(
      input(fixture),
    );
    const reorderedPolicy: NativeDependencyPreparationPolicy = {
      sandboxProfileFingerprint: POLICY.sandboxProfileFingerprint,
      requireLockfiles: true,
      cocoapodsHooks: "enabled",
      npmLifecycleScripts: "disabled",
      network: "locked-dependency-downloads",
      contract: "memi.native-dependency-preparation-policy.v1",
    };

    const reordered = await createNativeDependencyPreparationPlan(
      input(fixture, { policy: reorderedPolicy }),
    );

    expect(reordered.fingerprint).toBe(baseline.fingerprint);
  });

  it("rejects missing, non-executable, and symlink-disguised tools", async () => {
    const fixture = await makeManagedExpoFixture();
    const disguisedNpm = join(
      await mkdtemp(join(tmpdir(), "memi-disguised-tool-")),
      "npm",
    );
    await symlink("/bin/sh", disguisedNpm);
    const nonExecutableNpm = join(
      await mkdtemp(join(tmpdir(), "memi-non-executable-tool-")),
      "npm",
    );
    await writeFile(nonExecutableNpm, "#!/bin/sh\nexit 0\n");

    for (const npmExecutable of [
      "/definitely/missing/npm",
      disguisedNpm,
      nonExecutableNpm,
    ]) {
      await expect(
        createNativeDependencyPreparationPlan(
          input(fixture, { npmExecutable }),
        ),
      ).rejects.toThrow(/npm executable/i);
    }
  });

  it("accepts npm's canonical npm-cli.js target and binds its bytes", async () => {
    const fixture = await makeManagedExpoFixture();
    const toolRoot = await mkdtemp(
      join(tmpdir(), "memi-realistic-npm-tool-"),
    );
    const canonicalNpm = join(
      toolRoot,
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    const npmAlias = join(toolRoot, "bin", "npm");
    await mkdir(join(toolRoot, "bin"), { recursive: true });
    await mkdir(join(canonicalNpm, ".."), { recursive: true });
    await mkdir(join(toolRoot, "lib", "node_modules", "npm", "lib"), {
      recursive: true,
    });
    await writeFile(canonicalNpm, "#!/usr/bin/env node\n");
    await writeFile(
      join(toolRoot, "lib", "node_modules", "npm", "lib", "cli.js"),
      "module.exports = () => undefined\n",
    );
    await chmod(canonicalNpm, 0o755);
    await symlink(canonicalNpm, npmAlias);

    const plan = await createNativeDependencyPreparationPlan(
      input(fixture, { npmExecutable: npmAlias }),
    );
    const canonicalNpmPath = await realpath(npmAlias);

    expect(plan.commands[0]?.args[0]).toBe(canonicalNpmPath);
    expect(plan.tools[1]).toMatchObject({
      tool: "npm",
      requestedPath: npmAlias,
      canonicalPath: canonicalNpmPath,
      requestedPathMetadataSha256: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u,
      ),
      runtimeTreeSha256: expect.stringMatching(
        /^sha256:[a-f0-9]{64}$/u,
      ),
      byteLength: 20,
    });
  });

  it("rejects an arbitrary JavaScript target disguised as npm-cli.js", async () => {
    const fixture = await makeManagedExpoFixture();
    const toolRoot = await mkdtemp(
      join(tmpdir(), "memi-fake-npm-cli-"),
    );
    const fakeCli = join(toolRoot, "npm-cli.js");
    const npmAlias = join(toolRoot, "npm");
    await writeFile(fakeCli, "#!/usr/bin/env node\n");
    await chmod(fakeCli, 0o755);
    await symlink(fakeCli, npmAlias);

    await expect(
      createNativeDependencyPreparationPlan(
        input(fixture, { npmExecutable: npmAlias }),
      ),
    ).rejects.toThrow(/npm executable/i);
  });

  it("runs the planned npm recipe with an empty PATH", async ({ skip }) => {
    const fixture = await makeManagedExpoFixture();
    const plan = await createNativeDependencyPreparationPlan(
      input(fixture),
    );
    const command = plan.commands[0]!;

    const result = spawnSync(command.executable, command.args, {
      cwd: command.cwd,
      env: { PATH: "" },
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 2_000,
    });

    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
      skip("The host cannot launch the fixture executable within two seconds.");
    }

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toEqual(command.args);
  });

  it("invalidates approval when npm's transitive runtime tree changes", async () => {
    const fixture = await makeManagedExpoFixture();
    const baseline = await createNativeDependencyPreparationPlan(
      input(fixture),
    );
    const npmRoot = join(
      await realpath(fixture.npmExecutable),
      "..",
      "..",
    );
    await writeFile(
      join(npmRoot, "lib", "cli.js"),
      "module.exports = () => 'changed'\n",
    );

    const changed = await createNativeDependencyPreparationPlan(
      input(fixture),
    );

    expect(changed.tools[1]?.sha256).toBe(
      baseline.tools[1]?.sha256,
    );
    expect(changed.tools[1]?.runtimeTreeSha256).not.toBe(
      baseline.tools[1]?.runtimeTreeSha256,
    );
    expect(changed.fingerprint).not.toBe(baseline.fingerprint);
  });

  it("requires a matching explicit approval and rejects stale plans", async () => {
    const fixture = await makeManagedExpoFixture();
    const plan = await createNativeDependencyPreparationPlan(
      input(fixture),
    );

    expect(() =>
      assertNativeDependencyPreparationApproval(plan, undefined),
    ).toThrow(/explicit approval/i);
    expect(() =>
      approveNativeDependencyPreparationPlan(plan, {
        approvedFingerprint: `sha256:${"0".repeat(64)}`,
        approvedBy: "human:designer",
        approvedAt: "2026-07-30T12:00:00.000Z",
      }),
    ).toThrow(/fingerprint/i);

    const approval = approveNativeDependencyPreparationPlan(plan, {
      approvedFingerprint: plan.fingerprint,
      approvedBy: "human:designer",
      approvedAt: "2026-07-30T12:00:00.000Z",
    });
    expect(
      assertNativeDependencyPreparationApproval(plan, approval),
    ).toEqual(approval);

    const currentPlan = await createNativeDependencyPreparationPlan(
      input(fixture, { repositoryRevision: "c".repeat(40) }),
    );
    expect(() =>
      assertNativeDependencyPreparationApproval(
        currentPlan,
        approval,
      ),
    ).toThrow(/stale/i);

    for (const forged of [
      { ...approval, contract: "forged" },
      { ...approval, approvedBy: "" },
      { ...approval, approvedAt: "not-a-date" },
    ]) {
      expect(() =>
        assertNativeDependencyPreparationApproval(
          plan,
          forged as typeof approval,
        ),
      ).toThrow(/approval/i);
    }
  });
});
