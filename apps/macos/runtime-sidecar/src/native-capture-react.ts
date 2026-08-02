import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import type { CaptureAdapterV1 } from "@memi/capture-import";
import {
  type BrowserLauncher,
  type ContentAddressedArtifactStore,
  type PortLease,
  type ProcessExecutionPolicy,
  type ProcessStarter,
  ReactWebCaptureAdapter,
} from "@memi/capture-execution";
import type { CaptureApplicationUnit } from "@memi/capture-platforms";
import type { ImportApplicationV2 } from "@memi/protocol";

import {
  isContained,
  SANDBOX_EXECUTABLE,
} from "./native-capture-process.js";

export interface ReactWebAdapterAuthority {
  readonly application: ImportApplicationV2;
  readonly unit: CaptureApplicationUnit;
  readonly managedRootPath: string;
  readonly applicationRoot: string;
  readonly executable: string;
  readonly appDataRoot: string;
  readonly artifactStore: ContentAddressedArtifactStore;
  readonly processStarter: ProcessStarter;
  readonly portLease: PortLease;
  readonly browserLauncher?: BrowserLauncher;
  readonly waitForLoopback?: (
    url: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

function recipeArguments(
  unit: CaptureApplicationUnit,
  port: number,
): readonly string[] {
  const recipe = unit.buildRecipe;
  if (
    recipe === null ||
    recipe.executable !== "npm" ||
    recipe.args.every((argument) => argument !== "{leasedPort}")
  ) {
    throw new Error(
      "React capture requires an approved npm recipe with a loopback port.",
    );
  }
  return Object.freeze(
    recipe.args.map((argument) =>
      argument === "{leasedPort}" ? String(port) : argument,
    ),
  );
}

function processPolicy(
  authority: ReactWebAdapterAuthority,
): ProcessExecutionPolicy {
  const recipe = authority.unit.buildRecipe;
  if (recipe === null) {
    throw new Error("React capture has no launch recipe.");
  }
  return Object.freeze({
    allowedCommands: Object.freeze([{
      executable: authority.executable,
      arguments: Object.freeze(
        recipe.args.map((argument) =>
          argument === "{leasedPort}"
            ? { kind: "integer" as const, minimum: 1, maximum: 65_535 }
            : { kind: "literal" as const, value: argument },
        ),
      ),
    }]),
    allowedCwdRoots: Object.freeze([
      authority.applicationRoot,
      authority.appDataRoot,
    ]),
    sandboxEnvironment: Object.freeze({
      home: join(authority.appDataRoot, "sandbox", "home"),
      temporaryDirectory: join(authority.appDataRoot, "sandbox", "tmp"),
      path: "",
    }),
    sandbox: Object.freeze({
      executable: SANDBOX_EXECUTABLE,
      allowedReadRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
        "/System",
        "/Library",
        "/usr",
      ]),
      allowedWriteRoots: Object.freeze([
        authority.applicationRoot,
        authority.appDataRoot,
      ]),
      network: "loopback" as const,
    }),
  });
}

export async function waitForLoopback(
  url: string,
  signal: AbortSignal,
): Promise<void> {
  const target = new URL(url);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
    target.port === "" ||
    target.username !== "" ||
    target.password !== ""
  ) {
    throw new Error("React readiness URL must be credential-free loopback HTTP.");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new Error("React launch readiness was cancelled.");
    }
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
      });
      await response.body?.cancel();
      if (response.status < 500) {
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        throw new Error("React launch readiness was cancelled.", {
          cause: error,
        });
      }
    }
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 100);
    });
  }
  throw new Error("React application did not become ready on loopback.");
}

export function createReactWebCaptureAdapter(
  authority: ReactWebAdapterAuthority,
): CaptureAdapterV1 {
  const managedRoot = realpathSync.native(authority.managedRootPath);
  const applicationRoot = realpathSync.native(authority.applicationRoot);
  const expectedRoot = realpathSync.native(
    resolve(managedRoot, authority.unit.root),
  );
  if (
    authority.application.platform !== "react-web" ||
    authority.unit.platform !== "react-web" ||
    managedRoot !== resolve(authority.managedRootPath) ||
    applicationRoot !== resolve(authority.applicationRoot) ||
    applicationRoot !== expectedRoot ||
    !isContained(managedRoot, applicationRoot)
  ) {
    throw new Error("React adapter authority is invalid.");
  }
  const canonicalAuthority = Object.freeze({
    ...authority,
    managedRootPath: managedRoot,
    applicationRoot,
  });
  return new ReactWebCaptureAdapter({
    applications: [canonicalAuthority.application],
    artifactStore: canonicalAuthority.artifactStore,
    processRunner: canonicalAuthority.processStarter,
    processPolicy: processPolicy(canonicalAuthority),
    recipe: (_application, port) => ({
      executable: canonicalAuthority.executable,
      args: recipeArguments(canonicalAuthority.unit, port),
      cwd: canonicalAuthority.applicationRoot,
    }),
    portLease: canonicalAuthority.portLease,
    ...(canonicalAuthority.browserLauncher === undefined
      ? {}
      : { browserLauncher: canonicalAuthority.browserLauncher }),
    waitForLoopback:
      canonicalAuthority.waitForLoopback ?? waitForLoopback,
  });
}
