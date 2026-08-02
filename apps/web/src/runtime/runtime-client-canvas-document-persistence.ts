import type {
  CanvasDocumentAppendV3,
  CanvasDocumentIdentityV3,
  CanvasDocumentJournalV3,
  CanvasDocumentSnapshotV3,
  CanvasDocumentV3PersistencePort,
} from "@memi/protocol";

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

function journalKey(identity: CanvasDocumentIdentityV3): string {
  return `${identity.projectId}:${identity.documentId}`;
}

function journalFromSnapshot(
  snapshot: CanvasDocumentSnapshotV3,
  operations: CanvasDocumentJournalV3["operations"] = [],
): CanvasDocumentJournalV3 {
  return {
    schemaVersion: 1,
    kind: "canvas-document-v3-journal",
    identity: snapshot.identity,
    snapshot,
    operations,
    operationBytes: new TextEncoder().encode(JSON.stringify(operations)).byteLength,
  };
}

/**
 * Ephemeral browser-only V3 persistence. It deliberately owns no browser
 * storage: closing or reloading the page discards its journal.
 */
export function createEphemeralCanvasDocumentPersistence(): CanvasDocumentV3PersistencePort {
  const journals = new Map<string, CanvasDocumentJournalV3>();
  const port: CanvasDocumentV3PersistencePort = {
    async load(identity) {
      return journals.get(journalKey(identity)) ?? null;
    },
    async initialize(snapshot) {
      journals.set(journalKey(snapshot.identity), journalFromSnapshot(snapshot));
    },
    async append(append: CanvasDocumentAppendV3) {
      const key = journalKey(append.identity);
      const journal = journals.get(key);
      if (journal === undefined) {
        throw new Error("Canvas V3 journal is not initialized.");
      }
      const next = journalFromSnapshot(journal.snapshot, [
        ...journal.operations,
        append.operation,
      ]);
      journals.set(key, next);
      return {
        schemaVersion: 1,
        identity: append.identity,
        operationId: append.operation.id,
        revision: append.operation.expectedRevision + 1,
        stateHash: append.operation.resultingHash,
      };
    },
    async checkpoint(snapshot) {
      const existing = journals.get(journalKey(snapshot.identity));
      journals.set(
        journalKey(snapshot.identity),
        journalFromSnapshot(snapshot, existing?.operations ?? []),
      );
    },
  };
  return Object.freeze(port);
}
