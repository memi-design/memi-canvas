import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["packages/canvas-document/src/v3-replay-property.test.ts"],
    testTimeout: 120_000,
    coverage: {
      enabled: false,
    },
  },
});
