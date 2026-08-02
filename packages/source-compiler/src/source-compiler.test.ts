import { describe, expect, it } from "vitest";

import {
  DeterministicSourceCompilerError,
  compileSourceEdit,
  createSourceAnchorForTarget,
  hashSourceText,
  MAX_SOURCE_TEXT_BYTES,
} from "./index.js";
import type {
  SourceStaticValue,
  SourceTarget,
} from "./index.js";

const REVISION = "a6ce2458e0cd1b252663057f2e4060f0929c0687";
const DIRTY_FINGERPRINT = `sha256:${"d".repeat(64)}` as const;

const SOURCE = `import { StyleSheet } from "react-native";

export const BUTTON_RADIUS_MD = 12;
export const SPACING = {
  sm: 6,
  lg: 12,
  "2xl": 20,
} as const;

export function Prompt() {
  return <Button label="Turn on notifications" size="lg" />;
}

const styles = StyleSheet.create({
  root: {
    borderRadius: BUTTON_RADIUS_MD,
    paddingHorizontal: SPACING.lg,
  },
});
`;

function value(
  input: string | number | boolean,
): SourceStaticValue {
  if (typeof input === "string") {
    return { kind: "string", value: input };
  }
  if (typeof input === "number") {
    return { kind: "number", value: input };
  }
  return { kind: "boolean", value: input };
}

async function anchor(
  target: SourceTarget,
  expectedValue: SourceStaticValue,
  sourceText = SOURCE,
) {
  return createSourceAnchorForTarget({
    componentIdentity: "buzzr.ui",
    dirtyFingerprint: DIRTY_FINGERPRINT,
    expectedValue,
    relativePath: "components/ui/Prompt.tsx",
    runtimeEvidenceRefs: ["artifact://buzzr/prompt"],
    sourceRevision: REVISION,
    sourceText,
    target,
  });
}

describe("deterministic source compiler", () => {
  it("changes only an exact JSX string initializer and preserves surrounding formatting", async () => {
    const target = {
      attributeName: "label",
      elementName: "Button",
      kind: "jsx-attribute",
    } as const;
    const sourceAnchor = await anchor(
      target,
      value("Turn on notifications"),
    );
    const result = await compileSourceEdit({
      anchor: sourceAnchor,
      edit: {
        after: value("Enable alerts"),
        before: value("Turn on notifications"),
        target,
      },
      sourceText: SOURCE,
    });

    expect(result.zeroToken).toBe(true);
    expect(result.patch).toMatchObject({
      expectedBeforeHash: await hashSourceText(SOURCE),
      relativePath: "components/ui/Prompt.tsx",
      replacements: [
        {
          after: '"Enable alerts"',
          before: '"Turn on notifications"',
        },
      ],
    });
    expect(result.afterText).toBe(
      SOURCE.replace(
        'label="Turn on notifications"',
        'label="Enable alerts"',
      ),
    );
    expect(result.changedRange).toEqual(sourceAnchor.range);
    expect(result.afterHash).toBe(
      await hashSourceText(result.afterText),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.patch.replacements)).toBe(true);
  });

  it("escapes JSX attribute strings without enabling source injection", async () => {
    const target = {
      attributeName: "label",
      elementName: "Button",
      kind: "jsx-attribute",
    } as const;
    const sourceAnchor = await anchor(
      target,
      value("Turn on notifications"),
    );
    const result = await compileSourceEdit({
      anchor: sourceAnchor,
      edit: {
        after: value('Alerts "now" & <later>'),
        before: value("Turn on notifications"),
        target,
      },
      sourceText: SOURCE,
    });

    expect(result.patch.replacements[0]?.after).toBe(
      '"Alerts &quot;now&quot; &amp; &lt;later&gt;"',
    );
  });

  it("patches an exported numeric radius token by expression range", async () => {
    const target = {
      declarationName: "BUTTON_RADIUS_MD",
      kind: "constant",
    } as const;
    const sourceAnchor = await anchor(target, value(12));
    const result = await compileSourceEdit({
      anchor: sourceAnchor,
      edit: {
        after: value(14),
        before: value(12),
        target,
      },
      sourceText: SOURCE,
    });

    expect(result.patch.replacements).toEqual([
      { after: "14", before: "12" },
    ]);
    expect(result.afterText).toContain(
      "export const BUTTON_RADIUS_MD = 14;",
    );
  });

  it("patches quoted and identifier spacing keys without printing the enclosing object", async () => {
    const identifierTarget = {
      declarationName: "SPACING",
      kind: "object-property",
      propertyPath: ["lg"],
    } as const;
    const quotedTarget = {
      declarationName: "SPACING",
      kind: "object-property",
      propertyPath: ["2xl"],
    } as const;
    const identifierAnchor = await anchor(identifierTarget, value(12));
    const identifierResult = await compileSourceEdit({
      anchor: identifierAnchor,
      edit: {
        after: value(14),
        before: value(12),
        target: identifierTarget,
      },
      sourceText: SOURCE,
    });
    const quotedAnchor = await anchor(
      quotedTarget,
      value(20),
      identifierResult.afterText,
    );
    const quotedResult = await compileSourceEdit({
      anchor: quotedAnchor,
      edit: {
        after: value(24),
        before: value(20),
        target: quotedTarget,
      },
      sourceText: identifierResult.afterText,
    });

    expect(quotedResult.afterText).toContain("  lg: 14,");
    expect(quotedResult.afterText).toContain('  "2xl": 24,');
    expect(quotedResult.afterText).toContain("} as const;");
  });

  it("patches a StyleSheet property to a constrained token reference", async () => {
    const target = {
      declarationName: "styles",
      kind: "style-property",
      propertyPath: ["root", "borderRadius"],
    } as const;
    const before = {
      kind: "token-reference",
      path: ["BUTTON_RADIUS_MD"],
    } as const;
    const after = {
      kind: "token-reference",
      path: ["SPACING", "xl"],
    } as const;
    const sourceAnchor = await anchor(target, before);
    const result = await compileSourceEdit({
      anchor: sourceAnchor,
      edit: { after, before, target },
      sourceText: SOURCE,
    });

    expect(result.patch.replacements).toEqual([
      {
        after: "SPACING.xl",
        before: "BUTTON_RADIUS_MD",
      },
    ]);
    expect(result.afterText).toContain(
      "borderRadius: SPACING.xl,",
    );
  });

  it("rejects a stale source hash before parsing or proposing a patch", async () => {
    const target = {
      declarationName: "BUTTON_RADIUS_MD",
      kind: "constant",
    } as const;
    const sourceAnchor = await anchor(target, value(12));

    await expect(
      compileSourceEdit({
        anchor: sourceAnchor,
        edit: {
          after: value(14),
          before: value(12),
          target,
        },
        sourceText: `${SOURCE}\n// changed`,
      }),
    ).rejects.toMatchObject({
      code: "anchor-hash-mismatch",
    });
  });

  it("rejects tampered ranges and AST paths", async () => {
    const target = {
      declarationName: "BUTTON_RADIUS_MD",
      kind: "constant",
    } as const;
    const sourceAnchor = await anchor(target, value(12));

    await expect(
      compileSourceEdit({
        anchor: {
          ...sourceAnchor,
          range: {
            end: sourceAnchor.range.end + 1,
            start: sourceAnchor.range.start,
          },
        },
        edit: {
          after: value(14),
          before: value(12),
          target,
        },
        sourceText: SOURCE,
      }),
    ).rejects.toMatchObject({
      code: "anchor-target-mismatch",
    });
    await expect(
      compileSourceEdit({
        anchor: {
          ...sourceAnchor,
          astPath: ["constant", "OTHER"],
        },
        edit: {
          after: value(14),
          before: value(12),
          target,
        },
        sourceText: SOURCE,
      }),
    ).rejects.toMatchObject({
      code: "anchor-target-mismatch",
    });
  });

  it("rejects stale semantic values even when the anchor hash matches", async () => {
    const target = {
      declarationName: "BUTTON_RADIUS_MD",
      kind: "constant",
    } as const;
    const sourceAnchor = await anchor(target, value(12));

    await expect(
      compileSourceEdit({
        anchor: sourceAnchor,
        edit: {
          after: value(14),
          before: value(10),
          target,
        },
        sourceText: SOURCE,
      }),
    ).rejects.toMatchObject({ code: "stale-value" });
  });

  it("fails closed when target discovery is ambiguous", async () => {
    const sourceText = `${SOURCE}
export function Duplicate() {
  return <Button label="Turn on notifications" />;
}
`;
    const target = {
      attributeName: "label",
      elementName: "Button",
      kind: "jsx-attribute",
    } as const;

    await expect(
      anchor(
        target,
        value("Turn on notifications"),
        sourceText,
      ),
    ).rejects.toMatchObject({ code: "ambiguous-target" });
  });

  it("rejects parse failures, no-ops, unsafe token paths, and unsupported JSX expressions", async () => {
    const constantTarget = {
      declarationName: "BUTTON_RADIUS_MD",
      kind: "constant",
    } as const;
    const sourceAnchor = await anchor(constantTarget, value(12));
    await expect(
      compileSourceEdit({
        anchor: sourceAnchor,
        edit: {
          after: value(12),
          before: value(12),
          target: constantTarget,
        },
        sourceText: SOURCE,
      }),
    ).rejects.toMatchObject({ code: "no-op" });
    await expect(
      compileSourceEdit({
        anchor: sourceAnchor,
        edit: {
          after: {
            kind: "token-reference",
            path: ["SPACING", "x; process.exit()"],
          },
          before: value(12),
          target: constantTarget,
        },
        sourceText: SOURCE,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      createSourceAnchorForTarget({
        componentIdentity: null,
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: value(12),
        relativePath: "broken.tsx",
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText: "export const broken = {",
        target: constantTarget,
      }),
    ).rejects.toMatchObject({ code: "parse-error" });
    await expect(
      createSourceAnchorForTarget({
        componentIdentity: null,
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: value("Dynamic"),
        relativePath: "dynamic.tsx",
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText:
          "export const Prompt = () => <Button label={copy} />;",
        target: {
          attributeName: "label",
          elementName: "Button",
          kind: "jsx-attribute",
        },
      }),
    ).rejects.toBeInstanceOf(DeterministicSourceCompilerError);
  });

  it("supports expression-wrapped JSX strings, booleans, signed numbers, and bracket token paths", async () => {
    const expressionSource = `export const FLAGS = {
  active: true,
  offset: -12,
};
export const GAP = SPACING["2xl"];
export const Prompt = () => <Button label={"Old"} />;
`;
    const labelTarget = {
      attributeName: "label",
      elementName: "Button",
      kind: "jsx-attribute",
    } as const;
    const labelAnchor = await anchor(
      labelTarget,
      value("Old"),
      expressionSource,
    );
    const labelResult = await compileSourceEdit({
      anchor: labelAnchor,
      edit: {
        after: value("New"),
        before: value("Old"),
        target: labelTarget,
      },
      sourceText: expressionSource,
    });
    expect(labelResult.afterText).toContain('label={"New"}');

    const activeTarget = {
      declarationName: "FLAGS",
      kind: "object-property",
      propertyPath: ["active"],
    } as const;
    const activeAnchor = await anchor(
      activeTarget,
      value(true),
      expressionSource,
    );
    const active = await compileSourceEdit({
      anchor: activeAnchor,
      edit: {
        after: value(false),
        before: value(true),
        target: activeTarget,
      },
      sourceText: expressionSource,
    });
    expect(active.afterText).toContain("active: false");

    const offsetTarget = {
      declarationName: "FLAGS",
      kind: "object-property",
      propertyPath: ["offset"],
    } as const;
    const offsetAnchor = await anchor(
      offsetTarget,
      value(-12),
      expressionSource,
    );
    const offset = await compileSourceEdit({
      anchor: offsetAnchor,
      edit: {
        after: value(8),
        before: value(-12),
        target: offsetTarget,
      },
      sourceText: expressionSource,
    });
    expect(offset.afterText).toContain("offset: 8");

    const gapTarget = {
      declarationName: "GAP",
      kind: "constant",
    } as const;
    const gapAnchor = await anchor(
      gapTarget,
      {
        kind: "token-reference",
        path: ["SPACING", "2xl"],
      },
      expressionSource,
    );
    const gap = await compileSourceEdit({
      anchor: gapAnchor,
      edit: {
        after: {
          kind: "token-reference",
          path: ["SPACING", "3xl"],
        },
        before: {
          kind: "token-reference",
          path: ["SPACING", "2xl"],
        },
        target: gapTarget,
      },
      sourceText: expressionSource,
    });
    expect(gap.afterText).toContain('GAP = SPACING["3xl"]');
  });

  it("supports nested and computed static object keys", async () => {
    const sourceText = `export const TOKENS = {
  ["space"]: {
    "large": 12,
  },
} as const;
`;
    const target = {
      declarationName: "TOKENS",
      kind: "object-property",
      propertyPath: ["space", "large"],
    } as const;
    const sourceAnchor = await anchor(target, value(12), sourceText);
    const result = await compileSourceEdit({
      anchor: sourceAnchor,
      edit: {
        after: value(16),
        before: value(12),
        target,
      },
      sourceText,
    });
    expect(result.afterText).toContain('"large": 16');
  });

  it("rejects invalid target boundaries and unsupported static structures", async () => {
    const cases: readonly SourceTarget[] = [
      {
        attributeName: "label",
        elementName: "Button;evil",
        kind: "jsx-attribute",
      },
      {
        declarationName: "SPACING",
        kind: "object-property",
        propertyPath: [],
      },
      {
        declarationName: "SPACING",
        kind: "object-property",
        propertyPath: ["\u0000"],
      },
      {
        declarationName: "SPACING",
        kind: "object-property",
        propertyPath: Array.from({ length: 17 }, () => "nested"),
      },
    ];
    for (const target of cases) {
      await expect(
        anchor(target, value(12)),
      ).rejects.toMatchObject({ code: "invalid-input" });
    }

    await expect(
      anchor(
        {
          declarationName: "MISSING",
          kind: "constant",
        },
        value(12),
      ),
    ).rejects.toMatchObject({ code: "target-not-found" });
    await expect(
      anchor(
        {
          declarationName: "SPACING",
          kind: "object-property",
          propertyPath: ["lg"],
        },
        value(99),
      ),
    ).rejects.toMatchObject({ code: "stale-value" });
    await expect(
      anchor(
        {
          declarationName: "styles",
          kind: "style-property",
          propertyPath: ["missing"],
        },
        value(12),
      ),
    ).rejects.toMatchObject({ code: "target-not-found" });
  });

  it("rejects unsafe bounded values and malformed V2 anchors", async () => {
    const target = {
      declarationName: "BUTTON_RADIUS_MD",
      kind: "constant",
    } as const;
    const sourceAnchor = await anchor(target, value(12));
    const invalidValues: readonly SourceStaticValue[] = [
      { kind: "string", value: "\u0000" },
      { kind: "string", value: "x".repeat(16_385) },
      { kind: "number", value: Number.POSITIVE_INFINITY },
      { kind: "number", value: 1_000_000_001 },
      { kind: "token-reference", path: [] },
      {
        kind: "token-reference",
        path: Array.from({ length: 17 }, () => "TOKEN"),
      },
      { kind: "token-reference", path: ["not valid"] },
    ];
    for (const after of invalidValues) {
      await expect(
        compileSourceEdit({
          anchor: sourceAnchor,
          edit: {
            after,
            before: value(12),
            target,
          },
          sourceText: SOURCE,
        }),
      ).rejects.toMatchObject({ code: "invalid-input" });
    }

    await expect(
      compileSourceEdit({
        anchor: {
          ...sourceAnchor,
          path: "../escape.tsx" as typeof sourceAnchor.path,
        },
        edit: {
          after: value(14),
          before: value(12),
          target,
        },
        sourceText: SOURCE,
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      createSourceAnchorForTarget({
        componentIdentity: null,
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: value(12),
        relativePath: "../escape.ts",
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText: "export const SIZE = 12;",
        target: {
          declarationName: "SIZE",
          kind: "constant",
        },
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      hashSourceText(`// ${"x".repeat(MAX_SOURCE_TEXT_BYTES)}`),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      hashSourceText("export const BAD = '\u0000';"),
    ).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("parses supported JavaScript and JSX source extensions", async () => {
    const target = {
      declarationName: "SIZE",
      kind: "constant",
    } as const;
    for (const relativePath of ["tokens.ts", "tokens.js", "tokens.jsx"]) {
      const sourceAnchor = await createSourceAnchorForTarget({
        componentIdentity: null,
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: value(12),
        relativePath,
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText: "export const SIZE = 12;",
        target,
      });
      expect(sourceAnchor.range.end).toBeGreaterThan(
        sourceAnchor.range.start,
      );
    }
  });
});
