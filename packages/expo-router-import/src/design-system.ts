import * as ts from "typescript";

import type { VerifiedStaticSource } from "./filesystem.js";
import type {
  ComponentAxisEvidence,
  ComponentDeclarationEvidence,
  DesignSystemBarrelExportEvidence,
  SemanticTokenCollectionEvidence,
  SemanticTokenEntryEvidence,
  StaticDeclarationAnchor,
  StaticDesignSystemEvidence,
  StaticTokenValue,
  VisibleNavigationTabEvidence,
} from "./types.js";
import {
  parseStaticTokenValue,
  unwrapStaticExpression,
} from "./static-expression.js";

const COMPONENT_NAMES = ["Badge", "Button", "Card", "Input"] as const;
const COMPONENT_NAME_SET = new Set<string>(COMPONENT_NAMES);
const AXIS_NAMES = ["padding", "size", "tone", "variant"] as const;
const AXIS_NAME_SET = new Set<string>(AXIS_NAMES);
const MAX_DECLARATIONS = 4_096;
const MAX_TOKEN_ENTRIES = 8_192;
const MAX_TOKEN_DEPTH = 12;
const MAX_EXPRESSION_LENGTH = 2_048;
const MAX_DECLARATION_NAME_LENGTH = 256;
const MAX_MODULE_SPECIFIER_LENGTH = 512;
const MAX_VISIBLE_TABS = 256;

type ComponentName = (typeof COMPONENT_NAMES)[number];
type AxisName = (typeof AXIS_NAMES)[number];

interface ParsedFile {
  readonly verified: VerifiedStaticSource;
  readonly sourceFile: ts.SourceFile;
}

interface ExtractionState {
  declarationCount: number;
  tokenEntryCount: number;
  omittedAmbiguousDeclarations: number;
}

interface TabScreenDeclaration {
  readonly routeName: string;
  readonly title?: string;
  readonly hidden: boolean;
  readonly source: StaticDeclarationAnchor;
}

function parseSource(file: VerifiedStaticSource): ParsedFile | null {
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    return null;
  }
  const scriptKind = file.sourcePath.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : file.sourcePath.endsWith(".jsx")
      ? ts.ScriptKind.JSX
      : file.sourcePath.endsWith(".js")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    file.sourcePath,
    sourceText,
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
    return null;
  }
  return {
    verified: file,
    sourceFile,
  };
}

function anchor(parsed: ParsedFile, node: ts.Node): StaticDeclarationAnchor {
  const start = parsed.sourceFile.getLineAndCharacterOfPosition(
    node.getStart(parsed.sourceFile),
  );
  const end = parsed.sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    sourcePath: parsed.verified.sourcePath,
    contentHash: parsed.verified.contentHash,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function staticPropertyName(name: ts.PropertyName): string | null {
  let value: string | null = null;
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    value = name.text;
  }
  if (
    value === null &&
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) ||
      ts.isNumericLiteral(name.expression))
  ) {
    value = name.expression.text;
  }
  return value !== null && value.length <= MAX_DECLARATION_NAME_LENGTH
    ? value
    : null;
}

function isConstVariableStatement(statement: ts.VariableStatement): boolean {
  return (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
}

function staticTokenValue(
  parsed: ParsedFile,
  expression: ts.Expression,
): StaticTokenValue | null {
  return parseStaticTokenValue(
    parsed.sourceFile,
    expression,
    MAX_EXPRESSION_LENGTH,
  );
}

function tokenEntry(
  parsed: ParsedFile,
  path: readonly string[],
  expression: ts.Expression,
): SemanticTokenEntryEvidence | null {
  const value = staticTokenValue(parsed, expression);
  if (value === null) {
    return null;
  }
  return {
    path: [...path],
    value,
    confidence: "high",
    source: anchor(parsed, expression),
  };
}

function collectTokenEntries(
  parsed: ParsedFile,
  expression: ts.Expression,
  path: readonly string[],
  depth: number,
  state: ExtractionState,
): readonly SemanticTokenEntryEvidence[] | null {
  if (depth > MAX_TOKEN_DEPTH || state.tokenEntryCount >= MAX_TOKEN_ENTRIES) {
    return null;
  }
  const unwrapped = unwrapStaticExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    let entries: readonly SemanticTokenEntryEvidence[] = [];
    for (const property of unwrapped.properties) {
      if (ts.isPropertyAssignment(property)) {
        const name = staticPropertyName(property.name);
        if (name === null) {
          return null;
        }
        const nested = collectTokenEntries(
          parsed,
          property.initializer,
          [...path, name],
          depth + 1,
          state,
        );
        if (nested === null) {
          return null;
        }
        entries = [...entries, ...nested];
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const entry = tokenEntry(
          parsed,
          [...path, property.name.text],
          property.name,
        );
        if (entry === null) {
          return null;
        }
        state.tokenEntryCount += 1;
        entries = [...entries, entry];
      } else {
        return null;
      }
    }
    return entries;
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    let entries: readonly SemanticTokenEntryEvidence[] = [];
    for (const [index, element] of unwrapped.elements.entries()) {
      if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) {
        return null;
      }
      const nested = collectTokenEntries(
        parsed,
        element,
        [...path, String(index)],
        depth + 1,
        state,
      );
      if (nested === null) {
        return null;
      }
      entries = [...entries, ...nested];
    }
    return entries;
  }
  const entry = tokenEntry(parsed, path, unwrapped);
  if (entry === null || state.tokenEntryCount >= MAX_TOKEN_ENTRIES) {
    return null;
  }
  state.tokenEntryCount += 1;
  return [entry];
}

function extractTokenCollections(
  files: readonly ParsedFile[],
  state: ExtractionState,
): readonly SemanticTokenCollectionEvidence[] {
  let collections: readonly SemanticTokenCollectionEvidence[] = [];
  for (const parsed of files.filter((file) => file.verified.role === "token")) {
    for (const statement of parsed.sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || !isExported(statement)) {
        continue;
      }
      if (!isConstVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (declaration.initializer === undefined) {
            continue;
          }
          const initializer = unwrapStaticExpression(declaration.initializer);
          if (
            ts.isObjectLiteralExpression(initializer) ||
            ts.isArrayLiteralExpression(initializer)
          ) {
            state.omittedAmbiguousDeclarations += 1;
          }
        }
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) {
          continue;
        }
        const initializer = unwrapStaticExpression(declaration.initializer);
        if (
          !ts.isObjectLiteralExpression(initializer) &&
          !ts.isArrayLiteralExpression(initializer)
        ) {
          continue;
        }
        const entryCountBefore = state.tokenEntryCount;
        const entries = collectTokenEntries(
          parsed,
          initializer,
          [],
          0,
          state,
        );
        if (entries === null || state.declarationCount >= MAX_DECLARATIONS) {
          state.tokenEntryCount = entryCountBefore;
          state.omittedAmbiguousDeclarations += 1;
          continue;
        }
        state.declarationCount += 1;
        collections = [
          ...collections,
          {
            name: declaration.name.text,
            collectionKind: ts.isArrayLiteralExpression(initializer)
              ? "array"
              : "object",
            confidence: "high",
            source: anchor(parsed, declaration),
            entries,
          },
        ];
      }
    }
  }
  return [...collections].sort((left, right) =>
    left.source.sourcePath.localeCompare(right.source.sourcePath) ||
    left.name.localeCompare(right.name),
  );
}

function componentDeclaration(
  statement: ts.Statement,
): { readonly name: ComponentName; readonly node: ts.Node } | null {
  if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
    const name = statement.name?.text;
    return name !== undefined && COMPONENT_NAME_SET.has(name)
      ? { name: name as ComponentName, node: statement }
      : null;
  }
  if (
    !ts.isVariableStatement(statement) ||
    !isExported(statement) ||
    !isConstVariableStatement(statement)
  ) {
    return null;
  }
  for (const declaration of statement.declarationList.declarations) {
    if (
      ts.isIdentifier(declaration.name) &&
      COMPONENT_NAME_SET.has(declaration.name.text)
    ) {
      return {
        name: declaration.name.text as ComponentName,
        node: declaration,
      };
    }
  }
  return null;
}

function axisFromAlias(
  componentName: ComponentName,
  alias: ts.TypeAliasDeclaration,
): AxisName | null {
  if (!alias.name.text.startsWith(componentName)) {
    return null;
  }
  const suffix = alias.name.text.slice(componentName.length).toLowerCase();
  return AXIS_NAME_SET.has(suffix) ? (suffix as AxisName) : null;
}

function unionStringValues(type: ts.TypeNode): readonly string[] | null {
  const nodes = ts.isUnionTypeNode(type) ? type.types : [type];
  let values: readonly string[] = [];
  for (const node of nodes) {
    if (
      !ts.isLiteralTypeNode(node) ||
      !ts.isStringLiteral(node.literal)
    ) {
      return null;
    }
    values = [...values, node.literal.text];
  }
  return values.length === 0 ? null : values;
}

function defaultValueForAxis(node: ts.Node, name: AxisName): string | undefined {
  let found: string | undefined;
  const visit = (candidate: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (
      ts.isBindingElement(candidate) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name &&
      candidate.initializer !== undefined
    ) {
      const initializer = unwrapStaticExpression(candidate.initializer);
      if (ts.isStringLiteral(initializer)) {
        found = initializer.text;
        return;
      }
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

function extractComponents(
  files: readonly ParsedFile[],
  state: ExtractionState,
): readonly ComponentDeclarationEvidence[] {
  let components: readonly ComponentDeclarationEvidence[] = [];
  for (const parsed of files.filter((file) => file.verified.role === "component")) {
    for (const statement of parsed.sourceFile.statements) {
      if (
        ts.isVariableStatement(statement) &&
        isExported(statement) &&
        !isConstVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            COMPONENT_NAME_SET.has(declaration.name.text),
        )
      ) {
        state.omittedAmbiguousDeclarations += 1;
        continue;
      }
      const declaration = componentDeclaration(statement);
      if (declaration === null) {
        continue;
      }
      let axes: readonly ComponentAxisEvidence[] = [];
      for (const candidate of parsed.sourceFile.statements) {
        if (!ts.isTypeAliasDeclaration(candidate)) {
          continue;
        }
        const axisName = axisFromAlias(declaration.name, candidate);
        if (axisName === null) {
          continue;
        }
        const values = unionStringValues(candidate.type);
        if (values === null) {
          state.omittedAmbiguousDeclarations += 1;
          continue;
        }
        const defaultValue = defaultValueForAxis(declaration.node, axisName);
        axes = [
          ...axes,
          {
            name: axisName,
            values,
            ...(defaultValue === undefined ? {} : { defaultValue }),
            confidence: "high",
            source: anchor(parsed, candidate),
          },
        ];
      }
      if (state.declarationCount >= MAX_DECLARATIONS) {
        state.omittedAmbiguousDeclarations += 1;
        continue;
      }
      state.declarationCount += 1;
      components = [
        ...components,
        {
          name: declaration.name,
          atomicLevel: "atom",
          confidence: "high",
          source: anchor(parsed, declaration.node),
          axes: [...axes].sort((left, right) => left.name.localeCompare(right.name)),
        },
      ];
    }
  }
  return [...components].sort((left, right) => left.name.localeCompare(right.name));
}

function isBarrel(sourcePath: string): boolean {
  const basename = sourcePath.split("/").at(-1)?.replace(/\.[^.]+$/u, "");
  return basename === "design-system" || basename === "index";
}

function extractBarrelExports(
  files: readonly ParsedFile[],
  state: ExtractionState,
): readonly DesignSystemBarrelExportEvidence[] {
  let exports: readonly DesignSystemBarrelExportEvidence[] = [];
  for (const parsed of files.filter(
    (file) => file.verified.role === "component" && isBarrel(file.verified.sourcePath),
  )) {
    for (const statement of parsed.sourceFile.statements) {
      if (
        !ts.isExportDeclaration(statement) ||
        statement.moduleSpecifier === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const moduleSpecifier = statement.moduleSpecifier.text;
      if (moduleSpecifier.length > MAX_MODULE_SPECIFIER_LENGTH) {
        state.omittedAmbiguousDeclarations += 1;
        continue;
      }
      if (statement.exportClause === undefined) {
        if (state.declarationCount >= MAX_DECLARATIONS) {
          state.omittedAmbiguousDeclarations += 1;
          continue;
        }
        state.declarationCount += 1;
        exports = [
          ...exports,
          {
            exportedName: "*",
            localName: "*",
            moduleSpecifier,
            typeOnly: statement.isTypeOnly,
            confidence: "high",
            source: anchor(parsed, statement),
          },
        ];
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) {
        state.omittedAmbiguousDeclarations += 1;
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (state.declarationCount >= MAX_DECLARATIONS) {
          state.omittedAmbiguousDeclarations += 1;
          continue;
        }
        state.declarationCount += 1;
        exports = [
          ...exports,
          {
            exportedName: element.name.text,
            localName: element.propertyName?.text ?? element.name.text,
            moduleSpecifier,
            typeOnly: statement.isTypeOnly || element.isTypeOnly,
            confidence: "high",
            source: anchor(parsed, element),
          },
        ];
      }
    }
  }
  return [...exports].sort((left, right) =>
    left.source.sourcePath.localeCompare(right.source.sourcePath) ||
    left.exportedName.localeCompare(right.exportedName) ||
    left.moduleSpecifier.localeCompare(right.moduleSpecifier),
  );
}

function jsxAttribute(
  element: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | null {
  for (const property of element.attributes.properties) {
    if (ts.isJsxAttribute(property) && property.name.getText() === name) {
      return property;
    }
  }
  return null;
}

function jsxAttributeString(attribute: ts.JsxAttribute | null): string | null {
  if (attribute?.initializer === undefined) {
    return null;
  }
  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }
  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression !== undefined
  ) {
    const expression = unwrapStaticExpression(attribute.initializer.expression);
    return ts.isStringLiteral(expression) ? expression.text : null;
  }
  return null;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const property of object.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      staticPropertyName(property.name) === name
    ) {
      return property;
    }
  }
  return null;
}

function tabScreenDeclaration(
  parsed: ParsedFile,
  element: ts.JsxOpeningLikeElement,
): TabScreenDeclaration | null {
  if (element.tagName.getText(parsed.sourceFile) !== "Tabs.Screen") {
    return null;
  }
  const nameAttribute = jsxAttribute(element, "name");
  const routeName = jsxAttributeString(nameAttribute);
  const optionsAttribute = jsxAttribute(element, "options");
  if (
    routeName === null ||
    nameAttribute === null ||
    optionsAttribute?.initializer === undefined ||
    !ts.isJsxExpression(optionsAttribute.initializer) ||
    optionsAttribute.initializer.expression === undefined
  ) {
    return null;
  }
  const options = unwrapStaticExpression(optionsAttribute.initializer.expression);
  if (!ts.isObjectLiteralExpression(options)) {
    return null;
  }
  const href = objectProperty(options, "href");
  const title = objectProperty(options, "title");
  const titleExpression =
    title === null ? null : unwrapStaticExpression(title.initializer);
  const staticTitle =
    titleExpression !== null && ts.isStringLiteral(titleExpression)
      ? titleExpression.text
      : undefined;
  return {
    routeName,
    ...(staticTitle === undefined ? {} : { title: staticTitle }),
    hidden:
      href !== null &&
      unwrapStaticExpression(href.initializer).kind === ts.SyntaxKind.NullKeyword,
    source: anchor(parsed, nameAttribute),
  };
}

function collectTabScreens(files: readonly ParsedFile[]): readonly TabScreenDeclaration[] {
  let screens: readonly TabScreenDeclaration[] = [];
  for (const parsed of files.filter((file) => file.verified.role === "route")) {
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const screen = tabScreenDeclaration(parsed, node);
        if (screen !== null) {
          screens = [...screens, screen];
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.sourceFile);
  }
  return screens;
}

function visibleTabArray(
  parsed: ParsedFile,
  declaration: ts.VariableDeclaration,
): readonly VisibleNavigationTabEvidence[] | null {
  if (
    !ts.isIdentifier(declaration.name) ||
    !/visible.*(?:tab|nav).*names?/iu.test(declaration.name.text) ||
    declaration.initializer === undefined
  ) {
    return null;
  }
  const initializer = unwrapStaticExpression(declaration.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) {
    return [];
  }
  if (initializer.elements.length > MAX_VISIBLE_TABS) {
    return [];
  }
  let tabs: readonly VisibleNavigationTabEvidence[] = [];
  for (const element of initializer.elements) {
    if (
      !ts.isStringLiteral(element) ||
      element.text.length === 0 ||
      element.text.length > MAX_DECLARATION_NAME_LENGTH
    ) {
      return [];
    }
    tabs = [
      ...tabs,
      {
        routeName: element.text,
        confidence: "high",
        source: anchor(parsed, element),
      },
    ];
  }
  return tabs;
}

function extractNavigation(
  files: readonly ParsedFile[],
  state: ExtractionState,
): StaticDesignSystemEvidence["navigation"] {
  const screens = collectTabScreens(files);
  let declaredTabs: readonly VisibleNavigationTabEvidence[] = [];
  for (const parsed of files) {
    for (const statement of parsed.sourceFile.statements) {
      if (!ts.isVariableStatement(statement) || !isExported(statement)) {
        continue;
      }
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !/visible.*(?:tab|nav).*names?/iu.test(declaration.name.text)
        ) {
          continue;
        }
        if (!isConstVariableStatement(statement)) {
          state.omittedAmbiguousDeclarations += 1;
          continue;
        }
        const tabs = visibleTabArray(parsed, declaration);
        if (tabs === null || tabs.length === 0) {
          state.omittedAmbiguousDeclarations += 1;
          continue;
        }
        declaredTabs = [...declaredTabs, ...tabs];
      }
    }
  }
  const candidates =
    declaredTabs.length > 0
      ? declaredTabs
      : screens
          .filter((screen) => !screen.hidden)
          .map((screen) => ({
            routeName: screen.routeName,
            ...(screen.title === undefined ? {} : { title: screen.title }),
            confidence: "high" as const,
            source: screen.source,
          }));
  const titles = new Map(
    screens.flatMap((screen) =>
      screen.title === undefined ? [] : [[screen.routeName, screen.title] as const],
    ),
  );
  let visibleTabs: readonly VisibleNavigationTabEvidence[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.routeName)) {
      continue;
    }
    seen.add(candidate.routeName);
    const title = candidate.title ?? titles.get(candidate.routeName);
    visibleTabs = [
      ...visibleTabs,
      {
        routeName: candidate.routeName,
        ...(title === undefined ? {} : { title }),
        confidence: "high",
        source: candidate.source,
      },
    ];
  }
  return { visibleTabs };
}

export function extractStaticDesignSystem(
  files: readonly VerifiedStaticSource[],
): StaticDesignSystemEvidence {
  const state: ExtractionState = {
    declarationCount: 0,
    tokenEntryCount: 0,
    omittedAmbiguousDeclarations: 0,
  };
  let parsedFiles: readonly ParsedFile[] = [];
  for (const file of files.filter((candidate) => candidate.role !== "manifest")) {
    const parsed = parseSource(file);
    if (parsed === null) {
      state.omittedAmbiguousDeclarations += 1;
    } else {
      parsedFiles = [...parsedFiles, parsed];
    }
  }
  const components = extractComponents(parsedFiles, state);
  const tokenCollections = extractTokenCollections(parsedFiles, state);
  const barrelExports = extractBarrelExports(parsedFiles, state);
  const navigation = extractNavigation(parsedFiles, state);
  return {
    schemaVersion: "expo-design-system-static@1",
    analysisMode: "static-ast",
    executedProjectCode: false,
    confidencePolicy: "high-confidence-only",
    components,
    tokenCollections,
    barrelExports,
    navigation,
    extraction: {
      status:
        state.omittedAmbiguousDeclarations === 0 ? "complete" : "partial",
      omittedAmbiguousDeclarations: state.omittedAmbiguousDeclarations,
    },
  };
}
