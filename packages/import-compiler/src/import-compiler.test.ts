import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  CoverageLedgerSchema,
  FlowManifestSchema,
  ProductManifestSchema,
  RouteManifestSchema,
  StateManifestSchema,
} from "@memi/protocol";

import {
  compileProductImport,
  type CompileProductImportOptions,
} from "./index.js";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../test-fixtures/deterministic-product/", import.meta.url),
);
const tempRoots: string[] = [];
const baseOptions = {
  projectId: "prj_01J00000000000000000000000",
  repository: {
    revision: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
  },
  adapterVersion: "vite-react-static@1",
  budgets: {
    maxFileBytes: 64 * 1024,
    maxTotalBytes: 256 * 1024,
  },
} as const;
const HOME_ONLY_FLOW = [
  "export const flows = [",
  "  {",
  '    "id": "home-only",',
  '    "name": "Home only",',
  '    "provenance": "declared",',
  '    "steps": [',
  "      {",
  '        "order": 1,',
  '        "route": "home",',
  '        "state": "default",',
  '        "trigger": "flow-start",',
  '        "assertion": "home-screen-visible"',
  "      }",
  "    ]",
  "  }",
  "] as const;",
  "",
].join("\n");

async function compile(
  rootDir: string,
  overrides: Partial<CompileProductImportOptions> = {},
) {
  return compileProductImport({ ...baseOptions, rootDir, ...overrides });
}

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memi-import-"));
  tempRoots.push(root);
  await cp(FIXTURE_ROOT, root, { recursive: true });
  return root;
}

function repositoryRoot(result: Awaited<ReturnType<typeof compile>>): string {
  if (result.productManifest.source.kind !== "repository") {
    throw new Error("Expected repository import fixture.");
  }
  return result.productManifest.source.root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe("compileProductImport", () => {
  it("emits protocol-valid canonical manifests", async () => {
    const result = await compile(FIXTURE_ROOT);

    expect(ProductManifestSchema.parse(result.productManifest)).toEqual(
      result.productManifest,
    );
    expect(RouteManifestSchema.parse(result.routeManifest)).toEqual(
      result.routeManifest,
    );
    expect(StateManifestSchema.parse(result.stateManifest)).toEqual(
      result.stateManifest,
    );
    expect(CoverageLedgerSchema.parse(result.coverageLedger)).toEqual(
      result.coverageLedger,
    );
    expect(FlowManifestSchema.parse(result.flowManifest)).toEqual(
      result.flowManifest,
    );
    expect(result.routeManifest.routes).toMatchObject([
      { displayName: "Home", sourceScreen: "HomeScreen" },
      { displayName: "Projects", sourceScreen: "ProjectsScreen" },
      { displayName: "Settings", sourceScreen: "SettingsScreen" },
    ]);
    expect(result.routeManifest.routes.map((route) => route.path)).toEqual([
      "/",
      "/projects",
      "/settings",
    ]);
    expect(result.stateManifest.states).toHaveLength(6);
    expect(result.designSystemManifest.tokens).toHaveLength(6);
    expect(result.flowManifest.flows).toHaveLength(1);
    expect(result.flowManifest.sourceFile).toBe("src/app/flows.ts");
    expect(result.flowManifest.flows[0]?.steps).toHaveLength(3);
    expect(result.flowManifest.flows[0]?.steps.map((step) => step.order)).toEqual(
      [1, 2, 3],
    );
  });

  it("plans every route state across desktop, tablet, and mobile", async () => {
    const result = await compile(FIXTURE_ROOT);

    expect(result.capturePlan.cells).toHaveLength(18);
    expect(result.coverageLedger.cells).toHaveLength(18);
    expect(
      new Set(
        result.coverageLedger.cells.map((cell) => cell.viewport.name),
      ),
    ).toEqual(new Set(["desktop", "tablet", "mobile"]));
    expect(
      result.coverageLedger.cells.every(
        (cell) =>
          cell.health === "partial" &&
          cell.evidenceLevel === "inferred" &&
          cell.frameKind === "code-frame" &&
          cell.reason === "runtime-capture-not-run",
      ),
    ).toBe(true);
  });

  it("is deterministic and uses zero model tokens", async () => {
    const first = await compile(FIXTURE_ROOT);
    const second = await compile(FIXTURE_ROOT);

    expect(first.contentFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second).toEqual(first);
    expect(second.modelTokenUsage).toBe(0);
    expect(second.executionMode).toBe("deterministic");
  });

  it("is deterministic across distinct canonical source roots", async () => {
    const firstRoot = await copyFixture();
    const secondRoot = await copyFixture();
    const first = await compile(firstRoot);
    const second = await compile(secondRoot);

    expect(repositoryRoot(second)).not.toBe(repositoryRoot(first));
    expect({
      ...second,
      productManifest: {
        ...second.productManifest,
        source: first.productManifest.source,
      },
    }).toEqual(first);
  });

  it("canonicalizes compiler authority input independent of object key order", async () => {
    const forward = await compile(FIXTURE_ROOT);
    const reordered = await compile(FIXTURE_ROOT, {
      repository: {
        dirtyFileFingerprint: baseOptions.repository.dirtyFileFingerprint,
        dirty: baseOptions.repository.dirty,
        revision: baseOptions.repository.revision,
      },
      budgets: {
        maxTotalBytes: baseOptions.budgets.maxTotalBytes,
        maxFileBytes: baseOptions.budgets.maxFileBytes,
      },
    });

    expect(reordered.compilerFingerprint).toBe(forward.compilerFingerprint);
  });

  it.each([
    [
      "repository",
      {
        repository: {
          ...baseOptions.repository,
          undeclaredAuthority: "forbidden",
        },
      },
    ],
    [
      "budgets",
      {
        budgets: {
          ...baseOptions.budgets,
          undeclaredBudget: 1,
        },
      },
    ],
    ["adapter", { adapterVersion: "vite-react-static@1\nforged" }],
  ] as const)("rejects non-canonical %s compiler authority", async (_name, override) => {
    await expect(
      compile(FIXTURE_ROOT, override as Partial<CompileProductImportOptions>),
    ).rejects.toThrow(/authority|budget|adapter|unrecognized/i);
  });

  it("invalidates token evidence and dependent captures after token changes", async () => {
    const root = await copyFixture();
    const baseline = await compile(root);
    const tokenPath = join(root, "src/styles/tokens.css");
    await writeFile(
      tokenPath,
      (await readFile(tokenPath, "utf8")).replace(
        "--space-panel: 16px",
        "--space-panel: 20px",
      ),
      "utf8",
    );

    const changed = await compile(root, { previous: baseline });

    expect(changed.invalidation.changedInputPaths).toEqual([
      "src/styles/tokens.css",
    ]);
    expect(changed.invalidation.invalidatedArtifactKinds).toEqual([
      "design-system",
      "screen-captures",
    ]);
    expect(changed.invalidation.recaptureCellIds).toEqual(
      changed.coverageLedger.cells.map((cell) => cell.id),
    );
  });

  it("invalidates all derived truth when compiler metadata changes", async () => {
    const baseline = await compile(FIXTURE_ROOT);
    const changed = await compile(FIXTURE_ROOT, {
      adapterVersion: "vite-react-static@2",
      previous: baseline,
    });

    expect(changed.invalidation.changedInputPaths).toEqual([]);
    expect(changed.invalidation.invalidatedArtifactKinds).toContain(
      "route-manifest",
    );
    expect(changed.invalidation.invalidatedArtifactKinds).toContain(
      "screen-captures",
    );
  });

  it("fingerprints and invalidates a declared flow change", async () => {
    const root = await copyFixture();
    const baseline = await compile(root);
    const flowPath = join(root, "src/app/flows.ts");
    await writeFile(
      flowPath,
      (await readFile(flowPath, "utf8")).replace(
        '"trigger": "open-projects"',
        '"trigger": "navigate-projects"',
      ),
      "utf8",
    );

    const changed = await compile(root, { previous: baseline });

    expect(changed.contentFingerprint).not.toBe(baseline.contentFingerprint);
    expect(changed.capturePlan.id).toBe(baseline.capturePlan.id);
    expect(changed.coverageLedger).toEqual(baseline.coverageLedger);
    expect(changed.flowManifest.sourceContentFingerprint).toBe(
      changed.contentFingerprint,
    );
    expect(changed.invalidation).toMatchObject({
      changedInputPaths: ["src/app/flows.ts"],
      invalidatedArtifactKinds: ["flow-manifest"],
      recaptureCellIds: [],
    });
  });

  it("unions flow and token invalidation without churning capture structure", async () => {
    const root = await copyFixture();
    const baseline = await compile(root);
    const flowPath = join(root, "src/app/flows.ts");
    const tokenPath = join(root, "src/styles/tokens.css");
    await writeFile(
      flowPath,
      (await readFile(flowPath, "utf8")).replace(
        '"trigger": "open-projects"',
        '"trigger": "navigate-projects"',
      ),
      "utf8",
    );
    await writeFile(
      tokenPath,
      (await readFile(tokenPath, "utf8")).replace(
        "--space-panel: 16px",
        "--space-panel: 20px",
      ),
      "utf8",
    );

    const changed = await compile(root, { previous: baseline });

    expect(changed.capturePlan.id).toBe(baseline.capturePlan.id);
    expect(changed.invalidation.changedInputPaths).toEqual([
      "src/app/flows.ts",
      "src/styles/tokens.css",
    ]);
    expect(changed.invalidation.invalidatedArtifactKinds).toEqual([
      "flow-manifest",
      "design-system",
      "screen-captures",
    ]);
  });

  it("unions route and token invalidation into the complete affected set", async () => {
    const root = await copyFixture();
    const baseline = await compile(root);
    const routePath = join(root, "src/app/routes.tsx");
    const tokenPath = join(root, "src/styles/tokens.css");
    await writeFile(
      routePath,
      (await readFile(routePath, "utf8")).replace(
        'name: "Projects"',
        'name: "Project library"',
      ),
      "utf8",
    );
    await writeFile(
      tokenPath,
      (await readFile(tokenPath, "utf8")).replace(
        "--space-panel: 16px",
        "--space-panel: 20px",
      ),
      "utf8",
    );

    const changed = await compile(root, { previous: baseline });

    expect(changed.capturePlan.id).not.toBe(baseline.capturePlan.id);
    expect(changed.invalidation.invalidatedArtifactKinds).toEqual([
      "route-manifest",
      "state-manifest",
      "flow-manifest",
      "capture-plan",
      "coverage-ledger",
      "design-system",
      "screen-captures",
    ]);
  });

  it("does not invalidate unchanged compiler inputs", async () => {
    const baseline = await compile(FIXTURE_ROOT);
    const unchanged = await compile(FIXTURE_ROOT, { previous: baseline });

    expect(unchanged.invalidation).toEqual({
      changedInputPaths: [],
      unchangedInputPaths: [
        "package.json",
        "src/app/routes.tsx",
        "src/app/screen-states.ts",
        "src/app/flows.ts",
        "src/styles/tokens.css",
      ],
      invalidatedArtifactKinds: [],
      recaptureCellIds: [],
    });
  });

  it.each([
    {
      path: "src/app/routes.tsx",
      contents: "export const routes = [] as const;\n",
      error: "No routes discovered",
    },
    {
      path: "src/app/screen-states.ts",
      contents: "export const screenStates = {} as const;\n",
      error: "No screen states discovered",
    },
    {
      path: "src/app/flows.ts",
      contents: "export const flows = [] as const;\n",
      error: "No declared flows discovered",
    },
    {
      path: "src/styles/tokens.css",
      contents: ":root { color: black; }\n",
      error: "No design tokens discovered",
    },
  ])("rejects missing discovery evidence in $path", async ({
    path,
    contents,
    error,
  }) => {
    const root = await copyFixture();
    await writeFile(join(root, path), contents, "utf8");
    await expect(compile(root)).rejects.toThrow(error);
  });

  it("rejects an orphan state", async () => {
    const root = await copyFixture();
    await writeFile(
      join(root, "src/app/screen-states.ts"),
      [
        "export const screenStates = {",
        '  missing: ["default"],',
        "} as const;",
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(compile(root)).rejects.toThrow(/unknown route "missing"/i);
  });

  it("rejects orphan and cross-route flow references", async () => {
    const root = await copyFixture();
    const flowPath = join(root, "src/app/flows.ts");
    const original = await readFile(flowPath, "utf8");
    await writeFile(
      flowPath,
      original.replace('"route": "projects"', '"route": "missing"'),
      "utf8",
    );
    await expect(compile(root)).rejects.toThrow(/unknown route "missing"/i);

    await writeFile(
      flowPath,
      original.replace(
        '"route": "projects",\n        "state": "default"',
        '"route": "projects",\n        "state": "loading"',
      ),
      "utf8",
    );
    await expect(compile(root)).rejects.toThrow(/does not belong to route/i);
  });

  it("accepts underscores consistently in route, state, and flow references", async () => {
    const root = await copyFixture();
    const replacements = [
      ["src/app/routes.tsx", 'id: "projects"', 'id: "project_list"'],
      ["src/app/screen-states.ts", "projects:", "project_list:"],
      [
        "src/app/flows.ts",
        '"route": "projects"',
        '"route": "project_list"',
      ],
    ] as const;
    for (const [path, from, to] of replacements) {
      const sourcePath = join(root, path);
      await writeFile(
        sourcePath,
        (await readFile(sourcePath, "utf8")).replace(from, to),
        "utf8",
      );
    }

    const result = await compile(root);
    const projectRoute = result.routeManifest.routes.find(
      (route) => route.path === "/projects",
    );
    expect(projectRoute).toBeDefined();
    expect(result.flowManifest.flows[0]?.steps[1]?.routeId).toBe(
      projectRoute?.id,
    );
  });

  it("rejects duplicate, missing, unordered, and unsafe flow declarations", async () => {
    const mutations = [
      ['"order": 2', '"order": 1'],
      ['"order": 2,', ""],
      ['"order": 2', '"order": 4'],
      ['"trigger": "open-projects"', '"trigger": "open-projects; rm -rf /"'],
      [
        '"assertion": "projects-screen-visible"',
        '"assertion": "${process.env.SECRET}"',
      ],
    ] as const;

    for (const [from, to] of mutations) {
      const root = await copyFixture();
      const flowPath = join(root, "src/app/flows.ts");
      const original = await readFile(flowPath, "utf8");
      await writeFile(flowPath, original.replace(from, to), "utf8");
      await expect(compile(root)).rejects.toThrow();
    }
  });

  it("preserves every canonical state kind without promotion", async () => {
    const root = await copyFixture();
    await writeFile(join(root, "src/app/flows.ts"), HOME_ONLY_FLOW, "utf8");
    await writeFile(
      join(root, "src/app/screen-states.ts"),
      [
        "export const screenStates = {",
        '  home: ["default", "loading", "empty", "error", "success", "overlay", "validation", "permission"],',
        "} as const;",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await compile(root);
    expect(result.stateManifest.states.map((state) => state.kind)).toEqual([
      "default",
      "loading",
      "empty",
      "error",
      "success",
      "overlay",
      "validation",
      "permission",
    ]);
  });

  it("rejects an unknown state kind instead of upgrading it to success", async () => {
    const root = await copyFixture();
    await writeFile(join(root, "src/app/flows.ts"), HOME_ONLY_FLOW, "utf8");
    await writeFile(
      join(root, "src/app/screen-states.ts"),
      [
        "export const screenStates = {",
        '  home: ["default", "wizard-mystery"],',
        "} as const;",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(compile(root)).rejects.toThrow(/unsupported state kind/i);
  });

  it("propagates a missing required input as a filesystem error", async () => {
    const root = await copyFixture();
    await rm(join(root, "src/styles/tokens.css"));
    await expect(compile(root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
