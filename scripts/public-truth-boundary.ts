import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

export interface PublicTruthFinding {
  readonly code:
    | "brand-manifest-divergence"
    | "brand-manifest-copy-drift"
    | "legacy-brand-name"
    | "missing-development-status"
    | "stale-brand-asset"
    | "unexpected-brand-asset"
    | "unqualified-production-claim";
  readonly detail: string;
  readonly line?: number;
  readonly path: string;
}

export interface CanvasBrandTruth {
  readonly iconSha256: string;
  readonly iconSourceUrl: string;
  readonly identity: string;
  readonly license: string;
  readonly repository: string;
  readonly status: string;
}

type CanvasBrandTruthField = keyof CanvasBrandTruth;

const BRAND_MANIFEST_PATH = "brand/brand-manifest.v1.json";
const BRAND_SCHEMA_PATH = "brand/brand-manifest.v1.schema.json";
const CANONICAL_BRAND_FILE_HASHES = Object.freeze({
  [BRAND_MANIFEST_PATH]:
    "8b7ca68e836ee0362fe1763b067dacb8e500d5037cd12791f6c5aaf0e80a2755",
  [BRAND_SCHEMA_PATH]:
    "ef3eaed367e20c3d54ef8284d84c8195d40fb5916fcd525fcd77243a0353e473",
});
const CANVAS_BRAND_FIELDS = Object.freeze([
  "identity",
  "status",
  "license",
  "repository",
  "iconSha256",
  "iconSourceUrl",
] satisfies readonly CanvasBrandTruthField[]);
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

export function findCanvasBrandDivergences(
  manifestTruth: CanvasBrandTruth,
  publicTruth: CanvasBrandTruth,
): readonly Readonly<PublicTruthFinding>[] {
  return Object.freeze(
    CANVAS_BRAND_FIELDS.flatMap((field) =>
      publicTruth[field] === manifestTruth[field]
        ? []
        : [
            finding({
              code: "brand-manifest-divergence",
              detail: `${field} diverges from the checked-in Canvas manifest: expected ${JSON.stringify(manifestTruth[field])}, received ${JSON.stringify(publicTruth[field])}.`,
              path: BRAND_MANIFEST_PATH,
            }),
          ],
    ),
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function requiredString(
  value: Readonly<Record<string, unknown>> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : undefined;
}

function parseCanvasBrandTruth(source: string): CanvasBrandTruth {
  const manifest = record(JSON.parse(source));
  if (
    manifest?.schemaVersion !== 1 ||
    manifest.brandRevision !== 3 ||
    !Array.isArray(manifest.products)
  ) {
    throw new Error("Expected canonical brand manifest v1 revision 3.");
  }
  const canvasProduct = manifest.products
    .map(record)
    .find((product) => product?.id === "canvas");
  const urls = record(canvasProduct?.urls);
  const license = record(canvasProduct?.license);
  const icons = Array.isArray(canvasProduct?.icons)
    ? canvasProduct.icons.map(record)
    : [];
  const appIcon = icons.find((icon) => icon?.purpose === "app");
  const values = Object.freeze({
    identity: requiredString(canvasProduct, "name"),
    status: requiredString(canvasProduct, "status"),
    license: requiredString(license, "spdx"),
    repository: requiredString(urls, "repository"),
    iconSha256: requiredString(appIcon, "sha256"),
    iconSourceUrl: requiredString(appIcon, "sourceUrl"),
  });
  const missingField = CANVAS_BRAND_FIELDS.find(
    (field) => values[field] === undefined,
  );
  if (missingField !== undefined) {
    throw new Error(`Canvas manifest field ${missingField} is missing.`);
  }
  if (!Array.isArray(canvasProduct?.packages) || canvasProduct.packages.length > 0) {
    throw new Error("Canvas packages must be explicitly empty at brand revision 3.");
  }
  return Object.freeze(values as CanvasBrandTruth);
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
  iconSha256: string,
): Promise<readonly Readonly<PublicTruthFinding>[]> {
  const expectedAssets = Object.freeze({
    ...EXPECTED_BRAND_ASSETS,
    "apps/macos/src-tauri/icons/icon.png": iconSha256,
    "apps/web/public/memi-canvas-icon.png": iconSha256,
  });
  const hashFindings = await Promise.all(
    Object.entries(expectedAssets).map(async ([path, expectedHash]) => {
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

interface BrandManifestInspection {
  readonly findings: readonly Readonly<PublicTruthFinding>[];
  readonly truth?: CanvasBrandTruth;
}

async function inspectBrandManifestCopy(
  root: string,
): Promise<Readonly<BrandManifestInspection>> {
  const contents = await Promise.all(
    Object.entries(CANONICAL_BRAND_FILE_HASHES).map(
      async ([path, expectedHash]) => {
        try {
          const content = await readFile(join(root, path));
          const actualHash = createHash("sha256").update(content).digest("hex");
          return Object.freeze({ actualHash, content, expectedHash, path });
        } catch (error) {
          return Object.freeze({ error, expectedHash, path });
        }
      },
    ),
  );
  const copyFindings = contents.flatMap((entry) => {
    if ("error" in entry) {
      return [
        finding({
          code: "brand-manifest-copy-drift",
          detail: `Canonical brand file is unreadable: ${String(entry.error)}.`,
          path: entry.path,
        }),
      ];
    }
    return entry.actualHash === entry.expectedHash
      ? []
      : [
          finding({
            code: "brand-manifest-copy-drift",
            detail: `Expected canonical SHA-256 ${entry.expectedHash}, received ${entry.actualHash}.`,
            path: entry.path,
          }),
        ];
  });
  const manifest = contents.find((entry) => entry.path === BRAND_MANIFEST_PATH);
  if (manifest === undefined || !("content" in manifest)) {
    return Object.freeze({ findings: Object.freeze(copyFindings) });
  }
  try {
    return Object.freeze({
      findings: Object.freeze(copyFindings),
      truth: parseCanvasBrandTruth(manifest.content.toString("utf8")),
    });
  } catch (error) {
    return Object.freeze({
      findings: Object.freeze([
        ...copyFindings,
        finding({
          code: "brand-manifest-copy-drift",
          detail: `Canvas brand manifest is invalid: ${String(error)}.`,
          path: BRAND_MANIFEST_PATH,
        }),
      ]),
    });
  }
}

function developmentStatusLabel(status: string): string {
  return status === "development" ? "In development" : status;
}

async function readPublicCanvasTruth(
  root: string,
): Promise<CanvasBrandTruth> {
  const [packageSource, tauriSource, programStatus, iconReadme, icon] =
    await Promise.all([
      readFile(join(root, "package.json"), "utf8"),
      readFile(join(root, "apps/macos/src-tauri/tauri.conf.json"), "utf8"),
      readFile(join(root, "docs/PROGRAM_STATUS.md"), "utf8"),
      readFile(join(root, "apps/macos/src-tauri/icons/README.md"), "utf8"),
      readFile(join(root, "apps/macos/src-tauri/icons/icon.png")),
    ]);
  const packageMetadata = record(JSON.parse(packageSource));
  const tauriMetadata = record(JSON.parse(tauriSource));
  const statusLabel = programStatus.match(/^Public status:\s*(.+)$/mu)?.[1];
  const iconSourceUrl = iconReadme.match(
    /^Canonical icon source URL:\s*<([^>]+)>$/mu,
  )?.[1];
  const normalizedStatus =
    statusLabel === "In development" ? "development" : statusLabel;
  const values = Object.freeze({
    identity: requiredString(tauriMetadata, "productName"),
    status: normalizedStatus,
    license: requiredString(packageMetadata, "license"),
    repository: requiredString(packageMetadata, "repository"),
    iconSha256: createHash("sha256").update(icon).digest("hex"),
    iconSourceUrl,
  });
  const missingField = CANVAS_BRAND_FIELDS.find(
    (field) => values[field] === undefined,
  );
  if (missingField !== undefined) {
    throw new Error(`Public Canvas field ${missingField} is missing.`);
  }
  return Object.freeze(values as CanvasBrandTruth);
}

function manifestSurfaceFindings(
  sources: readonly Readonly<{ path: string; source: string }>[],
  manifestTruth: CanvasBrandTruth,
): readonly Readonly<PublicTruthFinding>[] {
  const identityRequirements = Object.freeze([
    ["README.md", `# ${manifestTruth.identity}`],
    ["docs/PROGRAM_STATUS.md", `# ${manifestTruth.identity} Program Status`],
    [
      "apps/web/index.html",
      `content="${manifestTruth.identity} standalone product evidence workspace"`,
    ],
    ["apps/web/index.html", `<title>${manifestTruth.identity}</title>`],
    ["apps/web/src/home/ProjectHome.tsx", `<strong>${manifestTruth.identity}</strong>`],
    [
      "apps/web/src/home/ProjectHome.tsx",
      `aria-label="${manifestTruth.identity} development status"`,
    ],
    [
      "apps/macos/src-tauri/tauri.conf.json",
      `"productName": "${manifestTruth.identity}"`,
    ],
    [
      "apps/macos/src-tauri/tauri.conf.json",
      `"title": "${manifestTruth.identity}"`,
    ],
    ["apps/macos/src-tauri/icons/README.md", `# ${manifestTruth.identity} app icon`],
  ] as const);
  const identityFindings = identityRequirements.flatMap(([path, marker]) => {
    const source = sources.find((candidate) => candidate.path === path)?.source;
    return source?.includes(marker) === true
      ? []
      : [
          finding({
            code: "brand-manifest-divergence",
            detail: `identity diverges from the checked-in Canvas manifest; expected public marker ${JSON.stringify(marker)}.`,
            path,
          }),
        ];
  });
  const statusLabel = developmentStatusLabel(manifestTruth.status);
  const statusFindings = STATUS_SURFACES.flatMap((path) => {
    const surface = sources.find((candidate) => candidate.path === path);
    return surface?.source.includes(statusLabel) === true
      ? []
      : [
          finding({
            code: "missing-development-status",
            detail: `Public surface must state manifest status ${JSON.stringify(statusLabel)}.`,
            path,
          }),
        ];
  });
  const readme = sources.find(
    (candidate) => candidate.path === "README.md",
  )?.source;
  const repositoryFinding = readme?.includes(manifestTruth.repository) === true
    ? []
    : [
        finding({
          code: "brand-manifest-divergence",
          detail: `repository diverges from the checked-in Canvas manifest; README must include ${JSON.stringify(manifestTruth.repository)}.`,
          path: "README.md",
        }),
      ];
  const licenseFinding = readme?.includes(manifestTruth.license) === true
    ? []
    : [
        finding({
          code: "brand-manifest-divergence",
          detail: `license diverges from the checked-in Canvas manifest; README must include ${JSON.stringify(manifestTruth.license)}.`,
          path: "README.md",
        }),
      ];
  return Object.freeze([
    ...identityFindings,
    ...statusFindings,
    ...repositoryFinding,
    ...licenseFinding,
  ]);
}

export async function inspectPublicTruth(
  root: string,
): Promise<readonly Readonly<PublicTruthFinding>[]> {
  const [paths, manifestInspection] = await Promise.all([
    Promise.all(PUBLIC_TEXT_ROOTS.map((path) => textFiles(root, path))).then(
      (groups) => Object.freeze(groups.flat()),
    ),
    inspectBrandManifestCopy(root),
  ]);
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
  if (manifestInspection.truth === undefined) {
    return Object.freeze([
      ...textFindings,
      ...manifestInspection.findings,
    ]);
  }
  let publicTruthFindings: readonly Readonly<PublicTruthFinding>[];
  try {
    const publicTruth = await readPublicCanvasTruth(root);
    publicTruthFindings = findCanvasBrandDivergences(
      manifestInspection.truth,
      publicTruth,
    );
  } catch (error) {
    publicTruthFindings = Object.freeze([
      finding({
        code: "brand-manifest-divergence",
        detail: `Could not derive public Canvas identity: ${String(error)}.`,
        path: BRAND_MANIFEST_PATH,
      }),
    ]);
  }
  return Object.freeze([
    ...textFindings,
    ...manifestInspection.findings,
    ...publicTruthFindings,
    ...manifestSurfaceFindings(sources, manifestInspection.truth),
    ...(await brandAssetFindings(root, manifestInspection.truth.iconSha256)),
  ]);
}
