import {
  MAX_RUNTIME_RPC_BYTES,
  RuntimeRpcRequestSchema,
  RuntimeRpcResponseSchema,
  runtimeRpcByteLength,
  type RuntimePrivateTransport,
  type RuntimeRpcErrorCode,
  type RuntimeRpcMethod,
  type RuntimeRpcRequest,
  type RuntimeRpcRequestFor,
  type RuntimeRpcSuccessFor,
} from "@memi/protocol";

const AUTH_TOKEN_MIN_BYTES = 32;
const AUTH_TOKEN_MAX_BYTES = 4_096;
const SAFE_AUTH_TOKEN = /^[A-Za-z0-9._~-]+$/u;

function hasUnsafeAuthCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codepoint = character.codePointAt(0);
    return codepoint !== undefined && (codepoint <= 0x1f || codepoint === 0x7f);
  });
}

export interface RuntimeCallOptions {
  readonly signal?: AbortSignal;
}

export interface RuntimeClientV1Options {
  readonly authToken: () => string | Promise<string>;
  readonly correlationId: () => RuntimeRpcRequest["correlationId"];
  readonly now: () => string;
  readonly requestId: () => RuntimeRpcRequest["requestId"];
  readonly transport: RuntimePrivateTransport;
  readonly maxPayloadBytes?: number;
}

type PayloadFor<Method extends RuntimeRpcMethod> =
  RuntimeRpcRequestFor<Method>["payload"];
type ResultFor<Method extends RuntimeRpcMethod> =
  RuntimeRpcSuccessFor<Method>["result"];
type RunMutationMethod =
  | "runs.cancel"
  | "runs.resume"
  | "runs.retry"
  | "runs.handoff"
  | "runs.checkpoint";
const RUN_MUTATION_METHODS: ReadonlySet<RuntimeRpcMethod> = new Set([
  "runs.cancel",
  "runs.resume",
  "runs.retry",
  "runs.handoff",
  "runs.checkpoint",
]);
type ImportMutationMethod =
  | "imports.cancel"
  | "imports.discard"
  | "imports.resume"
  | "imports.retryFailed"
  | "imports.commit";
const IMPORT_MUTATION_METHODS: ReadonlySet<RuntimeRpcMethod> = new Set([
  "imports.cancel",
  "imports.discard",
  "imports.resume",
  "imports.retryFailed",
  "imports.commit",
]);

export class RuntimeClientError extends Error {
  readonly code: RuntimeRpcErrorCode;
  readonly correlationId: string | null;
  readonly details: readonly Readonly<{
    key: string;
    value: string;
  }>[];
  readonly retryable: boolean;

  constructor(input: {
    readonly code: RuntimeRpcErrorCode;
    readonly correlationId?: string | null;
    readonly details?: readonly Readonly<{
      key: string;
      value: string;
    }>[];
    readonly message: string;
    readonly retryable: boolean;
  }) {
    super(input.message);
    this.name = "RuntimeClientError";
    this.code = input.code;
    this.correlationId = input.correlationId ?? null;
    this.details = Object.freeze([...(input.details ?? [])]);
    this.retryable = input.retryable;
  }
}

export interface RuntimeClientV1 {
  readonly canvasDocuments: {
    open(
      payload: PayloadFor<"canvasDocuments.open">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"canvasDocuments.open">>;
    load(
      payload: PayloadFor<"canvasDocuments.load">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"canvasDocuments.load">>;
    initialize(
      payload: PayloadFor<"canvasDocuments.initialize">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"canvasDocuments.initialize">>;
    append(
      payload: PayloadFor<"canvasDocuments.append">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"canvasDocuments.append">>;
    checkpoint(
      payload: PayloadFor<"canvasDocuments.checkpoint">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"canvasDocuments.checkpoint">>;
  };
  readonly imports: {
    plan(
      payload: PayloadFor<"imports.plan">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.plan">>;
    list(
      payload?: PayloadFor<"imports.list">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.list">>;
    start(
      payload: PayloadFor<"imports.start">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.start">>;
    get(
      payload: PayloadFor<"imports.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.get">>;
    cancel(
      payload: PayloadFor<"imports.cancel">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.cancel">>;
    discard(
      payload: PayloadFor<"imports.discard">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.discard">>;
    resume(
      payload: PayloadFor<"imports.resume">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.resume">>;
    retryFailed(
      payload: PayloadFor<"imports.retryFailed">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.retryFailed">>;
    commit(
      payload: PayloadFor<"imports.commit">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.commit">>;
    purgeAll(
      payload?: PayloadFor<"imports.purgeAll">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"imports.purgeAll">>;
  };
  readonly projects: {
    list(
      payload?: PayloadFor<"projects.list">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"projects.list">>;
    get(
      payload: PayloadFor<"projects.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"projects.get">>;
  };
  readonly sessions: {
    migrateLegacy(
      payload: PayloadFor<"sessions.migrateLegacy">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"sessions.migrateLegacy">>;
    restore(
      payload: PayloadFor<"sessions.restore">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"sessions.restore">>;
    save(
      payload: PayloadFor<"sessions.save">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"sessions.save">>;
  };
  readonly runs: {
    start(
      payload: PayloadFor<"runs.start">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.start">>;
    get(
      payload: PayloadFor<"runs.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.get">>;
    cancel(
      payload: PayloadFor<"runs.cancel">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.cancel">>;
    resume(
      payload: PayloadFor<"runs.resume">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.resume">>;
    retry(
      payload: PayloadFor<"runs.retry">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.retry">>;
    handoff(
      payload: PayloadFor<"runs.handoff">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.handoff">>;
    checkpoint(
      payload: PayloadFor<"runs.checkpoint">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.checkpoint">>;
    events(
      payload: PayloadFor<"runs.events">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"runs.events">>;
  };
  readonly reviews: {
    get(
      payload: PayloadFor<"reviews.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"reviews.get">>;
    resolve(
      payload: PayloadFor<"reviews.resolve">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"reviews.resolve">>;
  };
  readonly worktrees: {
    create(
      payload: PayloadFor<"worktrees.create">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"worktrees.create">>;
    get(
      payload: PayloadFor<"worktrees.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"worktrees.get">>;
  };
  readonly previews: {
    start(
      payload: PayloadFor<"previews.start">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"previews.start">>;
    get(
      payload: PayloadFor<"previews.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"previews.get">>;
  };
  readonly promotions: {
    request(
      payload: PayloadFor<"promotions.request">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"promotions.request">>;
    get(
      payload: PayloadFor<"promotions.get">,
      options?: RuntimeCallOptions,
    ): Promise<ResultFor<"promotions.get">>;
  };
}

function localFailure(
  code: RuntimeRpcErrorCode,
  message: string,
  correlationId: string | null,
  retryable = false,
): RuntimeClientError {
  return new RuntimeClientError({
    code,
    correlationId,
    message,
    retryable,
  });
}

function assertNotCancelled(
  signal: AbortSignal | undefined,
  correlationId: string | null,
): void {
  if (signal?.aborted === true) {
    throw localFailure(
      "CANCELLED",
      "The runtime request was cancelled.",
      correlationId,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function authorize(token: string, correlationId: string): string {
  const tokenBytes = new TextEncoder().encode(token).byteLength;
  if (
    tokenBytes < AUTH_TOKEN_MIN_BYTES ||
    tokenBytes > AUTH_TOKEN_MAX_BYTES ||
    !SAFE_AUTH_TOKEN.test(token) ||
    hasUnsafeAuthCharacter(token)
  ) {
    throw localFailure(
      "UNAUTHENTICATED",
      "A valid private runtime session is required.",
      correlationId,
    );
  }
  return `Bearer ${token}`;
}

export function createRuntimeClientV1(
  options: RuntimeClientV1Options,
): RuntimeClientV1 {
  const configuredPayloadBytes =
    options.maxPayloadBytes ?? MAX_RUNTIME_RPC_BYTES;
  if (
    !Number.isSafeInteger(configuredPayloadBytes) ||
    configuredPayloadBytes <= 0
  ) {
    throw localFailure(
      "INVALID_REQUEST",
      "The runtime payload limit must be a positive safe integer.",
      null,
    );
  }
  const maxPayloadBytes = Math.min(
    configuredPayloadBytes,
    MAX_RUNTIME_RPC_BYTES,
  );

  async function invoke<Method extends RuntimeRpcMethod>(
    method: Method,
    payload: PayloadFor<Method>,
    callOptions: RuntimeCallOptions = {},
  ): Promise<ResultFor<Method>> {
    assertNotCancelled(callOptions.signal, null);
    const correlationId = options.correlationId();
    const candidate = {
      schemaVersion: 1,
      requestId: options.requestId(),
      correlationId,
      method,
      sentAt: options.now(),
      payload,
    };
    const parsedRequest = RuntimeRpcRequestSchema.safeParse(candidate);
    if (!parsedRequest.success) {
      throw localFailure(
        runtimeRpcByteLength(candidate) > maxPayloadBytes
          ? "PAYLOAD_TOO_LARGE"
          : "INVALID_REQUEST",
        "The runtime request failed strict validation.",
        correlationId,
      );
    }
    if (runtimeRpcByteLength(parsedRequest.data) > maxPayloadBytes) {
      throw localFailure(
        "PAYLOAD_TOO_LARGE",
        "The runtime request exceeds the private transport limit.",
        correlationId,
      );
    }
    const envelope = deepFreeze(parsedRequest.data);

    let token: string;
    try {
      token = await options.authToken();
    } catch {
      throw localFailure(
        "UNAUTHENTICATED",
        "The private runtime session could not be loaded.",
        correlationId,
      );
    }
    const authorization = authorize(token, correlationId);
    assertNotCancelled(callOptions.signal, correlationId);

    let rawResponse: unknown;
    try {
      rawResponse = await options.transport.exchange({
        authorization,
        envelope,
        ...(callOptions.signal === undefined
          ? {}
          : { signal: callOptions.signal }),
      });
    } catch (error) {
      assertNotCancelled(callOptions.signal, correlationId);
      if (error instanceof RuntimeClientError) {
        throw error;
      }
      throw localFailure(
        "UNAVAILABLE",
        "The private runtime transport is unavailable.",
        correlationId,
        true,
      );
    }

    assertNotCancelled(callOptions.signal, correlationId);
    if (runtimeRpcByteLength(rawResponse) > maxPayloadBytes) {
      throw localFailure(
        "PAYLOAD_TOO_LARGE",
        "The runtime response exceeds the private transport limit.",
        correlationId,
      );
    }
    const parsedResponse = RuntimeRpcResponseSchema.safeParse(rawResponse);
    if (!parsedResponse.success) {
      throw localFailure(
        "PROTOCOL_VIOLATION",
        "The runtime returned an invalid response.",
        correlationId,
      );
    }
    const response = parsedResponse.data;
    if (
      response.requestId !== envelope.requestId ||
      response.correlationId !== envelope.correlationId ||
      response.method !== envelope.method
    ) {
      throw localFailure(
        "PROTOCOL_VIOLATION",
        "The runtime response does not match the request identity.",
        correlationId,
      );
    }
    if (!response.ok) {
      throw new RuntimeClientError({
        ...response.error,
        correlationId,
      });
    }
    if (RUN_MUTATION_METHODS.has(method)) {
      const runRequest =
        envelope as RuntimeRpcRequestFor<RunMutationMethod>;
      const runResult = response.result as {
        readonly run: {
          readonly id: string;
          readonly projectId: string;
          readonly revision: number;
          readonly base: {
            readonly documentRevision: number;
            readonly sourceRevision: string;
          };
        };
      };
      const expected = runRequest.payload.expected;
      if (
        runResult.run.id !== runRequest.payload.runId ||
        runResult.run.projectId !== runRequest.payload.projectId ||
        runResult.run.base.documentRevision !==
          expected.documentRevision ||
        runResult.run.base.sourceRevision !== expected.sourceRevision ||
        runResult.run.revision !== expected.runRevision + 1
      ) {
        throw localFailure(
          "PROTOCOL_VIOLATION",
          "The runtime lifecycle response violates its run or revision binding.",
          correlationId,
        );
      }
      if (method === "runs.checkpoint") {
        const checkpoint = (
          response.result as ResultFor<"runs.checkpoint">
        ).checkpoint;
        if (
          checkpoint.runId !== runRequest.payload.runId ||
          checkpoint.binding.documentRevision !==
            expected.documentRevision ||
          checkpoint.binding.sourceRevision !== expected.sourceRevision
        ) {
          throw localFailure(
            "PROTOCOL_VIOLATION",
            "The runtime checkpoint violates its run or revision binding.",
            correlationId,
          );
        }
      }
    }
    if (IMPORT_MUTATION_METHODS.has(method)) {
      const importRequest =
        envelope as RuntimeRpcRequestFor<ImportMutationMethod>;
      const importResult = response.result as {
        readonly job: {
          readonly id: string;
          readonly revision: number;
        };
      };
      if (
        importResult.job.id !== importRequest.payload.jobId ||
        importResult.job.revision !==
          importRequest.payload.expectedRevision + 1
      ) {
        throw localFailure(
          "PROTOCOL_VIOLATION",
          "The runtime import response violates its job or revision binding.",
          correlationId,
        );
      }
    }
    if (method === "imports.get") {
      const importRequest =
        envelope as RuntimeRpcRequestFor<"imports.get">;
      const importResult =
        response.result as ResultFor<"imports.get">;
      if (importResult.job.id !== importRequest.payload.jobId) {
        throw localFailure(
          "PROTOCOL_VIOLATION",
          "The runtime returned a different import job.",
          correlationId,
        );
      }
    }
    if (method === "imports.start") {
      const importRequest =
        envelope as RuntimeRpcRequestFor<"imports.start">;
      const importResult =
        response.result as ResultFor<"imports.start">;
      if (
        importResult.job.repository.rootPath !==
          importRequest.payload.repositoryPath ||
        importResult.job.projectName !==
          importRequest.payload.projectName
      ) {
        throw localFailure(
          "PROTOCOL_VIOLATION",
          "The runtime import does not match the requested repository.",
          correlationId,
        );
      }
    }
    if (method === "runs.events") {
      const eventRequest =
        envelope as RuntimeRpcRequestFor<"runs.events">;
      const eventResult =
        response.result as ResultFor<"runs.events">;
      const invalidEventPage =
        eventResult.runRevision !==
          eventRequest.payload.expected.runRevision ||
        eventResult.events.length > eventRequest.payload.limit ||
        eventResult.events.some(
          (event) =>
            event.runId !== eventRequest.payload.runId ||
            event.sequence <= eventRequest.payload.afterSequence,
        );
      if (invalidEventPage) {
        throw localFailure(
          "PROTOCOL_VIOLATION",
          "The runtime event page violates its run, revision, or cursor binding.",
          correlationId,
        );
      }
    }
    return deepFreeze(response.result) as ResultFor<Method>;
  }

  return Object.freeze({
    canvasDocuments: Object.freeze({
      open: (
        payload: PayloadFor<"canvasDocuments.open">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("canvasDocuments.open", payload, callOptions),
      load: (
        payload: PayloadFor<"canvasDocuments.load">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("canvasDocuments.load", payload, callOptions),
      initialize: (
        payload: PayloadFor<"canvasDocuments.initialize">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("canvasDocuments.initialize", payload, callOptions),
      append: (
        payload: PayloadFor<"canvasDocuments.append">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("canvasDocuments.append", payload, callOptions),
      checkpoint: (
        payload: PayloadFor<"canvasDocuments.checkpoint">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("canvasDocuments.checkpoint", payload, callOptions),
    }),
    imports: Object.freeze({
      plan: (
        payload: PayloadFor<"imports.plan">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.plan", payload, callOptions),
      list: (
        payload: PayloadFor<"imports.list"> = {},
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.list", payload, callOptions),
      start: (
        payload: PayloadFor<"imports.start">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.start", payload, callOptions),
      get: (
        payload: PayloadFor<"imports.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.get", payload, callOptions),
      cancel: (
        payload: PayloadFor<"imports.cancel">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.cancel", payload, callOptions),
      discard: (
        payload: PayloadFor<"imports.discard">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.discard", payload, callOptions),
      resume: (
        payload: PayloadFor<"imports.resume">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.resume", payload, callOptions),
      retryFailed: (
        payload: PayloadFor<"imports.retryFailed">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.retryFailed", payload, callOptions),
      commit: (
        payload: PayloadFor<"imports.commit">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.commit", payload, callOptions),
      purgeAll: (
        payload: PayloadFor<"imports.purgeAll"> = {},
        callOptions?: RuntimeCallOptions,
      ) => invoke("imports.purgeAll", payload, callOptions),
    }),
    projects: Object.freeze({
      list: (
        payload: PayloadFor<"projects.list"> = {},
        callOptions?: RuntimeCallOptions,
      ) => invoke("projects.list", payload, callOptions),
      get: (
        payload: PayloadFor<"projects.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("projects.get", payload, callOptions),
    }),
    sessions: Object.freeze({
      migrateLegacy: (
        payload: PayloadFor<"sessions.migrateLegacy">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("sessions.migrateLegacy", payload, callOptions),
      restore: (
        payload: PayloadFor<"sessions.restore">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("sessions.restore", payload, callOptions),
      save: (
        payload: PayloadFor<"sessions.save">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("sessions.save", payload, callOptions),
    }),
    runs: Object.freeze({
      start: (
        payload: PayloadFor<"runs.start">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.start", payload, callOptions),
      get: (
        payload: PayloadFor<"runs.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.get", payload, callOptions),
      cancel: (
        payload: PayloadFor<"runs.cancel">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.cancel", payload, callOptions),
      resume: (
        payload: PayloadFor<"runs.resume">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.resume", payload, callOptions),
      retry: (
        payload: PayloadFor<"runs.retry">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.retry", payload, callOptions),
      handoff: (
        payload: PayloadFor<"runs.handoff">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.handoff", payload, callOptions),
      checkpoint: (
        payload: PayloadFor<"runs.checkpoint">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.checkpoint", payload, callOptions),
      events: (
        payload: PayloadFor<"runs.events">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("runs.events", payload, callOptions),
    }),
    reviews: Object.freeze({
      get: (
        payload: PayloadFor<"reviews.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("reviews.get", payload, callOptions),
      resolve: (
        payload: PayloadFor<"reviews.resolve">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("reviews.resolve", payload, callOptions),
    }),
    worktrees: Object.freeze({
      create: (
        payload: PayloadFor<"worktrees.create">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("worktrees.create", payload, callOptions),
      get: (
        payload: PayloadFor<"worktrees.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("worktrees.get", payload, callOptions),
    }),
    previews: Object.freeze({
      start: (
        payload: PayloadFor<"previews.start">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("previews.start", payload, callOptions),
      get: (
        payload: PayloadFor<"previews.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("previews.get", payload, callOptions),
    }),
    promotions: Object.freeze({
      request: (
        payload: PayloadFor<"promotions.request">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("promotions.request", payload, callOptions),
      get: (
        payload: PayloadFor<"promotions.get">,
        callOptions?: RuntimeCallOptions,
      ) => invoke("promotions.get", payload, callOptions),
    }),
  });
}
