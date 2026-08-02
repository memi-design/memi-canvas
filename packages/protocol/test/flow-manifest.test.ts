import { describe, expect, it } from "vitest";

import {
  FlowManifestSchema,
  validateFlowManifestBindings,
} from "../src/index.js";
import {
  flowManifestFixture,
  hash,
  ids,
  nextHash,
  routeManifestFixture,
  stateManifestFixture,
} from "./fixtures.js";

describe("FlowManifest", () => {
  it("accepts a strict declared flow bound to source and compiler truth", () => {
    expect(FlowManifestSchema.parse(flowManifestFixture)).toEqual(
      flowManifestFixture,
    );
  });

  it.each([
    ["missing", { assertion: undefined }],
    ["unsafe trigger", { trigger: "click(); process.exit(1)" }],
    ["unsafe assertion", { assertion: "${readFile('/etc/passwd')}" }],
    ["zero-based order", { order: 0 }],
  ])("rejects %s step fields", (_name, replacement) => {
    const step = { ...flowManifestFixture.flows[0].steps[0], ...replacement };
    expect(
      FlowManifestSchema.safeParse({
        ...flowManifestFixture,
        flows: [{ ...flowManifestFixture.flows[0], steps: [step] }],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate flow IDs and duplicate or non-contiguous step order", () => {
    const flow = flowManifestFixture.flows[0];
    expect(
      FlowManifestSchema.safeParse({
        ...flowManifestFixture,
        flows: [flow, flow],
      }).success,
    ).toBe(false);
    expect(
      FlowManifestSchema.safeParse({
        ...flowManifestFixture,
        flows: [
          {
            ...flow,
            steps: [
              flow.steps[0],
              { ...flow.steps[0], order: 1 },
              { ...flow.steps[0], order: 3 },
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    "authentication",
    "trace",
    "sourceRoot",
    "process",
    "network",
    "harness",
    "model",
  ])("rejects the out-of-scope %s field", (field) => {
    expect(
      FlowManifestSchema.safeParse({
        ...flowManifestFixture,
        [field]: "forbidden",
      }).success,
    ).toBe(false);
  });

  it("rejects executable step fields and non-declared provenance", () => {
    expect(
      FlowManifestSchema.safeParse({
        ...flowManifestFixture,
        flows: [
          {
            ...flowManifestFixture.flows[0],
            steps: [
              {
                ...flowManifestFixture.flows[0].steps[0],
                script: "process.exit(1)",
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      FlowManifestSchema.safeParse({
        ...flowManifestFixture,
        flows: [
          {
            ...flowManifestFixture.flows[0],
            provenance: "inferred",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an escaping or URI flow source file", () => {
    for (const sourceFile of [
      "../flows.ts",
      "file:///tmp/flows.ts",
      "C:\\tmp\\flows.ts",
    ]) {
      expect(
        FlowManifestSchema.safeParse({
          ...flowManifestFixture,
          sourceFile,
        }).success,
      ).toBe(false);
    }
  });
});

describe("validateFlowManifestBindings", () => {
  const authority = {
    flowManifest: flowManifestFixture,
    routeManifest: routeManifestFixture,
    stateManifest: stateManifestFixture,
    sourceContentFingerprint: hash,
    compilerFingerprint: nextHash,
  } as const;

  it("returns the parsed manifest when every reference and binding agrees", () => {
    expect(validateFlowManifestBindings(authority)).toEqual(
      flowManifestFixture,
    );
  });

  it.each([
    [
      "orphan route",
      {
        routeId: "rte_01J00000000000000000000001",
        stateId: ids.state,
      },
    ],
    [
      "orphan state",
      {
        routeId: ids.route,
        stateId: "sta_01J00000000000000000000001",
      },
    ],
  ])("rejects an %s reference", (_name, replacement) => {
    const step = {
      ...flowManifestFixture.flows[0].steps[0],
      ...replacement,
    };
    expect(() =>
      validateFlowManifestBindings({
        ...authority,
        flowManifest: {
          ...flowManifestFixture,
          flows: [
            {
              ...flowManifestFixture.flows[0],
              steps: [step],
            },
          ],
        },
      }),
    ).toThrow(/unknown|orphan/i);
  });

  it("rejects a state bound to another route", () => {
    const foreignRoute = {
      ...routeManifestFixture.routes[0],
      id: "rte_01J00000000000000000000001",
      path: "/foreign",
    };
    expect(() =>
      validateFlowManifestBindings({
        ...authority,
        routeManifest: {
          ...routeManifestFixture,
          routes: [...routeManifestFixture.routes, foreignRoute],
        },
        stateManifest: {
          ...stateManifestFixture,
          states: [
            {
              ...stateManifestFixture.states[0],
              routeId: foreignRoute.id,
            },
          ],
        },
      }),
    ).toThrow(/route/i);
  });

  it.each([
    ["route displayName", "route", { displayName: "Changed" }],
    ["route path", "route", { path: "/changed" }],
    ["route sourceScreen", "route", { sourceScreen: "ChangedScreen" }],
    ["route sourceFile", "route", { sourceFile: "src/changed.tsx" }],
    ["route ownership", "route", { sourceOwnership: "reference-only" }],
    ["route authentication", "route", { authentication: "authenticated" }],
    ["route parameters", "route", { parameters: ["projectId"] }],
    ["state name", "state", { name: "Changed" }],
    ["state kind", "state", { kind: "loading" }],
    ["state provenance", "state", { provenance: "observed" }],
  ] as const)(
    "rejects stale flow digest binding after %s changes under a stable ID",
    (_name, manifest, replacement) => {
      const routeManifest =
        manifest === "route"
          ? {
              ...routeManifestFixture,
              routes: [
                {
                  ...routeManifestFixture.routes[0],
                  ...replacement,
                },
              ],
            }
          : routeManifestFixture;
      const stateManifest =
        manifest === "state"
          ? {
              ...stateManifestFixture,
              states: [
                {
                  ...stateManifestFixture.states[0],
                  ...replacement,
                },
              ],
            }
          : stateManifestFixture;

      expect(() =>
        validateFlowManifestBindings({
          ...authority,
          routeManifest,
          stateManifest,
        }),
      ).toThrow(/digest|binding/i);
    },
  );

  it.each([
    ["project", { projectId: "prj_01J00000000000000000000001" }],
    ["source", { sourceContentFingerprint: nextHash }],
    ["compiler", { compilerFingerprint: hash }],
  ])("rejects a mismatched %s binding", (_name, replacement) => {
    expect(() =>
      validateFlowManifestBindings({
        ...authority,
        flowManifest: { ...flowManifestFixture, ...replacement },
      }),
    ).toThrow(/binding|project/i);
  });
});
