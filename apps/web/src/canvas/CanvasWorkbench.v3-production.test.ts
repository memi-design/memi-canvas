import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CanvasWorkbench } from "./CanvasWorkbench.js";
import { canvasWorkbenchFixture } from "./CanvasWorkbench.fixture.js";

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
  it("fails closed visibly when no durable V3 session is supplied", () => {
    render(createElement(CanvasWorkbench, { project: canvasWorkbenchFixture }));
    expect(screen.getByRole("alert").textContent).toBe(
      "Canvas V3 session is unavailable.",
    );
  });

  it("uses the V3 controller/history seam and excludes V2 scene authority from the shipped path", () => {
    expect(shippedWorkbenchSource).toContain("useWorkbenchV3SessionBridge");
    expect(shippedSessionSource).toContain("V3WorkbenchSessionController");
    expect(shippedWorkbenchSource).not.toContain("createWorkbenchHistoryActions");
    expect(shippedSessionSource).not.toContain(
      "createCanonicalWorkbenchAuthority",
    );
  });
});
