import type {
  RunWorktreeApproval,
  RunWorktreeApprovalAuthorityPort,
  SourceFileSystemPort,
  SourceGitRequest,
  SourceGitResult,
  SourceWorktreeMutationAuthorizationPort,
  SourceWorktreeProcessPort,
} from "./source-worktree.types.js";
import { SOURCE_REPOSITORY_PROCESS_POLICY } from "./source-worktree-security.js";

interface ExpectedGitCall extends SourceGitRequest {
  readonly result: SourceGitResult;
}

export class ScriptedSourceGit implements SourceWorktreeProcessPort {
  readonly calls: SourceGitRequest[] = [];
  readonly #expected: ExpectedGitCall[] = [];

  expect(
    cwd: string,
    args: readonly string[],
    stdout = "",
    exitCode = 0,
    stderr = "",
  ): void {
    this.#expected.push({
      args,
      cwd,
      repositoryProcessPolicy: SOURCE_REPOSITORY_PROCESS_POLICY,
      result: { exitCode, stderr, stdout },
      securityProfile: "source-worktree",
    });
  }

  async runGit(request: SourceGitRequest): Promise<SourceGitResult> {
    this.calls.push(structuredClone(request));
    const expected = this.#expected.shift();
    expect(expected).toBeDefined();
    expect(request).toEqual({
      args: expected?.args,
      cwd: expected?.cwd,
      repositoryProcessPolicy: expected?.repositoryProcessPolicy,
      securityProfile: expected?.securityProfile,
      ...(expected?.stdin === undefined ? {} : { stdin: expected.stdin }),
    });
    return structuredClone(expected!.result);
  }

  assertDrained(): void {
    expect(this.#expected).toEqual([]);
  }
}

export interface RecordedSourceTextWrite {
  readonly absolutePath: string;
  readonly afterText: string;
  readonly beforeText: string;
}

export class MemorySourceFileSystem implements SourceFileSystemPort {
  readonly atomicBatches: RecordedSourceTextWrite[][] = [];
  readonly #files = new Map<string, Uint8Array>();
  readonly #realPaths = new Map<string, string>();

  constructor(files: Readonly<Record<string, string>> = {}) {
    for (const [path, text] of Object.entries(files)) {
      this.#files.set(path, new TextEncoder().encode(text));
    }
  }

  setRealPath(path: string, realPath: string): void {
    this.#realPaths.set(path, realPath);
  }

  async realpath(path: string): Promise<string> {
    return this.#realPaths.get(path) ?? path;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = this.#files.get(path);
    if (bytes === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return bytes.slice();
  }

  async replaceTextFilesRecoverably(
    changes: readonly RecordedSourceTextWrite[],
  ): Promise<void> {
    for (const change of changes) {
      const current = new TextDecoder().decode(
        await this.readFile(change.absolutePath),
      );
      if (current !== change.beforeText) {
        throw new Error(`compare failed: ${change.absolutePath}`);
      }
    }
    this.atomicBatches.push(
      structuredClone(changes) as RecordedSourceTextWrite[],
    );
    for (const change of changes) {
      this.#files.set(
        change.absolutePath,
        new TextEncoder().encode(change.afterText),
      );
    }
  }
}

export function expectRepositoryCapture(
  git: ScriptedSourceGit,
  root: string,
  revision: string,
  options: {
    readonly cachedDiff?: string;
    readonly status?: string;
    readonly worktreeDiff?: string;
  } = {},
): void {
  git.expect(root, ["rev-parse", "--show-toplevel"], `${root}\n`);
  git.expect(root, ["rev-parse", "HEAD"], `${revision}\n`);
  git.expect(
    root,
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    options.status ?? "",
  );
  git.expect(
    root,
    ["diff", "--binary", "--no-ext-diff", "HEAD", "--"],
    options.worktreeDiff ?? "",
  );
  git.expect(
    root,
    ["diff", "--binary", "--cached", "--no-ext-diff", "HEAD", "--"],
    options.cachedDiff ?? "",
  );
}

export class MemoryRunWorktreeApprovalAuthority
  implements RunWorktreeApprovalAuthorityPort
{
  readonly #active = new Map<string, RunWorktreeApproval>();
  #nextId = 1;

  async issue(
    input: Parameters<RunWorktreeApprovalAuthorityPort["issue"]>[0],
  ): Promise<RunWorktreeApproval> {
    const approval = Object.freeze({
      approvalId: `approval-${this.#nextId++}`,
      approvedAt: input.approvedAt,
      approvedBy: structuredClone(input.approvedBy),
      digest: input.digest,
      runId: input.runId,
    });
    this.#active.set(approval.approvalId, approval);
    return approval;
  }

  async isActiveExact(approval: RunWorktreeApproval): Promise<boolean> {
    return (
      JSON.stringify(this.#active.get(approval.approvalId)) ===
      JSON.stringify(approval)
    );
  }

  async consumeExact(approval: RunWorktreeApproval): Promise<boolean> {
    if (!(await this.isActiveExact(approval))) {
      return false;
    }
    this.#active.delete(approval.approvalId);
    return true;
  }
}

export class MemorySourceWorktreeSecurityAuthorization {
  readonly calls: unknown[] = [];
  readonly #allowed: boolean;

  constructor(allowed = true) {
    this.#allowed = allowed;
  }

  async authorizeMutation(
    request: Parameters<
      SourceWorktreeMutationAuthorizationPort["authorizeMutation"]
    >[0],
  ): Promise<
    Awaited<
      ReturnType<
        SourceWorktreeMutationAuthorizationPort["authorizeMutation"]
      >
    >
  > {
    this.calls.push(structuredClone(request));
    if (!this.#allowed) {
      throw new Error("source-worktree security veto is active");
    }
    return {
      authorized: true,
      policyDigest: `sha256:${"f".repeat(64)}`,
    };
  }
}
