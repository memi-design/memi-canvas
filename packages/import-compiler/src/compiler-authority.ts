import { hashCanonicalValue } from "@memi/canonical-json";
import {
  ContentHashSchema,
  GitRevisionSchema,
} from "@memi/protocol";
import { z } from "zod";

const HARD_MAX_IMPORT_FILE_BYTES = 64 * 1024 * 1024;

const RepositoryAuthoritySchema = z.strictObject({
  revision: GitRevisionSchema,
  dirty: z.boolean(),
  dirtyFileFingerprint: ContentHashSchema,
});

const ImportReadBudgetsSchema = z
  .strictObject({
    maxFileBytes: z
      .number()
      .int()
      .positive()
      .max(HARD_MAX_IMPORT_FILE_BYTES),
    maxTotalBytes: z.number().int().positive(),
  })
  .refine(
    (budgets) => budgets.maxTotalBytes >= budgets.maxFileBytes,
    "Import total byte budget cannot be smaller than the per-file budget.",
  );

const AdapterVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9@._/-]+$/u);

export interface ImportReadBudgets {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export interface RepositoryAuthority {
  readonly revision: string;
  readonly dirty: boolean;
  readonly dirtyFileFingerprint: string;
}

export interface CompilerAuthorityInput {
  readonly repository: unknown;
  readonly budgets: unknown;
  readonly adapterVersion: unknown;
}

export interface NormalizedCompilerAuthority {
  readonly repository: RepositoryAuthority;
  readonly budgets: ImportReadBudgets;
  readonly adapterVersion: string;
  readonly compilerFingerprint: string;
}

export function normalizeCompilerAuthority(
  input: CompilerAuthorityInput,
  viewports: readonly object[],
): NormalizedCompilerAuthority {
  const parsed = z
    .strictObject({
      repository: RepositoryAuthoritySchema,
      budgets: ImportReadBudgetsSchema,
      adapterVersion: AdapterVersionSchema,
    })
    .safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid compiler authority: ${parsed.error.message}`);
  }
  const normalized = {
    repository: parsed.data.repository,
    budgets: parsed.data.budgets,
    adapterVersion: parsed.data.adapterVersion,
  };
  return {
    ...normalized,
    compilerFingerprint: hashCanonicalValue({
      namespace: "memi.import-compiler.v1",
      protocolVersion: 1,
      ...normalized,
      viewports,
    }),
  };
}
