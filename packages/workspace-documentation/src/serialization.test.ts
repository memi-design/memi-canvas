import { canonicalJson } from "@memi/canonical-json";
import { describe, expect, it } from "vitest";

import {
  parseWorkspaceDocumentation,
  type WorkspaceDocumentation,
} from "./index.js";
import {
  projectWorkspaceDocumentation,
  serializeWorkspaceDocumentation,
} from "./projector.js";
import { committedInput, mutable } from "../test-support.js";

const MAX_SERIALIZED_BYTES = 1_048_576;

describe("bounded canonical workspace documentation serialization", () => {
  it("emits canonical JSON with exactly one trailing newline", async () => {
    const documentation = projectWorkspaceDocumentation(
      await committedInput(),
    );
    const serialized = serializeWorkspaceDocumentation(documentation);

    expect(serialized).toBe(`${canonicalJson(documentation)}\n`);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized.endsWith("\n\n")).toBe(false);
    expect(JSON.parse(serialized)).toEqual(documentation);
    expect(parseWorkspaceDocumentation(JSON.parse(serialized))).toEqual(
      documentation,
    );
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(
      MAX_SERIALIZED_BYTES,
    );
  });

  it("refuses output over the one MiB serialization boundary", async () => {
    const documentation = mutable(
      projectWorkspaceDocumentation(await committedInput()),
    ) as unknown as {
      project: {
        dimensions: {
          flags: string[];
        };
      };
    };
    documentation.project.dimensions.flags = Array.from(
      { length: 7_000 },
      (_value, index) =>
        `${String(index).padStart(8, "0")}-${"x".repeat(151)}`,
    );

    expect(() =>
      serializeWorkspaceDocumentation(
        documentation as unknown as WorkspaceDocumentation,
      ),
    ).toThrow(/1048576|1,048,576|one MiB/iu);
  });

  it("omits raw token values and rejects sensitive fields or strings", async () => {
    const input = await committedInput();
    const documentation = projectWorkspaceDocumentation(input);
    const serialized = serializeWorkspaceDocumentation(documentation);

    for (const token of input.workspace.designTokens) {
      expect(serialized).not.toContain(token.value);
      expect(serialized).not.toContain(
        `${token.cssVariable}:${token.value}`,
      );
    }
    expect(serialized).not.toMatch(
      /(?:\/Users\/|\/Volumes\/|file:\/\/|BEGIN [A-Z ]*PRIVATE KEY|authorization|password|api[_-]?key|secret)/iu,
    );

    const injectedField = mutable(documentation) as unknown as Record<
      string,
      unknown
    >;
    injectedField["apiKey"] = `sk-${"a".repeat(48)}`;
    expect(() =>
      serializeWorkspaceDocumentation(
        injectedField as unknown as WorkspaceDocumentation,
      ),
    ).toThrow();

    const injectedSecret = mutable(documentation);
    (
      injectedSecret.flows[0] as unknown as { name: string }
    ).name = `sk-${"a".repeat(48)}`;
    expect(() =>
      serializeWorkspaceDocumentation(injectedSecret),
    ).toThrow(/redact|sensitive|secret/iu);

    const injectedHostPath = mutable(documentation);
    (
      injectedHostPath.abstentions[0] as unknown as { reason: string }
    ).reason = "/Users/example/private/project";
    expect(() =>
      serializeWorkspaceDocumentation(injectedHostPath),
    ).toThrow(/redact|sensitive|path/iu);
  });

  it("does not accept accessors, hidden fields, sparse arrays, or mutable aliases", async () => {
    const documentation = projectWorkspaceDocumentation(
      await committedInput(),
    );
    const accessor = Object.defineProperty(
      mutable(documentation),
      "coverage",
      {
        enumerable: true,
        get: () => documentation.coverage,
      },
    );
    const hidden = Object.defineProperty(
      mutable(documentation),
      "secret",
      {
        enumerable: false,
        value: "hidden",
      },
    );
    const sparse = mutable(documentation);
    delete (
      sparse.screens as unknown as Array<
        WorkspaceDocumentation["screens"][number] | undefined
      >
    )[0];

    for (const invalid of [accessor, hidden, sparse]) {
      expect(() =>
        serializeWorkspaceDocumentation(
          invalid as WorkspaceDocumentation,
        ),
      ).toThrow();
    }
  });
});
