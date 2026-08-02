import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileSourceEdit,
  createSourceAnchorForTarget,
  hashSourceText,
} from "./index.js";

const BUZZR_ROOT =
  process.env["MEMI_BUZZR_REPOSITORY_ROOT"] ?? "";
const BUZZR_AVAILABLE =
  BUZZR_ROOT.length > 0 &&
  existsSync(join(BUZZR_ROOT, "src/theme/layout.ts"));
const REVISION = "a6ce2458e0cd1b252663057f2e4060f0929c0687";
const DIRTY_FINGERPRINT = `sha256:${"d".repeat(64)}` as const;

describe.skipIf(!BUZZR_AVAILABLE)(
  "real Buzzr Expo source compiler integration",
  () => {
    it("compiles radius and spacing patches against the exact release source without writing it", async () => {
      const path = "src/theme/layout.ts";
      const sourceText = readFileSync(join(BUZZR_ROOT, path), "utf8");
      expect(await hashSourceText(sourceText)).toBe(
        "sha256:e6201d9584324bba6a8b59119c2bbf3af443c6da0e978e5ba889816bc72ca63e",
      );
      const radiusTarget = {
        declarationName: "BUTTON_RADIUS_MD",
        kind: "constant",
      } as const;
      const radiusAnchor = await createSourceAnchorForTarget({
        componentIdentity: "buzzr.button",
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: { kind: "number", value: 12 },
        relativePath: path,
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText,
        target: radiusTarget,
      });
      const radius = await compileSourceEdit({
        anchor: radiusAnchor,
        edit: {
          after: { kind: "number", value: 14 },
          before: { kind: "number", value: 12 },
          target: radiusTarget,
        },
        sourceText,
      });
      expect(radius.patch.replacements).toEqual([
        { after: "14", before: "12" },
      ]);

      const spacingTarget = {
        declarationName: "SPACING",
        kind: "object-property",
        propertyPath: ["lg"],
      } as const;
      const spacingAnchor = await createSourceAnchorForTarget({
        componentIdentity: "buzzr.tokens.spacing",
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: { kind: "number", value: 12 },
        relativePath: path,
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText,
        target: spacingTarget,
      });
      const spacing = await compileSourceEdit({
        anchor: spacingAnchor,
        edit: {
          after: { kind: "number", value: 14 },
          before: { kind: "number", value: 12 },
          target: spacingTarget,
        },
        sourceText,
      });
      expect(spacing.afterText).toContain("  lg: 14,");
      expect(readFileSync(join(BUZZR_ROOT, path), "utf8")).toBe(
        sourceText,
      );
    });

    it("compiles a real Buzzr Button label usage as one literal replacement", async () => {
      const path = "components/ui/NotifPermissionSheet.tsx";
      const sourceText = readFileSync(join(BUZZR_ROOT, path), "utf8");
      const target = {
        attributeName: "label",
        elementName: "Button",
        kind: "jsx-attribute",
      } as const;
      const anchor = await createSourceAnchorForTarget({
        componentIdentity: "buzzr.notification-permission.accept",
        dirtyFingerprint: DIRTY_FINGERPRINT,
        expectedValue: {
          kind: "string",
          value: "Turn on notifications",
        },
        relativePath: path,
        runtimeEvidenceRefs: [],
        sourceRevision: REVISION,
        sourceText,
        target,
      });
      const result = await compileSourceEdit({
        anchor,
        edit: {
          after: { kind: "string", value: "Enable alerts" },
          before: {
            kind: "string",
            value: "Turn on notifications",
          },
          target,
        },
        sourceText,
      });

      expect(result.patch.replacements).toEqual([
        {
          after: '"Enable alerts"',
          before: '"Turn on notifications"',
        },
      ]);
      expect(result.afterText).toContain('label="Enable alerts"');
      expect(readFileSync(join(BUZZR_ROOT, path), "utf8")).toBe(
        sourceText,
      );
    });
  },
);
