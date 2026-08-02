import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  parseWorkspaceDocumentation,
} from "@memi/workspace-documentation";
import {
  serializeWorkspaceDocumentation,
} from "@memi/workspace-documentation/projector";

const SOURCE_PATH =
  "dist/test-evidence/web-e2e/workspace-documentation.json";
const SOURCE_BUILD_DIRECTORY = "dist/web";
const E2E_BUILD_DIRECTORY = "dist/e2e-web";
const TARGET_PATH = `${E2E_BUILD_DIRECTORY}/workspace-documentation.json`;
const TEMPORARY_PATH = `${TARGET_PATH}.${process.pid}.tmp`;

const source = await readFile(SOURCE_PATH, "utf8");
const documentation = parseWorkspaceDocumentation(JSON.parse(source));
const serialized = serializeWorkspaceDocumentation(documentation);

await rm(E2E_BUILD_DIRECTORY, { force: true, recursive: true });
await cp(SOURCE_BUILD_DIRECTORY, E2E_BUILD_DIRECTORY, {
  recursive: true,
});
await mkdir(dirname(TARGET_PATH), { recursive: true });
await rm(TEMPORARY_PATH, { force: true });
await writeFile(TEMPORARY_PATH, serialized, {
  encoding: "utf8",
  flag: "wx",
});
await rename(TEMPORARY_PATH, TARGET_PATH);
process.stdout.write(
  `Staged ${documentation.screens.length} validated workspace screens in the isolated E2E preview output.\n`,
);
