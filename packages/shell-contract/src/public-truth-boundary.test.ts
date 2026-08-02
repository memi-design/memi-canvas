import { describe, expect, it } from "vitest";

import {
  findUnqualifiedProductionClaims,
  inspectPublicTruth,
} from "../../../scripts/public-truth-boundary.js";

describe("Memi Canvas public truth boundary", () => {
  it("rejects unqualified production importer and source-editing claims", () => {
    const source = [
      "Memi Canvas is a production importer.",
      "Production source editing is available from the canvas.",
      "The editor mutates repository source in production.",
    ].join("\n");

    expect(findUnqualifiedProductionClaims(source, "public-copy.md")).toEqual([
      expect.objectContaining({
        code: "unqualified-production-claim",
        line: 1,
      }),
      expect.objectContaining({
        code: "unqualified-production-claim",
        line: 2,
      }),
      expect.objectContaining({
        code: "unqualified-production-claim",
        line: 3,
      }),
    ]);
  });

  it("accepts explicit development and no-go qualifications", () => {
    const source = [
      "Memi Canvas is not a production importer.",
      "Production source editing remains disabled while the security veto is active.",
      "Repository source mutation in production is planned, not available today.",
      "The importer is an in-development fixture, not production-ready.",
    ].join("\n");

    expect(findUnqualifiedProductionClaims(source, "public-copy.md")).toEqual(
      [],
    );
  });

  it("keeps the checked-in public brand and capability surfaces truthful", async () => {
    await expect(inspectPublicTruth(process.cwd())).resolves.toEqual([]);
  });
});
