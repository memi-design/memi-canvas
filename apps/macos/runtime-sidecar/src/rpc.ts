import { timingSafeEqual } from "node:crypto";

import type {
  RuntimeRpcMethod,
  RuntimeRpcRequest,
  RuntimeRpcResponse,
} from "@memi/protocol";
import {
  RuntimeRpcRequestSchema,
  RuntimeRpcResponseSchema,
} from "@memi/protocol";

import {
  CanvasDocumentJournalRpcProtocolError,
  type CanvasDocumentJournalRpcService,
} from "./canvas-document-journal-service.js";

const FALLBACK_REQUEST_ID = "prq_00000000000000000000000000";
const FALLBACK_CORRELATION_ID = "cor_00000000000000000000000000";
const FALLBACK_METHOD = "imports.plan";

type ImportMethod = Extract<RuntimeRpcMethod, `imports.${string}`>;
type CanvasDocumentMethod = Extract<
  RuntimeRpcMethod,
  `canvasDocuments.${string}`
>;

export interface ImportRuntimeRpcService {
  plan(input: never): Promise<unknown>;
  list(): Promise<unknown>;
  start(input: never): Promise<unknown>;
  get(input: never): Promise<unknown>;
  cancel(input: never): Promise<unknown>;
  discard(input: never): Promise<unknown>;
  resume(input: never): Promise<unknown>;
  retryFailed(input: never): Promise<unknown>;
  commit(input: never): Promise<unknown>;
  purgeAll(input: never): Promise<unknown>;
}

export interface SidecarRpcHandlerOptions {
  readonly authToken: string;
  readonly imports: ImportRuntimeRpcService;
  readonly canvasDocuments?: CanvasDocumentJournalRpcService;
  readonly now?: () => string;
}

export interface SidecarRpcInput {
  readonly authorization: unknown;
  readonly envelope: unknown;
}

function bearerMatches(authorization: unknown, token: string): boolean {
  if (typeof authorization !== "string") return false;
  const supplied = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${token}`);
  return (
    supplied.byteLength === expected.byteLength &&
    timingSafeEqual(supplied, expected)
  );
}

function safeBinding(candidate: unknown): {
  readonly requestId: string;
  readonly correlationId: string;
  readonly method: RuntimeRpcMethod;
} {
  if (candidate === null || typeof candidate !== "object") {
    return {
      requestId: FALLBACK_REQUEST_ID,
      correlationId: FALLBACK_CORRELATION_ID,
      method: FALLBACK_METHOD,
    };
  }
  const value = candidate as Record<string, unknown>;
  return {
    requestId:
      typeof value.requestId === "string"
        ? value.requestId
        : FALLBACK_REQUEST_ID,
    correlationId:
      typeof value.correlationId === "string"
        ? value.correlationId
        : FALLBACK_CORRELATION_ID,
    method:
      typeof value.method === "string"
        ? (value.method as RuntimeRpcMethod)
        : FALLBACK_METHOD,
  };
}

function failure(
  candidate: unknown,
  receivedAt: string,
  code:
    | "UNAUTHENTICATED"
    | "INVALID_REQUEST"
    | "NOT_FOUND"
    | "CONFLICT"
    | "UNAVAILABLE"
    | "POLICY_DENIED"
    | "PROTOCOL_VIOLATION"
    | "INTERNAL",
  message: string,
  retryable = false,
  details: readonly Readonly<{
    readonly key: string;
    readonly value: string;
  }>[] = [],
): RuntimeRpcResponse {
  const binding = safeBinding(candidate);
  const response = {
    schemaVersion: 1,
    ...binding,
    receivedAt,
    ok: false,
    error: {
      code,
      message,
      retryable,
      details,
    },
  };
  const parsed = RuntimeRpcResponseSchema.safeParse(response);
  if (parsed.success) return parsed.data;
  return RuntimeRpcResponseSchema.parse({
    schemaVersion: 1,
    requestId: FALLBACK_REQUEST_ID,
    correlationId: FALLBACK_CORRELATION_ID,
    receivedAt,
    method: FALLBACK_METHOD,
    ok: false,
    error: {
      code,
      message,
      retryable,
      details,
    },
  });
}

function isImportMethod(method: RuntimeRpcMethod): method is ImportMethod {
  return method.startsWith("imports.");
}

function isCanvasDocumentMethod(
  method: RuntimeRpcMethod,
): method is CanvasDocumentMethod {
  return method.startsWith("canvasDocuments.");
}

async function dispatchImport(
  imports: ImportRuntimeRpcService,
  request: RuntimeRpcRequest & { readonly method: ImportMethod },
): Promise<unknown> {
  switch (request.method) {
    case "imports.plan":
      return imports.plan(request.payload as never);
    case "imports.list":
      return imports.list();
    case "imports.start":
      return imports.start(request.payload as never);
    case "imports.get":
      return imports.get(request.payload as never);
    case "imports.cancel":
      return imports.cancel(request.payload as never);
    case "imports.discard":
      return imports.discard(request.payload as never);
    case "imports.resume":
      return imports.resume(request.payload as never);
    case "imports.retryFailed":
      return imports.retryFailed(request.payload as never);
    case "imports.commit":
      return imports.commit(request.payload as never);
    case "imports.purgeAll":
      return imports.purgeAll(request.payload as never);
  }
}

async function dispatchCanvasDocument(
  canvasDocuments: CanvasDocumentJournalRpcService,
  request: RuntimeRpcRequest & { readonly method: CanvasDocumentMethod },
): Promise<unknown> {
  switch (request.method) {
    case "canvasDocuments.open":
      return canvasDocuments.open(request.payload);
    case "canvasDocuments.load":
      return canvasDocuments.load(request.payload);
    case "canvasDocuments.initialize":
      return canvasDocuments.initialize(request.payload);
    case "canvasDocuments.append":
      return canvasDocuments.append(request.payload);
    case "canvasDocuments.checkpoint":
      return canvasDocuments.checkpoint(request.payload);
  }
}

function planningError(error: unknown): Readonly<{
  code: string;
  message: string;
  remediation: string;
  stage: "validate" | "inventory" | "plan";
}> | null {
  if (
    !(error instanceof Error) ||
    error.name !== "ImportPlanningError" ||
    (error as unknown as { readonly stage?: unknown }).stage === undefined
  ) {
    return null;
  }
  const planning = error as unknown as {
    readonly publicCode?: unknown;
    readonly publicMessage?: unknown;
    readonly remediation?: unknown;
    readonly stage: unknown;
  };
  if (
    (planning.stage !== "validate" &&
      planning.stage !== "inventory" &&
      planning.stage !== "plan") ||
    typeof planning.publicCode !== "string" ||
    typeof planning.publicMessage !== "string" ||
    typeof planning.remediation !== "string"
  ) {
    return null;
  }
  return {
    code: planning.publicCode,
    message: planning.publicMessage,
    remediation: planning.remediation,
    stage: planning.stage,
  };
}

function publicError(error: unknown): {
  readonly code:
    | "CONFLICT"
    | "NOT_FOUND"
    | "UNAVAILABLE"
    | "POLICY_DENIED"
    | "PROTOCOL_VIOLATION"
    | "INTERNAL";
  readonly message: string;
  readonly retryable: boolean;
  readonly details: readonly Readonly<{ readonly key: string; readonly value: string }>[];
} {
  if (error instanceof CanvasDocumentJournalRpcProtocolError) {
    return {
      code: "PROTOCOL_VIOLATION",
      message: "The canvas journal returned an invalid durable response.",
      retryable: false,
      details: [],
    };
  }
  const planning = planningError(error);
  if (planning !== null) {
    return {
      code: "POLICY_DENIED",
      message: planning.message,
      retryable: true,
      details: [
        { key: "code", value: planning.code },
        { key: "stage", value: planning.stage },
        { key: "remediation", value: planning.remediation },
      ],
    };
  }
  const message = error instanceof Error ? error.message : "";
  if (
    /expired|consumed|bound|revision|conflict|in progress/iu.test(
      message,
    )
  ) {
    return {
      code: "CONFLICT",
      message: "The import request conflicts with current durable state.",
      retryable: false,
      details: [],
    };
  }
  if (/unknown|not found/iu.test(message)) {
    return {
      code: "NOT_FOUND",
      message: "The requested import resource was not found.",
      retryable: false,
      details: [],
    };
  }
  if (/unavailable|tool|adapter/iu.test(message)) {
    return {
      code: "UNAVAILABLE",
      message: "The import runtime is not currently available.",
      retryable: true,
      details: [],
    };
  }
  return {
    code: "INTERNAL",
    message: "The import runtime could not complete the request.",
    retryable: false,
    details: [],
  };
}

export function createSidecarRpcHandler(
  options: SidecarRpcHandlerOptions,
): (input: SidecarRpcInput) => Promise<RuntimeRpcResponse> {
  if (!/^[a-f0-9]{64}$/u.test(options.authToken)) {
    throw new Error("Runtime authentication token must be 32-byte hex.");
  }
  const now = options.now ?? (() => new Date().toISOString());
  return async (input) => {
    const receivedAt = now();
    if (!bearerMatches(input.authorization, options.authToken)) {
      return failure(
        input.envelope,
        receivedAt,
        "UNAUTHENTICATED",
        "Runtime authentication failed.",
      );
    }
    if (
      Object.keys(input as object).sort().join(",") !==
      "authorization,envelope"
    ) {
      return failure(
        input.envelope,
        receivedAt,
        "INVALID_REQUEST",
        "Runtime transport envelope is invalid.",
      );
    }
    const parsed = RuntimeRpcRequestSchema.safeParse(input.envelope);
    if (!parsed.success) {
      return failure(
        input.envelope,
        receivedAt,
        "INVALID_REQUEST",
        "Runtime request envelope is invalid.",
      );
    }
    const request = parsed.data;
    if (
      !isImportMethod(request.method) &&
      !isCanvasDocumentMethod(request.method)
    ) {
      return failure(
        request,
        receivedAt,
        "UNAVAILABLE",
        "This packaged runtime does not expose this operation.",
      );
    }
    try {
      let result: unknown;
      if (isImportMethod(request.method)) {
        result = await dispatchImport(
          options.imports,
          request as RuntimeRpcRequest & { readonly method: ImportMethod },
        );
      } else {
        if (options.canvasDocuments === undefined) {
          return failure(
            request,
            receivedAt,
            "UNAVAILABLE",
            "The canvas journal runtime is not currently available.",
            true,
          );
        }
        result = await dispatchCanvasDocument(
          options.canvasDocuments,
          request as RuntimeRpcRequest & {
            readonly method: CanvasDocumentMethod;
          },
        );
      }
      return RuntimeRpcResponseSchema.parse({
        schemaVersion: 1,
        requestId: request.requestId,
        correlationId: request.correlationId,
        receivedAt,
        method: request.method,
        ok: true,
        result,
      });
    } catch (error) {
      const publicFailure = publicError(error);
      return failure(
        request,
        receivedAt,
        publicFailure.code,
        publicFailure.message,
        publicFailure.retryable,
        publicFailure.details,
      );
    }
  };
}
