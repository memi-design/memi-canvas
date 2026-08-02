import { afterEach, describe, expect, it } from "vitest";

import { importExpoRouterProject } from "./index.js";
import {
  cleanupExpoRouterFixtures,
  createExpoRouterFixture,
  TEST_BUDGETS,
  TEST_REPOSITORY,
} from "./test-support.js";

const UNAVAILABLE_CAPTURE = {
  kind: "unavailable",
  reason: "No trusted Expo web runtime was supplied.",
} as const;

const DESIGN_SYSTEM_FILES = {
  "components/ui/Button.tsx": `
    type ButtonVariant = "primary" | "secondary" | "ghost";
    type ButtonSize = "sm" | "md" | "lg";
    export type ButtonProps = { variant?: ButtonVariant; size?: ButtonSize };
    export const Button = ({ variant = "primary", size = "md" }: ButtonProps) => null;
  `,
  "components/ui/Card.tsx": `
    type CardVariant = "default" | "elevated";
    type CardPadding = "none" | "md";
    export const Card = ({ variant = "default", padding = "md" }: {
      variant?: CardVariant; padding?: CardPadding
    }) => null;
  `,
  "components/ui/Badge.tsx": `
    type BadgeTone = "accent" | "success" | "warning";
    type BadgeSize = "xs" | "sm";
    export function Badge({ tone = "accent", size = "sm" }: {
      tone?: BadgeTone; size?: BadgeSize
    }) { return null; }
  `,
  "components/ui/Input.tsx": `
    type InputVariant = "outlined" | "filled" | "ghost";
    type InputSize = "sm" | "md" | "lg";
    export const Input = ({ variant = "outlined", size = "md" }: {
      variant?: InputVariant; size?: InputSize
    }) => null;
  `,
  "components/ui/design-system.ts": `
    export { Button } from "./Button";
    export type { ButtonProps } from "./Button";
    export { Card } from "./Card";
    export { Badge } from "./Badge";
    export { Input } from "./Input";
    export * from "./Text";
  `,
  "components/ui/CustomTabBar.tsx": `
    export const VISIBLE_TAB_NAMES = ["dashboard", "games", "chat"] as const;
  `,
  "src/theme/layout.ts": `
    export const SPACING = { sm: 6, md: 8, lg: 12 } as const;
    export const RADIUS = { sm: 8, card: 16, pill: 999 } as const;
  `,
  "src/theme/colors.ts": `
    export const ACCENT_COLORS = ["#10b981", "#34d399"] as const;
    export const colorTokens = {
      accent: { primary: ACCENT_COLORS[0], strong: ACCENT_COLORS[1] },
      main: { background: "#000000", foreground: "#f7f7f7" },
    } as const;
  `,
  "app/(protected)/(tabs)/_layout.tsx": `
    import { Tabs } from "expo-router";
    declare const t: (key: string) => string;
    export default function Layout() {
      return <Tabs>
        <Tabs.Screen name="dashboard" options={{ title: "Dashboard" }} />
        <Tabs.Screen name="games" options={{ title: t("tab_games") }} />
        <Tabs.Screen name="chat" options={{ title: "Chat" }} />
        <Tabs.Screen name="profile" options={{ href: null, title: "Profile" }} />
      </Tabs>;
    }
  `,
} as const;

afterEach(cleanupExpoRouterFixtures);

async function importDesignSystem(
  additionalFiles: Readonly<Record<string, string>> = DESIGN_SYSTEM_FILES,
) {
  const fixture = await createExpoRouterFixture({ additionalFiles });
  return importExpoRouterProject({
    rootDir: fixture.root,
    repository: TEST_REPOSITORY,
    budgets: TEST_BUDGETS,
    runtimeCapture: UNAVAILABLE_CAPTURE,
  });
}

describe("static Expo design-system extraction", () => {
  it("extracts editable component axes, semantic tokens, barrels, and visible tabs", async () => {
    const imported = await importDesignSystem();

    expect(imported.designSystem).toMatchObject({
      schemaVersion: "expo-design-system-static@1",
      analysisMode: "static-ast",
      executedProjectCode: false,
      confidencePolicy: "high-confidence-only",
      components: [
        {
          name: "Badge",
          atomicLevel: "atom",
          confidence: "high",
          axes: [
            { name: "size", values: ["xs", "sm"], defaultValue: "sm" },
            {
              name: "tone",
              values: ["accent", "success", "warning"],
              defaultValue: "accent",
            },
          ],
        },
        {
          name: "Button",
          atomicLevel: "atom",
          confidence: "high",
          axes: [
            { name: "size", values: ["sm", "md", "lg"], defaultValue: "md" },
            {
              name: "variant",
              values: ["primary", "secondary", "ghost"],
              defaultValue: "primary",
            },
          ],
        },
        {
          name: "Card",
          atomicLevel: "atom",
          confidence: "high",
          axes: [
            { name: "padding", values: ["none", "md"], defaultValue: "md" },
            {
              name: "variant",
              values: ["default", "elevated"],
              defaultValue: "default",
            },
          ],
        },
        {
          name: "Input",
          atomicLevel: "atom",
          confidence: "high",
          axes: [
            { name: "size", values: ["sm", "md", "lg"], defaultValue: "md" },
            {
              name: "variant",
              values: ["outlined", "filled", "ghost"],
              defaultValue: "outlined",
            },
          ],
        },
      ],
      navigation: {
        visibleTabs: [
          { routeName: "dashboard", title: "Dashboard", confidence: "high" },
          { routeName: "games", confidence: "high" },
          { routeName: "chat", title: "Chat", confidence: "high" },
        ],
      },
    });

    const spacing = imported.designSystem.tokenCollections.find(
      (collection) => collection.name === "SPACING",
    );
    expect(spacing).toMatchObject({
      collectionKind: "object",
      confidence: "high",
      entries: [
        { path: ["sm"], value: { kind: "number", value: 6 } },
        { path: ["md"], value: { kind: "number", value: 8 } },
        { path: ["lg"], value: { kind: "number", value: 12 } },
      ],
    });
    const colorTokens = imported.designSystem.tokenCollections.find(
      (collection) => collection.name === "colorTokens",
    );
    expect(colorTokens?.entries).toEqual([
      expect.objectContaining({
        path: ["accent", "primary"],
        value: {
          kind: "reference",
          expression: "ACCENT_COLORS[0]",
          resolution: "unresolved",
        },
      }),
      expect.objectContaining({
        path: ["accent", "strong"],
        value: {
          kind: "reference",
          expression: "ACCENT_COLORS[1]",
          resolution: "unresolved",
        },
      }),
      expect.objectContaining({
        path: ["main", "background"],
        value: { kind: "string", value: "#000000" },
      }),
      expect.objectContaining({
        path: ["main", "foreground"],
        value: { kind: "string", value: "#f7f7f7" },
      }),
    ]);

    expect(imported.designSystem.barrelExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          exportedName: "Button",
          localName: "Button",
          moduleSpecifier: "./Button",
          typeOnly: false,
          confidence: "high",
        }),
        expect.objectContaining({
          exportedName: "ButtonProps",
          localName: "ButtonProps",
          moduleSpecifier: "./Button",
          typeOnly: true,
          confidence: "high",
        }),
        expect.objectContaining({
          exportedName: "*",
          localName: "*",
          moduleSpecifier: "./Text",
          typeOnly: false,
          confidence: "high",
        }),
      ]),
    );
  });

  it("retains byte hashes and exact source ranges for every declaration", async () => {
    const imported = await importDesignSystem();
    const button = imported.designSystem.components.find(
      (component) => component.name === "Button",
    );
    const variant = button?.axes.find((axis) => axis.name === "variant");

    expect(button?.source).toEqual({
      sourcePath: "components/ui/Button.tsx",
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      startLine: expect.any(Number),
      startColumn: expect.any(Number),
      endLine: expect.any(Number),
      endColumn: expect.any(Number),
    });
    expect(variant?.source).toEqual(
      expect.objectContaining({
        sourcePath: "components/ui/Button.tsx",
        contentHash: button?.source.contentHash,
      }),
    );
    expect(Object.isFrozen(imported.designSystem)).toBe(true);
    expect(Object.isFrozen(button?.axes)).toBe(true);
  });

  it("fails closed on dynamic unions, token spreads, and computed navigation", async () => {
    const imported = await importDesignSystem({
      "components/ui/Button.tsx": `
        declare const extra: string;
        type ButtonVariant = "primary" | typeof extra;
        export const Button = ({ variant = "primary" }: {
          variant?: ButtonVariant
        }) => null;
      `,
      "components/ui/CustomTabBar.tsx": `
        declare function getTabs(): readonly string[];
        export const VISIBLE_TAB_NAMES = getTabs();
      `,
      "src/theme/tokens.ts": `
        declare const inherited: Record<string, string>;
        export const unsafeTokens = { safe: "#ffffff", ...inherited } as const;
      `,
    });

    expect(imported.designSystem.components).toEqual([
      expect.objectContaining({ name: "Button", axes: [] }),
    ]);
    expect(
      imported.designSystem.tokenCollections.some(
        (collection) => collection.name === "unsafeTokens",
      ),
    ).toBe(false);
    expect(imported.designSystem.navigation.visibleTabs).toEqual([]);
    expect(imported.designSystem.extraction).toEqual({
      status: "partial",
      omittedAmbiguousDeclarations: 3,
    });
  });

  it("preserves the supported literal grammar and falls back to explicit Tabs.Screen declarations", async () => {
    const imported = await importDesignSystem({
      "components/ui/Button.tsx": `
        type ButtonVariant = "primary";
        export function Button({ variant = "primary" }: {
          variant?: ButtonVariant
        }) { return null; }
      `,
      "src/theme/tokens.ts": `
        const alias = "#10b981";
        export const grammar = {
          string: "value",
          numeric: 12,
          negative: -2,
          positive: +3,
          enabled: true,
          disabled: false,
          empty: null,
          alias,
          ["literal-key"]: "literal-value",
          nested: [{ state: "active" }, "tail"],
        } as const;
        export const unsafeMethod = {
          valid: "not-partially-emitted",
          method() { return "dynamic"; },
        } as const;
        export const runtimeTokens = {
          color: getColor(),
        } as const;
        declare function getColor(): string;
      `,
      "components/ui/CustomTabBar.tsx": `
        declare function getTabs(): readonly string[];
        export const VISIBLE_TAB_NAMES = getTabs();
      `,
      "app/(tabs)/_layout.tsx": `
        import { Tabs } from "expo-router";
        declare function getOptions(): object;
        export default function Layout() {
          return <Tabs>
            <Tabs.Screen name={"home"} options={{ title: "Home" }} />
            <Tabs.Screen name="hidden" options={{ href: null, title: "Hidden" }} />
            <Tabs.Screen name="settings" options={{ title: "Settings" }}>
              {null}
            </Tabs.Screen>
            <Tabs.Screen name="dynamic" options={getOptions()} />
            <Tabs.Screen name="missing-options" />
          </Tabs>;
        }
      `,
    });

    const grammar = imported.designSystem.tokenCollections.find(
      (collection) => collection.name === "grammar",
    );
    expect(grammar?.entries.map((entry) => [entry.path, entry.value])).toEqual([
      [["string"], { kind: "string", value: "value" }],
      [["numeric"], { kind: "number", value: 12 }],
      [["negative"], { kind: "number", value: -2 }],
      [["positive"], { kind: "number", value: 3 }],
      [["enabled"], { kind: "boolean", value: true }],
      [["disabled"], { kind: "boolean", value: false }],
      [["empty"], { kind: "null", value: null }],
      [
        ["alias"],
        {
          kind: "reference",
          expression: "alias",
          resolution: "unresolved",
        },
      ],
      [["literal-key"], { kind: "string", value: "literal-value" }],
      [["nested", "0", "state"], { kind: "string", value: "active" }],
      [["nested", "1"], { kind: "string", value: "tail" }],
    ]);
    expect(
      imported.designSystem.tokenCollections.some(
        (collection) => collection.name === "unsafeMethod",
      ),
    ).toBe(false);
    expect(
      imported.designSystem.tokenCollections.some(
        (collection) => collection.name === "runtimeTokens",
      ),
    ).toBe(false);
    expect(imported.designSystem.navigation.visibleTabs).toEqual([
      expect.objectContaining({
        routeName: "home",
        title: "Home",
        confidence: "high",
      }),
      expect.objectContaining({
        routeName: "settings",
        title: "Settings",
        confidence: "high",
      }),
    ]);
  });

  it("rejects syntactically invalid source instead of extracting a recovered AST", async () => {
    const imported = await importDesignSystem({
      "src/theme/broken-tokens.ts": `
        export const recoveredButUnsafe = {
          color: "#ffffff",
      `,
      "src/theme/mutable-tokens.ts": `
        export let mutableTokens = { color: "#ffffff" } as const;
      `,
      "components/ui/Input.tsx": `
        export let Input = () => null;
      `,
    });

    expect(
      imported.designSystem.tokenCollections.some(
        (collection) => collection.name === "recoveredButUnsafe",
      ),
    ).toBe(false);
    expect(imported.designSystem.extraction.status).toBe("partial");
    expect(
      imported.designSystem.tokenCollections.some(
        (collection) => collection.name === "mutableTokens",
      ),
    ).toBe(false);
    expect(
      imported.designSystem.components.some(
        (component) => component.name === "Input",
      ),
    ).toBe(false);
    expect(
      imported.designSystem.extraction.omittedAmbiguousDeclarations,
    ).toBeGreaterThanOrEqual(3);
  });
});
