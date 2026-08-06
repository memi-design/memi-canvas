import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  parseCaptureAdapterMetadataV1,
  type CaptureAdapterV1,
} from "@memi/capture-import";
import {
  type BrowserLauncher,
  type ContentAddressedArtifactStore,
  type PortLease,
  type ProcessExecutionPolicy,
  type ProcessStarter,
} from "@memi/capture-execution/core";
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
  readonly loadAdapter?: () => Promise<{
    readonly ReactWebCaptureAdapter: new (input: {
      readonly applications: readonly ImportApplicationV2[];
      readonly artifactStore: ContentAddressedArtifactStore;
      readonly processRunner: ProcessStarter;
      readonly processPolicy: ProcessExecutionPolicy;
      readonly recipe: (
        application: ImportApplicationV2,
        port: number,
      ) => {
        readonly executable: string;
        readonly args: readonly string[];
        readonly cwd: string;
      };
      readonly portLease: PortLease;
      readonly browserLauncher?: BrowserLauncher;
      readonly waitForLoopback: (
        url: string,
        signal: AbortSignal,
      ) => Promise<void>;
    }) => CaptureAdapterV1;
  }>;
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
  const loader = canonicalAuthority.loadAdapter ??
    (async () => await import("@memi/capture-execution/react-web-adapter"));
  let adapterPromise: Promise<CaptureAdapterV1> | null = null;
  const resolveAdapter = (): Promise<CaptureAdapterV1> => {
    adapterPromise ??= loader().then(({ ReactWebCaptureAdapter }) =>
      new ReactWebCaptureAdapter({
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
      }));
    return adapterPromise;
  };
  const deferredAdapter: CaptureAdapterV1 = {
    metadata: parseCaptureAdapterMetadataV1({
      id: "playwright-react-web",
      platform: "react-web",
      version: "1.0.0",
      capabilities: [
        "discover",
        "prepare",
        "launch",
        "capture",
        "collect",
        "cleanup",
      ],
    }),
    async discover(context) {
      return await (await resolveAdapter()).discover(context);
    },
    async prepare(context, application, scenarios) {
      return await (await resolveAdapter()).prepare(context, application, scenarios);
    },
    async launch(context, preparation) {
      return await (await resolveAdapter()).launch(context, preparation);
    },
    async capture(context, launch, scenario) {
      return await (await resolveAdapter()).capture(context, launch, scenario);
    },
    async collect(context, launch, capture) {
      return await (await resolveAdapter()).collect(context, launch, capture);
    },
    async cleanup(context, launch) {
      return await (await resolveAdapter()).cleanup(context, launch);
    },
  };
  return Object.freeze(deferredAdapter);
}
