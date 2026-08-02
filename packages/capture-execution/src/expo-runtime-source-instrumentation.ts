import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  opendir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import ts from "typescript";

const SOURCE_ROOTS = ["app", "components", "src"] as const;
const SOURCE_EXTENSIONS = new Set([".jsx", ".tsx"]);
const SUPPORTED_PRIMITIVES = new Map<string, {
  readonly atomicLevel: "atom" | "molecule";
  readonly kind:
    | "component-instance"
    | "frame"
    | "image"
    | "text";
}>([
  ["Image", { atomicLevel: "atom", kind: "image" }],
  ["Pressable", { atomicLevel: "atom", kind: "component-instance" }],
  ["ScrollView", { atomicLevel: "molecule", kind: "frame" }],
  ["Text", { atomicLevel: "atom", kind: "text" }],
  ["TextInput", { atomicLevel: "atom", kind: "component-instance" }],
  ["TouchableOpacity", { atomicLevel: "atom", kind: "component-instance" }],
  ["View", { atomicLevel: "molecule", kind: "frame" }],
]);
const MAX_FILES = 4_096;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 32_000_000;

export interface InstrumentedExpoSourceV1 {
  readonly backupPath: string;
  readonly instrumentedHash: `sha256:${string}`;
  readonly originalHash: `sha256:${string}`;
  readonly sourcePath: string;
}

interface TextEdit {
  readonly end: number;
  readonly start: number;
  readonly text: string;
}

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

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function sourceFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let handle;
    try {
      handle = await opendir(directory);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for await (const entry of handle) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Expo capture source trees may not contain symlinks.");
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        files.push(path);
        if (files.length > MAX_FILES) {
          throw new Error("Expo capture source instrumentation exceeded its file budget.");
        }
      }
    }
  };
  for (const directory of SOURCE_ROOTS) {
    await visit(join(root, directory));
  }
  return files.sort();
}

function sourceImport(
  filePath: string,
  modulePath: string,
): string {
  let specifier = relative(dirname(filePath), modulePath)
    .split(sep)
    .join("/")
    .replace(/\.(?:jsx|tsx)$/u, "");
  if (!specifier.startsWith(".")) specifier = `./${specifier}`;
  return `import { MemiCapturePrimitive } from ${JSON.stringify(specifier)};`;
}

function metadata(input: {
  readonly filePath: string;
  readonly importedName: string;
  readonly node: ts.JsxOpeningLikeElement;
  readonly root: string;
  readonly source: string;
  readonly sourceFile: ts.SourceFile;
}): Readonly<Record<string, unknown>> {
  const primitive = SUPPORTED_PRIMITIVES.get(input.importedName)!;
  const sourcePath = relative(input.root, input.filePath).split(sep).join("/");
  const start = input.node.getStart(input.sourceFile);
  const end = input.node.end;
  const location = input.sourceFile.getLineAndCharacterOfPosition(start);
  const identity = `${sourcePath}\0${start}\0${end}\0${input.importedName}`;
  const layerId = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return {
    clip: input.importedName === "ScrollView",
    kind: primitive.kind,
    layerId: `memi-${layerId}`,
    name: `${input.importedName} · ${sourcePath}:${location.line + 1}`,
    semanticKey: `${sourcePath}:${start}:${end}`,
    source: {
      astPath: [sourcePath, input.importedName, `${location.line + 1}:${location.character + 1}`],
      atomicLevel: primitive.atomicLevel,
      componentId: input.importedName,
      exportName: null,
      range: { end, start },
      sourceAnchor: sourcePath,
      sourceContentHash: hash(input.source),
    },
  };
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let output = source;
  let previousStart = source.length + 1;
  for (const edit of [...edits].sort((left, right) => right.start - left.start)) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      edit.end > previousStart
    ) {
      throw new Error("Expo capture source instrumentation edits overlap.");
    }
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    previousStart = edit.start;
  }
  return output;
}

function instrumentSource(input: {
  readonly filePath: string;
  readonly modulePath: string;
  readonly root: string;
  readonly source: string;
}): string | null {
  if (input.source.includes("MemiCapturePrimitive")) {
    throw new Error("Expo source already contains Memi capture instrumentation.");
  }
  const scriptKind = input.filePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.JSX;
  const sourceFile = ts.createSourceFile(
    input.filePath,
    input.source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (parseDiagnostics !== undefined && parseDiagnostics.length > 0) {
    throw new Error(`Expo source could not be parsed: ${input.filePath}`);
  }
  const localPrimitives = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "react-native"
    ) {
      continue;
    }
    for (const element of statement.importClause?.namedBindings !== undefined &&
    ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements
      : []) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (SUPPORTED_PRIMITIVES.has(importedName)) {
        localPrimitives.set(element.name.text, importedName);
      }
    }
  }
  if (localPrimitives.size === 0) return null;

  const edits: TextEdit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName)
    ) {
      const localName = node.tagName.text;
      const importedName = localPrimitives.get(localName);
      if (importedName !== undefined) {
        edits.push({
          start: node.tagName.getStart(sourceFile),
          end: node.tagName.end,
          text:
            `MemiCapturePrimitive component={${localName}} captureMetadata={` +
            `${JSON.stringify(metadata({
              filePath: input.filePath,
              importedName,
              node,
              root: input.root,
              source: input.source,
              sourceFile,
            }))}}`,
        });
        if (ts.isJsxOpeningElement(node)) {
          const parent = node.parent;
          if (!ts.isJsxElement(parent)) {
            throw new Error("Expo capture JSX hierarchy is invalid.");
          }
          edits.push({
            start: parent.closingElement.tagName.getStart(sourceFile),
            end: parent.closingElement.tagName.end,
            text: "MemiCapturePrimitive",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (edits.length === 0) return null;
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const lastImport = imports.at(-1);
  if (lastImport === undefined) {
    throw new Error("Expo capture source must preserve its primitive imports.");
  }
  return applyEdits(input.source, [
    ...edits,
    {
      start: lastImport.end,
      end: lastImport.end,
      text: `\n${sourceImport(input.filePath, input.modulePath)}`,
    },
  ]);
}

export async function instrumentExpoRuntimeSources(input: {
  readonly backupRoot: string;
  readonly managedWorktreeRoot: string;
  readonly modulePath: string;
}): Promise<readonly InstrumentedExpoSourceV1[]> {
  if (
    ![input.backupRoot, input.modulePath].every((path) =>
      contained(input.managedWorktreeRoot, path),
    )
  ) {
    throw new Error("Expo semantic instrumentation escaped the managed root.");
  }
  let totalBytes = 0;
  let result: readonly InstrumentedExpoSourceV1[] = Object.freeze([]);
  try {
    for (const filePath of await sourceFiles(input.managedWorktreeRoot)) {
      const stats = await lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_FILE_BYTES) {
        throw new Error("Expo semantic instrumentation requires bounded regular source files.");
      }
      totalBytes += stats.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error("Expo semantic instrumentation exceeded its byte budget.");
      }
      const source = await readFile(filePath, "utf8");
      const instrumented = instrumentSource({
        filePath,
        modulePath: input.modulePath,
        root: input.managedWorktreeRoot,
        source,
      });
      if (instrumented === null) continue;
      const sourcePath = relative(input.managedWorktreeRoot, filePath)
        .split(sep)
        .join("/");
      const backupPath = join(
        input.backupRoot,
        `${createHash("sha256").update(sourcePath).digest("hex")}.source`,
      );
      await atomicWrite(backupPath, source);
      await atomicWrite(filePath, instrumented);
      result = Object.freeze([
        ...result,
        Object.freeze({
          backupPath,
          instrumentedHash: hash(instrumented),
          originalHash: hash(source),
          sourcePath,
        }),
      ]);
    }
    if (result.length === 0) {
      throw new Error("Expo project exposes no supported React Native JSX primitives.");
    }
    return result;
  } catch (error) {
    if (result.length === 0) throw error;
    try {
      await restoreExpoRuntimeSources({
        managedWorktreeRoot: input.managedWorktreeRoot,
        sources: result,
      });
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Expo semantic instrumentation failed and rollback was incomplete.",
      );
    }
    throw error;
  }
}

export async function restoreExpoRuntimeSources(input: {
  readonly managedWorktreeRoot: string;
  readonly sources: readonly InstrumentedExpoSourceV1[];
}): Promise<void> {
  for (const source of input.sources) {
    const path = join(input.managedWorktreeRoot, source.sourcePath);
    if (
      !contained(input.managedWorktreeRoot, path) ||
      !contained(input.managedWorktreeRoot, source.backupPath)
    ) {
      throw new Error("Expo source restoration escaped the managed root.");
    }
    const [current, original] = await Promise.all([
      readFile(path, "utf8"),
      readFile(source.backupPath, "utf8"),
    ]);
    if (
      hash(current) !== source.instrumentedHash ||
      hash(original) !== source.originalHash
    ) {
      throw new Error("Expo semantic source hash changed before restoration.");
    }
    await atomicWrite(path, original);
  }
}
