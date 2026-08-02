import { createHash } from "node:crypto";

import type {
  ExpoScreenRoute,
  RouteParameter,
  SourceAnchor,
  SourceAnchorKind,
} from "./types.js";
import type { VerifiedStaticSource } from "./filesystem.js";

const SOURCE_EXTENSION = /\.(?:js|jsx|ts|tsx)$/u;

function anchorKind(sourcePath: string): SourceAnchorKind {
  const basename = sourcePath.split("/").at(-1)?.replace(SOURCE_EXTENSION, "");
  if (basename === "_layout") {
    return "layout";
  }
  if (basename === "+html") {
    return "html-shell";
  }
  if (basename === "+not-found") {
    return "not-found";
  }
  if (basename?.endsWith("+api") === true) {
    return "api-route";
  }
  return "screen";
}

function routeId(sourcePath: string): `rte_${string}` {
  const digest = createHash("sha256").update(sourcePath).digest("hex");
  return `rte_${digest.slice(0, 24)}`;
}

function parseSegment(segment: string): {
  readonly pathSegment: string | null;
  readonly group: string | null;
  readonly parameter: RouteParameter | null;
} {
  const group = segment.match(/^\(([^)]+)\)$/u)?.[1];
  if (group !== undefined) {
    return { pathSegment: null, group, parameter: null };
  }
  const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/u)?.[1];
  if (catchAll !== undefined) {
    return {
      pathSegment: `:${catchAll}*`,
      group: null,
      parameter: { kind: "catch-all", name: catchAll },
    };
  }
  const dynamic = segment.match(/^\[([^\]]+)\]$/u)?.[1];
  if (dynamic !== undefined) {
    return {
      pathSegment: `:${dynamic}`,
      group: null,
      parameter: { kind: "dynamic", name: dynamic },
    };
  }
  return {
    pathSegment: segment === "index" ? null : segment,
    group: null,
    parameter: null,
  };
}

function parseScreen(source: VerifiedStaticSource): ExpoScreenRoute {
  const relativeRoute = source.sourcePath
    .slice("app/".length)
    .replace(SOURCE_EXTENSION, "");
  const parsed = relativeRoute.split("/").map(parseSegment);
  const pathSegments = parsed.flatMap((segment) =>
    segment.pathSegment === null ? [] : [segment.pathSegment],
  );
  return {
    routeId: routeId(source.sourcePath),
    kind: "screen",
    sourcePath: source.sourcePath,
    normalizedPath: pathSegments.length === 0 ? "/" : `/${pathSegments.join("/")}`,
    groups: parsed.flatMap((segment) =>
      segment.group === null ? [] : [segment.group],
    ),
    parameters: parsed.flatMap((segment) =>
      segment.parameter === null ? [] : [segment.parameter],
    ),
  };
}

export function compileRoutes(files: readonly VerifiedStaticSource[]): {
  readonly routes: readonly ExpoScreenRoute[];
  readonly sourceAnchors: readonly SourceAnchor[];
} {
  const routeFiles = files.filter((file) => file.role === "route");
  const sourceAnchors = routeFiles.map((file) => ({
    kind: anchorKind(file.sourcePath),
    sourcePath: file.sourcePath,
    contentHash: file.contentHash,
  }));
  const routes = routeFiles
    .filter((file) => anchorKind(file.sourcePath) === "screen")
    .map(parseScreen);
  return { routes, sourceAnchors };
}
