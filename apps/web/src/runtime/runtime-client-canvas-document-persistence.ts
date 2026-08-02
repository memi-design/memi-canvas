import type {
  CanvasDocumentAppendV3,
  CanvasDocumentIdentityV3,
  CanvasDocumentJournalV3,
  CanvasDocumentSnapshotV3,
  CanvasDocumentV3,
  CanvasDocumentV3PersistencePort,
} from "@memi/protocol";
import {
  CanvasDocumentAppendV3Schema,
  CanvasDocumentIdentityV3Schema,
  CanvasDocumentJournalV3Schema,
  CanvasDocumentSnapshotV3Schema,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  CanvasDocumentV3PersistenceAdapter,
} from "@memi/canvas-document";

import type { RuntimeClientV1 } from "./runtime-client.js";

/**
 * Adapts the private authenticated runtime client to the narrow V3 journal
 * persistence port used by the canvas authority. The renderer never receives
 * a database path or writes storage directly.
 */
export function createRuntimeClientCanvasDocumentPersistence(
  runtime: Pick<RuntimeClientV1, "canvasDocuments">,
): CanvasDocumentV3PersistencePort {
  const port: CanvasDocumentV3PersistencePort = {
    async load(identity) {
      const result = await runtime.canvasDocuments.load({ identity });
      return result.journal;
    },
    async initialize(snapshot) {
      await runtime.canvasDocuments.initialize({ snapshot });
    },
    async append(append) {
      const result = await runtime.canvasDocuments.append({ append });
      return result.receipt;
    },
    async checkpoint(snapshot) {
      await runtime.canvasDocuments.checkpoint({ snapshot });
    },
  };
  return Object.freeze(port);
}

export async function initializeCanvasDocumentV3Persistence(
  document: CanvasDocumentV3,
  persistence: CanvasDocumentV3PersistencePort,
): Promise<void> {
  await CanvasDocumentV3PersistenceAdapter.open(document, persistence);
}

function journalKey(identity: CanvasDocumentIdentityV3): string {
  return `${identity.projectId}:${identity.documentId}`;
}

function immutableClone<Value>(value: Value): Value {
  const clone = structuredClone(value);
  const freeze = (candidate: unknown): unknown => {
    if (candidate !== null && typeof candidate === "object") {
      for (const child of Object.values(candidate)) {
        freeze(child);
      }
      Object.freeze(candidate);
    }
    return candidate;
  };
  return freeze(clone) as Value;
}

function journalFromSnapshot(
  snapshot: CanvasDocumentSnapshotV3,
  operations: CanvasDocumentJournalV3["operations"] = [],
): CanvasDocumentJournalV3 {
  const encoder = new TextEncoder();
  return immutableClone(
    CanvasDocumentJournalV3Schema.parse({
    schemaVersion: 1,
    kind: "canvas-document-v3-journal",
    identity: snapshot.identity,
    snapshot,
    operations,
    operationBytes: operations.reduce(
      (total, operation) =>
        total + encoder.encode(JSON.stringify(operation)).byteLength,
      0,
    ),
    }),
  );
}

function replayJournal(journal: CanvasDocumentJournalV3) {
  return journal.operations.reduce(
    (document, operation) => applyCanvasOperationV3(document, operation),
    journal.snapshot.document,
  );
}

function hasCurrentDocumentProof(
  snapshot: CanvasDocumentSnapshotV3,
  current: CanvasDocumentSnapshotV3["document"],
): boolean {
  return (
    snapshot.identity.projectId === current.projectId &&
    snapshot.identity.documentId === current.id &&
    snapshot.document.revision === current.revision &&
    snapshot.document.stateHash === current.stateHash &&
    snapshot.document.operationCursor === current.operationCursor
  );
}

/**
 * Ephemeral browser-only V3 persistence. It deliberately owns no browser
 * storage: closing or reloading the page discards its journal.
 */
export function createEphemeralCanvasDocumentPersistence(): CanvasDocumentV3PersistencePort {
  const journals = new Map<string, CanvasDocumentJournalV3>();
  const port: CanvasDocumentV3PersistencePort = {
    async load(identity) {
      const parsedIdentity = CanvasDocumentIdentityV3Schema.parse(identity);
      return journals.get(journalKey(parsedIdentity)) ?? null;
    },
    async initialize(snapshot) {
      const parsedSnapshot = CanvasDocumentSnapshotV3Schema.parse(snapshot);
      journals.set(
        journalKey(parsedSnapshot.identity),
        journalFromSnapshot(parsedSnapshot),
      );
    },
    async append(append: CanvasDocumentAppendV3) {
      const parsedAppend = CanvasDocumentAppendV3Schema.parse(append);
      const key = journalKey(parsedAppend.identity);
      const journal = journals.get(key);
      if (journal === undefined) {
        throw new Error("Canvas V3 journal is not initialized.");
      }
      const currentDocument = replayJournal(journal);
      const nextDocument = applyCanvasOperationV3(
        currentDocument,
        parsedAppend.operation,
      );
      const next = journalFromSnapshot(journal.snapshot, [
        ...journal.operations,
        parsedAppend.operation,
      ]);
      journals.set(key, next);
      return {
        schemaVersion: 1,
        identity: parsedAppend.identity,
        operationId: parsedAppend.operation.id,
        revision: nextDocument.revision,
        stateHash: nextDocument.stateHash,
      };
    },
    async checkpoint(snapshot) {
      const parsedSnapshot = CanvasDocumentSnapshotV3Schema.parse(snapshot);
      const key = journalKey(parsedSnapshot.identity);
      const existing = journals.get(key);
      if (existing === undefined) {
        throw new Error("Canvas V3 journal is not initialized.");
      }
      if (!hasCurrentDocumentProof(parsedSnapshot, replayJournal(existing))) {
        throw new Error("Canvas V3 checkpoint is stale.");
      }
      journals.set(
        key,
        journalFromSnapshot(parsedSnapshot),
      );
    },
  };
  return Object.freeze(port);
}
