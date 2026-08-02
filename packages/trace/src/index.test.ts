import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openTraceJournal,
  replayTrace,
  verifyTraceIntegrity,
  type TraceEventInput,
} from "./index.js";

const base = {
  schemaVersion: 1,
  projectId: "prj_01J00000000000000000000000",
  taskId: "tsk_01J00000000000000000000000",
  runId: "run_01J00000000000000000000000",
  actor: { kind: "system", id: "m0-fixture" },
  correlationId: "cor_01J00000000000000000000000",
  causationId: null,
  artifactIds: [] as string[],
  beforeHash: null,
  afterHash: `sha256:${"a".repeat(64)}`,
} as const;

const importCompleted: TraceEventInput = {
  ...base,
  id: "evt_01J00000000000000000000000",
  family: "import.completed",
  payload: { modelTokenUsage: 0 },
};

const canvasMaterialized: TraceEventInput = {
  ...base,
  id: "evt_01J00000000000000000000001",
  family: "canvas.matrix.materialized",
  payload: { canvasDocumentId: "doc_01J00000000000000000000000" },
};

describe("trace journal", () => {
  it("persists, verifies, and reopens a canonical integrity chain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-"));
    const path = join(directory, "trace.jsonl");
    const journal = await openTraceJournal(path, {
      clock: () => "2026-07-28T12:00:00.000Z",
    });
    const first = await journal.append(importCompleted);
    const second = await journal.append(canvasMaterialized);
    await journal.close();

    expect(second.previousEventHash).toBe(first.eventHash);
    const reopened = await openTraceJournal(path);
    const events = await reopened.readAll();
    await reopened.close();
    expect(verifyTraceIntegrity(events)).toEqual({
      valid: true,
      eventCount: 2,
    });
    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(2);
  });

  it("serializes concurrent appends and deduplicates identical retries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-"));
    const journal = await openTraceJournal(join(directory, "trace.jsonl"));
    const [first, second] = await Promise.all([
      journal.append(importCompleted),
      journal.append(canvasMaterialized),
    ]);
    const retried = await journal.append(importCompleted);
    const events = await journal.readAll();
    await journal.close();

    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(retried).toEqual(first);
    expect(events).toHaveLength(2);
    expect(verifyTraceIntegrity(events).valid).toBe(true);
  });

  it("replays only verified semantic state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-"));
    const journal = await openTraceJournal(join(directory, "trace.jsonl"));
    await journal.append(importCompleted);
    await journal.append(canvasMaterialized);
    const events = await journal.readAll();
    await journal.close();

    expect(replayTrace(events)).toEqual({
      projectId: base.projectId,
      imported: true,
      materializedCanvasIds: ["doc_01J00000000000000000000000"],
      lastSequence: 2,
    });
  });

  it("rejects invalid inputs before they reach the journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-"));
    const journal = await openTraceJournal(join(directory, "trace.jsonl"));

    await expect(
      journal.append({
        ...importCompleted,
        family: "provider.raw.secret",
      } as unknown as TraceEventInput),
    ).rejects.toThrow();
    expect(await journal.readAll()).toEqual([]);
    await journal.close();
  });
});
