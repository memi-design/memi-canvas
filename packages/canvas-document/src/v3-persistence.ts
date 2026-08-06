import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasDocumentAppendV3Schema,
  CanvasDocumentIdentityV3Schema,
  CanvasDocumentJournalV3Schema,
  CanvasDocumentSnapshotV3Schema,
  CanvasDocumentV3Schema,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentSnapshotV3,
  type CanvasDocumentV3,
  type CanvasDocumentV3PersistencePort,
  type CanvasOperationV3,
} from "@memi/protocol";

import {
  applyCanvasOperationV3,
  hashCanvasDocumentV3,
} from "./v3-engine.js";
import { immutableCanvasV3 } from "./v3-support.js";

const DEFAULT_MAX_OPERATIONS = 250;
const DEFAULT_MAX_OPERATION_BYTES = 2_000_000;

export interface CanvasDocumentV3PersistencePolicy {
  readonly maxOperations?: number;
  readonly maxOperationBytes?: number;
}

interface ResolvedPersistencePolicy {
  readonly maxOperations: number;
  readonly maxOperationBytes: number;
}

function resolvePolicy(
  policy: CanvasDocumentV3PersistencePolicy,
): ResolvedPersistencePolicy {
  const resolved = {
    maxOperations: policy.maxOperations ?? DEFAULT_MAX_OPERATIONS,
    maxOperationBytes:
      policy.maxOperationBytes ?? DEFAULT_MAX_OPERATION_BYTES,
  };
  if (
    !Number.isInteger(resolved.maxOperations) ||
    resolved.maxOperations <= 0 ||
    !Number.isInteger(resolved.maxOperationBytes) ||
    resolved.maxOperationBytes <= 0
  ) {
    throw new Error("Canvas V3 persistence thresholds must be positive integers.");
  }
  return Object.freeze(resolved);
}

function identityFor(
  document: CanvasDocumentV3,
): CanvasDocumentIdentityV3 {
  return immutableCanvasV3(
    CanvasDocumentIdentityV3Schema.parse({
      schemaVersion: 1,
      projectId: document.projectId,
      documentId: document.id,
    }),
  );
}

function operationBytes(operation: CanvasOperationV3): number {
  return new TextEncoder().encode(JSON.stringify(operation)).byteLength;
}

function snapshotFor(
  identity: CanvasDocumentIdentityV3,
  document: CanvasDocumentV3,
  persistedAt: string,
): CanvasDocumentSnapshotV3 {
  return immutableCanvasV3(
    CanvasDocumentSnapshotV3Schema.parse({
      schemaVersion: 1,
      kind: "canvas-document-v3-snapshot",
      identity,
      document,
      persistedAt,
    }),
  );
}

function validateDocument(document: CanvasDocumentV3): CanvasDocumentV3 {
  const parsed = CanvasDocumentV3Schema.parse(document);
  if (hashCanvasDocumentV3(parsed) !== parsed.stateHash) {
    throw new Error("Persisted CanvasDocumentV3 state hash is corrupt.");
  }
  return immutableCanvasV3(parsed);
}

function sameIdentity(
  left: CanvasDocumentIdentityV3,
  right: CanvasDocumentIdentityV3,
): boolean {
  return (
    left.projectId === right.projectId &&
    left.documentId === right.documentId
  );
}

export class CanvasDocumentV3PersistenceAdapter {
  readonly #identity: CanvasDocumentIdentityV3;
  readonly #operationBytes: number;
  readonly #operationCount: number;
  readonly #operations: readonly CanvasOperationV3[];
  readonly #policy: ResolvedPersistencePolicy;
  readonly #port: CanvasDocumentV3PersistencePort;
  readonly document: CanvasDocumentV3;

  private constructor(input: {
    readonly identity: CanvasDocumentIdentityV3;
    readonly document: CanvasDocumentV3;
    readonly operationBytes: number;
    readonly operationCount: number;
    readonly operations: readonly CanvasOperationV3[];
    readonly policy: ResolvedPersistencePolicy;
    readonly port: CanvasDocumentV3PersistencePort;
  }) {
    this.#identity = input.identity;
    this.document = input.document;
    this.#operationBytes = input.operationBytes;
    this.#operationCount = input.operationCount;
    this.#operations = Object.freeze([...input.operations]);
    this.#policy = input.policy;
    this.#port = input.port;
    Object.freeze(this);
  }

  static async open(
    untrustedSeed: CanvasDocumentV3,
    port: CanvasDocumentV3PersistencePort,
    policy: CanvasDocumentV3PersistencePolicy = {},
  ): Promise<CanvasDocumentV3PersistenceAdapter> {
    const seed = validateDocument(untrustedSeed);
    const identity = identityFor(seed);
    const persisted = await port.load(identity);
    if (persisted === null) {
      await port.initialize(
        snapshotFor(identity, seed, new Date().toISOString()),
      );
      return new CanvasDocumentV3PersistenceAdapter({
        identity,
        document: seed,
        operationBytes: 0,
        operationCount: 0,
        operations: [],
        policy: resolvePolicy(policy),
        port,
      });
    }

    const journal = CanvasDocumentJournalV3Schema.parse(persisted);
    if (!sameIdentity(journal.identity, identity)) {
      throw new Error("Persisted CanvasDocumentV3 identity does not match the seed.");
    }
    let document = validateDocument(journal.snapshot.document);
    for (const operation of journal.operations) {
      document = applyCanvasOperationV3(document, operation);
    }
    const actualBytes = journal.operations.reduce(
      (total, operation) => total + operationBytes(operation),
      0,
    );
    if (actualBytes !== journal.operationBytes) {
      throw new Error("Persisted CanvasDocumentV3 operation byte count is corrupt.");
    }
    return new CanvasDocumentV3PersistenceAdapter({
      identity,
      document,
      operationBytes: actualBytes,
      operationCount: journal.operations.length,
      operations: journal.operations,
      policy: resolvePolicy(policy),
      port,
    });
  }

  get identity(): CanvasDocumentIdentityV3 {
    return this.#identity;
  }

  /**
   * The durable, post-checkpoint operation tail. Consumers may rebuild
   * in-memory affordances such as undo/redo from this immutable journal
   * material; document mutation remains exclusively operation-driven.
   */
  get operations(): readonly CanvasOperationV3[] {
    return this.#operations;
  }

  get snapshotRequired(): boolean {
    return (
      this.#operationCount >= this.#policy.maxOperations ||
      this.#operationBytes >= this.#policy.maxOperationBytes
    );
  }

  async commit(
    untrustedOperation: CanvasOperationV3,
  ): Promise<CanvasDocumentV3PersistenceAdapter> {
    const next = applyCanvasOperationV3(this.document, untrustedOperation);
    const request = immutableCanvasV3(
      CanvasDocumentAppendV3Schema.parse({
        schemaVersion: 1,
        kind: "canvas-document-v3-append",
        identity: this.#identity,
        operation: untrustedOperation,
      }),
    );
    const receipt = CanvasDocumentAppendReceiptV3Schema.parse(
      await this.#port.append(request),
    );
    if (
      !sameIdentity(receipt.identity, this.#identity) ||
      receipt.operationId !== request.operation.id ||
      receipt.revision !== next.revision ||
      receipt.stateHash !== next.stateHash
    ) {
      throw new Error("CanvasDocumentV3 append receipt does not match the operation.");
    }
    return new CanvasDocumentV3PersistenceAdapter({
      identity: this.#identity,
      document: next,
      operationBytes: this.#operationBytes + operationBytes(request.operation),
      operationCount: this.#operationCount + 1,
      operations: [...this.#operations, request.operation],
      policy: this.#policy,
      port: this.#port,
    });
  }

  async checkpoint(
    persistedAt: string,
  ): Promise<CanvasDocumentV3PersistenceAdapter> {
    await this.#port.checkpoint(
      snapshotFor(this.#identity, this.document, persistedAt),
    );
    return new CanvasDocumentV3PersistenceAdapter({
      identity: this.#identity,
      document: this.document,
      operationBytes: 0,
      operationCount: 0,
      operations: [],
      policy: this.#policy,
      port: this.#port,
    });
  }
}
