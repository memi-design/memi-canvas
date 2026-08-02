import { describe, expect, it } from "vitest";

import { estimateImportStorage } from "./runtime-storage-estimate.js";

const MIB = 1_024 * 1_024;
const GIB = 1_024 * MIB;

describe("runtime storage estimate", () => {
  it("reserves bounded native build, artifact, and dependency capacity", () => {
    expect(
      estimateImportStorage({ applicationCount: 1, scenarioCount: 10 }),
    ).toEqual({
      transientBytes: GIB,
      artifactBytes: 160 * MIB,
      sharedCacheBytes: 512 * MIB,
    });
    expect(
      estimateImportStorage({ applicationCount: 20, scenarioCount: 1_000 }),
    ).toEqual({
      transientBytes: 4 * GIB,
      artifactBytes: 2 * GIB,
      sharedCacheBytes: 2 * GIB,
    });
  });

  it("rejects impossible inventory counts", () => {
    expect(() =>
      estimateImportStorage({ applicationCount: 0, scenarioCount: 1 }),
    ).toThrow(/application count/iu);
    expect(() =>
      estimateImportStorage({ applicationCount: 1, scenarioCount: -1 }),
    ).toThrow(/scenario count/iu);
  });
});
