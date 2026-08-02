import {
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  composeExecutedImportDocumentation,
  executeApprovedImportBatch,
} from "@memi/import-runtime";
import {
  serializeWorkspaceDocumentation,
} from "@memi/workspace-documentation/projector";

import {
  approvedBatch,
  cleanupFixture,
  productPlan,
  runtimeFixture,
  type RuntimeFixture,
} from "../../packages/import-runtime/test-support.js";

const EVIDENCE_DIRECTORY = "dist/test-evidence/web-e2e";
const ARTIFACT_PATH = join(
  EVIDENCE_DIRECTORY,
  "workspace-documentation.json",
);
const ARTIFACT_TEMPORARY_PATH =
  `${ARTIFACT_PATH}.${process.pid}.tmp`;
const EXPECTED_COUNTS = Object.freeze({
  screens: 18,
  committed: 18,
  inferred: 18,
  verified: 0,
  flows: 1,
  tokens: 6,
  traceEvents: 18,
});
const EXPECTED_SCREEN_IDENTITIES = Object.freeze([
  "Home|/|default|desktop",
  "Home|/|default|mobile",
  "Home|/|default|tablet",
  "Home|/|loading|desktop",
  "Home|/|loading|mobile",
  "Home|/|loading|tablet",
  "Projects|/projects|default|desktop",
  "Projects|/projects|default|mobile",
  "Projects|/projects|default|tablet",
  "Projects|/projects|empty|desktop",
  "Projects|/projects|empty|mobile",
  "Projects|/projects|empty|tablet",
  "Projects|/projects|error|desktop",
  "Projects|/projects|error|mobile",
  "Projects|/projects|error|tablet",
  "Settings|/settings|default|desktop",
  "Settings|/settings|default|mobile",
  "Settings|/settings|default|tablet",
]);
const EXPECTED_TOKEN_IDENTIFIERS = Object.freeze([
  "color.canvas|--color-canvas",
  "color.foreground|--color-foreground",
  "color.surface|--color-surface",
  "font.body|--font-body",
  "radius.control|--radius-control",
  "space.panel|--space-panel",
]);

function assertGenerationContract(
  documentation: ReturnType<typeof composeExecutedImportDocumentation>,
): void {
  const counts = {
    screens: documentation.screens.length,
    committed: documentation.coverage.materialization.committed,
    inferred: documentation.coverage.captures.inferred,
    verified: documentation.coverage.captures.observed,
    flows: documentation.coverage.flows.declared,
    tokens: documentation.coverage.tokens.declared,
    traceEvents: documentation.trace.refs.length,
  };
  if (JSON.stringify(counts) !== JSON.stringify(EXPECTED_COUNTS)) {
    throw new Error(
      `Generated browser fixture violated the E2E truth contract: ${JSON.stringify(counts)}.`,
    );
  }
  if (
    documentation.screens.some(
      (screen) =>
        screen.materialization.status !== "committed" ||
        screen.capture.status !== "inferred",
    )
  ) {
    throw new Error(
      "Generated browser fixture must contain only committed canvas cells with inferred captures.",
    );
  }
  const screenIdentities = documentation.screens
    .map(
      (screen) =>
        `${screen.route.displayName}|${screen.route.path}|${screen.state.name}|${screen.viewport.name}`,
    )
    .sort();
  const tokenIdentifiers = documentation.designSystem.tokens
    .map((token) => `${token.name}|${token.cssVariable}`)
    .sort();
  const flow = documentation.flows[0];
  if (
    JSON.stringify(screenIdentities) !==
      JSON.stringify(EXPECTED_SCREEN_IDENTITIES) ||
    JSON.stringify(tokenIdentifiers) !==
      JSON.stringify(EXPECTED_TOKEN_IDENTIFIERS) ||
    flow?.name !== "Primary navigation" ||
    JSON.stringify(
      flow.steps.map((step) => `${step.trigger}|${step.assertion}`),
    ) !==
      JSON.stringify([
        "flow-start|home-screen-visible",
        "open-projects|projects-screen-visible",
        "open-settings|settings-screen-visible",
      ])
  ) {
    throw new Error(
      "Generated browser fixture does not preserve the exact deterministic product semantics.",
    );
  }
}

async function generate(): Promise<void> {
  const { workspace, plan } = await productPlan();
  let fixture: RuntimeFixture | undefined;
  try {
    fixture = await runtimeFixture(plan);
    const batch = await approvedBatch(fixture, workspace, plan);
    const execution = await executeApprovedImportBatch(
      fixture.runtime,
      workspace,
      plan,
      batch,
    );
    if (
      execution.committedCount !== EXPECTED_COUNTS.committed ||
      execution.totalCount !== EXPECTED_COUNTS.screens
    ) {
      throw new Error("Import runtime did not commit the exact E2E batch.");
    }
    const documentation = composeExecutedImportDocumentation(
      fixture.runtime,
      workspace,
      plan,
    );
    assertGenerationContract(documentation);

    const serialized = serializeWorkspaceDocumentation(documentation);
    await rm(EVIDENCE_DIRECTORY, { force: true, recursive: true });
    await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
    await rm(ARTIFACT_TEMPORARY_PATH, { force: true });
    await writeFile(ARTIFACT_TEMPORARY_PATH, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(ARTIFACT_TEMPORARY_PATH, ARTIFACT_PATH);
    process.stdout.write(
      `Prepared ${documentation.screens.length} canonical workspace screens from ${execution.committedCount} committed runtime events.\n`,
    );
  } finally {
    if (fixture !== undefined) {
      await cleanupFixture(fixture);
    }
  }
}

await generate();
