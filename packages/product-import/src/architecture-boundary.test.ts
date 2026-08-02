import { describe, expect, it } from "vitest";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  applyCanvasOperation,
  createCanvasDocument,
  prepareNodeCreateOperation,
} from "@memi/canvas-document";
import type { ProductImportResult } from "@memi/import-compiler";
import { ArtifactIdSchema } from "@memi/protocol";

import {
  compileCanvasOperations,
  compileProductWorkspace,
  createCanvasMaterializationPlan,
  validateCanvasMaterializationPlan,
  validateProductWorkspace,
  type CanvasMaterializationPlan,
} from "./index.js";
import {
  FIXED_ACTOR,
  FIXED_TIME,
  compileFixture,
} from "./test-fixtures.js";

function rehashPlan(
  plan: CanvasMaterializationPlan,
): CanvasMaterializationPlan {
  const { planDigest: _planDigest, ...body } = plan;
  return {
    ...body,
    planDigest: hashCanonicalValue(body),
  } as CanvasMaterializationPlan;
}

function rehashWorkspace<Workspace extends { readonly workspaceDigest: string }>(
  workspace: Workspace,
): Workspace {
  const { workspaceDigest: _workspaceDigest, ...body } = workspace;
  return {
    ...body,
    workspaceDigest: hashCanonicalValue(body),
  } as Workspace;
}

function roleBody(role: string, value: object): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const digest = hashCanonicalValue({
    namespace: "memi.product-import.plan.v1",
    role,
    value,
  }).slice("sha256:".length);
  let remaining = BigInt(`0x${digest}`) & ((1n << 130n) - 1n);
  let body = "";
  for (let index = 0; index < 26; index += 1) {
    body = alphabet[Number(remaining & 31n)] + body;
    remaining >>= 5n;
  }
  return body;
}

function rehandlePlan(plan: CanvasMaterializationPlan): CanvasMaterializationPlan {
  const planId = `mpl_${roleBody("canvas-materialization-plan", {
    projectId: plan.projectId,
    documentId: plan.documentId,
    actorId: plan.actorId,
    workspaceDigest: plan.workspaceDigest,
    sourceContentFingerprint: plan.sourceContentFingerprint,
    compilerFingerprint: plan.compilerFingerprint,
    projectionIntegrityDigests: plan.projectionIntegrityDigests,
  })}` as CanvasMaterializationPlan["planId"];
  return rehashPlan({ ...plan, planId });
}

function rebuildEntryTruth(
  plan: CanvasMaterializationPlan,
  mutate: (
    entry: CanvasMaterializationPlan["entries"][number],
    index: number,
  ) => CanvasMaterializationPlan["entries"][number],
): CanvasMaterializationPlan {
  let document = createCanvasDocument({
    id: plan.documentId,
    projectId: plan.projectId,
  });
  const initialDocument = {
    revision: 0 as const,
    stateHash: document.stateHash,
  };
  const entries = plan.entries.map((entry, index) => {
    const changed = mutate(entry, index);
    const identity = {
      documentId: plan.documentId,
      coverageCellId: changed.coverageCellId,
      routeId: changed.routeId,
      stateId: changed.stateId,
      viewport: changed.viewport,
    };
    const nodeId = `nod_${roleBody("coverage-cell-node", identity)}` as
      typeof changed.nodeId;
    const operationId = `opn_${roleBody("coverage-cell-operation", {
      ...identity,
      ordinal: changed.ordinal,
    })}` as typeof changed.operationId;
    const operation = prepareNodeCreateOperation(document, {
      id: operationId,
      actorId: plan.actorId,
      occurredAt: plan.occurredAt,
      node: {
        id: nodeId,
        kind: changed.frameKind,
        authority: changed.frameAuthority,
        evidenceLevel: changed.evidenceLevel,
        coverageHealth: changed.coverageHealth,
        parentId: null,
        position: {
          x: { desktop: 0, tablet: 1540, mobile: 2474 }[
            changed.viewport.name
          ],
          y: Math.floor(changed.ordinal / 3) * 1240,
        },
        size: {
          width: changed.viewport.width,
          height: changed.viewport.height,
        },
        viewport: changed.viewport,
        source: {
          routeId: changed.routeId,
          stateId: changed.stateId,
          coverageCellId: changed.coverageCellId,
        },
      },
    });
    document = applyCanvasOperation(document, operation);
    return {
      ...changed,
      nodeId,
      operationId,
      expectedBeforeHash: operation.expectedBeforeHash,
      resultingHash: operation.resultingHash,
      actionDigest: operation.actionDigest,
    };
  });
  return rehashPlan({
    ...plan,
    initialDocument,
    entries,
    finalDocument: {
      revision: document.revision,
      stateHash: document.stateHash,
      operationCursor: document.operationCursor,
    },
  });
}

describe("workspace-bound materialization authority", () => {
  it("binds validation and compilation to the exact workspace digest", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });

    expect(plan.workspaceDigest).toBe(workspace.workspaceDigest);
    expect(plan.unmaterializedEntries).toEqual([]);
    expect(validateCanvasMaterializationPlan(plan, workspace)).toBe(plan);
    expect(compileCanvasOperations(plan, workspace)).toHaveLength(18);
  });

  it("rejects a self-consistent re-digested terminal omission", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const original = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const entries = original.entries.slice(0, -1);
    const omitted = rehashPlan({
      ...original,
      entries,
      finalDocument: {
        revision: entries.length,
        stateHash: entries.at(-1)!.resultingHash,
        operationCursor: entries.at(-1)!.operationId,
      },
      counts: {
        ...original.counts,
        materializedCells: entries.length,
        blockedCells: 1,
        unmaterializedCells: 1,
      },
    });

    expect(() =>
      validateCanvasMaterializationPlan(omitted, workspace),
    ).toThrow(/workspace|materialized|coverage/u);
  });

  it("retains exact nonmaterialized identity, status, health, and reason", async () => {
    const imported = structuredClone(await compileFixture()) as ProductImportResult;
    const blockedId = imported.coverageLedger.cells[0]!.id;
    imported.capturePlan.cells[0] = {
      ...imported.capturePlan.cells[0]!,
      status: "unsupported",
      reason: "adapter-does-not-support-state",
    };
    const workspace = compileProductWorkspace(imported);
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });

    expect(plan.entries).toHaveLength(17);
    expect(plan.unmaterializedEntries).toEqual([
      {
        ordinal: 0,
        coverageCellId: blockedId,
        captureStatus: "unsupported",
        coverageHealth: "partial",
        reason: "adapter-does-not-support-state",
      },
    ]);

    const relabeled = rehashPlan({
      ...plan,
      unmaterializedEntries: [
        {
          ...plan.unmaterializedEntries[0]!,
          captureStatus: "blocked",
          reason: "laundered",
        },
      ],
    });
    expect(() =>
      validateCanvasMaterializationPlan(relabeled, workspace),
    ).toThrow(/workspace|unmaterialized|status/u);

    const missingReason = rehashPlan({
      ...plan,
      unmaterializedEntries: [
        {
          ...plan.unmaterializedEntries[0]!,
          reason: "",
        },
      ],
    });
    expect(() =>
      validateCanvasMaterializationPlan(missingReason, workspace),
    ).toThrow(/reason/u);
  });

  it("rejects re-digested projected truth with stale integrity digests", async () => {
    const workspace = structuredClone(
      compileProductWorkspace(await compileFixture()),
    );
    (workspace.routes as Array<(typeof workspace.routes)[number]>)[0] = {
      ...workspace.routes[0]!,
      displayName: "Relabeled home",
    };
    const tampered = rehashWorkspace(workspace);

    expect(() => validateProductWorkspace(tampered)).toThrow(
      /integrity digest|projection/u,
    );
  });

  it("rejects re-digested verified evidence without an artifact", async () => {
    const workspace = structuredClone(
      compileProductWorkspace(await compileFixture()),
    );
    (workspace.coverageCells as Array<
      (typeof workspace.coverageCells)[number]
    >)[0] = {
      ...workspace.coverageCells[0]!,
      evidenceLevel: "verified",
      evidenceArtifactIds: [],
    };
    const tampered = rehashWorkspace(workspace);

    expect(() => validateProductWorkspace(tampered)).toThrow(
      /artifact|verified|projection/u,
    );
  });

  it("rejects absolute and traversal design-token source paths", async () => {
    for (const sourceFile of [
      "/private/tmp/tokens.css",
      "../tokens.css",
      "C:\\tokens.css",
      "file:///tmp/tokens.css",
    ]) {
      const imported = structuredClone(
        await compileFixture(),
      ) as ProductImportResult;
      imported.designSystemManifest.tokens[0] = {
        ...imported.designSystemManifest.tokens[0]!,
        sourceFile,
      };

      expect(() => compileProductWorkspace(imported)).toThrow(
        /contained|relative|source/i,
      );
    }
  });

  it("does not vary the plan handle with operation occurrence time", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const first = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const later = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: "2026-07-28T12:05:00.000Z",
    });

    expect(later.planId).toBe(first.planId);
    expect(later.planDigest).not.toBe(first.planDigest);
    expect(later.entries[0]!.actionDigest).not.toBe(
      first.entries[0]!.actionDigest,
    );
  });

  it("rejects a fully re-digested inferred-to-verified plan projection", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const laundered = rebuildEntryTruth(plan, (entry, index) =>
      index === 0 ? { ...entry, evidenceLevel: "verified" } : entry,
    );

    expect(() =>
      validateCanvasMaterializationPlan(laundered, workspace),
    ).toThrow(/workspace|truth|evidence|projection/u);
  });

  it("rejects every re-digested materialized truth-field cross-binding", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const other = plan.entries[6]!;
    const cases = [
      (entry: typeof other, index: number) =>
        index === 0 ? { ...entry, routeId: other.routeId } : entry,
      (entry: typeof other, index: number) =>
        index === 0 ? { ...entry, stateId: other.stateId } : entry,
      (entry: typeof other, index: number) => {
        if (index === 0) {
          return { ...entry, viewport: plan.entries[1]!.viewport };
        }
        if (index === 1) {
          return { ...entry, viewport: plan.entries[0]!.viewport };
        }
        return entry;
      },
      (entry: typeof other, index: number) =>
        index === 0 ? { ...entry, coverageHealth: "current" as const } : entry,
      (entry: typeof other, index: number) => {
        if (index === 0) {
          return { ...entry, ordinal: 1 };
        }
        if (index === 1) {
          return { ...entry, ordinal: 0 };
        }
        return entry;
      },
    ];
    for (const mutate of cases) {
      const tampered = rebuildEntryTruth(plan, mutate);
      expect(() =>
        validateCanvasMaterializationPlan(tampered, workspace),
      ).toThrow();
    }

    for (const changed of [
      { frameKind: "draft-frame" as const },
      { frameAuthority: "canvas-document" as const },
    ]) {
      const entries = plan.entries.map((entry, index) =>
        index === 0 ? { ...entry, ...changed } : entry,
      );
      const tampered = rehashPlan({ ...plan, entries });
      expect(() =>
        validateCanvasMaterializationPlan(tampered, workspace),
      ).toThrow();
    }
  });

  it("rejects top-level project, source, and compiler claim mismatches", async () => {
    const workspace = compileProductWorkspace(await compileFixture());
    const plan = createCanvasMaterializationPlan(workspace, {
      actorId: FIXED_ACTOR,
      occurredAt: FIXED_TIME,
    });
    const changedProject = rebuildEntryTruth(
      {
        ...plan,
        projectId: "prj_01J00000000000000000000001" as typeof plan.projectId,
      },
      (entry) => entry,
    );
    for (const changed of [
      changedProject,
      { ...plan, sourceContentFingerprint: `sha256:${"a".repeat(64)}` },
      { ...plan, compilerFingerprint: `sha256:${"b".repeat(64)}` },
    ]) {
      const tampered = rehandlePlan(changed as CanvasMaterializationPlan);
      expect(() =>
        validateCanvasMaterializationPlan(tampered, workspace),
      ).toThrow(/workspace|project|source|compiler/u);
    }
  });

  it("rejects verified capture status over partial inferred coverage", async () => {
    const imported = structuredClone(await compileFixture()) as ProductImportResult;
    imported.capturePlan.cells[0] = {
      ...imported.capturePlan.cells[0]!,
      status: "verified",
    };

    expect(() => compileProductWorkspace(imported)).toThrow(
      /verified|coverage|evidence|health/u,
    );
  });

  it("rejects non-http running URL schemes even on loopback", async () => {
    const imported = structuredClone(await compileFixture()) as {
      -readonly [Key in keyof ProductImportResult]: ProductImportResult[Key];
    };
    imported.productManifest = {
      schemaVersion: 1,
      projectId: imported.productManifest.projectId,
      importMode: "running-url",
      source: { kind: "running-url", url: "ftp://localhost/design" },
      dimensions: imported.productManifest.dimensions,
    };

    expect(() => compileProductWorkspace(imported)).toThrow(/http|scheme/iu);
  });

  it("rejects a re-digested absolute design-token source path", async () => {
    const workspace = structuredClone(
      compileProductWorkspace(await compileFixture()),
    );
    (workspace.designTokens as Array<
      (typeof workspace.designTokens)[number]
    >)[0] = {
      ...workspace.designTokens[0]!,
      sourceFile: "/private/re-authored/tokens.css",
    };
    const designSystem = {
      schemaVersion: 1,
      projectId: workspace.projectId,
      tokens: workspace.designTokens,
    };
    const tampered = rehashWorkspace({
      ...workspace,
      projectionIntegrityDigests: {
        ...workspace.projectionIntegrityDigests,
        designSystem: hashCanonicalValue(designSystem),
      },
    });

    expect(() => validateProductWorkspace(tampered)).toThrow(
      /contained|relative|source/u,
    );
  });

  it("requires content binding for otherwise verified artifact evidence", async () => {
    const imported = structuredClone(await compileFixture()) as ProductImportResult;
    imported.capturePlan.cells[0] = {
      ...imported.capturePlan.cells[0]!,
      status: "verified",
    };
    imported.coverageLedger.cells[0] = {
      ...imported.coverageLedger.cells[0]!,
      health: "current",
      evidenceLevel: "verified",
      evidenceArtifactIds: [
        ArtifactIdSchema.parse("art_01J00000000000000000000000"),
      ],
    };

    expect(() => compileProductWorkspace(imported)).toThrow(
      /evidence hash|content bind|verified/u,
    );
  });

  it("rejects self-authored verified evidence without artifact authority", async () => {
    const imported = structuredClone(await compileFixture()) as ProductImportResult;
    imported.capturePlan.cells[0] = {
      ...imported.capturePlan.cells[0]!,
      status: "verified",
    };
    imported.coverageLedger.cells[0] = {
      ...imported.coverageLedger.cells[0]!,
      health: "current",
      evidenceLevel: "verified",
      evidenceArtifactIds: [
        ArtifactIdSchema.parse("art_01J00000000000000000000000"),
      ],
      evidenceHash: `sha256:${"a".repeat(64)}`,
    };

    expect(() => compileProductWorkspace(imported)).toThrow(
      /artifact authority|resolver|verified evidence/u,
    );
  });
});
