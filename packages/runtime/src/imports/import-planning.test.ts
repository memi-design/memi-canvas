import type { CaptureAdapterV1 } from "@memi/capture-import";
import {
  discoverCaptureApplications,
  type CaptureApplicationUnit,
} from "@memi/capture-platforms";
import {
  CaptureScenarioIdSchema,
  type ImportApplicationV2,
} from "@memi/protocol";
import { describe, expect, it, vi } from "vitest";

import type {
  ImportCoordinatorOptions,
  ImportRepositoryInspection,
} from "./import-coordinator.types.js";
import {
  buildImportPlan,
  captureAdapterExecutionContext,
  recipeApprovalsMatch,
} from "./import-planning.js";

const REVISION = "a".repeat(40);
const HASH = `sha256:${"b".repeat(64)}` as const;
const NOW = new Date("2026-07-30T05:00:00.000Z");

function inspection(
  applications?: readonly CaptureApplicationUnit[],
): ImportRepositoryInspection {
  return {
    authority: {
      rootPath: "/tmp/source",
      sourceRevision: REVISION,
      dirtyFingerprint: HASH,
      managedWorktreeId: null,
      managedRootPath: "/tmp/managed",
    },
    manifest: {
      schemaVersion: 1,
      repository: {
        revision: REVISION,
        dirtyFileFingerprint: HASH,
      },
      budgets: {
        maxEntries: 32,
        maxFileBytes: 32_768,
        maxTotalBytes: 262_144,
        maxDepth: 12,
      },
      entries: [
        {
          path: "package.json",
          content: JSON.stringify({
            name: "planning-fixture",
            scripts: { dev: "vite" },
            dependencies: { react: "19.0.0" },
          }),
        },
        {
          path: "src/pages/index.tsx",
          content: "export default function Home() { return <main /> }",
        },
        {
          path: "src/components/Button.tsx",
          content: "export function Button() { return <button /> }",
        },
        {
          path: "src/styles/tokens.css",
          content: ":root { --accent: ruby; }",
        },
      ],
    },
    snapshotExclusions: {
      schemaVersion: 1,
      entries: [],
      fingerprint: HASH,
      policyFingerprint: HASH,
    },
    ...(applications === undefined ? {} : { applications }),
  };
}

function options(input: {
  readonly adapter?: CaptureAdapterV1 | null;
  readonly resolveFixture?: ImportCoordinatorOptions["resolveFixture"];
} = {}): ImportCoordinatorOptions {
  const adapter = input.adapter === undefined
    ? ({
        metadata: {
          id: "react-web-test",
          platform: "react-web",
          version: "1",
          capabilities: [],
        },
      } as unknown as CaptureAdapterV1)
    : input.adapter;
  return {
    store: {} as never,
    planStore: {} as never,
    purgeAuthority: {} as never,
    artifactStore: {} as never,
    repository: {} as never,
    adapterFor: vi.fn(
      (_application: ImportApplicationV2) => adapter,
    ),
    approvalAuthority: {
      describe: vi.fn(async () => ({
        resolvedExecutable: "/usr/local/bin/npm",
        environmentFingerprint: HASH,
      })),
      createNonce: () => "nonce",
      expiresAt: () => "2026-07-31T05:00:00.000Z",
    },
    createJobId: vi.fn() as never,
    createScenarioId: (_scenario, index) =>
      CaptureScenarioIdSchema.parse(
        `csc_01J0000000000000000000000${index}`,
      ),
    createProjectId: vi.fn() as never,
    now: () => NOW,
    ...(input.resolveFixture === undefined
      ? {}
      : { resolveFixture: input.resolveFixture }),
  };
}

describe("import planning branch contracts", () => {
  it("publishes bounded truthful repository inventory with source paths", async () => {
    const configured = options();
    const plan = await buildImportPlan(inspection(), configured);

    expect(plan.publicPlan.scenarios).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^csc_/u),
        route: "/",
        sourceAnchor: expect.objectContaining({
          relativePath: "src/pages/index.tsx",
        }),
        state: "default",
        viewport: expect.objectContaining({
          height: 900,
          width: 1_440,
        }),
      }),
    ]);

    expect(plan.publicPlan.repository).toEqual({
      rootPath: "/tmp/source",
      sourceRevision: REVISION,
      dirtyFingerprint: HASH,
      managedWorktreeId: null,
    });
    expect(plan.publicPlan.repository).not.toHaveProperty(
      "managedRootPath",
    );
    expect(configured.adapterFor).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      Object.freeze({
        managedRootPath: "/tmp/managed",
        applicationRootPath: "/tmp/managed",
        sourceApplicationRootPath: "/tmp/source",
        repositoryRevision: REVISION,
      }),
    );
    expect(plan.publicPlan.inventory).toMatchObject({
      fileCount: 4,
      screenCount: 1,
      componentCount: 1,
      tokenCount: 1,
      screens: [
        {
          name: "Home",
          route: "/",
          sourcePath: "src/pages/index.tsx",
        },
      ],
      components: [
        {
          name: "Button",
          sourcePath: "src/components/Button.tsx",
        },
      ],
      tokens: [
        {
          name: "tokens",
          sourcePath: "src/styles/tokens.css",
        },
      ],
      truncated: {
        screens: false,
        components: false,
        tokens: false,
      },
    });
  });

  it("uses explicit application inventories and resolves required fixtures", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = discovered.applications[0];
    expect(application).toBeDefined();
    const required = {
      ...application!,
      routes: [
        {
          ...application!.routes[0]!,
          path: "/:slug",
          parameters: [{ name: "slug", kind: "dynamic" as const }],
        },
        {
          ...application!.routes[0]!,
          routeId: "rte_missing_route",
        },
      ],
      scenarios: [
        {
          ...application!.scenarios[0]!,
          routePath: "/:slug",
          fixture: {
            status: "required" as const,
            parameterNames: ["slug"],
          },
        },
        {
          ...application!.scenarios[0]!,
          routeId: "rte_not_present",
        },
      ],
    } satisfies CaptureApplicationUnit;
    const resolveFixture = vi.fn(async () => ({
      parameters: [{ key: "slug", value: "fixture" }],
      fixtureProfile: "test-fixture",
      readinessSelector: "#ready",
    }));

    const plan = await buildImportPlan(
      inspection([required]),
      options({ resolveFixture }),
    );

    expect(resolveFixture).toHaveBeenCalledOnce();
    expect(plan.scenarios).toHaveLength(1);
    expect(plan.scenarios[0]).toMatchObject({
      parameters: [{ key: "slug", value: "fixture" }],
      fixtureProfile: "test-fixture",
      readinessSelector: "#ready",
      sourceAnchor: {
        relativePath: "src/pages/index.tsx",
      },
    });
  });

  it("marks unresolved fixtures and missing source evidence honestly", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = discovered.applications[0]!;
    const route = {
      ...application.routes[0]!,
      sourcePath: "src/pages/missing.tsx",
    };
    const required = {
      ...application,
      routes: [route],
      scenarios: [{
        ...application.scenarios[0]!,
        routeId: route.routeId,
        fixture: {
          status: "required" as const,
          parameterNames: ["id"],
        },
      }],
    } satisfies CaptureApplicationUnit;

    const plan = await buildImportPlan(
      inspection([required]),
      options(),
    );

    expect(plan.scenarios[0]).toMatchObject({
      parameters: [],
      fixtureProfile: "unresolved-required-fixture",
      readinessSelector: null,
      sourceAnchor: null,
    });
    expect(plan.publicPlan.errors).toEqual([]);
  });

  it("uses deterministic repository route evidence before an optional harness resolver", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = discovered.applications[0]!;
    const baseRoute = application.routes[0]!;
    const dynamicRoute = {
      ...baseRoute,
      path: "/game/:gameId",
      parameters: [{ name: "gameId", kind: "dynamic" as const }],
    };
    const dynamic = {
      ...application,
      routes: [dynamicRoute],
      scenarios: [{
        ...application.scenarios[0]!,
        routePath: dynamicRoute.path,
        fixture: {
          status: "required" as const,
          parameterNames: ["gameId"],
        },
      }],
    } satisfies CaptureApplicationUnit;
    const resolveFixture = vi.fn(async () => null);
    const repository = inspection([dynamic]);
    const withEvidence = {
      ...repository,
      manifest: {
        ...repository.manifest,
        entries: [
          ...repository.manifest.entries,
          {
            path: "tests/game-route.test.ts",
            content: "expect(route).toBe('/game/game-123')",
          },
        ],
      },
    } satisfies ImportRepositoryInspection;

    const plan = await buildImportPlan(
      withEvidence,
      options({ resolveFixture }),
    );

    expect(resolveFixture).not.toHaveBeenCalled();
    expect(plan.scenarios[0]).toMatchObject({
      parameters: [{ key: "gameId", value: "game-123" }],
      fixtureProfile: "repository-route-evidence",
    });
  });

  it("rejects secret-like parameters returned by a harness before job persistence", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = discovered.applications[0]!;
    const baseRoute = application.routes[0]!;
    const dynamicRoute = {
      ...baseRoute,
      path: "/reset-password/:resetToken",
      parameters: [{ name: "resetToken", kind: "dynamic" as const }],
    };
    const dynamic = {
      ...application,
      routes: [dynamicRoute],
      scenarios: [{
        ...application.scenarios[0]!,
        routePath: dynamicRoute.path,
        fixture: {
          status: "required" as const,
          parameterNames: ["resetToken"],
        },
      }],
    } satisfies CaptureApplicationUnit;
    const resolveFixture = vi.fn(async () => ({
      parameters: [{ key: "resetToken", value: "fixture-value" }],
      fixtureProfile: "harness-fixture",
      readinessSelector: null,
    }));

    const plan = await buildImportPlan(
      inspection([dynamic]),
      options({ resolveFixture }),
    );

    expect(resolveFixture).toHaveBeenCalledOnce();
    expect(plan.scenarios[0]).toMatchObject({
      parameters: [],
      fixtureProfile: "unresolved-required-fixture",
      readinessSelector: null,
    });
  });

  it("reports unavailable approval authorities without inventing recipes", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = discovered.applications[0]!;

    const unavailable = await buildImportPlan(
      inspection([application]),
      options({ adapter: null }),
    );
    expect(unavailable.publicPlan.recipes).toEqual([]);
    expect(unavailable.publicPlan.errors).toEqual([
      expect.objectContaining({
        code: "CAPTURE_ADAPTER_UNAVAILABLE",
        retryable: true,
      }),
    ]);

    const noRevision = {
      ...inspection([application]),
      authority: {
        ...inspection().authority,
        sourceRevision: null,
      },
    };
    const missingAuthority = await buildImportPlan(
      noRevision,
      options(),
    );
    expect(missingAuthority.publicPlan.recipes).toEqual([]);
  });

  it("handles applications with no executable recipe", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = {
      ...discovered.applications[0]!,
      buildRecipe: null,
    } satisfies CaptureApplicationUnit;

    const plan = await buildImportPlan(
      inspection([application]),
      options(),
    );

    expect(plan.publicPlan.recipes).toEqual([]);
    expect(plan.publicPlan.errors).toEqual([]);
  });

  it("rejects an application root that escapes the managed copy", async () => {
    const discovered = discoverCaptureApplications(
      inspection().manifest,
    );
    const application = {
      ...discovered.applications[0]!,
      root: "../source",
    } satisfies CaptureApplicationUnit;

    expect(() =>
      captureAdapterExecutionContext(
        inspection([application]),
        application,
      ),
    ).toThrow(/application root escapes/u);
  });

  it("requires exact, canonical, current approvals", async () => {
    const plan = await buildImportPlan(inspection(), options());
    const approval = plan.publicPlan.recipes[0]!;

    expect(recipeApprovalsMatch([approval], [], NOW)).toBe(false);
    expect(
      recipeApprovalsMatch(
        [approval],
        [{ ...approval, applicationId: "another-app" }],
        NOW,
      ),
    ).toBe(false);
    expect(
      recipeApprovalsMatch(
        [approval],
        [{ ...approval, hash: HASH }],
        NOW,
      ),
    ).toBe(false);
    expect(
      recipeApprovalsMatch(
        [approval],
        [{ ...approval, nonce: "tampered" }],
        NOW,
      ),
    ).toBe(false);
    expect(
      recipeApprovalsMatch(
        [approval],
        [{ ...approval, expiresAt: NOW.toISOString() }],
        NOW,
      ),
    ).toBe(false);
    expect(recipeApprovalsMatch([approval], [approval], NOW)).toBe(
      true,
    );
  });
});
