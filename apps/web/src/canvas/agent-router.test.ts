import {
  AgentRoutingError,
  routeAgentRequest,
  type AgentRouteRequest,
} from "./agent-router.js";
import {
  createSelectionContextCapsuleFromLegacyDocument,
  type SelectionContextCapsuleV1,
} from "./selection-context-capsule.js";
import {
  createSelectionState,
  type DesignDocument,
  type DocumentNode,
  type ViewportState,
} from "./model.js";

const POLICY_HASH = `sha256:${"c".repeat(64)}`;

async function capsule(
  viewportOverride: Partial<ViewportState> = {},
): Promise<SelectionContextCapsuleV1> {
  const selected: DocumentNode = {
    id: "button-primary",
    kind: "Instance",
    name: "Primary button",
    parentId: null,
    childIds: [],
    position: { x: 0, y: 0 },
    size: { width: 120, height: 48 },
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    styles: { fill: "#13d790" },
    constraints: { horizontal: "left", vertical: "top" },
    sourceBinding: {
      repositoryRevision: "buzzr-revision-9",
      sourceContentHash: `sha256:${"a".repeat(64)}`,
      routeId: "dashboard",
      stateId: "default",
      coverageCellId: "dashboard-mobile-default",
      sourceAnchor: "components/ui/Button.tsx#Button",
      viewport: { name: "mobile", width: 393, height: 852 },
    },
  };
  const designDocument: DesignDocument = {
    id: "buzzr",
    revision: 9,
    nodes: [selected],
    rootIds: [selected.id],
  };
  const viewport: ViewportState = {
    translation: { x: 0, y: 0 },
    zoom: 1,
    viewportSize: { width: 1440, height: 900 },
    pointerMode: "select",
  };
  return createSelectionContextCapsuleFromLegacyDocument({
    document: designDocument,
    selection: createSelectionState([selected.id]),
    sourceRevision: "buzzr-revision-9",
    viewport: { ...viewport, ...viewportOverride },
  });
}

async function request(
  overrides: Partial<AgentRouteRequest> = {},
): Promise<AgentRouteRequest> {
  const selectionCapsule = await capsule();
  return {
    capsule: selectionCapsule,
    intent: {
      kind: "semantic-edit",
      prompt: "Change the button radius to 12.",
      deterministicOperation: "style",
      requiresVision: false,
    },
    localCompiler: {
      available: true,
      adapterVersion: "source-compiler-1",
      supportedOperations: [
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
      ],
      preflight: {
        status: "eligible",
        deterministicOperation: "style",
        selectionSemanticHash: selectionCapsule.selectionSemanticHash,
        sourceRevision: selectionCapsule.document.sourceRevision,
        sourceAnchorCount: selectionCapsule.sourceAnchors.length,
      },
    },
    models: {
      fast: {
        available: true,
        adapterVersion: "codex-fast-1",
        capabilities: { structural: false, vision: false },
        estimatedCostUsdMicros: 2_000,
        maxInputTokens: 16_000,
      },
      strong: {
        available: true,
        adapterVersion: "codex-strong-1",
        capabilities: { structural: true, vision: true },
        estimatedCostUsdMicros: 20_000,
        maxInputTokens: 64_000,
      },
    },
    budget: {
      remainingInputTokens: 64_000,
      remainingCostUsdMicros: 100_000,
      remainingEscalations: 2,
    },
    policy: {
      allowModelUse: true,
      policyHash: POLICY_HASH,
    },
    ...overrides,
  };
}

describe("cheapest-path agent routing", () => {
  it("routes a supported semantic edit to the zero-token local compiler", async () => {
    const decision = await routeAgentRequest(await request());

    expect(decision.level).toBe("local");
    expect(decision.zeroToken).toBe(true);
    expect(decision.reason).toMatch(/supported semantic edit/i);
    expect(decision.eligibility.local.eligible).toBe(true);
    expect(decision.budget.estimate).toEqual({
      inputTokens: 0,
      costUsdMicros: 0,
    });
    expect(decision.budget.remainingAfter).toEqual({
      inputTokens: 64_000,
      costUsdMicros: 100_000,
      escalations: 2,
    });
    expect(decision.cacheKey).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(decision.escalationRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "local",
          to: "fast-model",
          outcomes: expect.arrayContaining(["compiler-conflict"]),
        }),
      ]),
    );
  });

  it("does not route locally without truthful source anchors even when the compiler claims eligibility", async () => {
    const base = await request();
    const sourceFreeCapsule = await createSelectionContextCapsuleFromLegacyDocument({
      document: {
        id: "source-free",
        revision: 1,
        nodes: [
          {
            id: "draft",
            kind: "Rectangle",
            name: "Draft",
            parentId: null,
            childIds: [],
            position: { x: 0, y: 0 },
            size: { width: 100, height: 100 },
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            styles: {},
            constraints: { horizontal: "left", vertical: "top" },
          },
        ],
        rootIds: ["draft"],
      },
      selection: createSelectionState(["draft"]),
      sourceRevision: "revision-1",
      viewport: {
        translation: { x: 0, y: 0 },
        zoom: 1,
        viewportSize: { width: 1440, height: 900 },
        pointerMode: "select",
      },
    });
    const decision = await routeAgentRequest({
      ...base,
      capsule: sourceFreeCapsule,
      localCompiler: {
        ...base.localCompiler,
        preflight: {
          status: "eligible",
          deterministicOperation: "style",
          selectionSemanticHash: sourceFreeCapsule.selectionSemanticHash,
          sourceRevision: sourceFreeCapsule.document.sourceRevision,
          sourceAnchorCount: 0,
        },
      },
    });

    expect(decision.level).toBe("fast-model");
    expect(decision.eligibility.local.reasons).toContain(
      "Selected context has no truthful source anchors.",
    );
  });

  it("rejects a stale deterministic compiler preflight from local eligibility", async () => {
    const base = await request();
    const decision = await routeAgentRequest({
      ...base,
      localCompiler: {
        ...base.localCompiler,
        preflight: {
          ...base.localCompiler.preflight,
          sourceRevision: "stale-source-revision",
        },
      },
    });

    expect(decision.level).toBe("fast-model");
    expect(decision.eligibility.local.reasons).toContain(
      "Local preflight source revision does not match the selected context.",
    );
  });

  it("routes an ambiguous edit to the fast model when it fits policy and budget", async () => {
    const base = await request();
    const decision = await routeAgentRequest({
      ...base,
      intent: {
        kind: "ambiguous-edit",
        prompt: "Make this button feel more energetic.",
        requiresVision: false,
      },
    });

    expect(decision.level).toBe("fast-model");
    expect(decision.zeroToken).toBe(false);
    expect(decision.reason).toMatch(/cheapest eligible model/i);
    expect(decision.eligibility.fastModel.eligible).toBe(true);
    expect(decision.budget.estimate.inputTokens).toBeGreaterThan(0);
    expect(decision.budget.estimate.costUsdMicros).toBe(2_000);
  });

  it("routes structural intent directly to a capable strong model", async () => {
    const base = await request();
    const decision = await routeAgentRequest({
      ...base,
      intent: {
        kind: "structural-edit",
        prompt: "Rebuild this screen as a responsive authenticated flow.",
        requiresVision: true,
      },
    });

    expect(decision.level).toBe("strong-model");
    expect(decision.eligibility.fastModel.eligible).toBe(false);
    expect(decision.eligibility.fastModel.reasons).toContain(
      "Structural intent requires the strong-model route.",
    );
    expect(decision.eligibility.strongModel.eligible).toBe(true);
  });

  it("falls back to strong when the fast model is not eligible", async () => {
    const base = await request();
    const decision = await routeAgentRequest({
      ...base,
      intent: {
        kind: "ambiguous-edit",
        prompt: "Clarify the information hierarchy.",
        requiresVision: false,
      },
      models: {
        ...base.models,
        fast: {
          ...base.models.fast,
          available: false,
        },
      },
    });

    expect(decision.level).toBe("strong-model");
    expect(decision.eligibility.fastModel.reasons).toContain(
      "Fast model is unavailable.",
    );
  });

  it("escalates local conflicts to fast and failed fast verification to strong", async () => {
    const base = await request();
    const fromLocal = await routeAgentRequest({
      ...base,
      previousAttempt: {
        level: "local",
        outcome: "compiler-conflict",
      },
    });
    const fromFast = await routeAgentRequest({
      ...base,
      previousAttempt: {
        level: "fast-model",
        outcome: "verification-failed",
      },
    });

    expect(fromLocal.level).toBe("fast-model");
    expect(fromLocal.reason).toMatch(/local.*conflict/i);
    expect(fromFast.level).toBe("strong-model");
    expect(fromFast.reason).toMatch(/verification failed/i);
    expect(fromFast.budget.remainingAfter.escalations).toBe(1);
  });

  it("does not escalate terminal failures or exceed the escalation budget", async () => {
    const base = await request();

    await expect(
      routeAgentRequest({
        ...base,
        previousAttempt: {
          level: "fast-model",
          outcome: "permission-denied",
        },
      }),
    ).rejects.toMatchObject({
      code: "ESCALATION_NOT_ALLOWED",
    });

    await expect(
      routeAgentRequest({
        ...base,
        budget: { ...base.budget, remainingEscalations: 0 },
        previousAttempt: {
          level: "fast-model",
          outcome: "verification-failed",
        },
      }),
    ).rejects.toMatchObject({
      code: "ESCALATION_BUDGET_EXHAUSTED",
    });
  });

  it("fails explicitly when no route satisfies the budget", async () => {
    const base = await request();
    const routed = routeAgentRequest({
      ...base,
      localCompiler: { ...base.localCompiler, available: false },
      budget: {
        remainingInputTokens: 1,
        remainingCostUsdMicros: 1,
        remainingEscalations: 2,
      },
    });

    await expect(routed).rejects.toBeInstanceOf(AgentRoutingError);
    await expect(routed).rejects.toMatchObject({
      code: "NO_ELIGIBLE_ROUTE",
    });
  });

  it("uses semantic selection, source revision, intent, adapter, and policy in a deterministic cache key", async () => {
    const base = await request();
    const first = await routeAgentRequest(base);
    const second = await routeAgentRequest({
      ...base,
      capsule: await capsule({ translation: { x: 999, y: 999 } }),
    });
    const policyChanged = await routeAgentRequest({
      ...base,
      policy: {
        ...base.policy,
        policyHash: `sha256:${"d".repeat(64)}`,
      },
    });

    expect(second.cacheKey).toBe(first.cacheKey);
    expect(policyChanged.cacheKey).not.toBe(first.cacheKey);
  });

  it("rejects tampered capsule evidence instead of routing it", async () => {
    const base = await request();

    await expect(
      routeAgentRequest({
        ...base,
        capsule: {
          ...base.capsule,
          selectionSemanticHash: `sha256:${"e".repeat(64)}`,
        },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_CONTEXT",
    });
  });
});
