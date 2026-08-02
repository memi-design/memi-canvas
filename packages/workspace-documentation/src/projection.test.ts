import { hashCanonicalValue } from "@memi/canonical-json";
import { describe, expect, it } from "vitest";

import {
  WorkspaceDocumentationSchema,
  parseWorkspaceDocumentation,
  selectWorkspaceScreen,
  selectWorkspaceScreensByRoute,
  type WorkspaceCaptureStatus,
  type WorkspaceDocumentation,
  type WorkspaceScreen,
} from "./index.js";
import {
  projectWorkspaceDocumentation,
  serializeWorkspaceDocumentation,
} from "./projector.js";
import {
  blockedInput,
  canonicalPrefix,
  committedInput,
  mutable,
} from "../test-support.js";

const TOP_LEVEL_KEYS = [
  "abstentions",
  "coverage",
  "designSystem",
  "documentationDigest",
  "flows",
  "kind",
  "project",
  "schemaVersion",
  "screens",
  "sourceBindings",
  "trace",
] as const;

function digestMaterial(
  documentation: WorkspaceDocumentation,
): Omit<WorkspaceDocumentation, "documentationDigest"> {
  const { documentationDigest: _digest, ...material } = documentation;
  return material;
}

describe("workspace documentation projection", () => {
  it("projects one bounded canonical screen cell per declared route/state/viewport", async () => {
    const input = await committedInput();
    const documentation = projectWorkspaceDocumentation(input);

    expect(Object.keys(documentation).sort()).toEqual(TOP_LEVEL_KEYS);
    expect(documentation).toMatchObject({
      schemaVersion: 1,
      kind: "workspace-documentation",
      sourceBindings: {
        workspaceDigest: input.workspace.workspaceDigest,
        planId: input.plan.planId,
        planDigest: input.plan.planDigest,
        documentId: input.plan.documentId,
        sourceRevision: input.workspace.sourceRevision,
        sourceContentFingerprint:
          input.workspace.sourceContentFingerprint,
        compilerFingerprint: input.workspace.compilerFingerprint,
        projectionIntegrityDigests:
          input.workspace.projectionIntegrityDigests,
      },
      project: {
        id: input.workspace.projectId,
        importMode: input.workspace.productTruth.importMode,
        source: input.workspace.productTruth.source,
        dimensions: input.workspace.productTruth.dimensions,
      },
      coverage: {
        routes: 3,
        states: 6,
        screenCells: 18,
        captures: {
          unavailable: 0,
          observed: 0,
          inferred: 18,
          blocked: 0,
        },
        materialization: {
          planned: 18,
          committed: 18,
          plannedNotCommitted: 0,
          unmaterialized: 0,
        },
        flows: {
          declared: 1,
          observed: 0,
        },
        tokens: {
          declared: 6,
        },
        components: {
          available: 0,
          status: "unavailable",
        },
      },
    });
    expect(documentation.screens).toHaveLength(18);
    expect(documentation.screens[0]).toMatchObject({
      id: input.workspace.coverageCells[0]!.id,
      route: {
        id: input.workspace.routes[0]!.id,
        displayName: "Home",
        path: "/",
      },
      state: {
        id: input.workspace.states[0]!.id,
        name: "default",
        kind: "default",
        provenance: "declared",
      },
      viewport: {
        name: "desktop",
        width: 1440,
        height: 900,
      },
      context: {
        role: "anonymous",
        theme: "light",
        locale: "en-US",
        fixture: "default",
      },
      capture: {
        status: "inferred",
        reason: "runtime-capture-not-run",
        evidenceArtifactIds: [],
      },
      materialization: {
        status: "committed",
        nodeId: input.plan.entries[0]!.nodeId,
        operationId: input.plan.entries[0]!.operationId,
        traceRef: {
          sequence: 1,
          eventId: input.canonicalReplay.events[0]!.id,
          eventHash: input.canonicalReplay.events[0]!.eventHash,
          operationId: input.plan.entries[0]!.operationId,
        },
      },
    });
    expect(
      documentation.screens.map((screen: WorkspaceScreen) => [
        screen.route.displayName,
        screen.state.name,
        screen.viewport.name,
      ]),
    ).toEqual([
      ["Home", "default", "desktop"],
      ["Home", "default", "tablet"],
      ["Home", "default", "mobile"],
      ["Home", "loading", "desktop"],
      ["Home", "loading", "tablet"],
      ["Home", "loading", "mobile"],
      ["Projects", "default", "desktop"],
      ["Projects", "default", "tablet"],
      ["Projects", "default", "mobile"],
      ["Projects", "empty", "desktop"],
      ["Projects", "empty", "tablet"],
      ["Projects", "empty", "mobile"],
      ["Projects", "error", "desktop"],
      ["Projects", "error", "tablet"],
      ["Projects", "error", "mobile"],
      ["Settings", "default", "desktop"],
      ["Settings", "default", "tablet"],
      ["Settings", "default", "mobile"],
    ]);
  });

  it("retains declaration authority without inventing observation or rendering authority", async () => {
    const input = await committedInput();
    const documentation = projectWorkspaceDocumentation(input);

    expect(documentation.flows).toEqual(
      input.workspace.flows.map((flow) => ({
        id: flow.id,
        name: flow.name,
        status: "declared",
        observationStatus: "not-observed",
        steps: flow.steps,
      })),
    );
    expect(documentation.designSystem).toEqual({
      tokens: input.workspace.designTokens.map((token) => ({
        name: token.name,
        cssVariable: token.cssVariable,
        sourceFile: token.sourceFile,
        status: "declared",
      })),
      components: {
        status: "unavailable",
        items: [],
      },
    });
    expect(documentation.abstentions).toEqual([
      {
        authority: "visual-verification",
        status: "unavailable",
        reason: "runtime-replay-is-not-visual-verification",
      },
      {
        authority: "flow-observation",
        status: "unavailable",
        reason: "workspace-flows-are-declarations-only",
      },
      {
        authority: "component-inventory",
        status: "unavailable",
        reason: "workspace-has-no-component-authority",
      },
      {
        authority: "token-value-rendering",
        status: "unavailable",
        reason: "declared-token-values-are-not-rendering-authority",
      },
    ]);
    const serialized = serializeWorkspaceDocumentation(documentation);
    for (const token of input.workspace.designTokens) {
      expect(serialized).not.toContain(token.value);
      expect(serialized).not.toContain(
        `${token.cssVariable}: ${token.value}`,
      );
    }
    expect(serialized).not.toContain(":root");
    expect(serialized).not.toContain("visually-verified");
  });

  it("reports a valid committed prefix without upgrading remaining plan intent", async () => {
    const input = canonicalPrefix(await committedInput(), 3);
    const documentation = projectWorkspaceDocumentation(input);

    expect(documentation.trace).toEqual({
      projectId: input.canonicalReplay.projectId,
      lastSequence: 3,
      lastEventHash: input.canonicalReplay.lastEventHash,
      refs: input.canonicalReplay.events.map((event) => ({
        sequence: event.sequence,
        eventId: event.id,
        eventHash: event.eventHash,
        previousEventHash: event.previousEventHash,
        operationId: event.operationId,
        commandId: event.commandId,
        resultingHash: event.resultingHash,
      })),
    });
    expect(documentation.coverage.materialization).toEqual({
      planned: 18,
      committed: 3,
      plannedNotCommitted: 15,
      unmaterialized: 0,
    });
    expect(
      documentation.screens.map(
        (screen: WorkspaceScreen) => screen.materialization.status,
      ),
    ).toEqual([
      ...Array.from({ length: 3 }, () => "committed"),
      ...Array.from({ length: 15 }, () => "planned-not-committed"),
    ]);
  });

  it("keeps blocked captures unavailable and never fabricates a component or frame", async () => {
    const input = await blockedInput();
    const documentation = projectWorkspaceDocumentation(input);

    expect(documentation.screens[0]).toMatchObject({
      capture: {
        status: "blocked",
        reason: "authentication-required",
        evidenceArtifactIds: [],
      },
      materialization: {
        status: "unmaterialized",
        nodeId: null,
        operationId: null,
        traceRef: null,
      },
    });
    expect(documentation.coverage).toMatchObject({
      captures: {
        unavailable: 0,
        observed: 0,
        inferred: 17,
        blocked: 1,
      },
      materialization: {
        planned: 17,
        committed: 0,
        plannedNotCommitted: 17,
        unmaterialized: 1,
      },
    });
    expect(documentation.designSystem.components).toEqual({
      status: "unavailable",
      items: [],
    });
  });

  it("is deterministic, digest-bound, deeply immutable, and canonically round-trippable", async () => {
    const input = await committedInput();
    const first = projectWorkspaceDocumentation(input);
    const second = projectWorkspaceDocumentation(input);
    const serialized = serializeWorkspaceDocumentation(first);
    const parsed = parseWorkspaceDocumentation(JSON.parse(serialized));

    expect(second).toEqual(first);
    expect(serializeWorkspaceDocumentation(second)).toBe(serialized);
    expect(first.documentationDigest).toBe(
      hashCanonicalValue(digestMaterial(first)),
    );
    expect(parsed).toEqual(first);
    expect(WorkspaceDocumentationSchema.parse(first)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.screens)).toBe(true);
    expect(Object.isFrozen(first.screens[0])).toBe(true);
    expect(Object.isFrozen(first.trace.refs)).toBe(true);
    expect(Object.isFrozen(first.abstentions)).toBe(true);
  });

  it("provides browser-safe selectors without exposing mutable collections", async () => {
    const documentation = projectWorkspaceDocumentation(
      await committedInput(),
    );
    const first = documentation.screens[0]!;

    expect(selectWorkspaceScreen(documentation, first.id)).toBe(first);
    expect(
      selectWorkspaceScreen(
        documentation,
        "cov_01J00000000000000000000000",
      ),
    ).toBeUndefined();
    const routeScreens = selectWorkspaceScreensByRoute(
      documentation,
      first.route.id,
    );
    expect(routeScreens).toEqual(documentation.screens.slice(0, 6));
    expect(Object.isFrozen(routeScreens)).toBe(true);
  });

  it.each<WorkspaceCaptureStatus>([
    "unavailable",
    "observed",
    "inferred",
    "blocked",
  ])("accepts the bounded capture abstention status %s", async (status) => {
    const documentation = mutable(
      projectWorkspaceDocumentation(await committedInput()),
    ) as unknown as {
      documentationDigest: string;
      screens: Array<{ capture: { status: WorkspaceCaptureStatus } }>;
    };
    documentation.screens[0]!.capture.status = status;
    documentation.documentationDigest = hashCanonicalValue(
      digestMaterial(
        documentation as unknown as WorkspaceDocumentation,
      ),
    );

    expect(
      parseWorkspaceDocumentation(documentation),
    ).toEqual(documentation);
  });

  it("rejects visual verification as a capture status", async () => {
    const documentation = mutable(
      projectWorkspaceDocumentation(await committedInput()),
    ) as unknown as {
      screens: Array<{ capture: { status: string } }>;
    };
    documentation.screens[0]!.capture.status = "verified";

    expect(() => parseWorkspaceDocumentation(documentation)).toThrow();
  });
});
