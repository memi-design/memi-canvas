import { z } from "zod";

import type { WhiteboardState } from "./whiteboard-model.js";

export const WHITEBOARD_DOCUMENT_MAX_BYTES = 524_288;
export const WHITEBOARD_DOCUMENT_MAX_ITEMS = 1_000;

const STORAGE_PREFIX = "memi.whiteboard.document.v1:";
const safeId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9-]*$/u);
const documentRef = z
  .string()
  .min(1)
  .max(139)
  .regex(/^whiteboard:[a-z0-9][a-z0-9-]*$/u);
const coordinate = z.number().finite().min(-100_000).max(100_000);
const dimension = z.number().finite().positive().max(100_000);
const boundedText = z.string().max(65_536);

const PointSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
});

const SizeSchema = z.strictObject({
  width: dimension,
  height: dimension,
});

const StickySchema = z.strictObject({
  id: safeId,
  kind: z.literal("sticky"),
  position: PointSchema,
  size: SizeSchema,
  text: boundedText,
  color: z.enum(["yellow", "pink", "blue", "green"]),
});

const TextSchema = z.strictObject({
  id: safeId,
  kind: z.literal("text"),
  position: PointSchema,
  size: SizeSchema,
  text: boundedText,
});

const SectionSchema = z.strictObject({
  id: safeId,
  kind: z.literal("section"),
  position: PointSchema,
  size: SizeSchema,
  title: boundedText,
});

const ConnectorSchema = z.strictObject({
  id: safeId,
  kind: z.literal("connector"),
  fromItemId: safeId,
  toItemId: safeId,
});

const ItemSchema = z.discriminatedUnion("kind", [
  StickySchema,
  TextSchema,
  SectionSchema,
  ConnectorSchema,
]);

const WhiteboardStateSchema = z
  .strictObject({
    id: safeId,
    title: z.string().trim().min(1).max(256),
    revision: z.number().int().nonnegative().max(1_000_000_000),
    items: z
      .array(ItemSchema)
      .max(WHITEBOARD_DOCUMENT_MAX_ITEMS),
    selectedItemIds: z.array(safeId).max(WHITEBOARD_DOCUMENT_MAX_ITEMS),
  })
  .superRefine((state, context) => {
    const ids = state.items.map(({ id }) => id);
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "Whiteboard item identities must be unique.",
        path: ["items"],
      });
    }

    if (
      new Set(state.selectedItemIds).size !==
        state.selectedItemIds.length ||
      state.selectedItemIds.some((id) => !idSet.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Whiteboard selection must reference unique items.",
        path: ["selectedItemIds"],
      });
    }

    const itemsById = new Map(
      state.items.map((item) => [item.id, item]),
    );
    state.items.forEach((item, index) => {
      if (item.kind !== "connector") {
        return;
      }
      const from = itemsById.get(item.fromItemId);
      const to = itemsById.get(item.toItemId);
      if (
        item.fromItemId === item.toItemId ||
        from === undefined ||
        from.kind === "connector" ||
        to === undefined ||
        to.kind === "connector"
      ) {
        context.addIssue({
          code: "custom",
          message: "Whiteboard connectors require two authoring items.",
          path: ["items", index],
        });
      }
    });
  });

const WhiteboardDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    kind: z.literal("memi-whiteboard-document"),
    documentRef,
    document: WhiteboardStateSchema,
  })
  .superRefine((payload, context) => {
    if (payload.documentRef !== `whiteboard:${payload.document.id}`) {
      context.addIssue({
        code: "custom",
        message: "Whiteboard identity must match its document reference.",
        path: ["document", "id"],
      });
    }
  });

export interface WhiteboardStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface WhiteboardPersistence {
  read(documentRefValue: string): WhiteboardReadResult;
  load(documentRefValue: string): WhiteboardState | null;
  save(documentRefValue: string, state: WhiteboardState): boolean;
}

export type WhiteboardReadResult =
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | {
      readonly status: "ready";
      readonly document: WhiteboardState;
    };

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validDocumentRef(value: string): boolean {
  return documentRef.safeParse(value).success;
}

export function whiteboardDocumentKey(documentRefValue: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(documentRefValue)}`;
}

export function createWhiteboardPersistence(
  storage: WhiteboardStorage,
): WhiteboardPersistence {
  const read = (documentRefValue: string): WhiteboardReadResult => {
    if (!validDocumentRef(documentRefValue)) {
      return { status: "invalid" };
    }
    try {
      const serialized = storage.getItem(
        whiteboardDocumentKey(documentRefValue),
      );
      if (serialized === null) {
        return { status: "missing" };
      }
      if (
        serialized.length > WHITEBOARD_DOCUMENT_MAX_BYTES ||
        byteLength(serialized) > WHITEBOARD_DOCUMENT_MAX_BYTES
      ) {
        return { status: "invalid" };
      }
      const parsed = WhiteboardDocumentSchema.safeParse(
        JSON.parse(serialized),
      );
      if (
        !parsed.success ||
        parsed.data.documentRef !== documentRefValue
      ) {
        return { status: "invalid" };
      }
      return { status: "ready", document: parsed.data.document };
    } catch {
      return { status: "invalid" };
    }
  };

  return {
    read,
    load(documentRefValue) {
      const result = read(documentRefValue);
      return result.status === "ready" ? result.document : null;
    },
    save(documentRefValue, state) {
      if (!validDocumentRef(documentRefValue)) {
        return false;
      }
      try {
        const parsed = WhiteboardDocumentSchema.safeParse({
          schemaVersion: 1,
          kind: "memi-whiteboard-document",
          documentRef: documentRefValue,
          document: state,
        });
        if (!parsed.success) {
          return false;
        }
        const serialized = JSON.stringify(parsed.data);
        if (byteLength(serialized) > WHITEBOARD_DOCUMENT_MAX_BYTES) {
          return false;
        }
        storage.setItem(
          whiteboardDocumentKey(documentRefValue),
          serialized,
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
