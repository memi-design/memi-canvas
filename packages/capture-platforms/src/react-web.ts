import type {
  CaptureApplicationUnit,
  CaptureDiscoveryError,
  RepositoryManifestEntry,
} from "./types.js";
import { CAPTURE_PIPELINE_STAGES } from "./types.js";
import {
  applicationCacheKey,
  entriesForRoot,
  makeRoute,
  relativeToRoot,
  sha256,
  titleFromSegment,
} from "./shared.js";
import type { PackageManifest } from "./expo.js";

const SOURCE_EXTENSION = /\.(?:jsx?|tsx?)$/u;

export function isReactPackage(manifest: PackageManifest): boolean {
  const dependencies = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
  };
  return "react" in dependencies;
}

function pagesRoute(localPath: string): string | null {
  const match = localPath.match(/^(?:src\/)?pages\/(.+)\.(?:jsx?|tsx?)$/u);
  if (match === null) {
    return null;
  }
  const segments = match[1]!.split("/").flatMap((segment) => {
    if (segment === "index" || segment.startsWith("_")) {
      return [];
    }
    const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/u)?.[1];
    if (catchAll !== undefined) {
      return [`:${catchAll}*`];
    }
    const dynamic = segment.match(/^\[([^\]]+)\]$/u)?.[1];
    return [dynamic === undefined ? segment : `:${dynamic}`];
  });
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function appRoute(localPath: string): string | null {
  const match = localPath.match(
    /^(?:src\/)?app\/(?:(.*)\/)?page\.(?:jsx?|tsx?)$/u,
  );
  if (match === null) {
    return null;
  }
  const segments = (match[1] ?? "").split("/").flatMap((segment) => {
    if (segment === "" || /^\([^)]+\)$/u.test(segment)) {
      return [];
    }
    const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/u)?.[1];
    if (catchAll !== undefined) {
      return [`:${catchAll}*`];
    }
    const dynamic = segment.match(/^\[([^\]]+)\]$/u)?.[1];
    return [dynamic === undefined ? segment : `:${dynamic}`];
  });
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function declaredRoutes(
  entry: RepositoryManifestEntry,
  root: string,
): readonly string[] {
  const localPath = relativeToRoot(root, entry.path);
  if (!SOURCE_EXTENSION.test(localPath)) {
    return [];
  }
  return [...entry.content.matchAll(/\bpath\s*(?:=|:)\s*["'](\/[^"']*)["']/gu)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function isRootComponent(path: string): boolean {
  return /^(?:src\/)?(?:App|main)\.(?:jsx?|tsx?)$/u.test(path);
}

export function discoverReactApplication(input: {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
  readonly entries: readonly RepositoryManifestEntry[];
  readonly repositoryFingerprint: `sha256:${string}`;
}): CaptureApplicationUnit {
  const applicationId = `app_${sha256(`react-web:${input.root}`).slice(
    "sha256:".length,
    "sha256:".length + 24,
  )}` as const;
  const routeCandidates = input.entries.flatMap((entry) => {
      const local = relativeToRoot(input.root, entry.path);
      const fileRoute = pagesRoute(local) ?? appRoute(local);
      return [
        ...(fileRoute === null
          ? []
          : [{ sourcePath: entry.path, path: fileRoute }]),
        ...(isRootComponent(local)
          ? [{ sourcePath: entry.path, path: "/" }]
          : []),
        ...declaredRoutes(entry, input.root).map((path) => ({
          sourcePath: entry.path,
          path,
        })),
      ];
    });
  const uniqueRoutes = new Map<string, { readonly sourcePath: string; readonly path: string }>();
  for (const route of routeCandidates) {
    if (!uniqueRoutes.has(route.path)) {
      uniqueRoutes.set(route.path, route);
    }
  }
  const planned = [...uniqueRoutes.values()]
    .map(({ sourcePath, path }) => {
      return makeRoute({
        applicationId,
        sourcePath,
        path,
        displayName:
          path === "/" ? "Home" : titleFromSegment(path.split("/").at(-1) ?? ""),
        navigation: "url",
        platform: "react-web",
      });
    })
    .sort((left, right) => left.route.path.localeCompare(right.route.path));

  const errors: CaptureDiscoveryError[] = [];
  const script = input.manifest.scripts?.dev === undefined ? "start" : "dev";
  if (input.manifest.scripts?.[script] === undefined) {
    errors.push({
      code: "missing-launch-script",
      path: input.manifestPath,
      message: "React application has no approved dev or start script.",
      remediation: "Declare an npm dev or start script that launches the web app.",
      retryable: true,
    });
  }
  if (planned.length === 0) {
    errors.push({
      code: "no-capturable-routes",
      path: input.manifestPath,
      message: "React application has no statically discoverable page routes.",
      remediation:
        "Add file-based pages or provide a future explicit capture flow manifest.",
      retryable: true,
    });
  }

  return {
    applicationId,
    platform: "react-web",
    root: input.root,
    displayName: input.manifest.name ?? input.root.split("/").at(-1) ?? "React app",
    status: errors.length === 0 ? "supported" : "unsupported",
    pipelineStages: CAPTURE_PIPELINE_STAGES,
    manifestPaths: [input.manifestPath],
    buildRecipe:
      errors.length === 0
        ? {
            executable: "npm",
            args: [
              "run",
              script,
              "--",
              "--host",
              "127.0.0.1",
              "--port",
              "{leasedPort}",
            ],
            cwd: input.root,
            purpose: "launch",
          }
        : null,
    routes: planned.map(({ route }) => route),
    scenarios: planned.map(({ scenario }) => scenario),
    cacheKey: applicationCacheKey({
      repositoryFingerprint: input.repositoryFingerprint,
      adapterVersion: "react-web-capture-plan@1",
      root: input.root,
      entries: entriesForRoot(input.entries, input.root),
    }),
    errors,
  };
}
