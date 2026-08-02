export interface ExpoRouteParameter {
  readonly key: string;
  readonly value: string;
}

export interface ExpoStandaloneDeepLinkInput {
  readonly scheme: string;
  readonly route: string;
  readonly parameters: readonly ExpoRouteParameter[];
  readonly attestation?: Readonly<{
    nonce: string;
    state: string;
  }>;
}

export interface ExpoStandaloneDeepLink {
  readonly concreteRoute: string;
  readonly url: string;
}

const EXPO_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]{0,127}$/u;
const PARAMETER_SEGMENT = /^:([A-Za-z0-9_-]{1,160})(\*)?$/u;
const ATTESTATION_NONCE = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

function assertRoute(route: string): readonly string[] {
  if (
    route !== route.trim() ||
    !route.startsWith("/") ||
    route.includes("\\") ||
    route.includes("\0") ||
    route.includes("?") ||
    route.includes("#") ||
    route.split("/").some((segment, index) =>
      index > 0 && (segment === "" || segment === "." || segment === "..")
    )
  ) {
    throw new Error("Expo route must be a canonical absolute route path.");
  }
  return Object.freeze(route.split("/").slice(1));
}

function assertParameterSegment(value: string, key: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new Error(`Expo route parameter ${key} must be one route segment.`);
  }
}

export function materializeExpoRoute(
  route: string,
  parameters: readonly ExpoRouteParameter[],
): string {
  const routeSegments = assertRoute(route);
  const values = new Map<string, string>();
  for (const parameter of parameters) {
    if (values.has(parameter.key)) {
      throw new Error(`Expo route parameter ${parameter.key} is duplicated.`);
    }
    values.set(parameter.key, parameter.value);
  }
  const used = new Set<string>();
  const concreteSegments = routeSegments.flatMap((segment) => {
    const match = segment.match(PARAMETER_SEGMENT);
    if (match === null) {
      return [segment];
    }
    const key = match[1]!;
    const value = values.get(key);
    if (value === undefined) {
      throw new Error(`Expo route parameter ${key} is missing.`);
    }
    used.add(key);
    if (match[2] === "*") {
      const catchAllSegments = value.split("/");
      catchAllSegments.forEach((part) =>
        assertParameterSegment(part, key)
      );
      return catchAllSegments.map(encodeURIComponent);
    }
    assertParameterSegment(value, key);
    return [encodeURIComponent(value)];
  });
  const unused = [...values.keys()].filter((key) => !used.has(key));
  if (unused.length > 0) {
    throw new Error(
      `Expo route parameters are not used by the route: ${unused.join(", ")}.`,
    );
  }
  return concreteSegments.length === 0
    ? "/"
    : `/${concreteSegments.join("/")}`;
}

export function createExpoStandaloneDeepLink(
  input: ExpoStandaloneDeepLinkInput,
): ExpoStandaloneDeepLink {
  if (!EXPO_SCHEME.test(input.scheme)) {
    throw new Error("Expo URL scheme is invalid.");
  }
  const concreteRoute = materializeExpoRoute(
    input.route,
    input.parameters,
  );
  let query = "";
  if (input.attestation !== undefined) {
    if (!ATTESTATION_NONCE.test(input.attestation.nonce)) {
      throw new Error("Expo route attestation nonce is invalid.");
    }
    if (
      input.attestation.state.length === 0 ||
      input.attestation.state.length > 160 ||
      input.attestation.state.trim() !== input.attestation.state ||
      input.attestation.state.includes("\0")
    ) {
      throw new Error("Expo route attestation state is invalid.");
    }
    query =
      `?__memi_capture=${input.attestation.nonce}` +
      `&__memi_state=${encodeURIComponent(input.attestation.state)}`;
  }
  return Object.freeze({
    concreteRoute,
    url: `${input.scheme}://${concreteRoute}${query}`,
  });
}
