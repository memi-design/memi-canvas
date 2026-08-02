import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { CaptureExecutionError } from "@memi/capture-execution/core";

const MAXIMUM_PBX_PROJECT_BYTES = 64 * 1_024 * 1_024;
const PROVENANCE_RELATIVE_PATH = join(
  ".memi",
  "capture",
  "native-dependency",
  "cocoapods-phase-normalization.json",
);
const HERMES_XCFRAMEWORK_PRESTAGE_RELATIVE_PATH = join(
  ".memi",
  "capture",
  "native-dependency",
  "hermes-xcframework-prestage.json",
);
const HERMES_XCFRAMEWORK_RELATIVE_SOURCE = join(
  "ios",
  "Pods",
  "hermes-engine",
  "destroot",
  "Library",
  "Frameworks",
  "universal",
  "hermes.xcframework",
  "ios-arm64_x86_64-simulator",
);
const MAXIMUM_HERMES_BINARY_BYTES = 64 * 1_024 * 1_024;

type PhaseStatus = "normalized" | "already-normalized" | "absent";

interface PhaseContract {
  readonly id: string;
  readonly name: string;
  readonly originalScript: string;
  readonly normalizedScript: string;
}

interface NamedPhase {
  readonly id: string;
  readonly name: string;
}

export interface ManagedExpoCocoaPodsNormalizationInput {
  readonly managedWorktreeRoot: string;
  readonly platformRoot: string;
  readonly repositoryRevision: string;
  readonly preparationFingerprint: `sha256:${string}`;
}

export interface ManagedExpoCocoaPodsPhaseResult {
  readonly id: string;
  readonly status: PhaseStatus;
}

export interface ManagedExpoCocoaPodsNormalizationV1 {
  readonly contract: "memi.expo-cocoapods-phase-normalization.v1";
  readonly sourceAuthority: "managed-cocoapods-generated-project";
  readonly projectRelativePath: string;
  readonly repositoryRevision: string;
  readonly preparationFingerprint: `sha256:${string}`;
  readonly beforeHash: `sha256:${string}`;
  readonly afterHash: `sha256:${string}`;
  readonly changed: boolean;
  readonly phases: readonly ManagedExpoCocoaPodsPhaseResult[];
  readonly hermesReleaseVersion: string | null;
}

export interface ManagedExpoHermesXCFrameworkPrestageInput
  extends ManagedExpoCocoaPodsNormalizationInput {
  readonly xcframeworksBuildDirectory: string;
}

export interface ManagedExpoHermesXCFrameworkPrestageV1 {
  readonly contract: "memi.expo-hermes-xcframework-prestage.v1";
  readonly sourceAuthority: "managed-cocoapods-generated-project";
  readonly repositoryRevision: string;
  readonly preparationFingerprint: `sha256:${string}`;
  readonly sourceRelativePath: string;
  readonly destinationRelativePath: string;
  readonly sourceHash: `sha256:${string}`;
  readonly destinationHash: `sha256:${string}`;
}

const PHASES: readonly PhaseContract[] = Object.freeze([
  Object.freeze({
    id: "expo-constants-app-config",
    name: "[CP-User] Generate app.config for prebuilt Constants.manifest",
    originalScript: String.raw`shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\"";`,
    normalizedScript: String.raw`shellScript = "bash -l -c \"\\\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\\\"\"";`,
  }),
  Object.freeze({
    id: "expo-updates-resources",
    name: "[CP-User] Generate updates resources for expo-updates",
    originalScript: String.raw`shellScript = "bash -l -c \"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh\"";`,
    normalizedScript: String.raw`shellScript = "bash -l -c \"\\\"$PODS_TARGET_SRCROOT/../scripts/create-updates-resources-ios.sh\\\"\"";`,
  }),
]);

const HERMES_PHASE: NamedPhase = Object.freeze({
  id: "hermes-engine-release-configuration",
  name: "[CP-User] [Hermes] Replace Hermes for the right configuration, if needed",
});

const HERMES_XCFRAMEWORK_COPY_PHASE: NamedPhase = Object.freeze({
  id: "hermes-engine-xcframework-copy",
  name: "[CP] Copy XCFrameworks",
});

const HERMES_XCFRAMEWORK_COPY_SCRIPT =
  String.raw`shellScript = "\"${"$"}{PODS_ROOT}/Target Support Files/hermes-engine/hermes-engine-xcframeworks.sh\"\n";`;

const HERMES_ORIGINAL_PREFIX = String.raw`shellScript = "        . \"$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh\"\n\n        CONFIG=\"Release\"\n        if echo $GCC_PREPROCESSOR_DEFINITIONS | grep -q \"DEBUG=1\"; then\n          CONFIG=\"Debug\"\n        fi\n\n        \"$NODE_BINARY\" \"$REACT_NATIVE_PATH/sdks/hermes-engine/utils/replace_hermes_version.js\" -c \"$CONFIG\" -r \"`;
const HERMES_ORIGINAL_SUFFIX = String.raw`\" -p \"$PODS_ROOT\"\n";`;
const HERMES_NORMALIZED_PREFIX = String.raw`shellScript = "        # Memi native capture: redirect Hermes phase output\n        MEMI_HERMES_LOG=\"$TEMP_DIR/memi-hermes-version.log\"\n        {\n          . \"$REACT_NATIVE_PATH/scripts/xcode/with-environment.sh\"\n\n          CONFIG=\"Release\"\n          if echo $GCC_PREPROCESSOR_DEFINITIONS | grep -q \"DEBUG=1\"; then\n            CONFIG=\"Debug\"\n          fi\n\n          \"$NODE_BINARY\" \"$REACT_NATIVE_PATH/sdks/hermes-engine/utils/replace_hermes_version.js\" -c \"$CONFIG\" -r \"`;
const HERMES_NORMALIZED_SUFFIX = String.raw`\" -p \"$PODS_ROOT\"\n        } > \"$MEMI_HERMES_LOG\" 2>&1\n        MEMI_HERMES_STATUS=$?\n        if [ \"$MEMI_HERMES_STATUS\" -ne 0 ]; then\n          printf \"Memi Hermes phase failed; see %s\\n\" \"$MEMI_HERMES_LOG\" >&2\n          exit \"$MEMI_HERMES_STATUS\"\n        fi\n";`;
const HERMES_PREPARED_PREFIX = String.raw`shellScript = "        # Memi native capture: Hermes release `;
const HERMES_PREPARED_SUFFIX = String.raw` was prepared before build\n        :\n";`;
const HERMES_VERSION = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/u;

function sha256(value: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contained(root: string, candidate: string): boolean {
  const relationship = relative(root, candidate);
  return relationship === "" || (
    relationship !== ".." &&
    !relationship.startsWith(`..${sep}`) &&
    !isAbsolute(relationship)
  );
}

function normalizationFailure(cause: unknown): CaptureExecutionError {
  return new CaptureExecutionError(
    "prepare-fixtures",
    "COCOAPODS_PHASE_NORMALIZATION_INVALID",
    false,
    cause,
  );
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function occurrenceCount(source: string, needle: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + needle.length;
  }
}

interface LocatedPbxObject {
  readonly markerIndex: number;
  readonly blockEnd: number;
  readonly block: string;
  readonly objectId: string;
  readonly objectStart: number;
  readonly objectEnd: number;
}

function locateObjectAtMarker(
  source: string,
  id: string,
  marker: string,
): Readonly<LocatedPbxObject> | null {
  const markerCount = occurrenceCount(source, marker);
  if (markerCount === 0) return null;
  if (markerCount !== 1) {
    throw new Error(`CocoaPods object ${id} is duplicated.`);
  }
  const markerIndex = source.indexOf(marker);
  const objectHeaders = [...source.slice(0, markerIndex).matchAll(
    /^\t\t([A-F0-9]+) \/\* .+ \*\/ = \{$/gmu,
  )];
  const objectHeader = objectHeaders.at(-1);
  if (objectHeader?.index === undefined) {
    throw new Error(`CocoaPods object ${id} has no bounded object header.`);
  }
  const objectStart = objectHeader.index;
  const objectId = objectHeader[1]!;
  const blockEnd = source.indexOf("\n\t\t};", markerIndex);
  if (blockEnd === -1) {
    throw new Error(`CocoaPods object ${id} has no bounded block.`);
  }
  return Object.freeze({
    markerIndex,
    blockEnd,
    block: source.slice(markerIndex, blockEnd),
    objectId,
    objectStart,
    objectEnd: blockEnd + "\n\t\t};".length,
  });
}

function locateNamedPhase(
  source: string,
  phase: NamedPhase,
): Readonly<LocatedPbxObject> | null {
  return locateObjectAtMarker(source, phase.id, `name = "${phase.name}";`);
}

function locateAggregateTarget(
  source: string,
  name: string,
): Readonly<LocatedPbxObject> | null {
  const sectionStart = source.indexOf("/* Begin PBXAggregateTarget section */");
  const sectionEnd = source.indexOf("/* End PBXAggregateTarget section */");
  if (sectionStart === -1 || sectionEnd === -1 || sectionEnd <= sectionStart) {
    throw new Error("CocoaPods aggregate target section is missing or malformed.");
  }
  const section = source.slice(sectionStart, sectionEnd);
  const candidates = [...section.matchAll(
    /^\t\t([A-F0-9]+) \/\* .+ \*\/ = \{\n([\s\S]*?)^\t\t\};$/gmu,
  )].map((match) => {
    const block = match[0]!;
    const blockStart = sectionStart + (match.index ?? 0);
    return Object.freeze({
      block,
      blockStart,
      objectId: match[1]!,
    });
  }).filter((candidate) => (
    occurrenceCount(candidate.block, "isa = PBXAggregateTarget;") === 1 &&
    occurrenceCount(candidate.block, `name = "${name}";`) === 1
  ));
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) {
    throw new Error(`CocoaPods aggregate target ${name} is ambiguous.`);
  }
  const candidate = candidates[0]!;
  const markerOffset = candidate.block.indexOf(`name = "${name}";`);
  const terminator = "\n\t\t};";
  return Object.freeze({
    markerIndex: candidate.blockStart + markerOffset,
    blockEnd: candidate.blockStart + candidate.block.length - terminator.length,
    block: candidate.block,
    objectId: candidate.objectId,
    objectStart: candidate.blockStart,
    objectEnd: candidate.blockStart + candidate.block.length,
  });
}

function hermesPhaseScript(
  block: string,
  prefix: string,
  suffix: string,
): string | null {
  const prefixCount = occurrenceCount(block, prefix);
  if (prefixCount === 0) return null;
  if (prefixCount !== 1) {
    throw new Error(`CocoaPods phase ${HERMES_PHASE.id} is ambiguous.`);
  }
  const start = block.indexOf(prefix);
  const versionStart = start + prefix.length;
  const suffixIndex = block.indexOf(suffix, versionStart);
  if (suffixIndex === -1) {
    throw new Error(`CocoaPods phase ${HERMES_PHASE.id} has an incomplete script.`);
  }
  const version = block.slice(versionStart, suffixIndex);
  if (!HERMES_VERSION.test(version)) {
    throw new Error(`CocoaPods phase ${HERMES_PHASE.id} has an invalid Hermes version.`);
  }
  return `${prefix}${version}${suffix}`;
}

function hermesReleaseVersion(
  script: string,
  prefix: string,
  suffix: string,
): string {
  return script.slice(prefix.length, script.length - suffix.length);
}

function normalizePhase(
  source: string,
  phase: PhaseContract,
): Readonly<{ source: string; result: ManagedExpoCocoaPodsPhaseResult }> {
  const located = locateNamedPhase(source, phase);
  if (located === null) {
    return Object.freeze({
      source,
      result: Object.freeze({ id: phase.id, status: "absent" }),
    });
  }
  const originalCount = occurrenceCount(located.block, phase.originalScript);
  const normalizedCount = occurrenceCount(located.block, phase.normalizedScript);
  if (originalCount === 1 && normalizedCount === 0) {
    const scriptIndex = source.indexOf(phase.originalScript, located.markerIndex);
    if (scriptIndex > located.blockEnd) {
      throw new Error(`CocoaPods phase ${phase.id} has no bounded script.`);
    }
    return Object.freeze({
      source: `${source.slice(0, scriptIndex)}${phase.normalizedScript}${source.slice(scriptIndex + phase.originalScript.length)}`,
      result: Object.freeze({ id: phase.id, status: "normalized" }),
    });
  }
  if (originalCount === 0 && normalizedCount === 1) {
    return Object.freeze({
      source,
      result: Object.freeze({
        id: phase.id,
        status: "already-normalized",
      }),
    });
  }
  throw new Error(`CocoaPods phase ${phase.id} does not match its exact contract.`);
}

function normalizeHermesPhase(
  source: string,
): Readonly<{
  source: string;
  result: ManagedExpoCocoaPodsPhaseResult;
  hermesReleaseVersion: string | null;
}> {
  const located = locateNamedPhase(source, HERMES_PHASE);
  if (located === null) {
    return Object.freeze({
      source,
      result: Object.freeze({ id: HERMES_PHASE.id, status: "absent" }),
      hermesReleaseVersion: null,
    });
  }
  const original = hermesPhaseScript(
    located.block,
    HERMES_ORIGINAL_PREFIX,
    HERMES_ORIGINAL_SUFFIX,
  );
  const normalized = hermesPhaseScript(
    located.block,
    HERMES_NORMALIZED_PREFIX,
    HERMES_NORMALIZED_SUFFIX,
  );
  const prepared = hermesPhaseScript(
    located.block,
    HERMES_PREPARED_PREFIX,
    HERMES_PREPARED_SUFFIX,
  );
  const candidates = [
    original === null
      ? null
      : Object.freeze({
          script: original,
          version: hermesReleaseVersion(
            original,
            HERMES_ORIGINAL_PREFIX,
            HERMES_ORIGINAL_SUFFIX,
          ),
        }),
    normalized === null
      ? null
      : Object.freeze({
          script: normalized,
          version: hermesReleaseVersion(
            normalized,
            HERMES_NORMALIZED_PREFIX,
            HERMES_NORMALIZED_SUFFIX,
          ),
        }),
    prepared === null
      ? null
      : Object.freeze({
          script: prepared,
          version: hermesReleaseVersion(
            prepared,
            HERMES_PREPARED_PREFIX,
            HERMES_PREPARED_SUFFIX,
          ),
        }),
  ].filter((candidate): candidate is Readonly<{ script: string; version: string }> =>
    candidate !== null,
  );
  if (candidates.length !== 1) {
    throw new Error(`CocoaPods phase ${HERMES_PHASE.id} does not match its exact contract.`);
  }
  const candidate = candidates[0]!;
  if (source.indexOf(candidate.script, located.markerIndex) > located.blockEnd) {
    throw new Error(`CocoaPods phase ${HERMES_PHASE.id} has no bounded script.`);
  }
  const reference = `\t\t\t\t${located.objectId} /* ${HERMES_PHASE.name} */,`;
  const object = source.slice(located.objectStart, located.objectEnd);
  if (
    occurrenceCount(source, reference) !== 1 ||
    occurrenceCount(source, object) !== 1
  ) {
    throw new Error(`CocoaPods phase ${HERMES_PHASE.id} has ambiguous references.`);
  }
  return Object.freeze({
    source: source
      .replace(`${reference}\n`, "")
      .replace(`${object}\n`, ""),
    result: Object.freeze({ id: HERMES_PHASE.id, status: "normalized" }),
    hermesReleaseVersion: candidate.version,
  });
}

function normalizeHermesXCFrameworkCopyPhase(
  source: string,
): Readonly<{
  source: string;
  result: ManagedExpoCocoaPodsPhaseResult;
}> {
  const located = locateObjectAtMarker(
    source,
    HERMES_XCFRAMEWORK_COPY_PHASE.id,
    HERMES_XCFRAMEWORK_COPY_SCRIPT,
  );
  if (located === null) {
    return Object.freeze({
      source,
      result: Object.freeze({
        id: HERMES_XCFRAMEWORK_COPY_PHASE.id,
        status: "absent",
      }),
    });
  }
  const object = source.slice(located.objectStart, located.objectEnd);
  if (
    !object.includes("isa = PBXShellScriptBuildPhase;") ||
    !object.includes(`name = "${HERMES_XCFRAMEWORK_COPY_PHASE.name}";`) ||
    occurrenceCount(object, HERMES_XCFRAMEWORK_COPY_SCRIPT) !== 1
  ) {
    throw new Error(
      `CocoaPods phase ${HERMES_XCFRAMEWORK_COPY_PHASE.id} does not match its exact contract.`,
    );
  }
  const target = locateAggregateTarget(source, "hermes-engine");
  if (target === null) {
    throw new Error(
      `CocoaPods phase ${HERMES_XCFRAMEWORK_COPY_PHASE.id} has no Hermes target.`,
    );
  }
  const reference = `\t\t\t\t${located.objectId} /* ${HERMES_XCFRAMEWORK_COPY_PHASE.name} */,`;
  const targetObject = source.slice(target.objectStart, target.objectEnd);
  if (
    occurrenceCount(source, reference) !== 1 ||
    occurrenceCount(targetObject, reference) !== 1 ||
    occurrenceCount(source, object) !== 1
  ) {
    throw new Error(
      `CocoaPods phase ${HERMES_XCFRAMEWORK_COPY_PHASE.id} has ambiguous references.`,
    );
  }
  return Object.freeze({
    source: source
      .replace(`${reference}\n`, "")
      .replace(`${object}\n`, ""),
    result: Object.freeze({
      id: HERMES_XCFRAMEWORK_COPY_PHASE.id,
      status: "normalized",
    }),
  });
}

async function atomicWrite(
  path: string,
  value: string,
  mode: number,
): Promise<void> {
  const temporaryPath = `${path}.memi-${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporaryPath, value, { flag: "wx", mode });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function canonicalRoots(
  input: ManagedExpoCocoaPodsNormalizationInput,
): Promise<Readonly<{ managedWorktreeRoot: string; platformRoot: string }>> {
  const [managedMetadata, platformMetadata] = await Promise.all([
    lstat(input.managedWorktreeRoot),
    lstat(input.platformRoot),
  ]);
  if (
    managedMetadata.isSymbolicLink() ||
    platformMetadata.isSymbolicLink() ||
    !managedMetadata.isDirectory() ||
    !platformMetadata.isDirectory()
  ) {
    throw new Error("CocoaPods normalization roots must be real directories.");
  }
  const [managedWorktreeRoot, platformRoot] = await Promise.all([
    realpath(input.managedWorktreeRoot),
    realpath(input.platformRoot),
  ]);
  if (!contained(managedWorktreeRoot, platformRoot)) {
    throw new Error("CocoaPods normalization escaped the managed worktree.");
  }
  return Object.freeze({ managedWorktreeRoot, platformRoot });
}

async function ensureRealDirectoryWithin(
  root: string,
  candidate: string,
): Promise<string> {
  const absoluteCandidate = await canonicalizeProspectivePath(candidate);
  if (!contained(root, absoluteCandidate)) {
    throw new Error("Generated native output escaped the managed worktree.");
  }
  const relationship = relative(root, absoluteCandidate);
  const parts = relationship === "" ? [] : relationship.split(sep);
  let cursor = root;
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") {
      throw new Error("Generated native output has an invalid path segment.");
    }
    cursor = join(cursor, part);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await mkdir(cursor, { mode: 0o700 });
      metadata = await lstat(cursor);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("Generated native output contains a symbolic or non-directory path.");
    }
  }
  const canonical = await realpath(absoluteCandidate);
  if (!contained(root, canonical)) {
    throw new Error("Generated native output escaped the managed worktree.");
  }
  return canonical;
}

async function canonicalizeProspectivePath(candidate: string): Promise<string> {
  let existing = resolve(candidate);
  const missingParts: string[] = [];
  while (true) {
    try {
      const metadata = await lstat(existing);
      if (!metadata.isDirectory()) {
        throw new Error("Generated native output ancestor is not a directory.");
      }
      return missingParts.reduce(
        (path, part) => join(path, part),
        await realpath(existing),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const parent = dirname(existing);
      if (parent === existing) {
        throw new Error("Generated native output has no existing directory ancestor.");
      }
      missingParts.unshift(basename(existing));
      existing = parent;
    }
  }
}

async function assertRegularFile(path: string, maximumBytes: number): Promise<void> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error("Managed Hermes XCFramework contains an invalid file.");
  }
}

async function assertNormalizedHermesXCFrameworkPrestage(
  roots: Readonly<{ managedWorktreeRoot: string; platformRoot: string }>,
  input: ManagedExpoHermesXCFrameworkPrestageInput,
): Promise<void> {
  const provenancePath = join(roots.platformRoot, PROVENANCE_RELATIVE_PATH);
  const metadata = await lstat(provenancePath);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > 256 * 1_024) {
    throw new Error("CocoaPods normalization provenance is invalid.");
  }
  const provenance = record(JSON.parse(await readFile(provenancePath, "utf8")));
  if (
    provenance?.contract !== "memi.expo-cocoapods-phase-normalization.v1" ||
    provenance.sourceAuthority !== "managed-cocoapods-generated-project" ||
    provenance.repositoryRevision !== input.repositoryRevision ||
    provenance.preparationFingerprint !== input.preparationFingerprint ||
    !Array.isArray(provenance.phases)
  ) {
    throw new Error("CocoaPods normalization provenance does not match this preparation.");
  }
  const matching = provenance.phases.filter((phase) => {
    const candidate = record(phase);
    return candidate?.id === HERMES_XCFRAMEWORK_COPY_PHASE.id;
  });
  if (
    matching.length !== 1 ||
    record(matching[0])?.status !== "normalized"
  ) {
    throw new Error("Hermes XCFramework phase was not normalized for pre-stage.");
  }
}

export async function prestageManagedExpoHermesXCFramework(
  input: ManagedExpoHermesXCFrameworkPrestageInput,
): Promise<ManagedExpoHermesXCFrameworkPrestageV1> {
  try {
    if (
      !/^[a-f0-9]{40}$/u.test(input.repositoryRevision) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.preparationFingerprint)
    ) {
      throw new Error("Hermes XCFramework pre-stage authority is invalid.");
    }
    const roots = await canonicalRoots(input);
    await assertNormalizedHermesXCFrameworkPrestage(roots, input);
    const sourceRoot = join(roots.platformRoot, HERMES_XCFRAMEWORK_RELATIVE_SOURCE);
    const sourceMetadata = await lstat(sourceRoot);
    const canonicalSourceRoot = await realpath(sourceRoot);
    if (
      sourceMetadata.isSymbolicLink() ||
      !sourceMetadata.isDirectory() ||
      !contained(roots.platformRoot, canonicalSourceRoot)
    ) {
      throw new Error("Managed Hermes XCFramework source is invalid.");
    }
    const sourceFramework = join(canonicalSourceRoot, "hermes.framework");
    const sourceBinary = join(sourceFramework, "hermes");
    // `install_xcframework` copies the selected slice payload into the build
    // directory, but the accompanying metadata belongs to the XCFramework
    // root rather than to that platform slice.
    const sourceInfoPlist = join(dirname(canonicalSourceRoot), "Info.plist");
    const sourceFrameworkMetadata = await lstat(sourceFramework);
    if (
      sourceFrameworkMetadata.isSymbolicLink() ||
      !sourceFrameworkMetadata.isDirectory()
    ) {
      throw new Error("Managed Hermes framework source is invalid.");
    }
    await Promise.all([
      assertRegularFile(sourceBinary, MAXIMUM_HERMES_BINARY_BYTES),
      assertRegularFile(sourceInfoPlist, 1 * 1_024 * 1_024),
    ]);
    const sourceHash = sha256(await readFile(sourceBinary));
    const xcframeworksBuildDirectory = await ensureRealDirectoryWithin(
      roots.platformRoot,
      input.xcframeworksBuildDirectory,
    );
    const destinationContainer = await ensureRealDirectoryWithin(
      roots.platformRoot,
      join(xcframeworksBuildDirectory, "hermes-engine"),
    );
    const destinationRoot = join(destinationContainer, "Pre-built");
    let destinationMetadata;
    try {
      destinationMetadata = await lstat(destinationRoot);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      destinationMetadata = null;
    }
    if (destinationMetadata === null) {
      await mkdir(destinationRoot, { mode: 0o700 });
      await Promise.all([
        cp(sourceFramework, join(destinationRoot, "hermes.framework"), {
          recursive: true,
          force: false,
          dereference: false,
          preserveTimestamps: true,
        }),
        cp(sourceInfoPlist, join(destinationRoot, "Info.plist"), {
          force: false,
          dereference: false,
          preserveTimestamps: true,
        }),
      ]);
    } else if (
      destinationMetadata.isSymbolicLink() ||
      !destinationMetadata.isDirectory()
    ) {
      throw new Error("Hermes XCFramework destination is not a real directory.");
    }
    const destinationBinary = join(destinationRoot, "hermes.framework", "hermes");
    await assertRegularFile(destinationBinary, MAXIMUM_HERMES_BINARY_BYTES);
    const destinationHash = sha256(await readFile(destinationBinary));
    if (destinationHash !== sourceHash) {
      throw new Error("Hermes XCFramework destination conflicts with verified source.");
    }
    const output: ManagedExpoHermesXCFrameworkPrestageV1 = Object.freeze({
      contract: "memi.expo-hermes-xcframework-prestage.v1",
      sourceAuthority: "managed-cocoapods-generated-project",
      repositoryRevision: input.repositoryRevision,
      preparationFingerprint: input.preparationFingerprint,
      sourceRelativePath: relative(roots.managedWorktreeRoot, canonicalSourceRoot),
      destinationRelativePath: relative(roots.managedWorktreeRoot, destinationRoot),
      sourceHash,
      destinationHash,
    });
    const prestageProvenancePath = join(
      roots.platformRoot,
      HERMES_XCFRAMEWORK_PRESTAGE_RELATIVE_PATH,
    );
    await ensureRealDirectoryWithin(
      roots.platformRoot,
      dirname(prestageProvenancePath),
    );
    await atomicWrite(
      prestageProvenancePath,
      `${JSON.stringify(output, null, 2)}\n`,
      0o600,
    );
    return output;
  } catch (error) {
    if (error instanceof CaptureExecutionError) throw error;
    throw normalizationFailure(error);
  }
}

export async function normalizeManagedExpoCocoaPodsPhases(
  input: ManagedExpoCocoaPodsNormalizationInput,
): Promise<ManagedExpoCocoaPodsNormalizationV1> {
  try {
    if (
      !/^[a-f0-9]{40}$/u.test(input.repositoryRevision) ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.preparationFingerprint)
    ) {
      throw new Error("CocoaPods normalization authority is invalid.");
    }
    const roots = await canonicalRoots(input);
    const projectPath = join(
      roots.platformRoot,
      "ios",
      "Pods",
      "Pods.xcodeproj",
      "project.pbxproj",
    );
    const projectMetadata = await lstat(projectPath);
    const canonicalProjectPath = await realpath(projectPath);
    if (
      projectMetadata.isSymbolicLink() ||
      !projectMetadata.isFile() ||
      projectMetadata.size < 1 ||
      projectMetadata.size > MAXIMUM_PBX_PROJECT_BYTES ||
      !contained(roots.platformRoot, canonicalProjectPath)
    ) {
      throw new Error("CocoaPods generated project is not a bounded regular file.");
    }
    const original = await readFile(canonicalProjectPath, "utf8");
    let normalized = original;
    const phaseResults: ManagedExpoCocoaPodsPhaseResult[] = [];
    for (const phase of PHASES) {
      const result = normalizePhase(normalized, phase);
      normalized = result.source;
      phaseResults.push(result.result);
    }
    const hermes = normalizeHermesPhase(normalized);
    normalized = hermes.source;
    phaseResults.push(hermes.result);
    const hermesXCFramework = normalizeHermesXCFrameworkCopyPhase(normalized);
    normalized = hermesXCFramework.source;
    phaseResults.push(hermesXCFramework.result);
    const changed = normalized !== original;
    if (changed) {
      await atomicWrite(
        canonicalProjectPath,
        normalized,
        projectMetadata.mode & 0o777,
      );
    }
    const provenance = Object.freeze({
      contract: "memi.expo-cocoapods-phase-normalization.v1" as const,
      sourceAuthority: "managed-cocoapods-generated-project" as const,
      projectRelativePath: relative(
        roots.managedWorktreeRoot,
        canonicalProjectPath,
      ),
      repositoryRevision: input.repositoryRevision,
      preparationFingerprint: input.preparationFingerprint,
      beforeHash: sha256(original),
      afterHash: sha256(normalized),
      changed,
      phases: Object.freeze(phaseResults),
      hermesReleaseVersion: hermes.hermesReleaseVersion,
    });
    const provenancePath = join(roots.platformRoot, PROVENANCE_RELATIVE_PATH);
    await mkdir(join(provenancePath, ".."), {
      recursive: true,
      mode: 0o700,
    });
    await atomicWrite(
      provenancePath,
      `${JSON.stringify(provenance, null, 2)}\n`,
      0o600,
    );
    return provenance;
  } catch (error) {
    if (error instanceof CaptureExecutionError) throw error;
    throw normalizationFailure(error);
  }
}
