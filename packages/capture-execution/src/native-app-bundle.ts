import {
  lstat,
  realpath,
} from "node:fs/promises";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { CaptureExecutionError } from "./executor.js";
import {
  readRegularFileNoFollow,
  stageNativeBundle,
} from "./native-bundle-staging.js";

export interface NativeBuildConfiguration {
  readonly container: Readonly<{
    kind: "project" | "workspace";
    path: string;
  }>;
  readonly scheme: string;
  readonly configuration: "Debug" | "Release";
  readonly derivedDataPath: string;
  readonly expectedBundleId: string | null;
  /**
   * The simulator slice used for a local capture build. The initial native
   * capture target is Apple Silicon; keeping this in the build configuration
   * makes the executed Xcode recipe auditable instead of relying on host
   * defaults for a generic simulator destination.
   */
  readonly simulatorArchitecture?: "arm64";
}

export interface ResolvedBuiltApplication {
  readonly appBundlePath: string;
  readonly bundleId: string;
}

export interface ResolveBuiltApplicationInput {
  readonly managedWorktreeRoot: string;
  readonly stagingRoot: string;
  readonly nativeBuild: NativeBuildConfiguration;
  readonly buildSettingsOutput: Uint8Array;
}

export type ResolveBuiltApplication = (
  input: ResolveBuiltApplicationInput,
) => Promise<ResolvedBuiltApplication>;

const REQUIRED_BUILD_SETTINGS = [
  "PRODUCT_BUNDLE_IDENTIFIER",
  "TARGET_BUILD_DIR",
  "FULL_PRODUCT_NAME",
] as const;
const MAXIMUM_PLIST_BYTES = 4 * 1_024 * 1_024;

function contained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" ||
    (fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(fromRoot));
}

function failure(code: string, message: string): CaptureExecutionError {
  return new CaptureExecutionError("build", code, false, message);
}

function buildSettingValues(
  output: Uint8Array,
  expectedBundleId: string | null,
): Readonly<Record<(typeof REQUIRED_BUILD_SETTINGS)[number], string>> {
  const blocks: Array<Map<string, string[]>> = [new Map()];
  for (const line of new TextDecoder().decode(output).split(/\r?\n/u)) {
    if (/^\s*Build settings for .* target .+:\s*$/u.test(line)) {
      if (blocks.at(-1)!.size > 0) {
        blocks.push(new Map());
      }
      continue;
    }
    const match =
      /^\s*(PRODUCT_BUNDLE_IDENTIFIER|TARGET_BUILD_DIR|FULL_PRODUCT_NAME)\s*=\s*(.*?)\s*$/u
        .exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      const block = blocks.at(-1)!;
      block.set(match[1], [...(block.get(match[1]) ?? []), match[2]]);
    }
  }
  const allValues = new Map<string, string[]>();
  for (const block of blocks) {
    for (const [key, values] of block) {
      allValues.set(key, [...(allValues.get(key) ?? []), ...values]);
    }
  }
  const missing = REQUIRED_BUILD_SETTINGS.filter(
    (key) => (allValues.get(key)?.length ?? 0) === 0,
  );
  if (missing.length > 0) {
    throw failure(
      "BUILD_SETTINGS_MISSING",
      `xcodebuild omitted required settings: ${missing.join(", ")}.`,
    );
  }
  const candidates = blocks.flatMap((block) => {
    const blockValues = Object.fromEntries(
      REQUIRED_BUILD_SETTINGS.map((key) => [key, block.get(key) ?? []]),
    ) as Record<(typeof REQUIRED_BUILD_SETTINGS)[number], string[]>;
    if (
      REQUIRED_BUILD_SETTINGS.some(
        (key) => blockValues[key].length !== 1,
      )
    ) {
      return [];
    }
    const candidate = Object.freeze(
      Object.fromEntries(
        REQUIRED_BUILD_SETTINGS.map((key) => [
          key,
          blockValues[key][0]!,
        ]),
      ),
    ) as Readonly<Record<
      (typeof REQUIRED_BUILD_SETTINGS)[number],
      string
    >>;
    return candidate.FULL_PRODUCT_NAME.endsWith(".app")
      ? [candidate]
      : [];
  });
  const distinctCandidates = [
    ...new Map(
      candidates.map((candidate) => [
        JSON.stringify(candidate),
        candidate,
      ]),
    ).values(),
  ];
  const matching = expectedBundleId === null
    ? distinctCandidates
    : distinctCandidates.filter(
      (candidate) =>
        candidate.PRODUCT_BUNDLE_IDENTIFIER === expectedBundleId,
    );
  const selected = matching.length === 1
    ? matching
    : matching.length === 0 && distinctCandidates.length === 1
    ? distinctCandidates
    : [];
  if (selected.length !== 1) {
    throw failure(
      "BUILD_SETTINGS_AMBIGUOUS",
      "xcodebuild did not identify exactly one application target.",
    );
  }
  return selected[0]!;
}

function unsigned(
  bytes: Uint8Array,
  offset: number,
  width: number,
): number {
  if (
    width < 1 ||
    width > 8 ||
    offset < 0 ||
    offset + width > bytes.byteLength
  ) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist is malformed.");
  }
  let value = 0;
  for (let index = 0; index < width; index += 1) {
    value = value * 256 + bytes[offset + index]!;
    if (!Number.isSafeInteger(value)) {
      throw failure("APP_INFO_PLIST_INVALID", "Info.plist is too large.");
    }
  }
  return value;
}

function objectLength(
  bytes: Uint8Array,
  offset: number,
): Readonly<{ length: number; payload: number }> {
  const marker = bytes[offset];
  if (marker === undefined) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist is malformed.");
  }
  const inline = marker & 0x0f;
  if (inline < 0x0f) {
    return { length: inline, payload: offset + 1 };
  }
  const integerMarker = bytes[offset + 1];
  if (
    integerMarker === undefined ||
    (integerMarker >> 4) !== 0x1
  ) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist length is invalid.");
  }
  const width = 2 ** (integerMarker & 0x0f);
  return {
    length: unsigned(bytes, offset + 2, width),
    payload: offset + 2 + width,
  };
}

function binaryBundleIdentifier(bytes: Uint8Array): string {
  if (
    bytes.byteLength < 40 ||
    new TextDecoder("ascii").decode(bytes.slice(0, 8)) !== "bplist00"
  ) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist is not a plist.");
  }
  const trailer = bytes.byteLength - 32;
  const offsetWidth = bytes[trailer + 6]!;
  const referenceWidth = bytes[trailer + 7]!;
  const objectCount = unsigned(bytes, trailer + 8, 8);
  const rootReference = unsigned(bytes, trailer + 16, 8);
  const offsetTable = unsigned(bytes, trailer + 24, 8);
  if (
    objectCount < 1 ||
    objectCount > 1_000_000 ||
    rootReference >= objectCount ||
    offsetTable + objectCount * offsetWidth > trailer
  ) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist table is invalid.");
  }
  const objectOffset = (reference: number): number => {
    if (reference < 0 || reference >= objectCount) {
      throw failure("APP_INFO_PLIST_INVALID", "Info.plist reference is invalid.");
    }
    const offset = unsigned(
      bytes,
      offsetTable + reference * offsetWidth,
      offsetWidth,
    );
    if (offset < 8 || offset >= offsetTable) {
      throw failure("APP_INFO_PLIST_INVALID", "Info.plist object escapes.");
    }
    return offset;
  };
  const stringAt = (reference: number): string => {
    const offset = objectOffset(reference);
    const marker = bytes[offset]!;
    const kind = marker >> 4;
    if (kind !== 0x5 && kind !== 0x6) {
      throw failure("APP_INFO_PLIST_INVALID", "Info.plist string is invalid.");
    }
    const { length, payload } = objectLength(bytes, offset);
    const width = kind === 0x5 ? 1 : 2;
    if (payload + length * width > offsetTable) {
      throw failure("APP_INFO_PLIST_INVALID", "Info.plist string escapes.");
    }
    if (kind === 0x5) {
      return new TextDecoder("ascii", { fatal: true }).decode(
        bytes.slice(payload, payload + length),
      );
    }
    let result = "";
    for (let index = 0; index < length; index += 1) {
      result += String.fromCharCode(
        unsigned(bytes, payload + index * 2, 2),
      );
    }
    return result;
  };
  const rootOffset = objectOffset(rootReference);
  if ((bytes[rootOffset]! >> 4) !== 0x0d) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist root is not a dictionary.");
  }
  const { length, payload } = objectLength(bytes, rootOffset);
  if (payload + length * referenceWidth * 2 > offsetTable) {
    throw failure("APP_INFO_PLIST_INVALID", "Info.plist dictionary escapes.");
  }
  for (let index = 0; index < length; index += 1) {
    const key = stringAt(unsigned(
      bytes,
      payload + index * referenceWidth,
      referenceWidth,
    ));
    if (key === "CFBundleIdentifier") {
      return stringAt(unsigned(
        bytes,
        payload + (length + index) * referenceWidth,
        referenceWidth,
      ));
    }
  }
  throw failure(
    "APP_INFO_PLIST_INVALID",
    "Info.plist omits CFBundleIdentifier.",
  );
}

function xmlBundleIdentifier(bytes: Uint8Array): string {
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const matches = [
    ...xml.matchAll(
      /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>([^<]+)<\/string>/gu,
    ),
  ];
  if (matches.length !== 1) {
    throw failure(
      "APP_INFO_PLIST_INVALID",
      "Info.plist must contain one CFBundleIdentifier.",
    );
  }
  return matches[0]![1]!
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

async function verifiedSourceBundle(
  appBundlePath: string,
  managedRoot: string,
  derivedDataRoot: string,
): Promise<Readonly<{ path: string; bundleId: string }>> {
  const metadata = await lstat(appBundlePath).catch(() => null);
  if (
    metadata === null ||
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    throw failure(
      "APP_BUNDLE_PATH_UNTRUSTED",
      "Resolved application bundle is not a real directory.",
    );
  }
  const [canonicalApp, canonicalManaged, canonicalDerived] =
    await Promise.all([
      realpath(appBundlePath),
      realpath(managedRoot),
      realpath(derivedDataRoot),
    ]).catch(() => {
      throw failure(
        "APP_BUNDLE_PATH_UNTRUSTED",
        "Resolved application bundle authority is unavailable.",
      );
    });
  if (
    !contained(canonicalManaged, canonicalApp) ||
    !contained(canonicalDerived, canonicalApp)
  ) {
    throw failure(
      "APP_BUNDLE_PATH_UNTRUSTED",
      "Resolved application bundle escaped canonical DerivedData.",
    );
  }
  const bytes = await readRegularFileNoFollow(
    join(canonicalApp, "Info.plist"),
    MAXIMUM_PLIST_BYTES,
  );
  return Object.freeze({
    path: canonicalApp,
    bundleId: bytes[0] === 0x62
      ? binaryBundleIdentifier(bytes)
      : xmlBundleIdentifier(bytes),
  });
}

export async function resolveBuiltApplication(
  input: ResolveBuiltApplicationInput,
): Promise<ResolvedBuiltApplication> {
  const source = await resolveSourceBuiltApplication(input);
  const staged = await stageNativeBundle(
    source.appBundlePath,
    input.stagingRoot,
  );
  const stagedBundleId = staged.infoPlistBytes[0] === 0x62
    ? binaryBundleIdentifier(staged.infoPlistBytes)
    : xmlBundleIdentifier(staged.infoPlistBytes);
  if (stagedBundleId !== source.bundleId) {
    throw failure(
      "APP_BUNDLE_IDENTIFIER_MISMATCH",
      "Staged Info.plist contradicts the verified build identity.",
    );
  }
  return Object.freeze({
    appBundlePath: staged.appBundlePath,
    bundleId: source.bundleId,
  });
}

async function resolveSourceBuiltApplication(
  input: ResolveBuiltApplicationInput,
): Promise<ResolvedBuiltApplication> {
  const settings = buildSettingValues(
    input.buildSettingsOutput,
    input.nativeBuild.expectedBundleId,
  );
  const bundleId = settings.PRODUCT_BUNDLE_IDENTIFIER;
  if (
    !/^(?=.{3,255}$)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(bundleId)
  ) {
    throw failure(
      "BUNDLE_IDENTIFIER_INVALID",
      "The resolved bundle identifier is invalid.",
    );
  }
  if (
    input.nativeBuild.expectedBundleId !== null &&
    bundleId !== input.nativeBuild.expectedBundleId
  ) {
    throw failure(
      "BUNDLE_IDENTIFIER_MISMATCH",
      "Resolved bundle identifier contradicts the imported application.",
    );
  }
  const productName = settings.FULL_PRODUCT_NAME;
  if (
    !/^[A-Za-z0-9._ -]{1,200}\.app$/u.test(productName) ||
    productName.includes("..")
  ) {
    throw failure(
      "APP_BUNDLE_NAME_INVALID",
      "FULL_PRODUCT_NAME is not a safe application bundle name.",
    );
  }
  const appBundlePath = resolve(settings.TARGET_BUILD_DIR, productName);
  if (
    !isAbsolute(settings.TARGET_BUILD_DIR) ||
    !contained(resolve(input.managedWorktreeRoot), appBundlePath) ||
    !contained(resolve(input.nativeBuild.derivedDataPath), appBundlePath)
  ) {
    throw failure(
      "APP_BUNDLE_PATH_ESCAPE",
      "Resolved application bundle is outside managed DerivedData.",
    );
  }
  const verified = await verifiedSourceBundle(
    appBundlePath,
    input.managedWorktreeRoot,
    input.nativeBuild.derivedDataPath,
  );
  if (verified.bundleId !== bundleId) {
    throw failure(
      "APP_BUNDLE_IDENTIFIER_MISMATCH",
      "Info.plist bundle identity contradicts xcodebuild settings.",
    );
  }
  return Object.freeze({
    appBundlePath: verified.path,
    bundleId,
  });
}

export async function resolveTrustedBuiltApplication(
  input: ResolveBuiltApplicationInput,
  resolver: ResolveBuiltApplication | undefined,
): Promise<ResolvedBuiltApplication> {
  if (resolver !== undefined) {
    const source = await resolveSourceBuiltApplication(input);
    const candidate = await resolver(input);
    if (
      candidate.appBundlePath !== source.appBundlePath ||
      candidate.bundleId !== source.bundleId
    ) {
      throw failure(
        "BUILD_RESOLVER_MISMATCH",
        "Native resolver output contradicts exact xcodebuild settings.",
      );
    }
  }
  return resolveBuiltApplication(input);
}
