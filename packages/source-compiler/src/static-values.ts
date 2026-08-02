import * as ts from "typescript";

import {
  DeterministicSourceCompilerError,
} from "./types.js";
import type { SourceStaticValue } from "./types.js";

const MAX_STRING_LENGTH = 16_384;
const MAX_ABSOLUTE_NUMBER = 1_000_000_000;
const MAX_TOKEN_DEPTH = 16;
const SAFE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const SAFE_PROPERTY = /^[A-Za-z0-9_$-]{1,128}$/u;

export function unwrapExpression(
  expression: ts.Expression,
): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function referencePath(expression: ts.Expression): readonly string[] | null {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return [unwrapped.text];
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const prefix = referencePath(unwrapped.expression);
    return prefix === null ? null : [...prefix, unwrapped.name.text];
  }
  if (
    ts.isElementAccessExpression(unwrapped) &&
    unwrapped.argumentExpression !== undefined
  ) {
    const prefix = referencePath(unwrapped.expression);
    const argument = unwrapExpression(unwrapped.argumentExpression);
    if (prefix === null || !ts.isStringLiteral(argument)) {
      return null;
    }
    return [...prefix, argument.text];
  }
  return null;
}

export function parseStaticValue(
  expression: ts.Expression,
): SourceStaticValue | null {
  const unwrapped = unwrapExpression(expression);
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return { kind: "string", value: unwrapped.text };
  }
  if (ts.isNumericLiteral(unwrapped)) {
    const numeric = Number(unwrapped.text);
    return Number.isFinite(numeric)
      ? { kind: "number", value: numeric }
      : null;
  }
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    (unwrapped.operator === ts.SyntaxKind.MinusToken ||
      unwrapped.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    const unsigned = Number(unwrapped.operand.text);
    const numeric =
      unwrapped.operator === ts.SyntaxKind.MinusToken
        ? -unsigned
        : unsigned;
    return Number.isFinite(numeric)
      ? { kind: "number", value: numeric }
      : null;
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: "boolean", value: true };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: false };
  }
  const path = referencePath(unwrapped);
  return path === null
    ? null
    : { kind: "token-reference", path };
}

export function equalStaticValue(
  left: SourceStaticValue,
  right: SourceStaticValue,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "token-reference") {
    return (
      right.kind === "token-reference" &&
      left.path.length === right.path.length &&
      left.path.every((segment, index) => segment === right.path[index])
    );
  }
  return right.kind === left.kind && left.value === right.value;
}

export function validateStaticValue(value: SourceStaticValue): void {
  if (value.kind === "string") {
    if (
      value.value.length > MAX_STRING_LENGTH ||
      value.value.includes("\u0000")
    ) {
      throw new DeterministicSourceCompilerError(
        "invalid-input",
        "Source string values must be bounded and contain no null bytes.",
      );
    }
    return;
  }
  if (value.kind === "number") {
    if (
      !Number.isFinite(value.value) ||
      Math.abs(value.value) > MAX_ABSOLUTE_NUMBER
    ) {
      throw new DeterministicSourceCompilerError(
        "invalid-input",
        "Source numeric values must be finite and bounded.",
      );
    }
    return;
  }
  if (value.kind === "boolean") {
    return;
  }
  if (
    value.path.length === 0 ||
    value.path.length > MAX_TOKEN_DEPTH ||
    !SAFE_IDENTIFIER.test(value.path[0] ?? "") ||
    value.path.some((segment) => !SAFE_PROPERTY.test(segment))
  ) {
    throw new DeterministicSourceCompilerError(
      "invalid-input",
      "Token references must use a bounded static property path.",
    );
  }
}

function renderTokenPath(path: readonly string[]): string {
  const [root, ...properties] = path;
  return properties.reduce(
    (text, property) =>
      SAFE_IDENTIFIER.test(property)
        ? `${text}.${property}`
        : `${text}[${JSON.stringify(property)}]`,
    root ?? "",
  );
}

function xmlAttributeText(value: string, quote: '"' | "'"): string {
  const quoteEntity = quote === '"' ? /"/gu : /'/gu;
  const replacement = quote === '"' ? "&quot;" : "&apos;";
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(quoteEntity, replacement);
}

export function renderStaticValue(
  value: SourceStaticValue,
  beforeText: string,
  jsxAttribute: boolean,
): string {
  validateStaticValue(value);
  if (value.kind === "string") {
    if (jsxAttribute && (beforeText.startsWith('"') || beforeText.startsWith("'"))) {
      const quote = beforeText[0] as '"' | "'";
      return `${quote}${xmlAttributeText(value.value, quote)}${quote}`;
    }
    return JSON.stringify(value.value);
  }
  if (value.kind === "number") {
    return String(value.value);
  }
  if (value.kind === "boolean") {
    return String(value.value);
  }
  return renderTokenPath(value.path);
}
