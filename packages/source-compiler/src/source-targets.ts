import * as ts from "typescript";

import {
  DeterministicSourceCompilerError,
} from "./types.js";
import type {
  SourceStaticValue,
  SourceTarget,
} from "./types.js";
import {
  equalStaticValue,
  parseStaticValue,
  unwrapExpression,
} from "./static-values.js";
import { assertSourceTextBounded } from "./source-hash.js";

const SAFE_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]{0,127}$/u;
const MAX_PROPERTY_DEPTH = 16;
const MAX_CANDIDATES = 4_096;

function hasUnsafeCodepoint(value: string): boolean {
  return Array.from(value).some((character) => {
    const codepoint = character.codePointAt(0);
    return (
      codepoint !== undefined &&
      (codepoint <= 0x1f || codepoint === 0x7f)
    );
  });
}

export interface SourceTargetCandidate {
  readonly astPath: readonly string[];
  readonly end: number;
  readonly jsxAttribute: boolean;
  readonly start: number;
  readonly symbol: string;
  readonly value: SourceStaticValue;
}

function validateName(name: string, label: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new DeterministicSourceCompilerError(
      "invalid-input",
      `${label} must be a bounded static identifier.`,
    );
  }
}

export function validateTarget(target: SourceTarget): void {
  if (target.kind === "jsx-attribute") {
    validateName(target.elementName, "JSX element name");
    validateName(target.attributeName, "JSX attribute name");
    return;
  }
  validateName(target.declarationName, "Declaration name");
  if (target.kind === "constant") {
    return;
  }
  if (
    target.propertyPath.length === 0 ||
    target.propertyPath.length > MAX_PROPERTY_DEPTH ||
    target.propertyPath.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > 128 ||
        hasUnsafeCodepoint(segment),
    )
  ) {
    throw new DeterministicSourceCompilerError(
      "invalid-input",
      "Property paths must be non-empty, bounded, and static.",
    );
  }
}

function scriptKind(relativePath: string): ts.ScriptKind {
  if (relativePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (relativePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (relativePath.endsWith(".js")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

export function parseSource(
  relativePath: string,
  sourceText: string,
): ts.SourceFile {
  assertSourceTextBounded(sourceText);
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(relativePath),
  );
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (diagnostics !== undefined && diagnostics.length > 0) {
    throw new DeterministicSourceCompilerError(
      "parse-error",
      "Source contains syntax errors; deterministic compilation is blocked.",
    );
  }
  return sourceFile;
}

function staticPropertyName(name: ts.PropertyName): string | null {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  if (
    ts.isComputedPropertyName(name) &&
    ts.isStringLiteral(name.expression)
  ) {
    return name.expression.text;
  }
  return null;
}

function propertyInitializer(
  expression: ts.Expression,
  path: readonly string[],
): ts.Expression | null {
  let current = unwrapExpression(expression);
  for (const segment of path) {
    if (!ts.isObjectLiteralExpression(current)) {
      return null;
    }
    const matches = current.properties.filter(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        staticPropertyName(property.name) === segment,
    );
    if (matches.length !== 1) {
      return null;
    }
    const initializer = matches[0]?.initializer;
    if (initializer === undefined) {
      return null;
    }
    current = unwrapExpression(initializer);
  }
  return current;
}

function variableInitializers(
  sourceFile: ts.SourceFile,
  declarationName: string,
): readonly ts.Expression[] {
  const matches: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === declarationName &&
      node.initializer !== undefined
    ) {
      matches.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function styleObject(
  initializer: ts.Expression,
): ts.ObjectLiteralExpression | null {
  const expression = unwrapExpression(initializer);
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression) ||
    expression.expression.name.text !== "create"
  ) {
    return null;
  }
  const receiver = expression.expression.expression;
  if (!ts.isIdentifier(receiver) || receiver.text !== "StyleSheet") {
    return null;
  }
  const argument = expression.arguments[0];
  const unwrapped =
    argument === undefined ? null : unwrapExpression(argument);
  return unwrapped !== null && ts.isObjectLiteralExpression(unwrapped)
    ? unwrapped
    : null;
}

function jsxTagName(tagName: ts.JsxTagNameExpression): string | null {
  return ts.isIdentifier(tagName) ? tagName.text : null;
}

function jsxCandidateExpression(
  attribute: ts.JsxAttribute,
): ts.Expression | null {
  const initializer = attribute.initializer;
  if (initializer === undefined) {
    return null;
  }
  if (ts.isStringLiteral(initializer)) {
    return initializer;
  }
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression !== undefined
  ) {
    return initializer.expression;
  }
  return null;
}

function candidate(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  symbol: string,
  astPath: readonly string[],
  jsxAttribute: boolean,
): SourceTargetCandidate | null {
  const value = parseStaticValue(expression);
  return value === null
    ? null
    : {
        astPath,
        end: expression.end,
        jsxAttribute,
        start: expression.getStart(sourceFile),
        symbol,
        value,
      };
}

function collectJsxCandidates(
  sourceFile: ts.SourceFile,
  target: Extract<SourceTarget, { readonly kind: "jsx-attribute" }>,
): readonly SourceTargetCandidate[] {
  const matches: SourceTargetCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      jsxTagName(node.tagName) === target.elementName
    ) {
      for (const property of node.attributes.properties) {
        if (
          ts.isJsxAttribute(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === target.attributeName
        ) {
          const expression = jsxCandidateExpression(property);
          const initializer = property.initializer;
          const found =
            expression === null
              ? null
              : candidate(
                  sourceFile,
                  expression,
                  `${target.elementName}.${target.attributeName}`,
                  ["jsx", target.elementName, target.attributeName],
                  initializer !== undefined &&
                    ts.isStringLiteral(initializer),
                );
          if (found !== null) {
            matches.push(found);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

export function collectTargetCandidates(
  sourceFile: ts.SourceFile,
  target: SourceTarget,
): readonly SourceTargetCandidate[] {
  validateTarget(target);
  let matches: readonly SourceTargetCandidate[];
  if (target.kind === "jsx-attribute") {
    matches = collectJsxCandidates(sourceFile, target);
  } else {
    matches = variableInitializers(
      sourceFile,
      target.declarationName,
    ).flatMap((initializer) => {
      let expression: ts.Expression | null;
      let astPath: readonly string[];
      if (target.kind === "constant") {
        expression = unwrapExpression(initializer);
        astPath = ["constant", target.declarationName];
      } else if (target.kind === "object-property") {
        expression = propertyInitializer(initializer, target.propertyPath);
        astPath = [
          "object",
          target.declarationName,
          ...target.propertyPath,
        ];
      } else {
        const object = styleObject(initializer);
        expression =
          object === null
            ? null
            : propertyInitializer(object, target.propertyPath);
        astPath = [
          "style",
          target.declarationName,
          ...target.propertyPath,
        ];
      }
      if (expression === null) {
        return [];
      }
      const found = candidate(
        sourceFile,
        expression,
        target.declarationName,
        astPath,
        false,
      );
      return found === null ? [] : [found];
    });
  }
  if (matches.length > MAX_CANDIDATES) {
    throw new DeterministicSourceCompilerError(
      "ambiguous-target",
      "Source target exceeds the deterministic candidate limit.",
    );
  }
  return matches;
}

export function selectUniqueCandidate(
  candidates: readonly SourceTargetCandidate[],
  expectedValue: SourceStaticValue,
): SourceTargetCandidate {
  const matching = candidates.filter((entry) =>
    equalStaticValue(entry.value, expectedValue),
  );
  if (matching.length === 0) {
    throw new DeterministicSourceCompilerError(
      candidates.length === 0 ? "target-not-found" : "stale-value",
      candidates.length === 0
        ? "No supported static source target matched."
        : "The source target no longer has the expected value.",
    );
  }
  if (matching.length !== 1) {
    throw new DeterministicSourceCompilerError(
      "ambiguous-target",
      "Multiple static source targets match; deterministic compilation is blocked.",
    );
  }
  const selected = matching[0];
  if (selected === undefined) {
    throw new DeterministicSourceCompilerError(
      "target-not-found",
      "No supported static source target matched.",
    );
  }
  return selected;
}
