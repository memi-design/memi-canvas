import {
  ContainedRelativeSourcePathSchema,
  SourceAnchorV2Schema,
} from "@memi/protocol";
import type { SourceAnchorV2 } from "@memi/protocol";

import { hashSourceText } from "./source-hash.js";
import {
  equalStaticValue,
  renderStaticValue,
  validateStaticValue,
} from "./static-values.js";
import {
  collectTargetCandidates,
  parseSource,
  selectUniqueCandidate,
} from "./source-targets.js";
import {
  DeterministicSourceCompilerError,
} from "./types.js";
import type {
  CompileSourceEditInput,
  CreateSourceAnchorInput,
  DeterministicSourceCompileResult,
  DeterministicSourcePatch,
  SourceStaticValue,
} from "./types.js";

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function frozenArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

function validateExpectedValue(value: SourceStaticValue): void {
  validateStaticValue(value);
}

function parseAnchor(value: unknown): SourceAnchorV2 {
  const parsed = SourceAnchorV2Schema.safeParse(value);
  if (!parsed.success) {
    throw new DeterministicSourceCompilerError(
      "invalid-input",
      "Source anchor does not satisfy the V2 contract.",
    );
  }
  return parsed.data;
}

export async function createSourceAnchorForTarget(
  input: CreateSourceAnchorInput,
) {
  validateExpectedValue(input.expectedValue);
  if (!ContainedRelativeSourcePathSchema.safeParse(input.relativePath).success) {
    throw new DeterministicSourceCompilerError(
      "invalid-input",
      "Source path must be a canonical contained relative path.",
    );
  }
  const sourceFile = parseSource(input.relativePath, input.sourceText);
  const selected = selectUniqueCandidate(
    collectTargetCandidates(sourceFile, input.target),
    input.expectedValue,
  );
  const contentHash = await hashSourceText(input.sourceText);
  return parseAnchor({
    astPath: [...selected.astPath],
    componentIdentity: input.componentIdentity,
    contentHash,
    dirtyFingerprint: input.dirtyFingerprint,
    path: input.relativePath,
    range: {
      end: selected.end,
      start: selected.start,
    },
    runtimeEvidenceRefs: [...input.runtimeEvidenceRefs],
    sourceRevision: input.sourceRevision,
    symbol: selected.symbol,
  });
}

function anchorCandidate(
  input: CompileSourceEditInput,
) {
  const sourceFile = parseSource(input.anchor.path, input.sourceText);
  const candidates = collectTargetCandidates(sourceFile, input.edit.target);
  const exact = candidates.filter(
    (candidate) =>
      candidate.start === input.anchor.range.start &&
      candidate.end === input.anchor.range.end,
  );
  if (exact.length !== 1) {
    throw new DeterministicSourceCompilerError(
      "anchor-target-mismatch",
      "The source anchor range no longer resolves to exactly one target.",
    );
  }
  const selected = exact[0];
  if (
    selected === undefined ||
    selected.symbol !== input.anchor.symbol ||
    !sameStrings(selected.astPath, input.anchor.astPath)
  ) {
    throw new DeterministicSourceCompilerError(
      "anchor-target-mismatch",
      "The source anchor identity no longer matches the AST target.",
    );
  }
  return selected;
}

function freezePatch(
  patch: DeterministicSourcePatch,
): DeterministicSourcePatch {
  const replacements = frozenArray(
    patch.replacements.map((replacement) =>
      Object.freeze({ ...replacement }),
    ),
  );
  return Object.freeze({ ...patch, replacements });
}

function freezeResult(
  result: DeterministicSourceCompileResult,
): DeterministicSourceCompileResult {
  return Object.freeze({
    ...result,
    changedRange: Object.freeze({ ...result.changedRange }),
    patch: freezePatch(result.patch),
  });
}

export async function compileSourceEdit(
  input: CompileSourceEditInput,
): Promise<DeterministicSourceCompileResult> {
  const anchor = parseAnchor(input.anchor);
  const normalizedInput = { ...input, anchor };
  validateStaticValue(input.edit.before);
  validateStaticValue(input.edit.after);
  if (equalStaticValue(input.edit.before, input.edit.after)) {
    throw new DeterministicSourceCompilerError(
      "no-op",
      "The requested deterministic source edit has no semantic change.",
    );
  }
  const beforeHash = await hashSourceText(input.sourceText);
  if (beforeHash !== anchor.contentHash) {
    throw new DeterministicSourceCompilerError(
      "anchor-hash-mismatch",
      "The source file hash no longer matches the canvas anchor.",
    );
  }
  const selected = anchorCandidate(normalizedInput);
  if (!equalStaticValue(selected.value, input.edit.before)) {
    throw new DeterministicSourceCompilerError(
      "stale-value",
      "The source target no longer has the expected semantic value.",
    );
  }
  const beforeText = input.sourceText.slice(
    selected.start,
    selected.end,
  );
  const afterText = renderStaticValue(
    input.edit.after,
    beforeText,
    selected.jsxAttribute,
  );
  if (afterText === beforeText) {
    throw new DeterministicSourceCompilerError(
      "no-op",
      "The requested deterministic source edit has no textual change.",
    );
  }
  const updatedSource = `${input.sourceText.slice(0, selected.start)}${afterText}${input.sourceText.slice(selected.end)}`;
  const afterHash = await hashSourceText(updatedSource);
  const patch = freezePatch({
    expectedBeforeHash: beforeHash,
    relativePath: anchor.path,
    replacements: [{ after: afterText, before: beforeText }],
    summary: `Set ${anchor.symbol} from ${beforeText} to ${afterText}.`,
  });
  return freezeResult({
    afterHash,
    afterText: updatedSource,
    beforeHash,
    changedRange: {
      end: selected.end,
      start: selected.start,
    },
    patch,
    zeroToken: true,
  });
}
