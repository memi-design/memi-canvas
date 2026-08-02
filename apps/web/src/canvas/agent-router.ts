import { z } from "zod";

import {
  hashSelectionContextValue,
  selectionContextBytes,
  SelectionContextCapsuleV1Schema,
  verifySelectionContextCapsule,
  type SelectionContextCapsuleV1,
} from "./selection-context-capsule.js";

const HashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u, "Expected a canonical SHA-256 hash.");
const AdapterVersionSchema = z.string().trim().min(1).max(256);

export const DeterministicOperationSchema = z.enum([
  "text",
  "token",
  "spacing",
  "size",
  "radius",
  "visibility",
  "layout",
  "component-property",
  "navigation",
  "style",
]);

export const AgentRouteLevelSchema = z.enum([
  "local",
  "fast-model",
  "strong-model",
]);

export const AgentRouteOutcomeSchema = z.enum([
  "compiler-unsupported",
  "compiler-conflict",
  "ambiguous-result",
  "verification-failed",
  "provider-failed",
  "permission-denied",
  "stale-revision",
  "budget-exhausted",
]);

const IntentSchema = z
  .strictObject({
    kind: z.enum(["semantic-edit", "ambiguous-edit", "structural-edit"]),
    prompt: z.string().trim().min(1).max(16_384),
    deterministicOperation: DeterministicOperationSchema.optional(),
    requiresVision: z.boolean(),
  })
  .superRefine((intent, context) => {
    if (
      intent.kind === "semantic-edit" &&
      intent.deterministicOperation === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Semantic edits require a deterministic operation.",
        path: ["deterministicOperation"],
      });
    }
  });

const LocalCompilerSchema = z.strictObject({
  available: z.boolean(),
  adapterVersion: AdapterVersionSchema,
  supportedOperations: z.array(DeterministicOperationSchema).max(100),
  preflight: z.strictObject({
    status: z.enum(["eligible", "unsupported", "conflict"]),
    deterministicOperation: DeterministicOperationSchema,
    selectionSemanticHash: HashSchema,
    sourceRevision: z.string().trim().min(1).max(512),
    sourceAnchorCount: z.number().int().nonnegative().max(2_000),
  }),
});

const ModelRouteSchema = z.strictObject({
  available: z.boolean(),
  adapterVersion: AdapterVersionSchema,
  capabilities: z.strictObject({
    structural: z.boolean(),
    vision: z.boolean(),
  }),
  estimatedCostUsdMicros: z.number().int().nonnegative().max(1_000_000_000),
  maxInputTokens: z.number().int().positive().max(10_000_000),
});

export const AgentRouteRequestSchema = z.strictObject({
  capsule: SelectionContextCapsuleV1Schema,
  intent: IntentSchema,
  localCompiler: LocalCompilerSchema,
  models: z.strictObject({
    fast: ModelRouteSchema,
    strong: ModelRouteSchema,
  }),
  budget: z.strictObject({
    remainingInputTokens: z.number().int().nonnegative().max(10_000_000),
    remainingCostUsdMicros: z
      .number()
      .int()
      .nonnegative()
      .max(1_000_000_000),
    remainingEscalations: z.number().int().nonnegative().max(100),
  }),
  policy: z.strictObject({
    allowModelUse: z.boolean(),
    policyHash: HashSchema,
  }),
  previousAttempt: z
    .strictObject({
      level: AgentRouteLevelSchema,
      outcome: AgentRouteOutcomeSchema,
    })
    .optional(),
});

export type DeterministicOperation = z.infer<
  typeof DeterministicOperationSchema
>;
export type AgentRouteLevel = z.infer<typeof AgentRouteLevelSchema>;
export type AgentRouteOutcome = z.infer<typeof AgentRouteOutcomeSchema>;
export type AgentRouteRequest = z.infer<typeof AgentRouteRequestSchema>;

export type AgentRoutingErrorCode =
  | "INVALID_CONTEXT"
  | "INVALID_REQUEST"
  | "NO_ELIGIBLE_ROUTE"
  | "ESCALATION_NOT_ALLOWED"
  | "ESCALATION_BUDGET_EXHAUSTED";

export class AgentRoutingError extends Error {
  readonly code: AgentRoutingErrorCode;

  constructor(code: AgentRoutingErrorCode, message: string) {
    super(message);
    this.name = "AgentRoutingError";
    this.code = code;
  }
}

export interface RouteEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly estimatedInputTokens: number;
  readonly estimatedCostUsdMicros: number;
}

export interface AgentRouteEscalationRule {
  readonly from: AgentRouteLevel;
  readonly to: AgentRouteLevel;
  readonly outcomes: readonly AgentRouteOutcome[];
}

export const AGENT_ROUTE_ESCALATION_RULES: readonly AgentRouteEscalationRule[] =
  Object.freeze([
    Object.freeze({
      from: "local" as const,
      to: "fast-model" as const,
      outcomes: Object.freeze([
        "compiler-unsupported" as const,
        "compiler-conflict" as const,
      ]),
    }),
    Object.freeze({
      from: "fast-model" as const,
      to: "strong-model" as const,
      outcomes: Object.freeze([
        "ambiguous-result" as const,
        "verification-failed" as const,
        "provider-failed" as const,
      ]),
    }),
  ]);

export interface AgentRouteDecision {
  readonly level: AgentRouteLevel;
  readonly reason: string;
  readonly zeroToken: boolean;
  readonly eligibility: {
    readonly local: RouteEligibility;
    readonly fastModel: RouteEligibility;
    readonly strongModel: RouteEligibility;
  };
  readonly cacheKey: `sha256:${string}`;
  readonly cacheKeyInputs: {
    readonly intentFingerprint: `sha256:${string}`;
    readonly selectionSemanticHash: `sha256:${string}`;
    readonly sourceRevision: string;
    readonly adapterVersion: string;
    readonly policyHash: `sha256:${string}`;
  };
  readonly budget: {
    readonly before: {
      readonly inputTokens: number;
      readonly costUsdMicros: number;
      readonly escalations: number;
    };
    readonly estimate: {
      readonly inputTokens: number;
      readonly costUsdMicros: number;
    };
    readonly remainingAfter: {
      readonly inputTokens: number;
      readonly costUsdMicros: number;
      readonly escalations: number;
    };
  };
  readonly escalationRules: readonly AgentRouteEscalationRule[];
}

function frozenEligibility(
  reasons: readonly string[],
  estimatedInputTokens: number,
  estimatedCostUsdMicros: number,
): RouteEligibility {
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze([...reasons]),
    estimatedInputTokens,
    estimatedCostUsdMicros,
  });
}

function estimateInputTokens(
  capsule: SelectionContextCapsuleV1,
  prompt: string,
): number {
  const promptBytes = new TextEncoder().encode(prompt).byteLength;
  return Math.ceil((selectionContextBytes(capsule) + promptBytes) / 4);
}

function localEligibility(
  request: AgentRouteRequest,
): RouteEligibility {
  const reasons: string[] = [];
  const operation = request.intent.deterministicOperation;
  const preflight = request.localCompiler.preflight;
  if (!request.localCompiler.available) {
    reasons.push("Local compiler is unavailable.");
  }
  if (request.intent.kind !== "semantic-edit") {
    reasons.push("Only semantic edits are eligible for local compilation.");
  }
  if (
    operation === undefined ||
    !request.localCompiler.supportedOperations.includes(operation)
  ) {
    reasons.push("Local compiler does not support the requested operation.");
  }
  if (request.intent.requiresVision) {
    reasons.push("Vision-dependent intent is not deterministic.");
  }
  if (preflight.status !== "eligible") {
    reasons.push(
      `Local compiler preflight reported ${preflight.status}.`,
    );
  }
  if (preflight.deterministicOperation !== operation) {
    reasons.push(
      "Local preflight operation does not match the requested operation.",
    );
  }
  if (
    preflight.selectionSemanticHash !==
    request.capsule.selectionSemanticHash
  ) {
    reasons.push(
      "Local preflight selection hash does not match the selected context.",
    );
  }
  if (preflight.sourceRevision !== request.capsule.document.sourceRevision) {
    reasons.push(
      "Local preflight source revision does not match the selected context.",
    );
  }
  if (preflight.sourceAnchorCount !== request.capsule.sourceAnchors.length) {
    reasons.push(
      "Local preflight source-anchor count does not match the selected context.",
    );
  }
  const truthfulSourceAnchor = request.capsule.sourceAnchors.some(
    (anchor) =>
      anchor.repositoryRevision === request.capsule.document.sourceRevision &&
      anchor.contentHash !== undefined,
  );
  if (!truthfulSourceAnchor) {
    reasons.push("Selected context has no truthful source anchors.");
  }
  return frozenEligibility(reasons, 0, 0);
}

function modelEligibility(
  request: AgentRouteRequest,
  model: AgentRouteRequest["models"]["fast"],
  route: "fast" | "strong",
  estimatedInputTokens: number,
): RouteEligibility {
  const reasons: string[] = [];
  const name = route === "fast" ? "Fast model" : "Strong model";
  if (!model.available) {
    reasons.push(`${name} is unavailable.`);
  }
  if (!request.policy.allowModelUse) {
    reasons.push("Model use is prohibited by policy.");
  }
  if (route === "fast" && request.intent.kind === "structural-edit") {
    reasons.push("Structural intent requires the strong-model route.");
  }
  if (request.intent.kind === "structural-edit" && !model.capabilities.structural) {
    reasons.push(`${name} does not support structural edits.`);
  }
  if (request.intent.requiresVision && !model.capabilities.vision) {
    reasons.push(`${name} does not support vision context.`);
  }
  if (estimatedInputTokens > model.maxInputTokens) {
    reasons.push(`${name} context window is too small.`);
  }
  if (estimatedInputTokens > request.budget.remainingInputTokens) {
    reasons.push("Remaining input-token budget is insufficient.");
  }
  if (
    model.estimatedCostUsdMicros >
    request.budget.remainingCostUsdMicros
  ) {
    reasons.push("Remaining cost budget is insufficient.");
  }
  return frozenEligibility(
    reasons,
    estimatedInputTokens,
    model.estimatedCostUsdMicros,
  );
}

function escalationTarget(
  request: AgentRouteRequest,
): AgentRouteLevel | null {
  const previous = request.previousAttempt;
  if (previous === undefined) {
    return null;
  }
  const rule = AGENT_ROUTE_ESCALATION_RULES.find(
    ({ from, outcomes }) =>
      from === previous.level && outcomes.includes(previous.outcome),
  );
  if (rule === undefined) {
    throw new AgentRoutingError(
      "ESCALATION_NOT_ALLOWED",
      `Outcome "${previous.outcome}" is terminal for the ${previous.level} route.`,
    );
  }
  if (request.budget.remainingEscalations === 0) {
    throw new AgentRoutingError(
      "ESCALATION_BUDGET_EXHAUSTED",
      "No escalation budget remains.",
    );
  }
  return rule.to;
}

function selectLevel(
  request: AgentRouteRequest,
  eligibility: AgentRouteDecision["eligibility"],
): { readonly level: AgentRouteLevel; readonly reason: string } {
  const previous = request.previousAttempt;
  const target = escalationTarget(request);
  if (target === "fast-model") {
    if (eligibility.fastModel.eligible) {
      return {
        level: "fast-model",
        reason:
          previous?.outcome === "compiler-conflict"
            ? "Local compilation reported a conflict; escalating to the fast model."
            : "Local compilation does not support the edit; escalating to the fast model.",
      };
    }
    if (eligibility.strongModel.eligible) {
      return {
        level: "strong-model",
        reason:
          "Local compilation could not complete and the fast model is ineligible; escalating to the strong model.",
      };
    }
  }
  if (target === "strong-model" && eligibility.strongModel.eligible) {
    const reason =
      previous?.outcome === "verification-failed"
        ? "Fast-model verification failed; escalating to the strong model."
        : previous?.outcome === "ambiguous-result"
          ? "The fast-model result remained ambiguous; escalating to the strong model."
          : "The fast-model provider failed; escalating to the strong model.";
    return { level: "strong-model", reason };
  }
  if (target !== null) {
    throw new AgentRoutingError(
      "NO_ELIGIBLE_ROUTE",
      `The required ${target} escalation route is not eligible.`,
    );
  }
  if (eligibility.local.eligible) {
    return {
      level: "local",
      reason:
        "This supported semantic edit can use the local compiler, so no model is required.",
    };
  }
  if (
    request.intent.kind !== "structural-edit" &&
    eligibility.fastModel.eligible
  ) {
    return {
      level: "fast-model",
      reason: "The fast model is the cheapest eligible model route.",
    };
  }
  if (eligibility.strongModel.eligible) {
    return {
      level: "strong-model",
      reason:
        request.intent.kind === "structural-edit"
          ? "Structural intent requires a capable strong model."
          : "The strong model is the remaining eligible route.",
    };
  }
  throw new AgentRoutingError(
    "NO_ELIGIBLE_ROUTE",
    "No route satisfies capability, policy, context, and budget constraints.",
  );
}

function adapterVersion(
  request: AgentRouteRequest,
  level: AgentRouteLevel,
): string {
  if (level === "local") {
    return request.localCompiler.adapterVersion;
  }
  return level === "fast-model"
    ? request.models.fast.adapterVersion
    : request.models.strong.adapterVersion;
}

function selectedEligibility(
  decision: AgentRouteDecision["eligibility"],
  level: AgentRouteLevel,
): RouteEligibility {
  if (level === "local") {
    return decision.local;
  }
  return level === "fast-model" ? decision.fastModel : decision.strongModel;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export async function routeAgentRequest(
  untrustedRequest: AgentRouteRequest,
): Promise<AgentRouteDecision> {
  const parsed = AgentRouteRequestSchema.safeParse(untrustedRequest);
  if (!parsed.success) {
    throw new AgentRoutingError(
      "INVALID_REQUEST",
      `Agent route request is invalid: ${z.prettifyError(parsed.error)}`,
    );
  }
  const request = parsed.data;
  if (!(await verifySelectionContextCapsule(request.capsule))) {
    throw new AgentRoutingError(
      "INVALID_CONTEXT",
      "Selection context failed canonical hash or size verification.",
    );
  }
  const inputTokens = estimateInputTokens(
    request.capsule,
    request.intent.prompt,
  );
  const eligibility = Object.freeze({
    local: localEligibility(request),
    fastModel: modelEligibility(
      request,
      request.models.fast,
      "fast",
      inputTokens,
    ),
    strongModel: modelEligibility(
      request,
      request.models.strong,
      "strong",
      inputTokens,
    ),
  });
  const selected = selectLevel(request, eligibility);
  const selectedRoute = selectedEligibility(eligibility, selected.level);
  const selectedAdapterVersion = adapterVersion(request, selected.level);
  const intentFingerprint = await hashSelectionContextValue(request.intent);
  const cacheKeyInputs = {
    intentFingerprint,
    selectionSemanticHash: request.capsule
      .selectionSemanticHash as `sha256:${string}`,
    sourceRevision: request.capsule.document.sourceRevision,
    adapterVersion: selectedAdapterVersion,
    policyHash: request.policy.policyHash as `sha256:${string}`,
  };
  const cacheKey = await hashSelectionContextValue(cacheKeyInputs);
  const escalationSpend = request.previousAttempt === undefined ? 0 : 1;
  const decision: AgentRouteDecision = {
    level: selected.level,
    reason: selected.reason,
    zeroToken: selected.level === "local",
    eligibility,
    cacheKey,
    cacheKeyInputs,
    budget: {
      before: {
        inputTokens: request.budget.remainingInputTokens,
        costUsdMicros: request.budget.remainingCostUsdMicros,
        escalations: request.budget.remainingEscalations,
      },
      estimate: {
        inputTokens: selectedRoute.estimatedInputTokens,
        costUsdMicros: selectedRoute.estimatedCostUsdMicros,
      },
      remainingAfter: {
        inputTokens:
          request.budget.remainingInputTokens -
          selectedRoute.estimatedInputTokens,
        costUsdMicros:
          request.budget.remainingCostUsdMicros -
          selectedRoute.estimatedCostUsdMicros,
        escalations:
          request.budget.remainingEscalations - escalationSpend,
      },
    },
    escalationRules: AGENT_ROUTE_ESCALATION_RULES,
  };
  return deepFreeze(decision);
}
