import * as ts from "typescript";

import type { StaticTokenValue } from "./types.js";

export function unwrapStaticExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapStaticExpression(expression.expression);
  }
  return expression;
}

function isStaticReference(expression: ts.Expression): boolean {
  const unwrapped = unwrapStaticExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return true;
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return isStaticReference(unwrapped.expression);
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    if (unwrapped.argumentExpression === undefined) {
      return false;
    }
    const argument = unwrapStaticExpression(unwrapped.argumentExpression);
    return (
      isStaticReference(unwrapped.expression) &&
      (ts.isStringLiteral(argument) || ts.isNumericLiteral(argument))
    );
  }
  return false;
}

export function parseStaticTokenValue(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  maxExpressionLength: number,
): StaticTokenValue | null {
  const unwrapped = unwrapStaticExpression(expression);
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return { kind: "string", value: unwrapped.text };
  }
  if (ts.isNumericLiteral(unwrapped)) {
    const value = Number(unwrapped.text);
    return Number.isFinite(value) ? { kind: "number", value } : null;
  }
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    (unwrapped.operator === ts.SyntaxKind.MinusToken ||
      unwrapped.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(unwrapped.operand)
  ) {
    const unsigned = Number(unwrapped.operand.text);
    const value =
      unwrapped.operator === ts.SyntaxKind.MinusToken ? -unsigned : unsigned;
    return Number.isFinite(value) ? { kind: "number", value } : null;
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return { kind: "boolean", value: true };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return { kind: "boolean", value: false };
  }
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "null", value: null };
  }
  if (!isStaticReference(unwrapped)) {
    return null;
  }
  const source = unwrapped.getText(sourceFile).trim();
  if (source.length === 0 || source.length > maxExpressionLength) {
    return null;
  }
  return {
    kind: "reference",
    expression: source,
    resolution: "unresolved",
  };
}
