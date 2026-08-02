/* v8 ignore file -- deterministic injected test ports */
import { createHash } from "node:crypto";

import {
  prepareRepositoryCapture,
  type RepositoryDirectoryEntry,
  type RepositoryFileSystemPort,
  type RepositoryGitRequest,
  type RepositoryProcessPort,
} from "./index.js";

type Entry = Readonly<
  | { kind: "directory" }
  | { kind: "file"; content: string }
  | { kind: "symlink"; target: string }
>;

export class MemoryFileSystem implements RepositoryFileSystemPort {
  readonly managedSnapshots: Array<{
    readonly sourceRoot: string;
    readonly targetRoot: string;
  }> = [];
  readonly managedSafetyChecks: string[] = [];
  readonly managedRemovals: string[] = [];

  constructor(private readonly entries: Readonly<Record<string, Entry>>) {}

  private treeFingerprint(rootPath: string) {
    const files = Object.entries(this.entries)
      .filter(
        ([path, entry]) =>
          path.startsWith(`${rootPath}/`) && entry.kind === "file",
      )
      .map(([path, entry]) => ({
        content: entry.kind === "file" ? entry.content : "",
        path: path.slice(rootPath.length + 1),
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    return {
      contentFingerprint: `sha256:${createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex")}` as const,
      exclusionManifest: {
        entries: [],
        fingerprint: `sha256:${"1".repeat(64)}` as const,
        policyFingerprint: `sha256:${"2".repeat(64)}` as const,
        schemaVersion: 1 as const,
      },
      fileCount: files.length,
      totalBytes: files.reduce(
        (total, file) => total + Buffer.byteLength(file.content),
        0,
      ),
    };
  }

  async createManagedSnapshot(input: {
    readonly sourceRoot: string;
    readonly targetRoot: string;
    readonly signal: AbortSignal;
  }) {
    if (input.signal.aborted) throw input.signal.reason;
    this.managedSnapshots.push({
      sourceRoot: input.sourceRoot,
      targetRoot: input.targetRoot,
    });
    return this.treeFingerprint(input.sourceRoot);
  }

  async fingerprintSourceTree(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }) {
    if (input.signal.aborted) throw input.signal.reason;
    return this.treeFingerprint(input.rootPath);
  }

  async entryKind(path: string): Promise<Entry["kind"] | "missing"> {
    return this.entries[path]?.kind ?? "missing";
  }

  async readDirectory(path: string): Promise<readonly RepositoryDirectoryEntry[]> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const children = new Map<string, RepositoryDirectoryEntry>();
    for (const [entryPath, entry] of Object.entries(this.entries)) {
      if (!entryPath.startsWith(prefix)) continue;
      const remainder = entryPath.slice(prefix.length);
      if (remainder.length === 0 || remainder.includes("/")) continue;
      children.set(remainder, { name: remainder, kind: entry.kind });
    }
    return [...children.values()];
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.entries[path];
    if (entry?.kind !== "file") throw new Error(`ENOENT: ${path}`);
    return new TextEncoder().encode(entry.content);
  }

  async realpath(path: string): Promise<string> {
    const entry = this.entries[path];
    return entry?.kind === "symlink" ? entry.target : path;
  }

  async assertManagedTreeSafe(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    if (input.signal.aborted) throw input.signal.reason;
    this.managedSafetyChecks.push(input.rootPath);
  }

  async removeManagedTree(input: {
    readonly rootPath: string;
    readonly signal: AbortSignal;
  }): Promise<void> {
    if (input.signal.aborted) throw input.signal.reason;
    this.managedRemovals.push(input.rootPath);
  }

}

export class ScriptedGit implements RepositoryProcessPort {
  readonly calls: RepositoryGitRequest[] = [];

  constructor(
    private readonly respond: (
      request: RepositoryGitRequest,
    ) => { readonly exitCode: number; readonly stdout?: string; readonly stderr?: string },
  ) {}

  async runGit(request: RepositoryGitRequest) {
    this.calls.push(structuredClone(request));
    if (request.signal.aborted) throw request.signal.reason;
    const response = this.respond(request);
    return {
      exitCode: response.exitCode,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
    };
  }
}

export function baseEntries(
  additions: Readonly<Record<string, Entry>> = {},
): Readonly<Record<string, Entry>> {
  return {
    "/source": { kind: "directory" },
    "/managed": { kind: "directory" },
    "/source/apps": { kind: "directory" },
    "/source/apps/expo": { kind: "directory" },
    "/source/apps/expo/app": { kind: "directory" },
    "/source/apps/expo/app/index.tsx": {
      kind: "file",
      content: "export default function Home() { return null }",
    },
    "/source/apps/expo/app.json": {
      kind: "file",
      content: JSON.stringify({
        expo: {
          ios: { bundleIdentifier: "design.memi.capture.fixture" },
          scheme: "memi-capture-fixture",
        },
      }),
    },
    "/source/apps/expo/package.json": {
      kind: "file",
      content: JSON.stringify({
        name: "mobile",
        main: "expo-router/entry",
        scripts: { start: "expo start --go" },
        dependencies: { expo: "53", "expo-router": "5", react: "19" },
      }),
    },
    "/source/apps/web": { kind: "directory" },
    "/source/apps/web/src": { kind: "directory" },
    "/source/apps/web/src/pages": { kind: "directory" },
    "/source/apps/web/src/pages/index.tsx": {
      kind: "file",
      content: "export default function Home() { return null }",
    },
    "/source/apps/web/package.json": {
      kind: "file",
      content: JSON.stringify({
        name: "site",
        scripts: { dev: "vite" },
        dependencies: { react: "19", "react-dom": "19" },
        devDependencies: { vite: "8" },
      }),
    },
    ...additions,
  };
}

export function gitPort(
  options: { readonly status?: string; readonly diff?: string } = {},
) {
  return new ScriptedGit((request) => {
    const args = request.args.join(" ");
    if (args === "rev-parse --show-toplevel") {
      return { exitCode: 0, stdout: "/source\n" };
    }
    if (args === "rev-parse HEAD") {
      return {
        exitCode: 0,
        stdout: "0123456789abcdef0123456789abcdef01234567\n",
      };
    }
    if (args.includes("status --porcelain=v1")) {
      return { exitCode: 0, stdout: options.status ?? "" };
    }
    if (args.includes("diff --name-status -z --cached")) return { exitCode: 0 };
    if (args.includes("diff --name-status -z --no-ext-diff")) {
      return { exitCode: 0, stdout: options.diff ?? "" };
    }
    return { exitCode: 0 };
  });
}

export async function prepare(input: {
  readonly fileSystem?: RepositoryFileSystemPort;
  readonly process?: RepositoryProcessPort;
  readonly signal?: AbortSignal;
} = {}) {
  return prepareRepositoryCapture({
    captureId: "capture-1",
    managedRoot: "/managed",
    sourceRoot: "/source",
    ports: {
      fileSystem: input.fileSystem ?? new MemoryFileSystem(baseEntries()),
      process: input.process ?? gitPort(),
    },
    signal: input.signal ?? new AbortController().signal,
  });
}
