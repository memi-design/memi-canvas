import { describe, expect, it } from "vitest";

import {
  CapabilitySchema,
  ContentHashSchema,
  type Capability,
  type ContentHash,
} from "../src/index.js";
import { hash } from "./fixtures.js";

describe("public inferred protocol types", () => {
  it("exports schema-derived capability and content hash types", () => {
    const capability: Capability = CapabilitySchema.parse("process:start");
    const contentHash: ContentHash = ContentHashSchema.parse(hash);

    expect(capability).toBe("process:start");
    expect(contentHash).toBe(hash);
  });
});
