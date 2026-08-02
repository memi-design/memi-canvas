import type { SourceAnchorV2 } from "@memi/protocol";

export type SourcePrimitiveValue =
  | {
      readonly kind: "string";
      readonly value: string;
    }
  | {
      readonly kind: "number";
      readonly value: number;
    }
  | {
      readonly kind: "boolean";
      readonly value: boolean;
    };

export interface SourceTokenReference {
  readonly kind: "token-reference";
  readonly path: readonly string[];
}

export type SourceStaticValue =
  | SourcePrimitiveValue
  | SourceTokenReference;

export interface JsxAttributeTarget {
  readonly kind: "jsx-attribute";
  readonly elementName: string;
  readonly attributeName: string;
}

export interface ConstantTarget {
  readonly kind: "constant";
  readonly declarationName: string;
}

export interface ObjectPropertyTarget {
  readonly kind: "object-property";
  readonly declarationName: string;
  readonly propertyPath: readonly string[];
}

export interface StylePropertyTarget {
  readonly kind: "style-property";
  readonly declarationName: string;
  readonly propertyPath: readonly string[];
}

export type SourceTarget =
  | JsxAttributeTarget
  | ConstantTarget
  | ObjectPropertyTarget
  | StylePropertyTarget;

export interface SourceEdit {
  readonly target: SourceTarget;
  readonly before: SourceStaticValue;
  readonly after: SourceStaticValue;
}

export interface CreateSourceAnchorInput {
  readonly componentIdentity: string | null;
  readonly dirtyFingerprint: `sha256:${string}`;
  readonly expectedValue: SourceStaticValue;
  readonly relativePath: string;
  readonly runtimeEvidenceRefs: readonly string[];
  readonly sourceRevision: string;
  readonly sourceText: string;
  readonly target: SourceTarget;
}

export interface CompileSourceEditInput {
  readonly anchor: SourceAnchorV2;
  readonly edit: SourceEdit;
  readonly sourceText: string;
}

export interface SourceTextReplacement {
  readonly before: string;
  readonly after: string;
}

export interface DeterministicSourcePatch {
  readonly expectedBeforeHash: `sha256:${string}`;
  readonly relativePath: string;
  readonly replacements: readonly SourceTextReplacement[];
  readonly summary: string;
}

export interface DeterministicSourceCompileResult {
  readonly zeroToken: true;
  readonly afterHash: `sha256:${string}`;
  readonly afterText: string;
  readonly beforeHash: `sha256:${string}`;
  readonly changedRange: {
    readonly start: number;
    readonly end: number;
  };
  readonly patch: DeterministicSourcePatch;
}

export type DeterministicSourceCompilerErrorCode =
  | "ambiguous-target"
  | "anchor-hash-mismatch"
  | "anchor-target-mismatch"
  | "invalid-input"
  | "no-op"
  | "parse-error"
  | "stale-value"
  | "target-not-found"
  | "unsupported-value";

export class DeterministicSourceCompilerError extends Error {
  readonly code: DeterministicSourceCompilerErrorCode;

  constructor(
    code: DeterministicSourceCompilerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeterministicSourceCompilerError";
    this.code = code;
  }
}
