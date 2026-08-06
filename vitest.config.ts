import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    globals: true,
    maxWorkers: 3,
    restoreMocks: true,
    testTimeout: 10_000,
    projects: [
      {
        test: {
          name: "domain",
          environment: "node",
          globals: true,
          testTimeout: 10_000,
          include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: ["packages/canvas-document/src/v3-replay-property.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          environment: "jsdom",
          globals: true,
          testTimeout: 10_000,
          include: ["apps/**/*.test.{ts,tsx}"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "packages/*/src/**/*.ts",
        "apps/web/src/**/*.{ts,tsx}"
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.bun-test.ts",
        "packages/runtime/src/**/bun-*.ts",
        "**/main.tsx"
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
