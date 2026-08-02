import { mkdir } from "node:fs/promises";
import {
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  prepareRepositoryCapture,
  type RepositoryCapturePorts,
} from "@memi/capture-repository";
import type { CaptureDiscoveryOptions } from "@memi/capture-platforms";
import { createNodeRepositoryPorts } from "@memi/capture-repository/node";
import type { WorktreeId } from "@memi/protocol";

import type {
  ImportRepositoryInspection,
  ImportRepositoryPort,
} from "./import-coordinator.types.js";

export interface CaptureRepositoryPortOptions {
  readonly managedRoot: string;
  readonly createCaptureId: (repositoryPath: string) => string;
  readonly createWorktreeId: (
    captureId: string,
    managedRoot: string,
  ) => WorktreeId;
  readonly ports?: RepositoryCapturePorts;
}

function containedManagedRoot(
  configuredRoot: string,
  preparedRoot: string,
): string {
  if (
    configuredRoot.includes("\0") ||
    preparedRoot.includes("\0") ||
    !isAbsolute(configuredRoot) ||
    !isAbsolute(preparedRoot)
  ) {
    throw new Error(
      "The managed capture root must be an absolute non-root path.",
    );
  }
  const authorityRoot = resolve(configuredRoot);
  const candidate = resolve(preparedRoot);
  const relationship = relative(authorityRoot, candidate);
  if (
    authorityRoot === parse(authorityRoot).root ||
    candidate === parse(candidate).root ||
    relationship === "" ||
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error(
      "The managed capture root must be a contained child of the configured authority.",
    );
  }
  return candidate;
}

export function createCaptureRepositoryPort(
  options: CaptureRepositoryPortOptions,
): ImportRepositoryPort {
  let ports = options.ports;
  return Object.freeze({
    async inspect(
      repositoryPath: string,
      signal: AbortSignal,
      discoveryOptions?: CaptureDiscoveryOptions,
    ): Promise<ImportRepositoryInspection> {
      await mkdir(options.managedRoot, {
        recursive: true,
        mode: 0o700,
      });
      ports ??= createNodeRepositoryPorts({
        managedRoot: options.managedRoot,
      });
      const captureId = options.createCaptureId(repositoryPath);
      const prepared = await prepareRepositoryCapture({
        sourceRoot: repositoryPath,
        managedRoot: options.managedRoot,
        captureId,
        signal,
        ports,
        ...(discoveryOptions === undefined
          ? {}
          : { discoveryOptions }),
      });
      const managedRootPath = containedManagedRoot(
        options.managedRoot,
        prepared.managedCopy.rootPath,
      );
      return Object.freeze({
        authority: Object.freeze({
          rootPath: prepared.source.rootPath,
          sourceRevision: prepared.source.headRevision,
          dirtyFingerprint: prepared.source.dirtyFingerprint,
          managedWorktreeId: options.createWorktreeId(
            captureId,
            managedRootPath,
          ),
          managedRootPath,
        }),
        manifest: prepared.inventory,
        applications: prepared.applications,
        snapshotExclusions: prepared.snapshotExclusions,
      });
    },
  });
}
