import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const workflowPath = new URL(
  "../.github/workflows/gate-c-release-evidence.yml",
  import.meta.url,
);
const gateAPath = new URL("../.github/workflows/gate-a.yml", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

describe("Gate C release evidence workflow", () => {
  it("is manual, protected, main-only, and isolated from normal PR CI", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const gateA = await readFile(gateAPath, "utf8");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s{2}(?:pull_request|push):/mu);
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("environment: gate-c-private-evidence");
    expect(workflow).toContain(
      "runs-on: [self-hosted, macOS, ARM64, memi-gate-c]",
    );
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(gateA).not.toContain("gate-c-release-evidence");
    expect(packageJson.scripts.verify).not.toContain(
      "verify:gate-c-release-evidence",
    );
  });

  it("uses protected configuration and uploads only a sanitized manifest", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain(
      "MEMI_BUZZR_REPOSITORY: ${{ vars.MEMI_BUZZR_REPOSITORY }}",
    );
    expect(workflow).toContain(
      "EXPECTED_SOURCE_REVISION: ${{ inputs.source_revision }}",
    );
    expect(workflow).toContain("::add-mask::${MEMI_BUZZR_REPOSITORY}");
    expect(workflow).toContain("npm run verify:gate-c-release-evidence");
    expect(workflow).toContain("evidence-manifest.json");
    expect(workflow).not.toMatch(/upload-artifact[\s\S]*(?:imports\.sqlite|capture-artifacts|reconstruction)/u);
  });
});
