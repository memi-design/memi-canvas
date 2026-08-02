import { createHash } from "node:crypto";
import { hashCanonicalValue } from "@memi/canonical-json";

import {
  CapturePlanSchema,
  CoverageLedgerSchema,
  DesignSystemManifestSchema,
  FlowIdSchema,
  FlowManifestSchema,
  ProductManifestSchema,
  ProjectIdSchema,
  RouteIdSchema,
  RouteManifestSchema,
  StateIdSchema,
  StateManifestSchema,
  validateFlowManifestBindings,
  CapturePlanIdSchema,
  CoverageCellIdSchema,
  type CapturePlan,
  type CoverageLedger,
  type DesignSystemManifest,
  type FlowManifest,
  type ProductManifest,
  type RouteManifest,
  type StateManifest,
} from "@memi/protocol";

import {
  normalizeCompilerAuthority,
  type ImportReadBudgets,
  type RepositoryAuthority,
} from "./compiler-authority.js";
import {
  parseDeclaredFlows,
  type DeclaredFlow,
} from "./flow-declarations.js";
import {
  readVerifiedInputBatch,
  type VerifiedInput,
} from "./input-snapshot.js";

export type {
  ImportReadBudgets,
  RepositoryAuthority,
} from "./compiler-authority.js";

const INPUT_PATHS = [
  "package.json",
  "src/app/routes.tsx",
  "src/app/screen-states.ts",
  "src/app/flows.ts",
  "src/styles/tokens.css",
] as const;

const ROUTES_PATH = "src/app/routes.tsx";
const STATES_PATH = "src/app/screen-states.ts";
const FLOWS_PATH = "src/app/flows.ts";
const TOKENS_PATH = "src/styles/tokens.css";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const INVALIDATION_ORDER = [
  "route-manifest",
  "state-manifest",
  "flow-manifest",
  "capture-plan",
  "coverage-ledger",
  "design-system",
  "screen-captures",
] as const;

export interface ImportInvalidation {
  readonly changedInputPaths: readonly string[];
  readonly unchangedInputPaths: readonly string[];
  readonly invalidatedArtifactKinds: readonly string[];
  readonly recaptureCellIds: readonly string[];
}

export interface ProductImportResult {
  readonly productManifest: ProductManifest;
  readonly routeManifest: RouteManifest;
  readonly stateManifest: StateManifest;
  readonly flowManifest: FlowManifest;
  readonly designSystemManifest: DesignSystemManifest;
  readonly capturePlan: CapturePlan;
  readonly coverageLedger: CoverageLedger;
  readonly contentFingerprint: string;
  readonly compilerFingerprint: string;
  readonly inputFingerprints: Readonly<Record<string, string>>;
  readonly invalidation: ImportInvalidation;
  readonly modelTokenUsage: 0;
  readonly executionMode: "deterministic";
}

export interface CompileProductImportOptions {
  readonly rootDir: string;
  readonly projectId: string;
  readonly repository: RepositoryAuthority;
  readonly adapterVersion: string;
  readonly budgets: ImportReadBudgets;
  readonly previous?: ProductImportResult;
}

type InputFile = VerifiedInput<(typeof INPUT_PATHS)[number]>;

interface DiscoveredRoute {
  readonly key: string;
  readonly name: string;
  readonly path: string;
  readonly screen: string;
}

interface DiscoveredState {
  readonly routeKey: string;
  readonly key: string;
}

interface DiscoveredToken {
  readonly name: string;
  readonly cssVariable: string;
  readonly value: string;
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function inputText(inputs: readonly InputFile[], path: InputFile["path"]): string {
  const input = inputs.find((candidate) => candidate.path === path);
  if (input === undefined) {
    throw new Error(`Required import input was not read: ${path}`);
  }
  return input.bytes.toString("utf8");
}

function requiredCapture(
  value: string | undefined,
  description: string,
): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Could not parse ${description}`);
  }
  return value;
}

function parseRoutes(source: string): readonly DiscoveredRoute[] {
  const routePattern =
    /\{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*path:\s*"([^"]+)",\s*screen:\s*"([^"]+)",?\s*\}/g;
  return Array.from(source.matchAll(routePattern), (match) => ({
    key: requiredCapture(match[1], "route id"),
    name: requiredCapture(match[2], "route name"),
    path: requiredCapture(match[3], "route path"),
    screen: requiredCapture(match[4], "route screen"),
  }));
}

function parseStates(source: string): readonly DiscoveredState[] {
  const routeStatePattern = /^\s*([A-Za-z][\w-]*):\s*\[([^\]]*)\]/gm;
  return Array.from(source.matchAll(routeStatePattern)).flatMap((match) => {
    const routeKey = requiredCapture(match[1], "state route id");
    const stateList = requiredCapture(match[2], "state list");
    return Array.from(stateList.matchAll(/"([^"]+)"/g), (stateMatch) => ({
      routeKey,
      key: requiredCapture(stateMatch[1], "state id"),
    }));
  });
}

function parseTokens(source: string): readonly DiscoveredToken[] {
  const tokenPattern = /^\s*(--[a-z0-9-]+):\s*([^;]+);/gim;
  return Array.from(source.matchAll(tokenPattern), (match) => {
    const cssVariable = requiredCapture(match[1], "CSS variable");
    return {
      name: cssVariable.slice(2).replaceAll("-", "."),
      cssVariable,
      value: requiredCapture(match[2], "CSS token value").trim(),
    };
  });
}

function validateDiscovery(
  routes: readonly DiscoveredRoute[],
  states: readonly DiscoveredState[],
  flows: readonly DeclaredFlow[],
  tokens: readonly DiscoveredToken[],
): void {
  if (routes.length === 0) {
    throw new Error(`No routes discovered in ${ROUTES_PATH}`);
  }
  if (states.length === 0) {
    throw new Error(`No screen states discovered in ${STATES_PATH}`);
  }
  if (flows.length === 0) {
    throw new Error(`No declared flows discovered in ${FLOWS_PATH}`);
  }
  if (tokens.length === 0) {
    throw new Error(`No design tokens discovered in ${TOKENS_PATH}`);
  }
  const routeKeys = new Set(routes.map((route) => route.key));
  const orphan = states.find((state) => !routeKeys.has(state.routeKey));
  if (orphan !== undefined) {
    throw new Error(
      `Screen state "${orphan.key}" references unknown route "${orphan.routeKey}"`,
    );
  }
  const stateKeys = new Set(
    states.map((state) => `${state.routeKey}:${state.key}`),
  );
  for (const flow of flows) {
    for (const step of flow.steps) {
      if (!routeKeys.has(step.route)) {
        throw new Error(
          `Declared flow "${flow.key}" references unknown route "${step.route}"`,
        );
      }
      if (!stateKeys.has(`${step.route}:${step.state}`)) {
        const stateOwner = states.find((state) => state.key === step.state);
        if (stateOwner !== undefined) {
          throw new Error(
            `Declared flow state "${step.state}" does not belong to route "${step.route}"`,
          );
        }
        throw new Error(
          `Declared flow "${flow.key}" references unknown state "${step.state}"`,
        );
      }
    }
  }
}

function deterministicBody(seed: string): string {
  let value = BigInt(`0x${createHash("sha256").update(seed).digest("hex")}`);
  let output = "";
  for (let index = 0; index < 26; index += 1) {
    output = CROCKFORD[Number(value & 31n)] + output;
    value >>= 5n;
  }
  return output;
}

function contentFingerprint(
  inputs: readonly InputFile[],
  metadata: object,
): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(metadata));
  for (const input of inputs) {
    hash.update(input.path);
    hash.update("\0");
    hash.update(input.bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function invalidatedArtifacts(
  changedInputPaths: readonly string[],
  compilerChanged: boolean,
): readonly string[] {
  const routeInputsChanged = changedInputPaths.some(
    (path) => path === ROUTES_PATH || path === STATES_PATH,
  );
  const invalidated = new Set<string>();
  if (
    compilerChanged ||
    routeInputsChanged ||
    changedInputPaths.includes("package.json")
  ) {
    for (const artifact of [
      "route-manifest",
      "state-manifest",
      "flow-manifest",
      "capture-plan",
      "coverage-ledger",
      "screen-captures",
    ]) {
      invalidated.add(artifact);
    }
  }
  if (changedInputPaths.includes(TOKENS_PATH)) {
    invalidated.add("design-system");
    invalidated.add("screen-captures");
  }
  if (changedInputPaths.includes(FLOWS_PATH)) {
    invalidated.add("flow-manifest");
  }
  return INVALIDATION_ORDER.filter((artifact) => invalidated.has(artifact));
}

function buildInvalidation(
  inputFingerprints: Readonly<Record<string, string>>,
  compilerFingerprint: string,
  previous: ProductImportResult | undefined,
  coverageCellIds: readonly string[],
): ImportInvalidation {
  if (previous === undefined) {
    return {
      changedInputPaths: [],
      unchangedInputPaths: [],
      invalidatedArtifactKinds: [],
      recaptureCellIds: [],
    };
  }
  const changedInputPaths = INPUT_PATHS.filter(
    (path) => previous.inputFingerprints[path] !== inputFingerprints[path],
  );
  const unchangedInputPaths = INPUT_PATHS.filter(
    (path) => previous.inputFingerprints[path] === inputFingerprints[path],
  );
  const artifactKinds = invalidatedArtifacts(
    changedInputPaths,
    previous.compilerFingerprint !== compilerFingerprint,
  );
  return {
    changedInputPaths,
    unchangedInputPaths,
    invalidatedArtifactKinds: artifactKinds,
    recaptureCellIds: artifactKinds.includes("screen-captures")
      ? coverageCellIds
      : [],
  };
}

type CanonicalStateKind =
  | "default"
  | "loading"
  | "empty"
  | "error"
  | "success"
  | "overlay"
  | "validation"
  | "permission";

function stateKind(key: string): CanonicalStateKind {
  const canonicalKinds = new Set<CanonicalStateKind>([
    "default",
    "loading",
    "empty",
    "error",
    "success",
    "overlay",
    "validation",
    "permission",
  ]);
  if (canonicalKinds.has(key as CanonicalStateKind)) {
    return key as CanonicalStateKind;
  }
  throw new Error(`Unsupported state kind "${key}"; declare an adapter mapping.`);
}

export async function compileProductImport(
  options: CompileProductImportOptions,
): Promise<ProductImportResult> {
  const projectId = ProjectIdSchema.parse(options.projectId);
  const authority = normalizeCompilerAuthority(
    {
      repository: options.repository,
      budgets: options.budgets,
      adapterVersion: options.adapterVersion,
    },
    VIEWPORTS,
  );
  const { repository, budgets, compilerFingerprint } = authority;
  const { root, inputs } = await readVerifiedInputBatch({
    rootDir: options.rootDir,
    inputPaths: INPUT_PATHS,
    budgets,
  });
  const discoveredRoutes = parseRoutes(inputText(inputs, ROUTES_PATH));
  const discoveredStates = parseStates(inputText(inputs, STATES_PATH));
  const declaredFlows = parseDeclaredFlows(inputText(inputs, FLOWS_PATH));
  const discoveredTokens = parseTokens(inputText(inputs, TOKENS_PATH));
  validateDiscovery(
    discoveredRoutes,
    discoveredStates,
    declaredFlows,
    discoveredTokens,
  );

  const sourceContentFingerprint = contentFingerprint(inputs, {
    protocolVersion: 1,
  });
  const capturePlanFingerprint = contentFingerprint(
    inputs.filter((input) =>
      ["package.json", ROUTES_PATH, STATES_PATH].includes(input.path),
    ),
    { compilerFingerprint },
  );
  const routeIds = new Map(
    discoveredRoutes.map((route) => [
      route.key,
      RouteIdSchema.parse(`rte_${deterministicBody(`${projectId}:${route.key}`)}`),
    ]),
  );
  const stateIds = new Map(
    discoveredStates.map((state) => [
      `${state.routeKey}:${state.key}`,
      StateIdSchema.parse(
        `sta_${deterministicBody(`${projectId}:${state.routeKey}:${state.key}`)}`,
      ),
    ]),
  );
  const flowIds = new Map(
    declaredFlows.map((flow) => [
      flow.key,
      FlowIdSchema.parse(
        `flw_${deterministicBody(`${projectId}:${flow.key}`)}`,
      ),
    ]),
  );
  const capturePlanId = CapturePlanIdSchema.parse(
    `cap_${deterministicBody(
      `${projectId}:${capturePlanFingerprint}:capture-plan`,
    )}`,
  );

  const productManifest = ProductManifestSchema.parse({
    schemaVersion: 1,
    projectId,
    importMode: "repository",
    source: {
      kind: "repository",
      root,
      revision: repository.revision,
      dirty: repository.dirty,
      dirtyFileFingerprint: repository.dirtyFileFingerprint,
    },
    framework: { kind: "vite-react", confidence: "inferred" },
    commands: {
      install: { executable: "npm", args: ["ci", "--ignore-scripts"] },
      preview: { executable: "npm", args: ["run", "dev"] },
    },
    dimensions: {
      roles: ["anonymous"],
      themes: ["light"],
      locales: ["en-US"],
      flags: [],
      fixtures: ["default"],
    },
  });

  const routeManifest = RouteManifestSchema.parse({
    schemaVersion: 1,
    projectId,
    routes: discoveredRoutes.map((route) => ({
      id: routeIds.get(route.key),
      displayName: route.name,
      path: route.path,
      sourceScreen: route.screen,
      sourceOwnership: "code-owned",
      sourceFile: ROUTES_PATH,
      authentication: "public",
      parameters: [],
    })),
  });

  const stateManifest = StateManifestSchema.parse({
    schemaVersion: 1,
    projectId,
    states: discoveredStates.map((state) => ({
      id: stateIds.get(`${state.routeKey}:${state.key}`),
      routeId: routeIds.get(state.routeKey),
      name: state.key,
      kind: stateKind(state.key),
      provenance: "declared",
    })),
  });
  const flowManifest = FlowManifestSchema.parse({
    schemaVersion: 1,
    projectId,
    sourceContentFingerprint,
    compilerFingerprint,
    sourceFile: FLOWS_PATH,
    routeManifestDigest: hashCanonicalValue(routeManifest),
    stateManifestDigest: hashCanonicalValue(stateManifest),
    flows: declaredFlows.map((flow) => ({
      id: flowIds.get(flow.key),
      name: flow.name,
      provenance: flow.provenance,
      steps: flow.steps.map((step) => ({
        order: step.order,
        routeId: routeIds.get(step.route),
        stateId: stateIds.get(`${step.route}:${step.state}`),
        trigger: step.trigger,
        assertion: step.assertion,
      })),
    })),
  });
  validateFlowManifestBindings({
    flowManifest,
    routeManifest,
    stateManifest,
    sourceContentFingerprint,
    compilerFingerprint,
  });

  const coverageCells = discoveredStates.flatMap((state) =>
    VIEWPORTS.map((viewport) => {
      const routeId = routeIds.get(state.routeKey)!;
      const stateId = stateIds.get(`${state.routeKey}:${state.key}`)!;
      return {
        id: CoverageCellIdSchema.parse(
          `cov_${deterministicBody(
            `${projectId}:${state.routeKey}:${state.key}:${viewport.name}`,
          )}`,
        ),
        routeId,
        stateId,
        role: "anonymous",
        theme: "light",
        locale: "en-US",
        fixture: "default",
        viewport,
        health: "partial" as const,
        evidenceLevel: "inferred" as const,
        frameKind: "code-frame" as const,
        reason: "runtime-capture-not-run",
        evidenceArtifactIds: [],
      };
    }),
  );

  const capturePlan = CapturePlanSchema.parse({
    schemaVersion: 1,
    id: capturePlanId,
    projectId,
    sourceRevision: repository.revision,
    budgets: {
      maxCells: 500,
      maxRuntimeSeconds: 900,
      maxConcurrency: 2,
      maxBrowserStorageBytes: 64 * 1024 * 1024,
      maxArtifactBytes: 1024 * 1024 * 1024,
    },
    cells: coverageCells.map((cell) => ({
      coverageCellId: cell.id,
      priority: "default",
      status: "planned",
    })),
  });

  const coverageLedger = CoverageLedgerSchema.parse({
    schemaVersion: 1,
    projectId,
    capturePlanId,
    cells: coverageCells,
  });
  const designSystemManifest = DesignSystemManifestSchema.parse({
    schemaVersion: 1,
    projectId,
    tokens: discoveredTokens.map((token) => ({
      ...token,
      sourceFile: TOKENS_PATH,
      provenance: "declared",
    })),
  });
  const inputFingerprints = Object.fromEntries(
    inputs.map((input) => [input.path, input.fingerprint]),
  );

  return {
    productManifest,
    routeManifest,
    stateManifest,
    flowManifest,
    designSystemManifest,
    capturePlan,
    coverageLedger,
    contentFingerprint: sourceContentFingerprint,
    compilerFingerprint,
    inputFingerprints,
    invalidation: buildInvalidation(
      inputFingerprints,
      compilerFingerprint,
      options.previous,
      coverageCells.map((cell) => cell.id),
    ),
    modelTokenUsage: 0,
    executionMode: "deterministic",
  };
}
