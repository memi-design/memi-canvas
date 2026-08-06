import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath = new URL(
  "../.github/workflows/macos-release.yml",
  import.meta.url,
);

describe("macOS release workflow contract", () => {
  it("keeps Apple credentials out of dependency and verification steps", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const npmCiIndex = workflow.indexOf("- run: npm ci");
    const verificationIndex = workflow.indexOf("npm run verify");
    const firstAppleSecretIndex = workflow.indexOf("secrets.APPLE_");

    expect(npmCiIndex).toBeGreaterThan(0);
    expect(verificationIndex).toBeGreaterThan(npmCiIndex);
    expect(firstAppleSecretIndex).toBeGreaterThan(verificationIndex);
    expect(workflow).not.toMatch(/    env:\n(?:      .*\n)*      APPLE_/u);
  });

  it("smokes the exact release app before packaging and upload", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const smokeIndex = workflow.indexOf("scripts/smoke-macos-app.ts");
    const packageIndex = workflow.indexOf("scripts/package-macos-release.ts");
    const uploadIndex = workflow.indexOf("gh release upload");

    expect(workflow).toContain(
      '--app "apps/macos/src-tauri/target/release/bundle/macos/Memi Canvas.app"',
    );
    expect(smokeIndex).toBeGreaterThan(0);
    expect(packageIndex).toBeGreaterThan(smokeIndex);
    expect(uploadIndex).toBeGreaterThan(packageIndex);
  });

  it("checks out a tag ref and passes immutable run provenance", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("ref: refs/tags/${{ env.RELEASE_TAG }}");
    expect(workflow).toContain('--source-sha "${GITHUB_SHA}"');
    expect(workflow).toContain('--repository "${GITHUB_REPOSITORY}"');
    expect(workflow).toContain('--workflow-ref "${GITHUB_WORKFLOW_REF}"');
    expect(workflow).toContain('--run-id "${GITHUB_RUN_ID}"');
    expect(workflow).toContain('--run-attempt "${GITHUB_RUN_ATTEMPT}"');
  });
});
