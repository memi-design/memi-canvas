import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface PublicTruthFinding {
  readonly code:
    | "legacy-brand-name"
    | "missing-development-status"
    | "stale-brand-asset"
    | "unexpected-brand-asset"
    | "unqualified-production-claim";
  readonly detail: string;
  readonly line?: number;
  readonly path: string;
}

const DEVELOPMENT_STATUS = "In development";
const LEGACY_BRAND_NAME = ["Memi", "Studio"].join(" ");
const TEXT_EXTENSIONS = Object.freeze(
  new Set([".css", ".html", ".json", ".md", ".ts", ".tsx"]),
);
const PUBLIC_TEXT_ROOTS = Object.freeze([
  "README.md",
  "docs",
  "apps/web/index.html",
  "apps/web/src",
  "apps/macos/src-tauri/icons/README.md",
  "apps/macos/src-tauri/tauri.conf.json",
]);
const STATUS_SURFACES = Object.freeze([
  "README.md",
  "docs/PROGRAM_STATUS.md",
  "apps/web/src/home/ProjectHome.tsx",
]);
const STALE_BRAND_ASSET = "apps/macos/src-tauri/icons/icon.svg";
const EXPECTED_BRAND_ASSETS = Object.freeze({
  "apps/macos/src-tauri/icons/icon.icns":
    "1b333332d703bde26663f1740340d915b7fc1f943a4a07ff89dbb66130df6195",
  "apps/macos/src-tauri/icons/icon.png":
    "da068f20ba9e0e43f59ebde8602b43342f8c77fef2c080155a18d5a8fd0e25c2",
  "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/Assets/00-oklch-ruby-field.png":
    "06d14fefc13d905fa733c9e9cdf877e8d23163ccb9657b6037db57337614f614",
  "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/Assets/10-frosted-white-heart.png":
    "10f323196305064ba66331026f237d9a40139f8b4b5bcbbd88ed35ca772e87ae",
  "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/Assets/11-white-heart-caustic.png":
    "bb63981b7b6b35829b44accfd932b42f3b1783addb12dfb45fa7593b268460aa",
  "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/Assets/20-liquid-glass-body.png":
    "0139be5f603158d1f3ee89d862d1b4b6768a1f77e22ade141ab1799d3bab78c4",
  "apps/macos/src-tauri/icons/source/MemiCanvas-Iteration-02.icon/icon.json":
    "d8604b6c10d80d1e70efad2f340d3848348d8bcd82cbcd158c36a6dd229ab0ec",
  "apps/web/public/memi-canvas-icon.png":
    "da068f20ba9e0e43f59ebde8602b43342f8c77fef2c080155a18d5a8fd0e25c2",
});
const PRODUCTION_CLAIM_PATTERNS = Object.freeze([
  /\bproduction\s+(?:repository\s+)?import(?:er|ing)?\b/giu,
  /\bproduction\s+source[- ]?(?:editor|editing|mutation)\b/giu,
  /\b(?:repository\s+)?source[- ]?(?:editing|mutation)[^.\n]{0,36}\b(?:in|for)\s+production\b/giu,
  /\b(?:mutates?|writes?|edits?)\s+(?:the\s+)?(?:repository\s+)?source[^.\n]{0,24}\bin\s+production\b/giu,
]);
const EXPLICIT_QUALIFIER =
  /\b(?:not|never|no|without|cannot|can't|does not|do not|isn't|aren't|disabled|unavailable|unsupported|incomplete|gated|veto|planned|pending|prototype|fixture|demo|development-only|in-development|not production-ready|out of scope|not complete|not claimed)\b/iu;

function finding(
  value: PublicTruthFinding,
): Readonly<PublicTruthFinding> {
  return Object.freeze(value);
}

function claimSentence(line: string, claimIndex: number): string {
  const beforeClaim = line.slice(0, claimIndex);
  const previousBoundary = Math.max(
    beforeClaim.lastIndexOf("."),
    beforeClaim.lastIndexOf("!"),
    beforeClaim.lastIndexOf("?"),
  );
  const afterClaim = line.slice(claimIndex);
  const nextBoundary = afterClaim.search(/[.!?](?:\s|$)/u);
  return line.slice(
    previousBoundary + 1,
    nextBoundary === -1 ? line.length : claimIndex + nextBoundary + 1,
  );
}

export function findUnqualifiedProductionClaims(
  source: string,
  path: string,
): readonly Readonly<PublicTruthFinding>[] {
  return Object.freeze(
    source.split(/\r?\n/u).flatMap((line, index) => {
      return PRODUCTION_CLAIM_PATTERNS.flatMap((pattern) =>
        Array.from(line.matchAll(pattern)).flatMap((match) =>
          EXPLICIT_QUALIFIER.test(claimSentence(line, match.index))
            ? []
            : [
                finding({
                  code: "unqualified-production-claim",
                  detail: `Qualify or remove public capability claim ${JSON.stringify(match[0])}.`,
                  line: index + 1,
                  path,
                }),
              ],
        ),
      );
    }),
  );
}

async function textFiles(root: string, path: string): Promise<readonly string[]> {
  const absolutePath = join(root, path);
  const metadata = await stat(absolutePath);
  if (metadata.isFile()) {
    return TEXT_EXTENSIONS.has(extname(path)) ? Object.freeze([path]) : [];
  }
  const entries = await readdir(absolutePath, { withFileTypes: true });
  const children = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => textFiles(root, join(path, entry.name))),
  );
  return Object.freeze(children.flat());
}

async function brandAssetFindings(
  root: string,
): Promise<readonly Readonly<PublicTruthFinding>[]> {
  const hashFindings = await Promise.all(
    Object.entries(EXPECTED_BRAND_ASSETS).map(async ([path, expectedHash]) => {
      try {
        const content = await readFile(join(root, path));
        const actualHash = createHash("sha256").update(content).digest("hex");
        return actualHash === expectedHash
          ? []
          : [
              finding({
                code: "unexpected-brand-asset",
                detail: `Expected SHA-256 ${expectedHash}, received ${actualHash}.`,
                path,
              }),
            ];
      } catch (error) {
        return [
          finding({
            code: "unexpected-brand-asset",
            detail: `Required brand asset is unreadable: ${String(error)}.`,
            path,
          }),
        ];
      }
    }),
  );
  const stalePath = join(root, STALE_BRAND_ASSET);
  const staleFinding = await stat(stalePath).then(
    () => [
      finding({
        code: "stale-brand-asset",
        detail: "Remove the unrelated black SVG; Icon Composer and raster exports are authoritative.",
        path: relative(root, stalePath),
      }),
    ],
    (error: unknown) =>
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? []
        : [
            finding({
              code: "unexpected-brand-asset",
              detail: `Could not verify stale SVG absence: ${String(error)}.`,
              path: STALE_BRAND_ASSET,
            }),
          ],
  );
  return Object.freeze([...hashFindings.flat(), ...staleFinding]);
}

export async function inspectPublicTruth(
  root: string,
): Promise<readonly Readonly<PublicTruthFinding>[]> {
  const paths = Object.freeze(
    (
      await Promise.all(PUBLIC_TEXT_ROOTS.map((path) => textFiles(root, path)))
    ).flat(),
  );
  const sources = await Promise.all(
    paths.map(async (path) =>
      Object.freeze({ path, source: await readFile(join(root, path), "utf8") }),
    ),
  );
  const textFindings = sources.flatMap(({ path, source }) => {
    const legacyFindings = source.split(/\r?\n/u).flatMap((line, index) =>
      line.includes(LEGACY_BRAND_NAME)
        ? [
            finding({
              code: "legacy-brand-name",
              detail: `Replace legacy public name ${JSON.stringify(LEGACY_BRAND_NAME)}.`,
              line: index + 1,
              path,
            }),
          ]
        : [],
    );
    return [...legacyFindings, ...findUnqualifiedProductionClaims(source, path)];
  });
  const statusFindings = STATUS_SURFACES.flatMap((path) => {
    const surface = sources.find((candidate) => candidate.path === path);
    return surface?.source.includes(DEVELOPMENT_STATUS) === true
      ? []
      : [
          finding({
            code: "missing-development-status",
            detail: `Public surface must state ${JSON.stringify(DEVELOPMENT_STATUS)}.`,
            path,
          }),
        ];
  });
  return Object.freeze([
    ...textFindings,
    ...statusFindings,
    ...(await brandAssetFindings(root)),
  ]);
}
