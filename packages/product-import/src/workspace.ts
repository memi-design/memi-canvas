import { hashCanonicalValue } from "@memi/canonical-json";
import type { ProductImportResult } from "@memi/import-compiler";
import {
  CapturePlanSchema,
  ContainedRelativeSourcePathSchema,
  ContentHashSchema,
  CoverageLedgerSchema,
  DesignSystemManifestSchema,
  FlowManifestSchema,
  GitRevisionSchema,
  ProductManifestSchema,
  ProjectIdSchema,
  RouteManifestSchema,
  StateManifestSchema,
  validateFlowManifestBindings,
} from "@memi/protocol";

import {
  assertAllowedKeys,
  assertExactKeys,
  assertUnique,
  deepFreeze,
  hashValue,
} from "./shared.js";
import type {
  ProductTruthProjection,
  ProjectionIntegrityDigests,
  ProductWorkspace,
  WorkspaceCaptureCell,
  WorkspaceCoverageCell,
  WorkspaceDesignToken,
  WorkspaceFlow,
  WorkspaceRoute,
  WorkspaceState,
} from "./types.js";

const RESULT_KEYS = [
  "productManifest",
  "routeManifest",
  "stateManifest",
  "flowManifest",
  "designSystemManifest",
  "capturePlan",
  "coverageLedger",
  "contentFingerprint",
  "compilerFingerprint",
  "inputFingerprints",
  "invalidation",
  "modelTokenUsage",
  "executionMode",
] as const;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;

function validateImportMetadata(result: ProductImportResult): void {
  ContentHashSchema.parse(result.contentFingerprint);
  ContentHashSchema.parse(result.compilerFingerprint);
  if (result.modelTokenUsage !== 0 || result.executionMode !== "deterministic") {
    throw new Error("Product import must remain deterministic and zero-token.");
  }
  if (
    result.inputFingerprints === null ||
    typeof result.inputFingerprints !== "object" ||
    Array.isArray(result.inputFingerprints)
  ) {
    throw new TypeError("Input fingerprints must be a plain object.");
  }
  for (const fingerprint of Object.values(result.inputFingerprints)) {
    ContentHashSchema.parse(fingerprint);
  }
  assertExactKeys(
    result.invalidation,
    [
      "changedInputPaths",
      "unchangedInputPaths",
      "invalidatedArtifactKinds",
      "recaptureCellIds",
    ],
    "Import invalidation",
  );
  for (const value of Object.values(result.invalidation)) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new TypeError("Import invalidation fields must be string arrays.");
    }
  }
}

function sanitizedProduct(
  product: ReturnType<typeof ProductManifestSchema.parse>,
): ProductTruthProjection {
  const base = {
    schemaVersion: product.schemaVersion,
    projectId: product.projectId,
    importMode: product.importMode,
    dimensions: structuredClone(product.dimensions),
  };
  if (product.source.kind === "repository") {
    return {
      ...base,
      source: {
        kind: product.source.kind,
        revision: product.source.revision,
        dirty: product.source.dirty,
        dirtyFileFingerprint: product.source.dirtyFileFingerprint,
      },
      ...("framework" in product
        ? { framework: structuredClone(product.framework) }
        : {}),
    };
  }
  if (
    product.source.kind === "static-build" ||
    product.source.kind === "screenshot-folder"
  ) {
    return {
      ...base,
      source: {
        kind: product.source.kind,
        contentFingerprint: product.source.contentFingerprint,
      },
      ...("framework" in product
        ? { framework: structuredClone(product.framework) }
        : {}),
    };
  }
  if (product.source.kind === "running-url") {
    return {
      ...base,
      source: {
        kind: "running-url",
        loopbackOrigin: new URL(product.source.url).origin,
      },
    };
  }
  return {
    ...base,
    source: structuredClone(product.source),
  };
}

function copyRoutes(
  routes: ReturnType<typeof RouteManifestSchema.parse>["routes"],
): readonly WorkspaceRoute[] {
  return structuredClone(routes);
}

function copyStates(
  states: ReturnType<typeof StateManifestSchema.parse>["states"],
): readonly WorkspaceState[] {
  return states.map((state) => ({ ...state }));
}

function copyFlows(
  flows: ReturnType<typeof FlowManifestSchema.parse>["flows"],
): readonly WorkspaceFlow[] {
  return flows.map((flow) => ({
    ...flow,
    steps: flow.steps.map((step) => ({ ...step })),
  }));
}

function copyTokens(
  tokens: ReturnType<typeof DesignSystemManifestSchema.parse>["tokens"],
): readonly WorkspaceDesignToken[] {
  return tokens.map((token) => ({ ...token }));
}

function copyCaptureCells(
  cells: ReturnType<typeof CapturePlanSchema.parse>["cells"],
): readonly WorkspaceCaptureCell[] {
  return cells.map((cell) => ({
    coverageCellId: cell.coverageCellId,
    priority: cell.priority,
    status: cell.status,
    ...(cell.reason === undefined ? {} : { reason: cell.reason }),
  }));
}

function copyCoverageCell(
  cell: ReturnType<typeof CoverageLedgerSchema.parse>["cells"][number],
): WorkspaceCoverageCell {
  return {
    id: cell.id,
    routeId: cell.routeId,
    stateId: cell.stateId,
    role: cell.role,
    theme: cell.theme,
    locale: cell.locale,
    fixture: cell.fixture,
    viewport: { ...cell.viewport } as WorkspaceCoverageCell["viewport"],
    health: cell.health,
    evidenceLevel: cell.evidenceLevel,
    frameKind: cell.frameKind,
    ...(cell.reason === undefined ? {} : { reason: cell.reason }),
    evidenceArtifactIds: [...cell.evidenceArtifactIds],
    ...(cell.evidenceHash === undefined
      ? {}
      : { evidenceHash: cell.evidenceHash }),
  };
}

function assertManifestProjectBindings(
  projectId: string,
  manifests: readonly { readonly projectId: string }[],
): void {
  if (manifests.some((manifest) => manifest.projectId !== projectId)) {
    throw new Error("Imported manifests do not share one project identity.");
  }
}

function canonicalCoverageOrder(
  routes: readonly WorkspaceRoute[],
  states: readonly WorkspaceState[],
  cells: readonly WorkspaceCoverageCell[],
): readonly WorkspaceCoverageCell[] {
  const cellByKey = new Map<string, WorkspaceCoverageCell>();
  for (const cell of cells) {
    const key = `${cell.routeId}:${cell.stateId}:${cell.viewport.name}`;
    if (cellByKey.has(key)) {
      throw new Error("Coverage graph contains a duplicate route-state-viewport.");
    }
    cellByKey.set(key, cell);
  }
  const ordered: WorkspaceCoverageCell[] = [];
  for (const route of routes) {
    for (const state of states.filter((candidate) => candidate.routeId === route.id)) {
      for (const viewport of VIEWPORTS) {
        const cell = cellByKey.get(`${route.id}:${state.id}:${viewport.name}`);
        if (cell === undefined) {
          throw new Error("Coverage graph is missing a route-state-viewport.");
        }
        if (
          cell.viewport.width !== viewport.width ||
          cell.viewport.height !== viewport.height
        ) {
          throw new Error(`Coverage viewport "${viewport.name}" has invalid dimensions.`);
        }
        ordered.push(cell);
      }
    }
  }
  if (ordered.length !== cells.length) {
    throw new Error("Coverage graph contains an unknown route or state binding.");
  }
  return ordered;
}

function assertGraph(
  workspace: Omit<ProductWorkspace, "workspaceDigest">,
): void {
  const routeIds = new Set(workspace.routes.map((route) => route.id));
  const stateById = new Map(workspace.states.map((state) => [state.id, state]));
  if (workspace.states.some((state) => !routeIds.has(state.routeId))) {
    throw new Error("State graph references an unknown route.");
  }
  for (const flow of workspace.flows) {
    for (const step of flow.steps) {
      const state = stateById.get(step.stateId);
      if (
        !routeIds.has(step.routeId) ||
        state === undefined ||
        state.routeId !== step.routeId
      ) {
        throw new Error("Flow graph contains an invalid route-state binding.");
      }
    }
  }
  const ordered = canonicalCoverageOrder(
    workspace.routes,
    workspace.states,
    workspace.coverageCells,
  );
  if (
    ordered.some(
      (cell, index) => cell.id !== workspace.coverageCells[index]?.id,
    )
  ) {
    throw new Error("Coverage ledger is not in canonical state-major order.");
  }
  if (
    workspace.captureCells.length !== workspace.coverageCells.length ||
    workspace.captureCells.some(
      (cell, index) =>
        cell.coverageCellId !== workspace.coverageCells[index]?.id,
    )
  ) {
    throw new Error("Capture plan and coverage ledger are not an exact bijection.");
  }
  for (const [index, cell] of workspace.coverageCells.entries()) {
    const state = stateById.get(cell.stateId);
    if (state === undefined || state.routeId !== cell.routeId) {
      throw new Error("Coverage cell contains a cross-route state binding.");
    }
    const capture = workspace.captureCells[index]!;
    const blocked = cell.health === "blocked";
    if (blocked !== (capture.status === "blocked")) {
      throw new Error("Blocked coverage truth and capture status disagree.");
    }
    if (
      capture.status === "verified" ||
      cell.health === "current" ||
      cell.evidenceLevel === "verified"
    ) {
      throw new Error(
        "verified evidence requires trusted artifact authority and resolver validation.",
      );
    }
    if (
      capture.status === "partial" &&
      (cell.health !== "partial" ||
        (cell.evidenceLevel !== "inferred" &&
          cell.evidenceLevel !== "observed"))
    ) {
      throw new Error(
        "Partial capture requires partial inferred or observed coverage.",
      );
    }
    if (capture.status === "stale" && cell.health !== "stale") {
      throw new Error("Stale capture requires stale coverage.");
    }
    if (
      !blocked &&
      (cell.frameKind !== "code-frame" ||
        cell.evidenceLevel === null)
    ) {
      throw new Error("Nonblocked import truth must remain a code frame.");
    }
  }
}

function workspaceBody(
  workspace: ProductWorkspace,
): Omit<ProductWorkspace, "workspaceDigest"> {
  const {
    workspaceDigest: _workspaceDigest,
    ...body
  } = workspace;
  return body;
}

function projectedManifests(workspace: ProductWorkspace) {
  const route = RouteManifestSchema.parse({
    schemaVersion: 1,
    projectId: workspace.projectId,
    routes: workspace.routes,
  });
  const state = StateManifestSchema.parse({
    schemaVersion: 1,
    projectId: workspace.projectId,
    states: workspace.states,
  });
  const flow = FlowManifestSchema.parse({
    schemaVersion: 1,
    projectId: workspace.projectId,
    sourceContentFingerprint: workspace.sourceContentFingerprint,
    compilerFingerprint: workspace.compilerFingerprint,
    sourceFile: workspace.flowSourceFile,
    routeManifestDigest: hashCanonicalValue(route),
    stateManifestDigest: hashCanonicalValue(state),
    flows: workspace.flows,
  });
  const designSystem = DesignSystemManifestSchema.parse({
    schemaVersion: 1,
    projectId: workspace.projectId,
    tokens: workspace.designTokens,
  });
  const capture = CapturePlanSchema.parse({
    schemaVersion: 1,
    id: workspace.capturePlanId,
    projectId: workspace.projectId,
    sourceRevision: workspace.sourceRevision,
    budgets: workspace.captureBudgets,
    cells: workspace.captureCells,
  });
  const coverage = CoverageLedgerSchema.parse({
    schemaVersion: 1,
    projectId: workspace.projectId,
    capturePlanId: workspace.capturePlanId,
    cells: workspace.coverageCells,
  });
  return { route, state, flow, designSystem, capture, coverage };
}

function projectionDigests(
  productTruth: ProductTruthProjection,
  manifests: ReturnType<typeof projectedManifests>,
): ProjectionIntegrityDigests {
  return {
    product: hashCanonicalValue(productTruth),
    route: hashCanonicalValue(manifests.route),
    state: hashCanonicalValue(manifests.state),
    flow: hashCanonicalValue(manifests.flow),
    designSystem: hashCanonicalValue(manifests.designSystem),
    capture: hashCanonicalValue(manifests.capture),
    coverage: hashCanonicalValue(manifests.coverage),
  };
}

function assertProductTruth(product: ProductTruthProjection): void {
  assertAllowedKeys(
    product,
    ["schemaVersion", "projectId", "importMode", "source", "dimensions"],
    ["framework"],
    "Product truth projection",
  );
  if (product.schemaVersion !== 1) {
    throw new Error("Product truth schema version is invalid.");
  }
  ProjectIdSchema.parse(product.projectId);
  assertExactKeys(
    product.dimensions,
    ["roles", "themes", "locales", "flags", "fixtures"],
    "Product truth dimensions",
  );
  for (const values of Object.values(product.dimensions)) {
    if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
      throw new Error("Product truth dimensions must be string arrays.");
    }
  }
  const source = product.source;
  if (source.kind === "repository") {
    assertExactKeys(
      source,
      ["kind", "revision", "dirty", "dirtyFileFingerprint"],
      "Repository truth",
    );
    GitRevisionSchema.parse(source.revision);
    ContentHashSchema.parse(source.dirtyFileFingerprint);
    if (
      product.importMode !== "repository" &&
      product.importMode !== "storybook"
    ) {
      throw new Error("Repository truth import mode is invalid.");
    }
  } else if (
    source.kind === "static-build" ||
    source.kind === "screenshot-folder"
  ) {
    assertExactKeys(source, ["kind", "contentFingerprint"], "Static source truth");
    ContentHashSchema.parse(source.contentFingerprint);
    if (product.importMode !== source.kind) {
      throw new Error("Static truth import mode is invalid.");
    }
  } else if (source.kind === "running-url") {
    assertExactKeys(source, ["kind", "loopbackOrigin"], "Running URL truth");
    const url = new URL(source.loopbackOrigin);
    if (
      product.importMode !== "running-url" ||
      url.origin !== source.loopbackOrigin ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      throw new Error(
        "Running URL truth must contain only a sanitized HTTP or HTTPS loopback origin.",
      );
    }
  } else {
    assertExactKeys(source, ["kind"], "Blank source truth");
    if (product.importMode !== "blank") {
      throw new Error("Blank truth import mode is invalid.");
    }
  }
}

function assertWorkspaceShape(workspace: ProductWorkspace): void {
  ProjectIdSchema.parse(workspace.projectId);
  GitRevisionSchema.parse(workspace.sourceRevision);
  ContentHashSchema.parse(workspace.sourceContentFingerprint);
  ContentHashSchema.parse(workspace.compilerFingerprint);
  assertProductTruth(workspace.productTruth);
  if (workspace.productTruth.projectId !== workspace.projectId) {
    throw new Error("Product truth project binding is invalid.");
  }
  assertExactKeys(
    workspace.projectionIntegrityDigests,
    ["product", "route", "state", "flow", "designSystem", "capture", "coverage"],
    "Workspace projection integrity digests",
  );
  const manifests = projectedManifests(workspace);
  for (const token of workspace.designTokens) {
    ContainedRelativeSourcePathSchema.parse(token.sourceFile);
  }
  validateFlowManifestBindings({
    flowManifest: manifests.flow,
    routeManifest: manifests.route,
    stateManifest: manifests.state,
    sourceContentFingerprint: workspace.sourceContentFingerprint,
    compilerFingerprint: workspace.compilerFingerprint,
  });
  const expected = projectionDigests(workspace.productTruth, manifests);
  if (
    JSON.stringify(workspace.projectionIntegrityDigests) !==
    JSON.stringify(expected)
  ) {
    throw new Error("Workspace projection integrity digest mismatch.");
  }
}

export function validateProductWorkspace(
  workspace: ProductWorkspace,
): ProductWorkspace {
  assertExactKeys(
    workspace,
    [
      "schemaVersion",
      "workspaceDigest",
      "projectId",
      "sourceRevision",
      "sourceContentFingerprint",
      "compilerFingerprint",
      "productTruth",
      "flowSourceFile",
      "capturePlanId",
      "captureBudgets",
      "projectionIntegrityDigests",
      "routes",
      "states",
      "flows",
      "designTokens",
      "captureCells",
      "coverageCells",
      "counts",
    ],
    "Product workspace",
  );
  assertWorkspaceShape(workspace);
  const body = workspaceBody(workspace);
  if (workspace.workspaceDigest !== hashValue(body)) {
    throw new Error("Product workspace digest is invalid.");
  }
  assertGraph(body);
  const counts = {
    routes: workspace.routes.length,
    states: workspace.states.length,
    coverageCells: workspace.coverageCells.length,
    designTokens: workspace.designTokens.length,
    flows: workspace.flows.length,
    blockedCells: workspace.coverageCells.filter(
      (cell) => cell.health === "blocked",
    ).length,
  };
  if (JSON.stringify(workspace.counts) !== JSON.stringify(counts)) {
    throw new Error("Product workspace counts are invalid.");
  }
  return workspace;
}

export function compileProductWorkspace(
  untrustedResult: ProductImportResult,
): ProductWorkspace {
  assertExactKeys(untrustedResult, RESULT_KEYS, "Product import result");
  validateImportMetadata(untrustedResult);
  const product = ProductManifestSchema.parse(untrustedResult.productManifest);
  const routeManifest = RouteManifestSchema.parse(untrustedResult.routeManifest);
  const stateManifest = StateManifestSchema.parse(untrustedResult.stateManifest);
  const flowManifest = FlowManifestSchema.parse(untrustedResult.flowManifest);
  const designSystem = DesignSystemManifestSchema.parse(
    untrustedResult.designSystemManifest,
  );
  const capturePlan = CapturePlanSchema.parse(untrustedResult.capturePlan);
  const coverageLedger = CoverageLedgerSchema.parse(
    untrustedResult.coverageLedger,
  );
  assertManifestProjectBindings(product.projectId, [
    routeManifest,
    stateManifest,
    flowManifest,
    designSystem,
    capturePlan,
    coverageLedger,
  ]);
  if (
    flowManifest.sourceContentFingerprint !== untrustedResult.contentFingerprint ||
    flowManifest.compilerFingerprint !== untrustedResult.compilerFingerprint
  ) {
    throw new Error("Import result fingerprint bindings do not match.");
  }
  validateFlowManifestBindings({
    flowManifest,
    routeManifest,
    stateManifest,
    sourceContentFingerprint: untrustedResult.contentFingerprint,
    compilerFingerprint: untrustedResult.compilerFingerprint,
  });
  if (
    capturePlan.id !== coverageLedger.capturePlanId ||
    capturePlan.sourceRevision !==
      (product.source.kind === "repository"
        ? product.source.revision
        : capturePlan.sourceRevision)
  ) {
    throw new Error("Capture plan identity or source revision binding is invalid.");
  }

  const routes = copyRoutes(routeManifest.routes);
  const states = copyStates(stateManifest.states);
  const flows = copyFlows(flowManifest.flows);
  const designTokens = copyTokens(designSystem.tokens);
  const captureCells = copyCaptureCells(capturePlan.cells);
  const coverageCells = coverageLedger.cells.map(copyCoverageCell);
  assertUnique(routes.map((route) => route.id), "Route");
  assertUnique(states.map((state) => state.id), "State");
  assertUnique(flows.map((flow) => flow.id), "Flow");
  assertUnique(
    designTokens.flatMap((token) => [token.name, token.cssVariable]),
    "Design token",
  );

  for (const token of designTokens) {
    ContainedRelativeSourcePathSchema.parse(token.sourceFile);
  }
  const productTruth = sanitizedProduct(product);
  const projectionIntegrityDigests = projectionDigests(productTruth, {
    route: routeManifest,
    state: stateManifest,
    flow: flowManifest,
    designSystem,
    capture: capturePlan,
    coverage: coverageLedger,
  });
  const body: Omit<ProductWorkspace, "workspaceDigest"> = {
    schemaVersion: 1,
    projectId: product.projectId,
    sourceRevision: capturePlan.sourceRevision,
    sourceContentFingerprint: untrustedResult.contentFingerprint,
    compilerFingerprint: untrustedResult.compilerFingerprint,
    productTruth,
    flowSourceFile: flowManifest.sourceFile,
    capturePlanId: capturePlan.id,
    captureBudgets: structuredClone(capturePlan.budgets),
    projectionIntegrityDigests,
    routes,
    states,
    flows,
    designTokens,
    captureCells,
    coverageCells,
    counts: {
      routes: routes.length,
      states: states.length,
      coverageCells: coverageCells.length,
      designTokens: designTokens.length,
      flows: flows.length,
      blockedCells: coverageCells.filter((cell) => cell.health === "blocked")
        .length,
    },
  };
  assertGraph(body);
  const workspace: ProductWorkspace = {
    ...body,
    workspaceDigest: hashValue(body),
  };
  validateProductWorkspace(workspace);
  return deepFreeze(workspace);
}
