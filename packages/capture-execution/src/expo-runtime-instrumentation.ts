import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import { expoRuntimeSemanticModule } from "./expo-runtime-semantic-module.js";
import {
  instrumentExpoRuntimeSources,
  restoreExpoRuntimeSources,
  type InstrumentedExpoSourceV1,
} from "./expo-runtime-source-instrumentation.js";

export interface PrepareExpoRuntimeInstrumentationInput {
  readonly managedWorktreeRoot: string;
  readonly sourceRevision: string;
}

export interface PreparedExpoRuntimeInstrumentation {
  readonly instrumentationVersion: 3;
  readonly instrumentedSourceCount: number;
  readonly instrumentedSources: readonly InstrumentedExpoSourceV1[];
  readonly managedWorktreeRoot: string;
  readonly layoutPath: string;
  readonly backupPath: string;
  readonly modulePath: string;
  readonly metadataPath: string;
  readonly sourceRevision: string;
  readonly readinessToken: string;
  readonly originalLayoutHash: `sha256:${string}`;
  readonly instrumentationHash: `sha256:${string}`;
}

const INSTRUMENTATION_IMPORT =
  "import { MemiCaptureRuntimeAttestation } from '../.memi/capture/runtime-attestation/MemiCaptureRuntimeAttestation';\n";
const ROOT_LAYOUT_CANDIDATES = [
  "app/_layout.tsx",
  "app/_layout.jsx",
  "app/_layout.ts",
  "app/_layout.js",
] as const;

function hash(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contained(root: string, candidate: string): boolean {
  const local = relative(resolve(root), resolve(candidate));
  return (
    local === "" ||
    (local !== ".." &&
      !local.startsWith(`..${sep}`) &&
      !isAbsolute(local))
  );
}

async function regularFile(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symlink.`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function findRootLayout(root: string): Promise<string> {
  for (const candidate of ROOT_LAYOUT_CANDIDATES) {
    const path = join(root, candidate);
    try {
      await regularFile(path, "Expo root layout");
      return path;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Expo Router root layout was not found.");
}

function instrumentRootLayout(source: string, fileName: string): string {
  if (
    source.includes("MemiCaptureOriginalRoot") ||
    source.includes(INSTRUMENTATION_IMPORT.trim())
  ) {
    throw new Error("Expo root layout is already instrumented.");
  }
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const exports = sourceFile.statements.filter(ts.isExportAssignment);
  if (exports.length !== 1 || exports[0]!.isExportEquals) {
    throw new Error(
      "Expo root layout must have exactly one default export assignment.",
    );
  }
  const assignment = exports[0]!;
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const lastImport = imports.at(-1);
  if (lastImport === undefined) {
    throw new Error("Expo root layout must import its runtime dependencies.");
  }
  const originalExpression = assignment.expression.getText(sourceFile);
  const replacement = [
    `const MemiCaptureOriginalRoot = ${originalExpression};`,
    "function MemiCaptureInstrumentedRoot() {",
    "  return (",
    "    <>",
    "      <MemiCaptureOriginalRoot />",
    "      <MemiCaptureRuntimeAttestation />",
    "    </>",
    "  );",
    "}",
    "export default MemiCaptureInstrumentedRoot;",
  ].join("\n");
  const sourceWithInstrumentationImport =
    source.slice(0, lastImport.end) +
    `\n${INSTRUMENTATION_IMPORT}` +
    source.slice(lastImport.end);
  const assignmentStart = assignment.getStart(sourceFile);
  const importLength = `\n${INSTRUMENTATION_IMPORT}`.length;
  return (
    sourceWithInstrumentationImport.slice(0, assignmentStart + importLength) +
    replacement +
    sourceWithInstrumentationImport.slice(assignment.end + importLength)
  );
}

function instrumentationModule(
  sourceRevision: string,
  readinessToken: string,
): string {
  return expoRuntimeSemanticModule(sourceRevision, readinessToken);
}

export async function prepareExpoRuntimeInstrumentation(
  input: PrepareExpoRuntimeInstrumentationInput,
): Promise<PreparedExpoRuntimeInstrumentation> {
  if (!isAbsolute(input.managedWorktreeRoot)) {
    throw new Error("Managed Expo worktree root must be absolute.");
  }
  const instrumentationRoot = join(
    input.managedWorktreeRoot,
    ".memi/capture/runtime-attestation",
  );
  const sourceBackupRoot = join(instrumentationRoot, "source-backups");
  const metadataPath = join(instrumentationRoot, "metadata.json");
  try {
    const existing = JSON.parse(
      await readFile(metadataPath, "utf8"),
    ) as PreparedExpoRuntimeInstrumentation;
    if (
      existing.instrumentationVersion === 3 &&
      existing.managedWorktreeRoot === input.managedWorktreeRoot &&
      existing.sourceRevision === input.sourceRevision &&
      Array.isArray(existing.instrumentedSources) &&
      existing.instrumentedSourceCount === existing.instrumentedSources.length
    ) {
      return Object.freeze(existing);
    }
    throw new Error("Expo runtime instrumentation revision is stale.");
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      throw error;
    }
  }

  const layoutPath = await findRootLayout(input.managedWorktreeRoot);
  const backupPath = join(instrumentationRoot, "original-layout");
  const modulePath = join(
    instrumentationRoot,
    "MemiCaptureRuntimeAttestation.jsx",
  );
  if (
    ![layoutPath, backupPath, modulePath, metadataPath].every((path) =>
      contained(input.managedWorktreeRoot, path)
    )
  ) {
    throw new Error("Expo runtime instrumentation escaped the managed root.");
  }
  const readinessToken = randomBytes(16).toString("hex").toUpperCase();
  const module = instrumentationModule(input.sourceRevision, readinessToken);
  let instrumentedSources: readonly InstrumentedExpoSourceV1[] = Object.freeze([]);
  let original: string | undefined;
  let layoutWasPatched = false;
  try {
    await atomicWrite(modulePath, module);
    instrumentedSources = await instrumentExpoRuntimeSources({
      backupRoot: sourceBackupRoot,
      managedWorktreeRoot: input.managedWorktreeRoot,
      modulePath,
    });
    original = await readFile(layoutPath, "utf8");
    const patched = instrumentRootLayout(original, layoutPath);
    await atomicWrite(backupPath, original);
    await atomicWrite(layoutPath, patched);
    layoutWasPatched = true;
    const prepared: PreparedExpoRuntimeInstrumentation = Object.freeze({
      instrumentationVersion: 3,
      instrumentedSourceCount: instrumentedSources.length,
      instrumentedSources,
      managedWorktreeRoot: input.managedWorktreeRoot,
      layoutPath,
      backupPath,
      modulePath,
      metadataPath,
      sourceRevision: input.sourceRevision,
      readinessToken,
      originalLayoutHash: hash(original),
      instrumentationHash: hash(
        `${patched}\0${module}\0${instrumentedSources
          .map(({ instrumentedHash, sourcePath }) =>
            `${sourcePath}:${instrumentedHash}`,
          )
          .join("\0")}`,
      ),
    });
    await atomicWrite(metadataPath, JSON.stringify(prepared));
    return prepared;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (layoutWasPatched && original !== undefined) {
      try {
        await atomicWrite(layoutPath, original);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (instrumentedSources.length > 0) {
      try {
        await restoreExpoRuntimeSources({
          managedWorktreeRoot: input.managedWorktreeRoot,
          sources: instrumentedSources,
        });
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await rm(instrumentationRoot, { recursive: true, force: true });
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "Expo runtime instrumentation failed and rollback was incomplete.",
      );
    }
    throw error;
  }
}

export async function restoreExpoRuntimeInstrumentation(
  prepared: PreparedExpoRuntimeInstrumentation,
): Promise<void> {
  const original = await readFile(prepared.backupPath, "utf8");
  if (hash(original) !== prepared.originalLayoutHash) {
    throw new Error("Expo root-layout backup hash does not match authority.");
  }
  await atomicWrite(prepared.layoutPath, original);
  await restoreExpoRuntimeSources({
    managedWorktreeRoot: prepared.managedWorktreeRoot,
    sources: prepared.instrumentedSources,
  });
  await rm(dirname(prepared.modulePath), { recursive: true, force: true });
}
