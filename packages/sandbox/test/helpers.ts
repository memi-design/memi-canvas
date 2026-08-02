import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  MacOSSandboxExecProvider,
  SandboxRunRequest,
  SandboxRunResult,
} from "../src/index";

export interface SandboxFixture {
  readonly root: string;
  readonly sourceRoot: string;
  readonly worktreeRoot: string;
  readonly tempRoot: string;
  readonly outsideRoot: string;
  readonly homeRoot: string;
  readonly sourceFile: string;
  readonly outsideFile: string;
  readonly sshSecretFile: string;
}

export async function createSandboxFixture(): Promise<SandboxFixture> {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "memi-sandbox-test-")),
  );
  const sourceRoot = join(root, "source");
  const worktreeRoot = join(root, "worktree");
  const tempRoot = join(root, "sandbox-temp");
  const outsideRoot = join(root, "outside");
  const homeRoot = join(root, "host-home");

  await Promise.all([
    mkdir(sourceRoot),
    mkdir(worktreeRoot),
    mkdir(tempRoot),
    mkdir(outsideRoot),
    mkdir(join(homeRoot, ".ssh"), { recursive: true }),
  ]);

  const sourceFile = join(sourceRoot, "source.txt");
  const outsideFile = join(outsideRoot, "outside.txt");
  const sshSecretFile = join(homeRoot, ".ssh", "id_test");

  await Promise.all([
    writeFile(sourceFile, "source-evidence", "utf8"),
    writeFile(outsideFile, "outside-secret", "utf8"),
    writeFile(sshSecretFile, "ssh-secret", "utf8"),
  ]);

  return {
    root,
    sourceRoot,
    worktreeRoot,
    tempRoot,
    outsideRoot,
    homeRoot,
    sourceFile,
    outsideFile,
    sshSecretFile,
  };
}

export async function removeSandboxFixture(
  fixture: SandboxFixture,
): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
}

export async function createEscapeSymlink(
  fixture: SandboxFixture,
): Promise<string> {
  const linkPath = join(fixture.worktreeRoot, "outside-link");
  await symlink(fixture.outsideRoot, linkPath, "dir");
  return linkPath;
}

export function sandboxRequest(
  fixture: SandboxFixture,
  overrides: Partial<SandboxRunRequest> = {},
): SandboxRunRequest {
  return {
    executable: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    cwd: fixture.worktreeRoot,
    sourceRoots: [fixture.sourceRoot],
    worktreeRoot: fixture.worktreeRoot,
    tempRoot: fixture.tempRoot,
    environment: {},
    timeoutMs: 2_000,
    maxStdoutBytes: 4_096,
    maxStderrBytes: 4_096,
    ...overrides,
  };
}

export async function runNode(
  provider: MacOSSandboxExecProvider,
  fixture: SandboxFixture,
  source: string,
  args: readonly string[] = [],
  overrides: Partial<SandboxRunRequest> = {},
): Promise<SandboxRunResult> {
  return provider.run(
    sandboxRequest(fixture, {
      args: ["-e", source, ...args],
      ...overrides,
    }),
  );
}

export async function waitForProcessExit(
  pid: number,
  timeoutMs = 2_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ESRCH"
      ) {
        return true;
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function readPid(filePath: string): Promise<number> {
  return Number.parseInt(await readFile(filePath, "utf8"), 10);
}
