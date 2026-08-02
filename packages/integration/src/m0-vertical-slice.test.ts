import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  createCanvasDocument,
  materializeScreenMatrix,
} from "@memi/canvas-document";
import { compileProductImport } from "@memi/import-compiler";
import {
  CanvasDocumentSchema,
  CoverageLedgerSchema,
  ProductManifestSchema,
} from "@memi/protocol";
import {
  openTraceJournal,
  replayTrace,
  verifyTraceIntegrity,
} from "@memi/trace";

const FIXTURE_ROOT = fileURLToPath(
  new URL("../../test-fixtures/deterministic-product/", import.meta.url),
);
const ids = {
  project: "prj_01J00000000000000000000000",
  document: "doc_01J00000000000000000000000",
  task: "tsk_01J00000000000000000000000",
  run: "run_01J00000000000000000000000",
  correlation: "cor_01J00000000000000000000000",
  importEvent: "evt_01J00000000000000000000000",
  canvasEvent: "evt_01J00000000000000000000001",
  nodes: [
    "nod_01J00000000000000000000000",
    "nod_01J00000000000000000000001",
    "nod_01J00000000000000000000002",
  ],
  operations: [
    "opn_01J00000000000000000000000",
    "opn_01J00000000000000000000001",
    "opn_01J00000000000000000000002",
  ],
} as const;

describe("M0 canonical deterministic vertical slice", () => {
  it("imports, materializes semantic operations, and replays one canonical trace", async () => {
    const imported = await compileProductImport({
      rootDir: FIXTURE_ROOT,
      projectId: ids.project,
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
    });
    const homeRoute = imported.routeManifest.routes.find(
      (route) => route.path === "/",
    )!;
    const defaultState = imported.stateManifest.states.find(
      (state) => state.routeId === homeRoute.id && state.name === "default",
    )!;
    const matrixCells = imported.coverageLedger.cells
      .filter(
        (cell) =>
          cell.routeId === homeRoute.id && cell.stateId === defaultState.id,
      )
      .map((cell, index) => ({
        nodeId: ids.nodes[index]!,
        operationId: ids.operations[index]!,
        routeId: cell.routeId,
        stateId: cell.stateId,
        coverageCellId: cell.id,
        viewport: {
          name: cell.viewport.name as "desktop" | "tablet" | "mobile",
          width: cell.viewport.width,
          height: cell.viewport.height,
        },
        evidenceLevel: cell.evidenceLevel!,
        coverageHealth: cell.health as "partial",
      }));
    const original = createCanvasDocument({
      id: ids.document,
      projectId: ids.project,
    });
    const materialized = materializeScreenMatrix(original, {
      actorId: "import-compiler",
      occurredAt: "2026-07-28T12:00:00.000Z",
      cells: matrixCells,
    });

    const traceDirectory = await mkdtemp(join(tmpdir(), "memi-m0-integration-"));
    const journal = await openTraceJournal(
      join(traceDirectory, "trace.jsonl"),
      { clock: () => "2026-07-28T12:00:00.000Z" },
    );
    await journal.append({
      schemaVersion: 1,
      id: ids.importEvent,
      projectId: ids.project,
      taskId: ids.task,
      runId: ids.run,
      family: "import.completed",
      actor: { kind: "system", id: "import-compiler" },
      correlationId: ids.correlation,
      causationId: null,
      payload: {
        modelTokenUsage: imported.modelTokenUsage,
        contentFingerprint: imported.contentFingerprint,
      },
      artifactIds: [],
      beforeHash: null,
      afterHash: imported.contentFingerprint,
    });
    await journal.append({
      schemaVersion: 1,
      id: ids.canvasEvent,
      projectId: ids.project,
      taskId: ids.task,
      runId: ids.run,
      family: "canvas.matrix.materialized",
      actor: { kind: "system", id: "canvas-document" },
      correlationId: ids.correlation,
      causationId: ids.importEvent,
      payload: {
        canvasDocumentId: ids.document,
        operationCount: materialized.operations.length,
      },
      artifactIds: [],
      beforeHash: original.stateHash,
      afterHash: materialized.document.stateHash,
    });
    const events = await journal.readAll();
    await journal.close();

    expect(ProductManifestSchema.parse(imported.productManifest)).toEqual(
      imported.productManifest,
    );
    expect(CoverageLedgerSchema.parse(imported.coverageLedger)).toEqual(
      imported.coverageLedger,
    );
    expect(CanvasDocumentSchema.parse(materialized.document)).toEqual(
      materialized.document,
    );
    expect(imported.modelTokenUsage).toBe(0);
    expect(materialized.operations).toHaveLength(3);
    expect(materialized.document.revision).toBe(3);
    expect(
      materialized.document.nodes.map((node) => node.viewport?.name),
    ).toEqual(["desktop", "tablet", "mobile"]);
    expect(verifyTraceIntegrity(events)).toEqual({
      valid: true,
      eventCount: 2,
    });
    expect(replayTrace(events)).toEqual({
      projectId: ids.project,
      imported: true,
      materializedCanvasIds: [ids.document],
      lastSequence: 2,
    });
  });
});
