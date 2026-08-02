import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  openTraceJournal,
  replayTrace,
  verifyTraceIntegrity,
  type TraceEventInput,
} from "./index.js";

const input: TraceEventInput = {
  schemaVersion: 1,
  id: "evt_01J00000000000000000000000",
  projectId: "prj_01J00000000000000000000000",
  taskId: "tsk_01J00000000000000000000000",
  runId: "run_01J00000000000000000000000",
  family: "canvas.matrix.materialized",
  actor: { kind: "system", id: "canvas-runtime" },
  correlationId: "cor_01J00000000000000000000000",
  causationId: null,
  payload: { canvasDocumentId: "doc_01J00000000000000000000000" },
  artifactIds: [],
  beforeHash: null,
  afterHash: `sha256:${"a".repeat(64)}`,
};

describe("canonical trace journal", () => {
  it("shares one close drain across concurrent and repeated callers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-close-"));
    const path = join(directory, "trace.jsonl");
    const journal = await openTraceJournal(path);

    const accepted = journal.append(input);
    const firstClose = journal.close();
    const concurrentClose = journal.close();

    expect(concurrentClose).toBe(firstClose);
    await concurrentClose;

    await expect(accepted).resolves.toMatchObject({ id: input.id });
    await expect(journal.append(input)).rejects.toThrow(/closed/i);
    expect(journal.close()).toBe(firstClose);

    const reopened = await openTraceJournal(path);
    expect(await reopened.readAll()).toHaveLength(1);
    await reopened.close();
  });

  it("rejects a second in-process writer for the same path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-writer-"));
    const path = join(directory, "trace.jsonl");
    const first = await openTraceJournal(path);

    await expect(openTraceJournal(path)).rejects.toThrow(/writer/i);
    await first.close();

    const reopened = await openTraceJournal(path);
    await reopened.close();
  });

  it("rejects a mismatched idempotent repeat by action digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-digest-"));
    const journal = await openTraceJournal(join(directory, "trace.jsonl"));
    await journal.append(input);

    await expect(
      journal.append({ ...input, payload: { canvasDocumentId: "different" } }),
    ).rejects.toThrow(/idempotency|digest/i);
    await journal.close();
  });

  it("rejects corruption before reopen or replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-corrupt-"));
    const path = join(directory, "trace.jsonl");
    const journal = await openTraceJournal(path);
    await journal.append(input);
    const events = await journal.readAll();
    await journal.close();

    const contents = await readFile(path, "utf8");
    await writeFile(path, contents.replace("canvas-runtime", "tampered"), "utf8");

    await expect(openTraceJournal(path)).rejects.toThrow(/integrity/i);
    expect(() =>
      replayTrace([
        {
          ...events[0]!,
          actor: { kind: "system", id: "tampered" },
        },
      ]),
    ).toThrow(/integrity/i);
  });

  it("binds project authority before writing a cross-project append", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-project-"));
    const path = join(directory, "trace.jsonl");
    const journal = await openTraceJournal(path);
    await journal.append(input);

    await expect(
      journal.append({
        ...input,
        id: "evt_01J00000000000000000000001",
        projectId: "prj_01J00000000000000000000001",
      }),
    ).rejects.toThrow(/project/i);

    const events = await journal.readAll();
    expect(events).toHaveLength(1);
    expect(verifyTraceIntegrity(events).valid).toBe(true);
    await journal.close();

    expect((await readFile(path, "utf8")).trim().split("\n")).toHaveLength(1);
    const reopened = await openTraceJournal(path);
    expect(await reopened.readAll()).toEqual(events);
    await reopened.close();
  });

  it("fails replay for a closed canonical family without a reducer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "memi-trace-family-"));
    const journal = await openTraceJournal(join(directory, "trace.jsonl"));
    await journal.append({
      ...input,
      family: "task.started",
    });
    const events = await journal.readAll();
    await journal.close();

    expect(verifyTraceIntegrity(events).valid).toBe(true);
    expect(() => replayTrace(events)).toThrow(/unsupported trace family/i);
  });
});
