import type { TargetReceipt } from "@memi/protocol";

export interface CanvasTargetFaults {
  readonly afterSchemaCreate?: () => void;
  readonly beforeWriteTransaction?: () => void;
  readonly beforeTransaction?: () => void | Promise<void>;
  readonly afterLookupDocumentRead?: () => void | Promise<void>;
  readonly afterCommit?: (
    receipt: TargetReceipt,
  ) => void | Promise<void>;
}

export interface CanvasTargetAuthorityOptions {
  readonly databasePath: string;
  readonly clock: () => string;
  readonly faults?: CanvasTargetFaults;
}
