import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";
const useExistingServer =
  process.env.MEMI_E2E_USE_EXISTING_SERVER === "1";
const useHelium = process.env.MEMI_E2E_HELIUM === "1";
const heliumExecutable = "/Applications/Helium.app/Contents/MacOS/Helium";

if (useHelium) {
  // Helium's macOS lifecycle exits after the last BrowserContext closes.
  // Playwright's built-in reuse mode resets one worker context between tests
  // instead, avoiding both the lifecycle race and a Chrome fallback.
  process.env.PW_TEST_REUSE_CONTEXT = "1";
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL,
    ...(useHelium
      ? {
          headless: false,
          launchOptions: { executablePath: heliumExecutable },
        }
      : {}),
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "tablet",
      use: {
        browserName: "chromium",
        viewport: { width: 834, height: 1_112 },
      },
    },
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: useExistingServer
    ? undefined
    : {
        command:
          "npm run e2e:prepare && VITE_MEMI_E2E_DEMO_RUNTIME=1 npm run build:e2e && npm run e2e:stage && npx vite preview --outDir ../../dist/e2e-web --host 127.0.0.1 --port 4173",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
