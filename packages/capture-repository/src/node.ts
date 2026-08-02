import { assertAbsoluteNonRoot } from "./guards.js";
import { NodeRepositoryFileSystem } from "./node-filesystem.js";
import { NodeRepositoryProcess } from "./node-process.js";
import type { RepositoryCapturePorts } from "./types.js";

export function createNodeRepositoryPorts(options: {
  readonly managedRoot: string;
}): RepositoryCapturePorts {
  const managedRoot = assertAbsoluteNonRoot(
    options.managedRoot,
    "invalid-managed-root",
    "Configured managed repository root",
  );
  return {
    fileSystem: new NodeRepositoryFileSystem(managedRoot),
    process: new NodeRepositoryProcess(managedRoot),
  };
}
