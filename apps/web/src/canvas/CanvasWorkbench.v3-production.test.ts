import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const shippedWorkbenchSource = readFileSync(
  resolve(process.cwd(), "apps/web/src/canvas/CanvasWorkbench.tsx"),
  "utf8",
);
const shippedSessionSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/src/canvas/useCanvasWorkbenchSessionState.ts",
  ),
  "utf8",
);

describe("CanvasWorkbench V3 production authority boundary", () => {
  it("uses the V3 controller/history seam and excludes V2 scene authority from the shipped path", () => {
    expect(shippedWorkbenchSource).toContain("createV3WorkbenchHistoryActions");
    expect(shippedSessionSource).toContain("V3WorkbenchSessionController");
    expect(shippedWorkbenchSource).not.toContain("createWorkbenchHistoryActions");
    expect(shippedSessionSource).not.toContain(
      "createCanonicalWorkbenchAuthority",
    );
  });
});
