import { createHash } from "node:crypto";

import type {
  CaptureApplicationUnit,
  CaptureAuthContext,
  CaptureRouteParameter,
  CaptureRoutePlan,
  CaptureScenarioPlan,
  ContentHash,
  RepositoryManifestEntry,
} from "./types.js";

export function sha256(value: string): ContentHash {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function stableHash(value: unknown): ContentHash {
  return sha256(JSON.stringify(value));
}

export function relativeRoot(path: string): string {
  const segments = path.split("/");
  segments.pop();
  return segments.join("/") || ".";
}

export function relativeToRoot(root: string, path: string): string {
  return root === "." ? path : path.slice(root.length + 1);
}

export function joinRoot(root: string, path: string): string {
  return root === "." ? path : `${root}/${path}`;
}

export function titleFromSegment(value: string): string {
  const words = value
    .replace(/\.(?:jsx?|tsx?|swift)$/u, "")
    .replace(/\[\.\.\.([^\]]+)\]/gu, "$1")
    .replace(/\[([^\]]+)\]/gu, "$1")
    .replace(/View$/u, "")
    .split(/[-_\s]+/u)
    .filter(Boolean);
  return words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}

export function parametersFromPath(path: string): readonly CaptureRouteParameter[] {
  const parameters: CaptureRouteParameter[] = [];
  for (const segment of path.split("/")) {
    const catchAll = segment.match(/^:([^/]+)\*$/u)?.[1];
    const dynamic = segment.match(/^:([^/]+)$/u)?.[1];
    if (catchAll !== undefined) {
      parameters.push({ name: catchAll, kind: "catch-all" });
    } else if (dynamic !== undefined) {
      parameters.push({ name: dynamic, kind: "dynamic" });
    }
  }
  return parameters;
}

function inferAuthContext(sourcePath: string): CaptureAuthContext {
  const groups = [...sourcePath.matchAll(/\(([^)]+)\)/gu)].map(
    (match) => match[1]?.toLowerCase() ?? "",
  );
  if (groups.some((group) => /auth|sign.?in|onboarding/u.test(group))) {
    return "signed-out";
  }
  if (groups.some((group) => /private|protected|account/u.test(group))) {
    return "authenticated";
  }
  if (groups.some((group) => /guest/u.test(group))) {
    return "guest";
  }
  return "public";
}

export function makeRoute(input: {
  readonly applicationId: `app_${string}`;
  readonly sourcePath: string;
  readonly path: string;
  readonly displayName: string;
  readonly navigation: CaptureRoutePlan["navigation"];
  readonly platform: CaptureApplicationUnit["platform"];
  readonly viewport?: CaptureScenarioPlan["viewport"];
}): {
  readonly route: CaptureRoutePlan;
  readonly scenario: CaptureScenarioPlan;
} {
  const routeId = `rte_${sha256(
    `${input.applicationId}:${input.sourcePath}:${input.path}`,
  ).slice("sha256:".length, "sha256:".length + 24)}` as const;
  const parameters = parametersFromPath(input.path);
  const route: CaptureRoutePlan = {
    routeId,
    sourcePath: input.sourcePath,
    path: input.path,
    displayName: input.displayName,
    parameters,
    navigation: input.navigation,
  };
  const scenarioId = `scn_${sha256(`${routeId}:default`).slice(
    "sha256:".length,
    "sha256:".length + 24,
  )}` as const;
  return {
    route,
    scenario: {
      scenarioId,
      applicationId: input.applicationId,
      routeId,
      routePath: input.path,
      state: "default",
      authContext: inferAuthContext(input.sourcePath),
      fixture: {
        status: parameters.length === 0 ? "not-required" : "required",
        parameterNames: parameters.map((parameter) => parameter.name),
      },
      viewport:
        input.viewport ??
        (input.platform === "react-web"
          ? { name: "desktop", width: 1440, height: 900, scale: 1 }
          : { name: "ios-mobile", width: 402, height: 874, scale: 3 }),
      readiness: {
        strategy: "two-stable-frames",
        stableFrames: 2,
        rejectBlank: true,
        rejectSplash: true,
        rejectErrorBoundary: true,
      },
    },
  };
}

export function entriesForRoot(
  entries: readonly RepositoryManifestEntry[],
  root: string,
): readonly RepositoryManifestEntry[] {
  const prefix = root === "." ? "" : `${root}/`;
  return entries.filter((entry) => entry.path.startsWith(prefix));
}

export function applicationCacheKey(input: {
  readonly repositoryFingerprint: ContentHash;
  readonly adapterVersion: string;
  readonly root: string;
  readonly entries: readonly RepositoryManifestEntry[];
}): ContentHash {
  return stableHash({
    repositoryFingerprint: input.repositoryFingerprint,
    adapterVersion: input.adapterVersion,
    root: input.root,
    entries: input.entries.map((entry) => ({
      path: entry.path,
      contentHash: sha256(entry.content),
    })),
  });
}
