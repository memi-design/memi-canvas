import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ASSET_ROOT = "dist/web/assets";
const FORBIDDEN_FIXTURE_MARKERS = [
  "Queued in Deterministic Demo",
  "zero-token-fixture",
  "demo-draft-",
] as const;

async function javascriptAssets(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && extname(entry.name) === ".js")
    .map((entry) => join(root, entry.name))
    .sort();
}

const assets = await javascriptAssets(ASSET_ROOT);
if (assets.length === 0) {
  throw new Error(`No production JavaScript assets were found in ${ASSET_ROOT}.`);
}

for (const asset of assets) {
  const source = await readFile(asset, "utf8");
  for (const marker of FORBIDDEN_FIXTURE_MARKERS) {
    if (source.includes(marker)) {
      throw new Error(
        `Production bundle ${asset} contains the test-only runtime marker ${JSON.stringify(marker)}.`,
      );
    }
  }
}

console.log(
  JSON.stringify({
    assetsChecked: assets.length,
    fixtureRuntimeExcluded: true,
  }),
);
