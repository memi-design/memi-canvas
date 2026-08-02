import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { applyCanvasOperation, createCanvasDocument } from "@memi/canvas-document";
import type { ProductImportResult } from "@memi/import-compiler";

import {
  PRODUCT_IMPORT_PLAN_NAMESPACE,
  compileCanvasOperations,
  compileProductWorkspace,
  createCanvasMaterializationPlan,
} from "./index.js";
import {
  FIXED_ACTOR,
  FIXED_TIME,
  compileFixture,
  copyFixture,
  removeFixtures,
} from "./test-fixtures.js";

const temporaryRoots: string[] = [];

function mutableImport(result: ProductImportResult): Record<string, unknown> {
  return structuredClone(result) as unknown as Record<string, unknown>;
}

function planFor(result: ProductImportResult) {
  return createCanvasMaterializationPlan(compileProductWorkspace(result), {
    actorId: FIXED_ACTOR,
    occurredAt: FIXED_TIME,
  });
}

afterEach(async () => {
  await removeFixtures(temporaryRoots.splice(0));
});

describe("compileProductWorkspace", () => {
  it("compiles the complete imported product graph into sanitized immutable truth", async () => {
    const imported = await compileFixture();
    const workspace = compileProductWorkspace(imported);
    const serialized = JSON.stringify(workspace);

    expect(workspace.counts).toEqual({
      routes: 3,
      states: 6,
      coverageCells: 18,
      designTokens: 6,
      flows: 1,
      blockedCells: 0,
    });
    expect(Object.keys(workspace.projectionIntegrityDigests)).toEqual([
      "product",
      "route",
      "state",
      "flow",
      "designSystem",
      "capture",
      "coverage",
    ]);
    expect(workspace.coverageCells).toHaveLength(18);
    expect(workspace.captureCells).toHaveLength(18);
    expect(Object.isFrozen(workspace)).toBe(true);
    expect(Object.isFrozen(workspace.coverageCells)).toBe(true);
    expect(serialized).not.toContain(imported.productManifest.source.kind === "repository"
      ? imported.productManifest.source.root
      : "__not-a-repository__");
    expect(serialized).not.toMatch(
      /"sourceRoot"|"root"|"commands"|"trace"|"runtime"/u,
    );
    expect(workspace.routes.map((route) => route.authentication)).toEqual([
      "public",
      "public",
      "public",
    ]);
  });

  it("uses route order, route-owned state order, then desktop/tablet/mobile", async () => {
    const workspace = compileProductWorkspace(await compileFixture());

    expect(
      workspace.coverageCells.map((cell) => [
        workspace.routes.find((route) => route.id === cell.routeId)?.displayName,
        workspace.states.find((state) => state.id === cell.stateId)?.name,
        cell.viewport.name,
      ]),
    ).toEqual([
      ["Home", "default", "desktop"],
      ["Home", "default", "tablet"],
      ["Home", "default", "mobile"],
      ["Home", "loading", "desktop"],
      ["Home", "loading", "tablet"],
      ["Home", "loading", "mobile"],
      ["Projects", "default", "desktop"],
      ["Projects", "default", "tablet"],
      ["Projects", "default", "mobile"],
      ["Projects", "empty", "desktop"],
      ["Projects", "empty", "tablet"],
      ["Projects", "empty", "mobile"],
      ["Projects", "error", "desktop"],
      ["Projects", "error", "tablet"],
      ["Projects", "error", "mobile"],
      ["Settings", "default", "desktop"],
      ["Settings", "default", "tablet"],
      ["Settings", "default", "mobile"],
    ]);
  });

  it("is byte-stable across different canonical source roots", async () => {
    const firstRoot = await copyFixture();
    const secondRoot = await copyFixture();
    temporaryRoots.push(firstRoot, secondRoot);

    const first = compileProductWorkspace(await compileFixture(firstRoot));
    const second = compileProductWorkspace(await compileFixture(secondRoot));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.workspaceDigest).toBe(first.workspaceDigest);
  });

  it("sanitizes every supported path-bearing product source mode", async () => {
    const imported = await compileFixture();
    const product = imported.productManifest;
    const alternatives = [
      {
        schemaVersion: 1,
        projectId: product.projectId,
        importMode: "blank",
        source: { kind: "blank" },
        dimensions: product.dimensions,
      },
      {
        schemaVersion: 1,
        projectId: product.projectId,
        importMode: "running-url",
        source: { kind: "running-url", url: "http://127.0.0.1:4173" },
        dimensions: product.dimensions,
      },
      {
        schemaVersion: 1,
        projectId: product.projectId,
        importMode: "screenshot-folder",
        source: {
          kind: "screenshot-folder",
          root: "/private/tmp/screens",
          contentFingerprint: `sha256:${"e".repeat(64)}`,
        },
        dimensions: product.dimensions,
      },
      {
        schemaVersion: 1,
        projectId: product.projectId,
        importMode: "static-build",
        source: {
          kind: "static-build",
          root: "/private/tmp/build",
          contentFingerprint: `sha256:${"f".repeat(64)}`,
        },
        framework: { kind: "static-html", confidence: "verified" },
        commands: {
          preview: { executable: "ignored", args: ["ignored"] },
        },
        dimensions: product.dimensions,
      },
    ] as const;

    for (const alternative of alternatives) {
      const candidate = mutableImport(imported);
      candidate["productManifest"] = alternative;
      const workspace = compileProductWorkspace(
        candidate as unknown as ProductImportResult,
      );
      expect(JSON.stringify(workspace)).not.toMatch(
        /private\/tmp|"commands"|"root"/u,
      );
    }
  });

  it("validates zero-token metadata and immutable workspace digests", async () => {
    const imported = await compileFixture();
    const invalidMode = mutableImport(imported);
    invalidMode["executionMode"] = "agentic";
    expect(() =>
      compileProductWorkspace(invalidMode as unknown as ProductImportResult),
    ).toThrow(/zero-token/u);

    const invalidFingerprint = mutableImport(imported);
    invalidFingerprint["inputFingerprints"] = { input: "not-a-hash" };
    expect(() =>
      compileProductWorkspace(
        invalidFingerprint as unknown as ProductImportResult,
      ),
    ).toThrow();

    const invalidation = mutableImport(imported);
    invalidation["invalidation"] = { changedInputPaths: [] };
    expect(() =>
      compileProductWorkspace(invalidation as unknown as ProductImportResult),
    ).toThrow(/missing or unknown/u);

    const workspace = structuredClone(
      compileProductWorkspace(imported),
    ) as unknown as Record<string, unknown>;
    const counts = workspace["counts"] as { routes: number };
    counts.routes += 1;
    expect(() =>
      createCanvasMaterializationPlan(workspace as never, {
        actorId: FIXED_ACTOR,
        occurredAt: FIXED_TIME,
      }),
    ).toThrow(/workspace digest/u);
  });

  it.each([
    ["unknown top-level field", (value: Record<string, unknown>) => {
      value["unexpected"] = true;
    }],
    ["missing capture cell", (value: Record<string, unknown>) => {
      const capturePlan = value["capturePlan"] as { cells: unknown[] };
      capturePlan.cells.pop();
    }],
    ["reordered ledger", (value: Record<string, unknown>) => {
      const ledger = value["coverageLedger"] as { cells: unknown[] };
      ledger.cells.reverse();
    }],
    ["cross-route state", (value: Record<string, unknown>) => {
      const states = value["stateManifest"] as {
        states: Array<{ routeId: string }>;
      };
      states.states[0]!.routeId = states.states.at(-1)!.routeId;
    }],
    ["viewport mismatch", (value: Record<string, unknown>) => {
      const ledger = value["coverageLedger"] as {
        cells: Array<{ viewport: { width: number } }>;
      };
      ledger.cells[0]!.viewport.width = 1;
    }],
    ["duplicate coverage identity", (value: Record<string, unknown>) => {
      const ledger = value["coverageLedger"] as {
        cells: Array<{ id: string }>;
      };
      ledger.cells[1]!.id = ledger.cells[0]!.id;
    }],
    ["project mismatch", (value: Record<string, unknown>) => {
      const routes = value["routeManifest"] as { projectId: string };
      routes.projectId = "prj_01J00000000000000000000001";
    }],
    ["fingerprint mismatch", (value: Record<string, unknown>) => {
      value["contentFingerprint"] = `sha256:${"a".repeat(64)}`;
    }],
    ["capture identity mismatch", (value: Record<string, unknown>) => {
      const capture = value["capturePlan"] as { id: string };
      capture.id = "cap_01J00000000000000000000001";
    }],
    ["blocked truth mismatch", (value: Record<string, unknown>) => {
      const capture = value["capturePlan"] as {
        cells: Array<{ status: string; reason?: string }>;
      };
      capture.cells[0] = {
        ...capture.cells[0]!,
        status: "blocked",
        reason: "blocked",
      };
    }],
  ])("fails closed for %s", async (_name, mutate) => {
    const imported = mutableImport(await compileFixture());
    mutate(imported);

    expect(() =>
      compileProductWorkspace(imported as unknown as ProductImportResult),
    ).toThrow();
  });
});

describe("CanvasMaterializationPlan", () => {
  it("binds all imported truth into a full deterministic 18-operation chain", async () => {
    const imported = await compileFixture();
    const workspace = compileProductWorkspace(imported);
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const operations = compileCanvasOperations(plan, workspace);

    expect(PRODUCT_IMPORT_PLAN_NAMESPACE).toBe("memi.product-import.plan.v1");
    expect(plan.counts).toEqual({
      coverageCells: 18,
      materializedCells: 18,
      blockedCells: 0,
      unmaterializedCells: 0,
    });
    expect(plan.entries).toHaveLength(18);
    expect(operations).toHaveLength(18);
    expect(plan.initialDocument).toEqual({
      revision: 0,
      stateHash: createCanvasDocument({
        id: plan.documentId,
        projectId: plan.projectId,
      }).stateHash,
    });
    expect(plan.entries.map((entry) => entry.ordinal)).toEqual(
      Array.from({ length: 18 }, (_value, index) => index),
    );
    for (const [index, entry] of plan.entries.entries()) {
      expect(entry.expectedBeforeHash).toBe(
        index === 0
          ? plan.initialDocument.stateHash
          : plan.entries[index - 1]!.resultingHash,
      );
      expect(entry.frameKind).toBe("code-frame");
      expect(entry.frameAuthority).toBe("product-source");
      expect(entry.evidenceLevel).toBe("inferred");
      expect(entry.coverageHealth).toBe("partial");
      expect(operations[index]).toMatchObject({
        id: entry.operationId,
        expectedBeforeHash: entry.expectedBeforeHash,
        resultingHash: entry.resultingHash,
        actionDigest: entry.actionDigest,
      });
    }
    expect(plan.finalDocument).toEqual({
      revision: 18,
      stateHash: plan.entries.at(-1)!.resultingHash,
      operationCursor: plan.entries.at(-1)!.operationId,
    });

    const reduced = operations.reduce(
      applyCanvasOperation,
      createCanvasDocument({
        id: plan.documentId,
        projectId: plan.projectId,
      }),
    );
    expect({
      revision: reduced.revision,
      stateHash: reduced.stateHash,
      operationCursor: reduced.operationCursor,
    }).toEqual(plan.finalDocument);
  });

  it("produces stable role-separated identifiers and digests for fixed inputs", async () => {
    const imported = await compileFixture();
    const first = planFor(imported);
    const second = planFor(imported);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.documentId).toMatch(/^doc_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(first.planId).toMatch(/^mpl_[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(first.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(new Set(first.entries.map((entry) => entry.nodeId)).size).toBe(18);
    expect(new Set(first.entries.map((entry) => entry.operationId)).size).toBe(18);
    expect(
      new Set([
        first.documentId.slice(4),
        first.planId.slice(4),
        ...first.entries.map((entry) => entry.nodeId.slice(4)),
        ...first.entries.map((entry) => entry.operationId.slice(4)),
      ]).size,
    ).toBe(38);
  });

  it("uses an explicit canonical document identity when provided", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const derived = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const explicit = createCanvasMaterializationPlan(workspace, {
      documentId: "doc_01J00000000000000000000000",
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });

    expect(explicit.documentId).not.toBe(derived.documentId);
    expect(explicit.planDigest).not.toBe(derived.planDigest);
    expect(() =>
      createCanvasMaterializationPlan(workspace, {
        documentId: "not-canonical",
        actorId: FIXED_ACTOR,
        occurredAt: FIXED_TIME,
      }),
    ).toThrow();
    expect(() =>
      createCanvasMaterializationPlan(workspace, {
        actorId: "arbitrary-agent",
        occurredAt: FIXED_TIME,
      }),
    ).toThrow(/memi-import-pipeline/u);
    expect(() =>
      createCanvasMaterializationPlan(workspace, {
        actorId: FIXED_ACTOR,
        occurredAt: "not-a-time",
      }),
    ).toThrow();
  });

  it("retains blocked truth without fabricating a blocked frame", async () => {
    const imported = mutableImport(await compileFixture());
    const capturePlan = imported["capturePlan"] as {
      cells: Array<{ status: string; reason?: string }>;
    };
    const ledger = imported["coverageLedger"] as {
      cells: Array<{
        health: string;
        evidenceLevel: string | null;
        frameKind: string | null;
        reason?: string;
      }>;
    };
    capturePlan.cells[0] = {
      ...capturePlan.cells[0]!,
      status: "blocked",
      reason: "authentication-required",
    };
    ledger.cells[0] = {
      ...ledger.cells[0]!,
      health: "blocked",
      evidenceLevel: null,
      frameKind: null,
      reason: "authentication-required",
    };

    const workspace = compileProductWorkspace(
      imported as unknown as ProductImportResult,
    );
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });

    expect(workspace.coverageCells).toHaveLength(18);
    expect(workspace.coverageCells[0]).toMatchObject({
      health: "blocked",
      frameKind: null,
      evidenceLevel: null,
    });
    expect(plan.counts).toEqual({
      coverageCells: 18,
      materializedCells: 17,
      blockedCells: 1,
      unmaterializedCells: 1,
    });
    expect(plan.entries).toHaveLength(17);
    expect(
      plan.entries.some(
        (entry) => entry.coverageCellId === workspace.coverageCells[0]!.id,
      ),
    ).toBe(false);
  });

  it.each([
    ["digest", (plan: Record<string, unknown>) => {
      plan["planDigest"] = `sha256:${"f".repeat(64)}`;
    }],
    ["expected hash", (plan: Record<string, unknown>) => {
      const entries = plan["entries"] as Array<Record<string, unknown>>;
      entries[1]!["expectedBeforeHash"] = `sha256:${"f".repeat(64)}`;
    }],
    ["reorder", (plan: Record<string, unknown>) => {
      const entries = plan["entries"] as unknown[];
      entries.reverse();
    }],
    ["drop", (plan: Record<string, unknown>) => {
      const entries = plan["entries"] as unknown[];
      entries.pop();
    }],
    ["add", (plan: Record<string, unknown>) => {
      const entries = plan["entries"] as unknown[];
      entries.push(structuredClone(entries[0]));
    }],
    ["identifier collision", (plan: Record<string, unknown>) => {
      const entries = plan["entries"] as Array<Record<string, unknown>>;
      entries[1]!["nodeId"] = entries[0]!["nodeId"];
    }],
    ["unknown field", (plan: Record<string, unknown>) => {
      plan["runtime"] = "forbidden";
    }],
    ["plan handle", (plan: Record<string, unknown>) => {
      plan["planId"] = "mpl_01J00000000000000000000000";
    }],
    ["final document", (plan: Record<string, unknown>) => {
      const finalDocument = plan["finalDocument"] as { revision: number };
      finalDocument.revision += 1;
    }],
    ["coverage counts", (plan: Record<string, unknown>) => {
      const counts = plan["counts"] as { coverageCells: number };
      counts.coverageCells += 1;
    }],
  ])("rejects plan %s tampering before operation compilation", async (_name, mutate) => {
    const plan = structuredClone(
      planFor(await compileFixture()),
    ) as unknown as Record<string, unknown>;
    mutate(plan);

    const workspace = compileProductWorkspace(await compileFixture());
    expect(() => compileCanvasOperations(plan as never, workspace)).toThrow();
  });
});

describe("package boundary", () => {
  it("has a pure dependency graph and no forbidden production capability imports", async () => {
    const packageRoot = fileURLToPath(new URL("../", import.meta.url));
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies: Record<string, string> };
    const sourceDirectory = new URL("./", import.meta.url);
    const productionFiles = (await readdir(sourceDirectory)).filter(
      (file) => file.endsWith(".ts") && !file.includes(".test") &&
        file !== "test-fixtures.ts",
    );
    const productionSource = (
      await Promise.all(
        productionFiles.map((file) =>
          readFile(new URL(file, sourceDirectory), "utf8"),
        ),
      )
    ).join("\n");

    expect(packageRoot).toContain("/packages/product-import/");
    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      "@memi/canonical-json",
      "@memi/canvas-document",
      "@memi/import-compiler",
      "@memi/protocol",
    ]);
    expect(productionSource).not.toMatch(
      /from ["'](?:node:)?(?:fs|path|process|child_process|net|http|https|git)|@memi\/(?:runtime|harnesses)|from ["'][^"']*(?:openai|anthropic)|\bfetch\s*\(/u,
    );
  });
});
