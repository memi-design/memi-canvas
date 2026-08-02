import { createHash } from "node:crypto";
import {
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  assertNativeDependencyPreparationApproval,
  createNativeDependencyPreparationPlan,
} from "@memi/capture-execution";
import {
  discoverCaptureApplications,
  type CaptureApplicationUnit,
  type CaptureRoutePlan,
  type CaptureScenarioPlan,
} from "@memi/capture-platforms";
import {
  CaptureScenarioSchemaV2,
  ImportApplicationSchemaV2,
  type CaptureScenarioV2,
  type ImportApplicationV2,
  type ImportInventoryV1,
} from "@memi/protocol";

import type {
  ImportCoordinatorOptions,
  ImportPlan,
  ImportRepositoryInspection,
  CaptureAdapterExecutionContext,
  PlannedNativeDependencyPreparation,
  ApprovedNativeDependencyPreparation,
  PlannedRecipeApproval,
} from "./import-coordinator.types.js";
import {
  isPersistableResolvedFixture,
  resolveDeterministicRepositoryFixture,
} from "./deterministic-fixture-resolver.js";

export interface InternalImportPlan {
  readonly publicPlan: ImportPlan;
  readonly inspection: ImportRepositoryInspection;
  readonly applications: readonly ImportApplicationV2[];
  readonly scenarios: readonly CaptureScenarioV2[];
  readonly unitsByApplicationId: ReadonlyMap<string, CaptureApplicationUnit>;
  readonly dependencyPreparations: readonly (
    | PlannedNativeDependencyPreparation
    | ApprovedNativeDependencyPreparation
  )[];
}

function contentHash(content: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export function captureAdapterExecutionContext(
  inspection: ImportRepositoryInspection,
  unit: CaptureApplicationUnit,
): CaptureAdapterExecutionContext {
  const rawManagedRoot = inspection.authority.managedRootPath;
  if (
    !isAbsolute(rawManagedRoot) ||
    rawManagedRoot.includes("\0")
  ) {
    throw new Error(
      "The managed repository authority must be an absolute non-root path.",
    );
  }
  const managedRootPath = resolve(rawManagedRoot);
  if (managedRootPath === parse(managedRootPath).root) {
    throw new Error(
      "The managed repository authority must be an absolute non-root path.",
    );
  }
  const applicationRootPath = resolve(managedRootPath, unit.root);
  const rawSourceRoot = inspection.authority.rootPath;
  if (!isAbsolute(rawSourceRoot) || rawSourceRoot.includes("\0")) {
    throw new Error(
      "The source repository authority must be an absolute non-root path.",
    );
  }
  const sourceRootPath = resolve(rawSourceRoot);
  if (sourceRootPath === parse(sourceRootPath).root) {
    throw new Error(
      "The source repository authority must be an absolute non-root path.",
    );
  }
  const sourceApplicationRootPath = resolve(sourceRootPath, unit.root);
  const relationship = relative(
    managedRootPath,
    applicationRootPath,
  );
  if (
    relationship === ".." ||
    relationship.startsWith(`..${sep}`) ||
    isAbsolute(relationship)
  ) {
    throw new Error(
      "The managed application root escapes its repository authority.",
    );
  }
  const sourceRelationship = relative(
    sourceRootPath,
    sourceApplicationRootPath,
  );
  if (
    sourceRelationship === ".." ||
    sourceRelationship.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelationship)
  ) {
    throw new Error(
      "The source application root escapes its repository authority.",
    );
  }
  return Object.freeze({
    managedRootPath,
    applicationRootPath,
    sourceApplicationRootPath,
    repositoryRevision: inspection.authority.sourceRevision,
  });
}

function inventoryId(path: string): string {
  return `inv_${createHash("sha256").update(path).digest("hex").slice(0, 24)}`;
}

function inventoryName(path: string): string {
  const filename = path.split("/").at(-1) ?? path;
  const stem = filename.replace(/\.[^.]+$/u, "");
  const normalized = stem
    .replace(/(?:View|Screen)$/u, "")
    .replace(/[-_]+/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .trim();
  return normalized === "" ? filename : normalized;
}

function isComponentSource(path: string): boolean {
  return /\.(?:jsx|tsx|swift)$/u.test(path) &&
    /(?:^|\/)(?:components?|ui|views?)(?:\/|$)/iu.test(path);
}

function isTokenSource(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(?:^|\/)(?:tokens?|theme)(?:[./_-]|$)/u.test(lower) ||
    /(?:^|\/)(?:styles?|variables)\.(?:css|scss|sass|less)$/u.test(lower)
  );
}

function importInventory(
  inspection: ImportRepositoryInspection,
  applications: readonly CaptureApplicationUnit[],
): ImportInventoryV1 {
  const entries = inspection.manifest.entries;
  const screens = applications.flatMap((application) =>
    application.routes.map((route) => ({
      id: route.routeId,
      name: route.displayName,
      route: route.path,
      sourcePath: route.sourcePath,
    })),
  );
  const componentEntries = entries.filter(({ path }) =>
    isComponentSource(path),
  );
  const tokenEntries = entries.filter(({ path }) => isTokenSource(path));
  const catalog = (items: typeof entries) =>
    items.map(({ path }) => ({
      id: inventoryId(path),
      name: inventoryName(path),
      sourcePath: path,
    }));
  return {
    fileCount: entries.length,
    screenCount: screens.length,
    componentCount: componentEntries.length,
    tokenCount: tokenEntries.length,
    screens: screens.slice(0, 500),
    components: catalog(componentEntries).slice(0, 250),
    tokens: catalog(tokenEntries).slice(0, 100),
    truncated: {
      screens: screens.length > 500,
      components: componentEntries.length > 250,
      tokens: tokenEntries.length > 100,
    },
  };
}

async function recipeApproval(
  application: CaptureApplicationUnit,
  importedApplication: ImportApplicationV2,
  inspection: ImportRepositoryInspection,
  repositoryFingerprint: `sha256:${string}`,
  options: ImportCoordinatorOptions,
): Promise<PlannedRecipeApproval | null> {
  if (application.buildRecipe === null) {
    return null;
  }
  const adapter = options.adapterFor(
    importedApplication,
    application,
    captureAdapterExecutionContext(inspection, application),
  );
  if (
    adapter === null ||
    inspection.authority.sourceRevision === null ||
    inspection.authority.dirtyFingerprint === null
  ) {
    return null;
  }
  const authority = await options.approvalAuthority.describe({
    application: importedApplication,
    unit: application,
    adapter,
    recipe: application.buildRecipe,
  });
  const unsigned = {
    schemaVersion: 2 as const,
    applicationId: application.applicationId,
    recipe: Object.freeze({
      ...application.buildRecipe,
      args: Object.freeze([...application.buildRecipe.args]),
    }),
    repositoryFingerprint,
    snapshotExclusionFingerprint:
      inspection.snapshotExclusions.fingerprint,
    snapshotPolicyFingerprint:
      inspection.snapshotExclusions.policyFingerprint,
    sourceRevision: inspection.authority.sourceRevision,
    dirtyFingerprint: inspection.authority.dirtyFingerprint,
    applicationCacheKey: application.cacheKey,
    adapter: {
      id: adapter.metadata.id,
      version: adapter.metadata.version,
    },
    resolvedExecutable: authority.resolvedExecutable,
    environmentFingerprint: authority.environmentFingerprint,
    nonce: options.approvalAuthority.createNonce(),
    expiresAt: options.approvalAuthority.expiresAt(
      options.now?.() ?? new Date(),
    ),
  };
  return Object.freeze({
    ...unsigned,
    hash: hashCanonicalValue(unsigned) as `sha256:${string}`,
  });
}

async function nativeDependencyPreparation(
  application: CaptureApplicationUnit,
  importedApplication: ImportApplicationV2,
  inspection: ImportRepositoryInspection,
  options: ImportCoordinatorOptions,
): Promise<PlannedNativeDependencyPreparation | null> {
  if (
    importedApplication.platform !== "expo-ios" ||
    options.nativeDependencyPreparationFor === undefined ||
    inspection.authority.sourceRevision === null
  ) {
    return null;
  }
  const context = captureAdapterExecutionContext(
    inspection,
    application,
  );
  const adapter = options.adapterFor(
    importedApplication,
    application,
    context,
  );
  if (adapter === null) {
    return null;
  }
  const input = await options.nativeDependencyPreparationFor({
    application: importedApplication,
    unit: application,
    context,
    adapter,
  });
  if (input === null) {
    return null;
  }
  return Object.freeze({
    applicationId: importedApplication.id,
    applicationLabel: importedApplication.label,
    plan: await createNativeDependencyPreparationPlan(input),
  });
}

function sourceAnchor(
  inspection: ImportRepositoryInspection,
  route: CaptureRoutePlan,
): CaptureScenarioV2["sourceAnchor"] {
  const entry = inspection.manifest.entries.find(
    ({ path }) => path === route.sourcePath,
  );
  return entry === undefined
    ? null
    : {
        relativePath: route.sourcePath,
        symbol: null,
        contentHash: contentHash(entry.content),
      };
}

async function scenarioFromPlan(
  input: {
    readonly inspection: ImportRepositoryInspection;
    readonly route: CaptureRoutePlan;
    readonly scenario: CaptureScenarioPlan;
    readonly index: number;
  },
  options: ImportCoordinatorOptions,
): Promise<CaptureScenarioV2> {
  const deterministicFixture =
    input.scenario.fixture.status === "required"
      ? resolveDeterministicRepositoryFixture({
          manifest: input.inspection.manifest,
          route: input.route,
          scenario: input.scenario,
        })
      : null;
  const candidateFixture =
    input.scenario.fixture.status === "not-required"
      ? {
          parameters: [],
          fixtureProfile: "deterministic-default",
          readinessSelector: null,
        }
      : deterministicFixture ??
        await options.resolveFixture?.(
          input.scenario,
          input.route,
        ) ?? null;
  const fixture =
    candidateFixture !== null &&
    isPersistableResolvedFixture(input.route, candidateFixture)
      ? candidateFixture
      : null;
  return CaptureScenarioSchemaV2.parse({
    id: options.createScenarioId(input.scenario, input.index),
    applicationId: input.scenario.applicationId,
    route: input.scenario.routePath,
    state: input.scenario.state,
    viewport: input.scenario.viewport,
    authContext: input.scenario.authContext,
    parameters: fixture?.parameters ?? [],
    fixtureProfile:
      fixture?.fixtureProfile ?? "unresolved-required-fixture",
    readinessSelector: fixture?.readinessSelector ?? null,
    sourceAnchor: sourceAnchor(input.inspection, input.route),
  });
}

export async function buildImportPlan(
  inspection: ImportRepositoryInspection,
  options: ImportCoordinatorOptions,
): Promise<InternalImportPlan> {
  const deterministicDiscovery = discoverCaptureApplications(
    inspection.manifest,
  );
  const discovery =
    inspection.applications === undefined
      ? deterministicDiscovery
      : {
          applications: inspection.applications,
          errors: deterministicDiscovery.errors,
        };
  const applications = discovery.applications.map((unit) =>
    ImportApplicationSchemaV2.parse({
      id: unit.applicationId,
      label: unit.displayName,
      platform: unit.platform,
      relativeRoot: unit.root,
    }),
  );
  const unitsByApplicationId = new Map(
    discovery.applications.map((unit) => [
      unit.applicationId,
      unit,
    ]),
  );
  const scenarios: CaptureScenarioV2[] = [];
  let index = 0;
  for (const unit of discovery.applications) {
    for (const scenario of unit.scenarios) {
      const route = unit.routes.find(
        ({ routeId }) => routeId === scenario.routeId,
      );
      if (route === undefined) {
        continue;
      }
      scenarios.push(
        await scenarioFromPlan(
          { inspection, route, scenario, index },
          options,
        ),
      );
      index += 1;
    }
  }
  const recipes: PlannedRecipeApproval[] = [];
  const dependencyPreparations: PlannedNativeDependencyPreparation[] =
    [];
  for (const [applicationIndex, application] of
    discovery.applications.entries()) {
    const importedApplication = applications[applicationIndex];
    if (importedApplication === undefined) {
      continue;
    }
    const approval = await recipeApproval(
      application,
      importedApplication,
      inspection,
      deterministicDiscovery.repositoryFingerprint,
      options,
    );
    if (approval !== null) {
      recipes.push(approval);
    }
    const preparation = await nativeDependencyPreparation(
      application,
      importedApplication,
      inspection,
      options,
    );
    if (preparation !== null) {
      dependencyPreparations.push(preparation);
    }
  }
  const errors = [
    ...discovery.errors,
    ...discovery.applications.flatMap((application) =>
      application.errors,
    ),
    ...discovery.applications.flatMap((application, index) =>
      application.buildRecipe !== null &&
      recipes.every(
        ({ applicationId }) =>
          applicationId !== application.applicationId,
      )
        ? [
            {
              code: "capture-adapter-unavailable" as const,
              path: applications[index]?.relativeRoot ?? ".",
              message:
                "The application has no trusted production capture adapter or repository authority.",
              remediation:
                "Configure the matching adapter and executable authority before approval.",
              retryable: true,
            },
          ]
        : [],
    ),
  ].map(({ code, message, remediation, retryable }) => ({
    code: code.toUpperCase().replaceAll("-", "_"),
    message,
    remediation,
    retryable,
  }));
  return Object.freeze({
    publicPlan: Object.freeze({
      repository: Object.freeze({
        rootPath: inspection.authority.rootPath,
        sourceRevision: inspection.authority.sourceRevision,
        dirtyFingerprint: inspection.authority.dirtyFingerprint,
        managedWorktreeId:
          inspection.authority.managedWorktreeId,
      }),
      applications: Object.freeze([...discovery.applications]),
      scenarios: Object.freeze([...scenarios]),
      recipes: Object.freeze(recipes),
      dependencyPreparations: Object.freeze(
        dependencyPreparations,
      ),
      inventory: Object.freeze(
        importInventory(inspection, discovery.applications),
      ),
      scenarioCount: scenarios.length,
      errors: Object.freeze(errors),
    }),
    inspection,
    applications: Object.freeze(applications),
    scenarios: Object.freeze(scenarios),
    unitsByApplicationId,
    dependencyPreparations: Object.freeze(
      dependencyPreparations,
    ),
  });
}

export function recipeApprovalsMatch(
  required: readonly PlannedRecipeApproval[],
  supplied: readonly PlannedRecipeApproval[],
  now: Date,
): boolean {
  if (required.length !== supplied.length) {
    return false;
  }
  const suppliedByApplication = new Map(
    supplied.map((approval) => [approval.applicationId, approval]),
  );
  return required.every((approval) => {
    const candidate = suppliedByApplication.get(approval.applicationId);
    return (
      candidate !== undefined &&
      candidate.hash === approval.hash &&
      hashCanonicalValue(
        Object.fromEntries(
          Object.entries(candidate).filter(([key]) => key !== "hash"),
        ),
      ) === approval.hash &&
      candidate.expiresAt > now.toISOString()
    );
  });
}

export function nativeDependencyApprovalsMatch(
  required: readonly PlannedNativeDependencyPreparation[],
  supplied: readonly ApprovedNativeDependencyPreparation[],
): boolean {
  if (required.length !== supplied.length) {
    return false;
  }
  const suppliedByApplication = new Map(
    supplied.map((preparation) => [
      preparation.applicationId,
      preparation,
    ]),
  );
  return required.every((preparation) => {
    const candidate = suppliedByApplication.get(
      preparation.applicationId,
    );
    if (
      candidate === undefined ||
      candidate.plan.fingerprint !== preparation.plan.fingerprint
    ) {
      return false;
    }
    try {
      assertNativeDependencyPreparationApproval(
        preparation.plan,
        candidate.approval,
      );
      return true;
    } catch {
      return false;
    }
  });
}
