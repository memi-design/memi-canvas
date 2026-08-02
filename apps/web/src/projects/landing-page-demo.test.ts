import { describe, expect, it } from "vitest";

import {
  createLandingPageDemoProject,
  isLandingPageDemo,
  LANDING_PAGE_DEMO_SOURCE_LABEL,
} from "./landing-page-demo.js";

const project = {
  archived: false,
  documentRef: "canvas:landing-demo",
  id: "landing-demo",
  kind: "design" as const,
  lastOpenedAt: "2026-07-30T20:00:00.000Z",
  name: "Landing page starter",
  source: { kind: "local" as const, label: LANDING_PAGE_DEMO_SOURCE_LABEL },
  updatedAt: "2026-07-30T20:00:00.000Z",
};

describe("landing page demo", () => {
  it("is an explicit local template with editable desktop, tablet, and mobile pages", () => {
    expect(isLandingPageDemo(project)).toBe(true);
    const document = createLandingPageDemoProject(project);

    const frames = document.document.nodes.filter(({ kind }) => kind === "Frame");
    expect(frames).toHaveLength(10);
    expect(frames.map(({ name }) => name)).toEqual(expect.arrayContaining([
      "Aster · Home · Desktop",
      "Aster · Home · Tablet",
      "Aster · Home · Mobile",
      "Aster · Pricing · Desktop",
      "Aster · Pricing · Tablet",
      "Aster · Pricing · Mobile",
      "Aster · Contact · Desktop",
      "Aster · Contact · Tablet",
      "Aster · Contact · Mobile",
    ]));
    expect(
      document.document.nodes.filter(
        ({ component }) => component?.classification === "master",
      ),
    ).toHaveLength(3);
    expect(
      document.document.nodes.filter(
        ({ kind, component }) =>
          kind === "ComponentInstance" && component?.classification === "instance",
      ),
    ).toHaveLength(15);
    expect(document.document.nodes.every(({ source }) => source === undefined)).toBe(true);
  });
});
