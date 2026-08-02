import {
  access,
  appendFile,
  mkdir,
  readFile,
  realpath,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { hashCanonicalValue } from "@memi/canonical-json";
import {
  TraceEventInputSchema,
  TraceEventSchema,
  type TraceEvent,
  type TraceEventInput,
} from "@memi/protocol";

import type {
  TraceIntegrityResult,
  TraceReplayState,
} from "./types.js";

export * from "./canonical-canvas.js";

export type {
  TraceEvent,
  TraceEventInput,
  TraceIntegrityResult,
  TraceReplayState,
} from "./types.js";

const activeWriterPaths = new Set<string>();

function hashValue(value: unknown): string {
  return hashCanonicalValue(value);
}

function eventWithoutHash(event: TraceEvent): Omit<TraceEvent, "eventHash"> {
  const { eventHash: _eventHash, ...rest } = event;
  return rest;
}

function inputFromEvent(event: TraceEvent): TraceEventInput {
  return {
    schemaVersion: event.schemaVersion,
    id: event.id,
    projectId: event.projectId,
    taskId: event.taskId,
    runId: event.runId,
    family: event.family,
    actor: event.actor,
    correlationId: event.correlationId,
    causationId: event.causationId,
    payload: event.payload,
    artifactIds: event.artifactIds,
    beforeHash: event.beforeHash,
    afterHash: event.afterHash,
  };
}

async function canonicalJournalPath(filePath: string): Promise<string> {
  const absolute = resolve(filePath);
  await mkdir(dirname(absolute), { recursive: true });

  try {
    await access(absolute);
    return await realpath(absolute);
  } catch {
    return join(await realpath(dirname(absolute)), basename(absolute));
  }
}

async function readEvents(filePath: string): Promise<TraceEvent[]> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const events = contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return TraceEventSchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `Trace journal schema or JSON corruption at line ${index + 1}.`,
          { cause: error },
        );
      }
    });

  if (!verifyTraceIntegrity(events).valid) {
    throw new Error(`Trace journal integrity verification failed.`);
  }
  return events;
}

export interface TraceJournal {
  append(input: TraceEventInput): Promise<TraceEvent>;
  readAll(): Promise<TraceEvent[]>;
  close(): Promise<void>;
}

export interface OpenTraceJournalOptions {
  readonly clock?: () => string;
}

export async function openTraceJournal(
  filePath: string,
  options: OpenTraceJournalOptions = {},
): Promise<TraceJournal> {
  const canonicalPath = await canonicalJournalPath(filePath);
  if (activeWriterPaths.has(canonicalPath)) {
    throw new Error(`A trace writer is already active for ${canonicalPath}.`);
  }
  activeWriterPaths.add(canonicalPath);

  let events: TraceEvent[];
  try {
    events = await readEvents(canonicalPath);
  } catch (error) {
    activeWriterPaths.delete(canonicalPath);
    throw error;
  }

  let writeQueue: Promise<void> = Promise.resolve();
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let journalProjectId = events[0]?.projectId ?? null;
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    append(untrustedInput) {
      if (closed) {
        return Promise.reject(new Error(`Trace journal is closed.`));
      }
      const operation = writeQueue.then(async () => {
        const input = TraceEventInputSchema.parse(untrustedInput);
        if (
          journalProjectId !== null &&
          input.projectId !== journalProjectId
        ) {
          throw new Error(
            `Trace journal project mismatch: expected ${journalProjectId}, received ${input.projectId}.`,
          );
        }
        const actionDigest = hashValue(input);
        const existing = events.find((event) => event.id === input.id);
        if (existing !== undefined) {
          if (existing.actionDigest !== actionDigest) {
            throw new Error(
              `Trace event idempotency digest mismatch for ${input.id}.`,
            );
          }
          return existing;
        }

        const previous = events.at(-1);
        const withoutHash = {
          ...input,
          sequence: (previous?.sequence ?? 0) + 1,
          occurredAt: clock(),
          actionDigest,
          previousEventHash: previous?.eventHash ?? null,
        };
        const event = TraceEventSchema.parse({
          ...withoutHash,
          eventHash: hashValue(withoutHash),
        });

        await appendFile(canonicalPath, `${JSON.stringify(event)}\n`, "utf8");
        events = [...events, event];
        journalProjectId = journalProjectId ?? event.projectId;
        return event;
      });
      writeQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
    async readAll() {
      await writeQueue;
      return structuredClone(events);
    },
    close() {
      if (closePromise !== undefined) {
        return closePromise;
      }
      closed = true;
      closePromise = writeQueue.then(() => {
        activeWriterPaths.delete(canonicalPath);
      });
      return closePromise;
    },
  };
}

export function verifyTraceIntegrity(
  untrustedEvents: readonly TraceEvent[],
): TraceIntegrityResult {
  let previousEventHash: string | null = null;
  let projectId: string | null = null;

  for (const [index, untrustedEvent] of untrustedEvents.entries()) {
    const result = TraceEventSchema.safeParse(untrustedEvent);
    if (!result.success) {
      return { valid: false, eventCount: untrustedEvents.length };
    }
    const event = result.data;
    if (
      event.sequence !== index + 1 ||
      (projectId !== null && event.projectId !== projectId) ||
      event.previousEventHash !== previousEventHash ||
      hashValue(inputFromEvent(event)) !== event.actionDigest ||
      hashValue(eventWithoutHash(event)) !== event.eventHash
    ) {
      return { valid: false, eventCount: untrustedEvents.length };
    }
    projectId = event.projectId;
    previousEventHash = event.eventHash;
  }

  return { valid: true, eventCount: untrustedEvents.length };
}

export function replayTrace(
  events: readonly TraceEvent[],
): TraceReplayState {
  if (!verifyTraceIntegrity(events).valid) {
    throw new Error(`Trace integrity verification failed before replay.`);
  }

  return events.reduce<TraceReplayState>(
    (state, event) => {
      const projectId = state.projectId ?? event.projectId;
      if (event.family === "import.completed") {
        return {
          ...state,
          projectId,
          imported: true,
          lastSequence: event.sequence,
        };
      }
      if (event.family === "canvas.matrix.materialized") {
        const canvasDocumentId = event.payload.canvasDocumentId;
        return {
          ...state,
          projectId,
          materializedCanvasIds:
            typeof canvasDocumentId === "string"
              ? [...state.materializedCanvasIds, canvasDocumentId]
              : state.materializedCanvasIds,
          lastSequence: event.sequence,
        };
      }
      throw new Error(`Unsupported trace family during replay: ${event.family}.`);
    },
    {
      projectId: null,
      imported: false,
      materializedCanvasIds: [],
      lastSequence: 0,
    },
  );
}
