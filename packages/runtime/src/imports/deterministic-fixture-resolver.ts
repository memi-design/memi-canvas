import type {
  CaptureRoutePlan,
  CaptureScenarioPlan,
  RepositoryManifestInput,
} from "@memi/capture-platforms";

import type {
  ResolvedScenarioFixture,
} from "./import-coordinator.types.js";

interface FixtureResolutionInput {
  readonly manifest: RepositoryManifestInput;
  readonly route: CaptureRoutePlan;
  readonly scenario: CaptureScenarioPlan;
}

type EvidenceKind = "maestro" | "test" | "source-constant";

interface StaticLiteral {
  readonly value: string;
  readonly offset: number;
}

interface RouteEvidence {
  readonly kind: EvidenceKind;
  readonly path: string;
  readonly offset: number;
  readonly parameters: ResolvedScenarioFixture["parameters"];
}

const CODE_SOURCE = /\.(?:[cm]?[jt]sx?|swift)$/u;
const MAESTRO_SOURCE = /(?:^|\/)\.maestro\/.+\.ya?ml$/u;
const TEST_SOURCE =
  /(?:^|\/)(?:__tests__|tests?|__fixtures__|fixtures?)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u;
const MAX_STATIC_LITERALS = 10_000;
const SENSITIVE_PARAMETER_NAME =
  /(?:auth|bearer|credential|jwt|otp|pass(?:word)?|reset|secret|session|token|verification)/iu;
const SENSITIVE_PARAMETER_VALUE =
  /(?:^[A-Za-z0-9_-]{48,}$|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{10,}\b|\bA(?:KIA|SIA)[A-Z0-9]{16}\b|\bAIza[A-Za-z0-9_-]{20,}\b|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^/\s:@]+:[^@\s/]+@|[?&](?:api[_-]?key|password|secret|token)=)/iu;

function isSafeParameter(value: string): boolean {
  const containsControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  return (
    value.length > 0 &&
    value.length <= 2_048 &&
    value !== "." &&
    value !== ".." &&
    !containsControlCharacter &&
    !/[/\\[\]{}]/u.test(value) &&
    !value.includes("${") &&
    !value.startsWith(":")
  );
}

function decodeParameter(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return isSafeParameter(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function withoutExpoGroups(path: string): string {
  const segments = path
    .split("/")
    .filter((segment) =>
      segment !== "" && !/^\([^)]+\)$/u.test(segment),
    );
  return `/${segments.join("/")}`;
}

function routeCandidate(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.includes("${")) {
    return null;
  }
  let path: string;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      path =
        url.protocol === "http:" || url.protocol === "https:"
          ? url.pathname
          : `/${[url.hostname, ...url.pathname.split("/")]
              .filter(Boolean)
              .join("/")}`;
    } catch {
      return null;
    }
  } else if (trimmed.startsWith("/")) {
    path = trimmed.split(/[?#]/u, 1)[0] ?? "";
  } else {
    return null;
  }
  const normalized = withoutExpoGroups(path.replace(/\/+/gu, "/"));
  return normalized === "/" || normalized.length > 2_048
    ? null
    : normalized;
}

function extractStaticLiterals(content: string): readonly StaticLiteral[] {
  const literals: StaticLiteral[] = [];
  let index = 0;
  let blockComment = false;
  while (
    index < content.length &&
    literals.length < MAX_STATIC_LITERALS
  ) {
    const current = content[index]!;
    const next = content[index + 1];
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 2;
      continue;
    }
    if (current === "/" && next === "/") {
      const newline = content.indexOf("\n", index + 2);
      index = newline === -1 ? content.length : newline + 1;
      continue;
    }
    if (current !== "'" && current !== '"' && current !== "`") {
      index += 1;
      continue;
    }
    const quote = current;
    const start = index;
    let value = "";
    let interpolated = false;
    index += 1;
    while (index < content.length) {
      const character = content[index]!;
      if (character === "\\") {
        const escaped = content[index + 1];
        if (escaped === undefined) {
          index += 1;
          break;
        }
        value +=
          escaped === "n"
            ? "\n"
            : escaped === "r"
              ? "\r"
              : escaped === "t"
                ? "\t"
                : escaped;
        index += 2;
        continue;
      }
      if (quote === "`" && character === "$" && content[index + 1] === "{") {
        interpolated = true;
      }
      if (character === quote) {
        index += 1;
        if (!interpolated) {
          literals.push(Object.freeze({ value, offset: start }));
        }
        break;
      }
      value += character;
      index += 1;
    }
  }
  return Object.freeze(literals);
}

function isStaticConstant(
  content: string,
  literal: StaticLiteral,
): boolean {
  const lineStart = content.lastIndexOf("\n", literal.offset - 1) + 1;
  const prefix = content.slice(lineStart, literal.offset);
  return /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*:[^=]+)?\s*=\s*$/u
    .test(prefix);
}

function maestroScalars(content: string): readonly StaticLiteral[] {
  const scalars: StaticLiteral[] = [];
  const pattern =
    /^\s*(?:-\s*)?openLink\s*:\s*(?:\n\s+(?:link|uri)\s*:\s*)?([^\s#]+)\s*$/gmu;
  for (const match of content.matchAll(pattern)) {
    const value = match[1];
    if (value !== undefined) {
      scalars.push(Object.freeze({
        value: value.replace(/^['"]|['"]$/gu, ""),
        offset: match.index,
      }));
    }
  }
  return Object.freeze(scalars);
}

function evidenceKind(path: string): EvidenceKind | null {
  if (MAESTRO_SOURCE.test(path)) {
    return "maestro";
  }
  if (TEST_SOURCE.test(path)) {
    return "test";
  }
  return CODE_SOURCE.test(path) ? "source-constant" : null;
}

function matchRoute(
  route: CaptureRoutePlan,
  candidate: string,
): ResolvedScenarioFixture["parameters"] | null {
  const routeSegments = route.path.split("/").filter(Boolean);
  const candidateSegments = candidate.split("/").filter(Boolean);
  const parameters: { readonly key: string; readonly value: string }[] = [];
  let candidateIndex = 0;
  for (let routeIndex = 0; routeIndex < routeSegments.length; routeIndex += 1) {
    const expected = routeSegments[routeIndex]!;
    if (!expected.startsWith(":")) {
      if (candidateSegments[candidateIndex] !== expected) {
        return null;
      }
      candidateIndex += 1;
      continue;
    }
    const catchAll = expected.endsWith("*");
    const key = expected.slice(1, catchAll ? -1 : undefined);
    const rawValue = catchAll
      ? candidateSegments.slice(candidateIndex).join("/")
      : candidateSegments[candidateIndex];
    if (rawValue === undefined || rawValue === "") {
      return null;
    }
    const decoded = catchAll
      ? rawValue
          .split("/")
          .map(decodeParameter)
          .filter((value): value is string => value !== null)
          .join("/")
      : decodeParameter(rawValue);
    if (
      decoded === null ||
      decoded === "" ||
      (catchAll &&
        decoded.split("/").length !== rawValue.split("/").length)
    ) {
      return null;
    }
    parameters.push(Object.freeze({ key, value: decoded }));
    candidateIndex = catchAll
      ? candidateSegments.length
      : candidateIndex + 1;
  }
  if (candidateIndex !== candidateSegments.length) {
    return null;
  }
  return Object.freeze(parameters);
}

function priority(kind: EvidenceKind): number {
  return kind === "maestro" ? 0 : kind === "test" ? 1 : 2;
}

function contractsMatch(
  route: CaptureRoutePlan,
  scenario: CaptureScenarioPlan,
): boolean {
  const routeNames = route.parameters.map(({ name }) => name);
  return (
    scenario.fixture.status === "required" &&
    scenario.routeId === route.routeId &&
    scenario.routePath === route.path &&
    routeNames.length > 0 &&
    routeNames.length === scenario.fixture.parameterNames.length &&
    routeNames.every(
      (name, index) => name === scenario.fixture.parameterNames[index],
    )
  );
}

export function isPersistableResolvedFixture(
  route: CaptureRoutePlan,
  fixture: ResolvedScenarioFixture,
): boolean {
  if (
    fixture.parameters.length !== route.parameters.length ||
    fixture.parameters.some(
      ({ key, value }, index) =>
        route.parameters[index]?.name !== key ||
        SENSITIVE_PARAMETER_NAME.test(key) ||
        SENSITIVE_PARAMETER_VALUE.test(value) ||
        !isSafeParameter(value),
    ) ||
    SENSITIVE_PARAMETER_VALUE.test(fixture.fixtureProfile) ||
    (fixture.readinessSelector !== null &&
      SENSITIVE_PARAMETER_VALUE.test(fixture.readinessSelector))
  ) {
    return false;
  }
  return true;
}

export function resolveDeterministicRepositoryFixture(
  input: FixtureResolutionInput,
): ResolvedScenarioFixture | null {
  if (!contractsMatch(input.route, input.scenario)) {
    return null;
  }
  const evidence: RouteEvidence[] = [];
  for (const entry of input.manifest.entries) {
    const kind = evidenceKind(entry.path);
    if (kind === null) {
      continue;
    }
    const literals = [
      ...extractStaticLiterals(entry.content),
      ...(kind === "maestro" ? maestroScalars(entry.content) : []),
    ];
    for (const literal of literals) {
      if (
        kind === "source-constant" &&
        !isStaticConstant(entry.content, literal)
      ) {
        continue;
      }
      const candidate = routeCandidate(literal.value);
      const parameters =
        candidate === null ? null : matchRoute(input.route, candidate);
      if (
        parameters === null ||
        parameters.length !== input.route.parameters.length
      ) {
        continue;
      }
      evidence.push(Object.freeze({
        kind,
        path: entry.path,
        offset: literal.offset,
        parameters,
      }));
    }
  }
  const selected = evidence
    .sort((left, right) =>
      priority(left.kind) - priority(right.kind) ||
      left.path.localeCompare(right.path) ||
      left.offset - right.offset,
    )
    .at(0);
  if (selected === undefined) {
    return null;
  }
  const fixture = Object.freeze({
    parameters: selected.parameters,
    fixtureProfile: "repository-route-evidence",
    readinessSelector: null,
  });
  return isPersistableResolvedFixture(input.route, fixture)
    ? fixture
    : null;
}
