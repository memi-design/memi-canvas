import type {
  CanvasDocumentV3,
  CanvasDocumentV3PersistencePort,
  CanvasOperationV3,
} from "@memi/protocol";
import {
  applyCanvasOperationV3,
  CanvasDocumentV3PersistenceAdapter,
  prepareCanvasOperationV3,
  type CanvasDocumentV3PersistencePolicy,
  type PrepareCanvasOperationV3Input,
} from "@memi/canvas-document";

export type CanonicalCanvasCommitIntentV3 = PrepareCanvasOperationV3Input;

export interface CanonicalCanvasJournalSnapshotV3 {
  readonly committing: boolean;
  readonly document: CanvasDocumentV3;
  readonly error: string | null;
  readonly snapshotRequired: boolean;
}

type JournalListener = () => void;

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : "Canvas commit failed.").slice(
    0,
    512,
  );
}

function immutableSnapshot(
  adapter: CanvasDocumentV3PersistenceAdapter,
  pending: number,
  error: string | null,
): CanonicalCanvasJournalSnapshotV3 {
  return Object.freeze({
    committing: pending > 0,
    document: adapter.document,
    error,
    snapshotRequired: adapter.snapshotRequired,
  });
}

/**
 * Serializes semantic intents onto the durable V3 operation journal.
 *
 * The document becomes observable only after the persistence port accepts the
 * operation and returns a matching revision/hash receipt. Pointer previews and
 * other transient interaction state deliberately live outside this authority.
 */
export class CanonicalCanvasJournalV3 {
  readonly #listeners = new Set<JournalListener>();
  #adapter: CanvasDocumentV3PersistenceAdapter;
  #pending = 0;
  #queue: Promise<void> = Promise.resolve();
  #snapshot: CanonicalCanvasJournalSnapshotV3;

  private constructor(adapter: CanvasDocumentV3PersistenceAdapter) {
    this.#adapter = adapter;
    this.#snapshot = immutableSnapshot(adapter, 0, null);
  }

  static async open(
    seed: CanvasDocumentV3,
    port: CanvasDocumentV3PersistencePort,
    policy: CanvasDocumentV3PersistencePolicy = {},
  ): Promise<CanonicalCanvasJournalV3> {
    return new CanonicalCanvasJournalV3(
      await CanvasDocumentV3PersistenceAdapter.open(seed, port, policy),
    );
  }

  getSnapshot = (): CanonicalCanvasJournalSnapshotV3 => this.#snapshot;

  subscribe = (listener: JournalListener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  commit(
    intent: CanonicalCanvasCommitIntentV3,
    beforeAppend?: (
      nextDocument: CanvasDocumentV3,
      operation: CanvasOperationV3,
    ) => void,
  ): Promise<CanvasOperationV3> {
    return this.commitPrepared(
      () => prepareCanvasOperationV3(this.#adapter.document, intent),
      beforeAppend,
    );
  }

  /**
   * Appends an operation that was prepared against the current durable
   * document. This is deliberately narrow: undo/redo use it for an inverse
   * operation, while ordinary callers continue to submit semantic intents.
   */
  commitPrepared(
    prepare: () => CanvasOperationV3,
    beforeAppend?: (
      nextDocument: CanvasDocumentV3,
      operation: CanvasOperationV3,
    ) => void,
  ): Promise<CanvasOperationV3> {
    this.#pending += 1;
    this.#publish(null);
    return this.#enqueue(async () => {
      try {
        const operation = prepare();
        if (beforeAppend !== undefined) {
          beforeAppend(
            applyCanvasOperationV3(this.#adapter.document, operation),
            operation,
          );
        }
        this.#adapter = await this.#adapter.commit(operation);
        this.#pending -= 1;
        this.#publish(null);
        return operation;
      } catch (error) {
        this.#pending -= 1;
        this.#publish(boundedError(error));
        throw error;
      }
    });
  }

  checkpoint(persistedAt: string): Promise<void> {
    this.#pending += 1;
    this.#publish(null);
    return this.#enqueue(async () => {
      try {
        this.#adapter = await this.#adapter.checkpoint(persistedAt);
        this.#pending -= 1;
        this.#publish(null);
      } catch (error) {
        this.#pending -= 1;
        this.#publish(boundedError(error));
        throw error;
      }
    });
  }

  #enqueue<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.#queue.then(work, work);
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #publish(error: string | null): void {
    this.#snapshot = immutableSnapshot(this.#adapter, this.#pending, error);
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
