import {
  CanvasDocumentAppendReceiptV3Schema,
  CanvasDocumentAppendV3Schema,
  CanvasDocumentIdentityV3Schema,
  CanvasDocumentJournalV3Schema,
  CanvasDocumentSnapshotV3Schema,
  type CanvasDocumentAppendV3,
  type CanvasDocumentIdentityV3,
  type CanvasDocumentJournalV3,
  type CanvasDocumentSnapshotV3,
  type CanvasDocumentV3PersistencePort,
} from "@memi/protocol";

export class CanvasDocumentJournalRpcProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasDocumentJournalRpcProtocolError";
  }
}

export interface CanvasDocumentJournalRpcService {
  open(input: {
    readonly snapshot: CanvasDocumentSnapshotV3;
  }): Promise<{
    readonly initialized: boolean;
    readonly journal: CanvasDocumentJournalV3;
  }>;
  load(input: {
    readonly identity: CanvasDocumentIdentityV3;
  }): Promise<{ readonly journal: CanvasDocumentJournalV3 | null }>;
  initialize(input: {
    readonly snapshot: CanvasDocumentSnapshotV3;
  }): Promise<{ readonly journal: CanvasDocumentJournalV3 }>;
  append(input: {
    readonly append: CanvasDocumentAppendV3;
  }): Promise<{
    readonly receipt: ReturnType<typeof CanvasDocumentAppendReceiptV3Schema.parse>;
  }>;
  checkpoint(input: {
    readonly snapshot: CanvasDocumentSnapshotV3;
  }): Promise<{ readonly journal: CanvasDocumentJournalV3 }>;
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

function journalFor(
  identity: CanvasDocumentIdentityV3,
  candidate: CanvasDocumentJournalV3 | null,
): CanvasDocumentJournalV3 {
  if (candidate === null) {
    throw new CanvasDocumentJournalRpcProtocolError(
      "CanvasDocumentV3 journal was not persisted.",
    );
  }
  const journal = CanvasDocumentJournalV3Schema.parse(candidate);
  if (!sameIdentity(journal.identity, identity)) {
    throw new CanvasDocumentJournalRpcProtocolError(
      "CanvasDocumentV3 journal violates the requested identity.",
    );
  }
  return journal;
}

function assertReceipt(
  append: CanvasDocumentAppendV3,
  candidate: unknown,
): ReturnType<typeof CanvasDocumentAppendReceiptV3Schema.parse> {
  const receipt = CanvasDocumentAppendReceiptV3Schema.parse(candidate);
  if (
    !sameIdentity(receipt.identity, append.identity) ||
    receipt.operationId !== append.operation.id ||
    receipt.revision !== append.operation.expectedRevision + 1 ||
    receipt.stateHash !== append.operation.resultingHash
  ) {
    throw new CanvasDocumentJournalRpcProtocolError(
      "CanvasDocumentV3 append receipt violates its operation or identity fence.",
    );
  }
  return receipt;
}

export function createCanvasDocumentJournalRpcService(options: {
  readonly port: CanvasDocumentV3PersistencePort;
}): CanvasDocumentJournalRpcService {
  const load = async (identityInput: CanvasDocumentIdentityV3) => {
    const identity = CanvasDocumentIdentityV3Schema.parse(identityInput);
    const journal = await options.port.load(identity);
    return journal === null
      ? null
      : journalFor(identity, journal);
  };

  return Object.freeze({
    async open(input: { readonly snapshot: CanvasDocumentSnapshotV3 }) {
      const snapshot = CanvasDocumentSnapshotV3Schema.parse(input.snapshot);
      const existing = await load(snapshot.identity);
      if (existing !== null) {
        return Object.freeze({ initialized: false, journal: existing });
      }
      await options.port.initialize(snapshot);
      return Object.freeze({
        initialized: true,
        journal: journalFor(snapshot.identity, await load(snapshot.identity)),
      });
    },
    async load(input: { readonly identity: CanvasDocumentIdentityV3 }) {
      return Object.freeze({
        journal: await load(input.identity),
      });
    },
    async initialize(input: { readonly snapshot: CanvasDocumentSnapshotV3 }) {
      const snapshot = CanvasDocumentSnapshotV3Schema.parse(input.snapshot);
      await options.port.initialize(snapshot);
      return Object.freeze({
        journal: journalFor(snapshot.identity, await load(snapshot.identity)),
      });
    },
    async append(input: { readonly append: CanvasDocumentAppendV3 }) {
      const append = CanvasDocumentAppendV3Schema.parse(input.append);
      const receipt = await options.port.append(append);
      return Object.freeze({ receipt: assertReceipt(append, receipt) });
    },
    async checkpoint(input: { readonly snapshot: CanvasDocumentSnapshotV3 }) {
      const snapshot = CanvasDocumentSnapshotV3Schema.parse(input.snapshot);
      await options.port.checkpoint(snapshot);
      const journal = journalFor(snapshot.identity, await load(snapshot.identity));
      if (
        journal.operations.length !== 0 ||
        journal.operationBytes !== 0 ||
        journal.snapshot.document.revision !== snapshot.document.revision ||
        journal.snapshot.document.stateHash !== snapshot.document.stateHash
      ) {
        throw new CanvasDocumentJournalRpcProtocolError(
          "CanvasDocumentV3 checkpoint did not compact the verified journal state.",
        );
      }
      return Object.freeze({ journal });
    },
  });
}
