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
    const jobDefinition = workflow.slice(0, workflow.indexOf("    steps:"));

    expect(npmCiIndex).toBeGreaterThan(0);
    expect(verificationIndex).toBeGreaterThan(npmCiIndex);
    expect(firstAppleSecretIndex).toBeGreaterThan(verificationIndex);
    expect(jobDefinition).not.toContain("${{ secrets.");
  });

  it("smokes the extracted versioned app archive before upload", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const smokeIndex = workflow.indexOf("scripts/smoke-macos-app.ts");
    const packageIndex = workflow.indexOf("scripts/package-macos-release.ts");
    const uploadIndex = workflow.indexOf("gh release upload");

    expect(workflow).toContain("--bundles app dmg");
    expect(workflow).toContain(
      'Memi.Canvas-${RELEASE_VERSION}-arm64.app.zip',
    );
    expect(workflow).toContain('/usr/bin/ditto -x -k "${app_zip}" "${smoke_root}"');
    expect(workflow).toContain('--app "${smoke_root}/Memi Canvas.app"');
    expect(workflow).toContain(
      '/usr/bin/hdiutil attach -readonly -nobrowse',
    );
    expect(workflow).toContain('--app "${dmg_mount}/Memi Canvas.app"');
    expect(workflow.match(/scripts\/smoke-macos-app\.ts/gu)).toHaveLength(2);
    expect(smokeIndex).toBeGreaterThan(0);
    expect(packageIndex).toBeGreaterThan(0);
    expect(smokeIndex).toBeGreaterThan(packageIndex);
    expect(uploadIndex).toBeGreaterThan(smokeIndex);
  });

  it("checks out a tag ref and passes immutable run provenance", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("ref: refs/tags/${{ env.RELEASE_TAG }}");
    expect(workflow).toContain('--source-sha "${SOURCE_SHA}"');
    expect(workflow).toContain('--repository "${GITHUB_REPOSITORY}"');
    expect(workflow).toContain('--workflow-ref "${GITHUB_WORKFLOW_REF}"');
    expect(workflow).toContain('--run-id "${GITHUB_RUN_ID}"');
    expect(workflow).toContain('--run-attempt "${GITHUB_RUN_ATTEMPT}"');
    expect(workflow).toContain('--server-url "${GITHUB_SERVER_URL}"');
    expect(workflow).toContain("package_args+=(--require-signed)");
    expect(workflow).toContain(
      'npm exec vite-node -- --script "${package_args[@]}"',
    );
  });
});
