import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { canonicalJson } from "@memi/canonical-json";
import {
  createCanvasMaterializationPlan,
  type CanvasMaterializationPlan,
  type ProductWorkspace,
} from "@memi/product-import";
import type { DurableRuntime } from "@memi/runtime";
import {
  serializeWorkspaceDocumentation,
  type CanonicalCanvasReplay,
} from "../../workspace-documentation/src/projector.js";

import {
  composeExecutedImportDocumentation,
  executeApprovedImportBatch,
} from "./index.js";
import {
  approvedBatch,
  cleanupFixture,
  productPlan,
  runtimeFixture,
  type RuntimeFixture,
} from "../test-support.js";

interface ExecutedImport {
  readonly workspace: ProductWorkspace;
  readonly plan: CanvasMaterializationPlan;
  readonly fixture: RuntimeFixture;
}

async function executedImport(): Promise<ExecutedImport> {
  const { workspace, plan } = await productPlan();
  const fixture = await runtimeFixture(plan);
  try {
    const batch = await approvedBatch(fixture, workspace, plan);
    await executeApprovedImportBatch(
      fixture.runtime,
      workspace,
      plan,
      batch,
    );
    return { workspace, plan, fixture };
  } catch (error) {
    await cleanupFixture(fixture);
    throw error;
  }
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) {
    expectDeeplyFrozen(child);
  }
}

describe("executed import documentation adapter", () => {
  it("projects the exact canonical runtime replay without inventing design evidence", async () => {
    const { workspace, plan, fixture } = await executedImport();
    try {
      const replay = vi.spyOn(fixture.runtime, "replayCanvasTrace");

      const documentation = composeExecutedImportDocumentation(
        fixture.runtime,
        workspace,
        plan,
      );

      expect(replay).toHaveBeenCalledOnce();
      expect(replay).toHaveBeenCalledWith(plan.projectId);
      expect(documentation.coverage).toMatchObject({
        screenCells: 18,
        captures: {
          observed: 0,
        },
        materialization: {
          committed: 18,
          plannedNotCommitted: 0,
          unmaterialized: 0,
        },
        flows: {
          declared: workspace.flows.length,
          observed: 0,
        },
        tokens: {
          declared: workspace.designTokens.length,
        },
        components: {
          available: 0,
          status: "unavailable",
        },
      });
      expect(
        documentation.screens.every(
          (screen) => screen.materialization.status === "committed",
        ),
      ).toBe(true);
      expect(
        documentation.screens.some(
          (screen) =>
            (screen.capture.status as string) === "verified" ||
            (screen.capture.status as string) === "visually-verified",
        ),
      ).toBe(false);
      expect(documentation.flows).toEqual(
        workspace.flows.map((flow) => ({
          id: flow.id,
          name: flow.name,
          status: "declared",
          observationStatus: "not-observed",
          steps: flow.steps,
        })),
      );
      expect(
        documentation.designSystem.tokens.map((token) => token.status),
      ).toEqual(
        workspace.designTokens.map(() => "declared"),
      );
      expect(documentation.designSystem.components).toEqual({
        status: "unavailable",
        items: [],
      });
      expect(documentation.abstentions).toContainEqual({
        authority: "visual-verification",
        status: "unavailable",
        reason: "runtime-replay-is-not-visual-verification",
      });
      expectDeeplyFrozen(documentation);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("is deterministic under canonical serialization and needs only runtime replay authority", async () => {
    const { workspace, plan, fixture } = await executedImport();
    try {
      const canonicalReplay = structuredClone(
        fixture.runtime.replayCanvasTrace(plan.projectId),
      ) as unknown as CanonicalCanvasReplay;
      const replayCanvasTrace = vi.fn(
        (projectId: string): CanonicalCanvasReplay => {
          expect(projectId).toBe(plan.projectId);
          return structuredClone(canonicalReplay);
        },
      );
      const replayOnlyRuntime = {
        replayCanvasTrace,
      } as unknown as DurableRuntime;

      const first = composeExecutedImportDocumentation(
        replayOnlyRuntime,
        workspace,
        plan,
      );
      const second = composeExecutedImportDocumentation(
        replayOnlyRuntime,
        workspace,
        plan,
      );

      expect(replayCanvasTrace).toHaveBeenCalledTimes(2);
      expect(serializeWorkspaceDocumentation(second)).toBe(
        serializeWorkspaceDocumentation(first),
      );
      expect(canonicalJson(second)).toBe(canonicalJson(first));
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects a tampered canonical replay instead of laundering it into documentation", async () => {
    const { workspace, plan, fixture } = await executedImport();
    try {
      const replay = structuredClone(
        fixture.runtime.replayCanvasTrace(plan.projectId),
      );
      replay.events[0] = {
        ...replay.events[0]!,
        operationId: replay.events[1]!.operationId,
      };
      vi.spyOn(fixture.runtime, "replayCanvasTrace").mockReturnValue(
        replay,
      );

      expect(() =>
        composeExecutedImportDocumentation(
          fixture.runtime,
          workspace,
          plan,
        ),
      ).toThrow();
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("passes through the exact replay wrapper so the projector rejects non-plain data", async () => {
    const { workspace, plan, fixture } = await executedImport();
    try {
      const replay = fixture.runtime.replayCanvasTrace(plan.projectId);
      const hostileReplay = Object.assign(
        Object.create(null) as object,
        replay,
      ) as typeof replay;
      vi.spyOn(fixture.runtime, "replayCanvasTrace").mockReturnValue(
        hostileReplay,
      );

      expect(() =>
        composeExecutedImportDocumentation(
          fixture.runtime,
          workspace,
          plan,
        ),
      ).toThrow("must be a plain object");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects a replay whose top-level project identity does not match the workspace", async () => {
    const { workspace, plan, fixture } = await executedImport();
    try {
      const replay = fixture.runtime.replayCanvasTrace(plan.projectId);
      vi.spyOn(fixture.runtime, "replayCanvasTrace").mockReturnValue({
        ...replay,
        projectId: "prj_01J00000000000000000000001",
      });

      expect(() =>
        composeExecutedImportDocumentation(
          fixture.runtime,
          workspace,
          plan,
        ),
      ).toThrow("head is not bound to the plan");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("rejects a valid plan whose operation mapping does not match the executed replay", async () => {
    const { workspace, plan, fixture } = await executedImport();
    try {
      const mismatchedPlan = createCanvasMaterializationPlan(
        workspace,
        {
          documentId: plan.documentId,
          actorId: plan.actorId,
          occurredAt: "2026-07-28T12:00:01.000Z",
        },
      );

      expect(() =>
        composeExecutedImportDocumentation(
          fixture.runtime,
          workspace,
          mismatchedPlan,
        ),
      ).toThrow("does not exactly map to plan order");
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("contains no direct database, screenshot, source-anchor, or collaboration composition path", async () => {
    const source = await readFile(
      new URL("./documentation-adapter.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("runtime.replayCanvasTrace(projectId)");
    expect(source).not.toMatch(
      /(?:node:sqlite|DatabaseSync|inspectDatabase|screenshot|sourceAnchor|source_anchor|collaboration)/u,
    );
  });
});
