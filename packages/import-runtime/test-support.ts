import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import { createCanvasDocument } from "@memi/canvas-document";
import { CanvasTargetAuthority } from "@memi/canvas-target";
import { compileProductImport } from "@memi/import-compiler";
import {
  compileProductWorkspace,
  createCanvasMaterializationPlan,
  type CanvasMaterializationPlan,
  type ProductWorkspace,
} from "@memi/product-import";
import {
  LeaseSchema,
  LeaseIdSchema,
  ProjectIdSchema,
  type ProjectId,
  type Lease,
} from "@memi/protocol";
import { DurableRuntime } from "@memi/runtime";

import {
  IMPORT_BATCH_CONSEQUENCE,
  issueApprovedImportAuthorityBatch,
  reserveApprovedImportAuthorityBatch,
  type IssuedImportAuthorityBatch,
  type HumanImportBatchDecision,
} from "./src/index.js";

export const NOW = "2026-07-28T12:00:00.000Z";
export const DECISION_EXPIRY = "2026-07-28T12:05:00.000Z";
export const PROJECT_ID = ProjectIdSchema.parse(
  "prj_01J00000000000000000000000",
);
export const FIXTURE_ROOT = fileURLToPath(
  new URL("../test-fixtures/deterministic-product/", import.meta.url),
);

export const HUMAN_APPROVAL_ROOT = (() => {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyDer = pair.publicKey.export({
    format: "der",
    type: "spki",
  });
  return Object.freeze({
    trustRootId: "local-human-approval-root",
    keyId: "product-designer-key",
    fingerprint:
      `sha256:${createHash("sha256")
        .update(publicKeyDer)
        .digest("hex")}` as const,
    publicKeyPem: pair.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
    sign(payload: object) {
      return sign(
        null,
        Buffer.from(canonicalJson(payload)),
        pair.privateKey,
      ).toString("base64");
    },
  });
})();

export interface RuntimeFixture {
  readonly directory: string;
  readonly runtimePath: string;
  readonly targetPath: string;
  readonly target: CanvasTargetAuthority;
  readonly runtime: DurableRuntime;
  readonly lease: Lease;
  readonly genericExecutorCallCount: () => number;
}

export interface ProductPlanFixture {
  readonly workspace: ProductWorkspace;
  readonly plan: CanvasMaterializationPlan;
}

export async function productPlan(
  options: {
    readonly projectId?: ProjectId;
    readonly revision?: string;
  } = {},
): Promise<ProductPlanFixture> {
  const imported = await compileProductImport({
    rootDir: FIXTURE_ROOT,
    projectId: options.projectId ?? PROJECT_ID,
    repository: {
      revision:
        options.revision ??
        "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
    },
    adapterVersion: "vite-react-static@1",
    budgets: {
      maxFileBytes: 64 * 1024,
      maxTotalBytes: 256 * 1024,
    },
  });
  const workspace = compileProductWorkspace(imported);
  return {
    workspace,
    plan: createCanvasMaterializationPlan(workspace, {
      actorId: "memi-import-pipeline",
      occurredAt: NOW,
    }),
  };
}

export function humanDecision(
  plan: CanvasMaterializationPlan,
  overrides: Partial<HumanImportBatchDecision> = {},
): HumanImportBatchDecision {
  return {
    schemaVersion: 1,
    kind: "human-import-batch-decision",
    outcome: "approved",
    projectId: plan.projectId,
    planId: plan.planId,
    planDigest: plan.planDigest,
    documentId: plan.documentId,
    approver: {
      kind: "human",
      id: "product-designer-01",
    },
    issuedAt: NOW,
    expiresAt: DECISION_EXPIRY,
    consequence: IMPORT_BATCH_CONSEQUENCE,
    ...overrides,
  };
}

export async function runtimeFixture(
  plan: CanvasMaterializationPlan,
): Promise<RuntimeFixture> {
  const directory = await mkdtemp(join(tmpdir(), "memi-import-runtime-"));
  const runtimePath = join(directory, "runtime.sqlite");
  const targetPath = join(directory, "target.sqlite");
  const target = new CanvasTargetAuthority({
    databasePath: targetPath,
    clock: () => NOW,
  });
  target.createDocument(
    createCanvasDocument({
      id: plan.documentId,
      projectId: plan.projectId,
    }),
  );
  let genericExecutorCalls = 0;
  const runtime = new DurableRuntime({
    databasePath: runtimePath,
    clock: () => NOW,
    canvasTarget: target,
    effectExecutor: {
      execute: () => {
        genericExecutorCalls += 1;
        throw new Error("Generic effect executor must not run.");
      },
    },
    approvalTrustRoots: [
      {
        id: HUMAN_APPROVAL_ROOT.trustRootId,
        consequence: IMPORT_BATCH_CONSEQUENCE,
        keys: [
          {
            keyId: HUMAN_APPROVAL_ROOT.keyId,
            publicKeyPem: HUMAN_APPROVAL_ROOT.publicKeyPem,
            approverId: "product-designer-01",
          },
        ],
      },
    ],
  } as ConstructorParameters<typeof DurableRuntime>[0] & {
    readonly approvalTrustRoots: readonly unknown[];
  });
  const acquired = runtime.acquireLease({
    leaseId: LeaseIdSchema.parse("lse_01J00000000000000000000000"),
    projectId: plan.projectId,
    targetId: plan.documentId,
    holderId: "import-runtime",
    ttlMilliseconds: 10 * 60 * 1_000,
  });
  const lease = await runtime.activateCanvasLease({
    projectId: acquired.projectId,
    targetId: acquired.targetId,
    leaseId: acquired.id,
    fencingEpoch: acquired.fencingEpoch,
  });
  return {
    directory,
    runtimePath,
    targetPath,
    target,
    runtime,
    lease: LeaseSchema.parse(lease),
    genericExecutorCallCount: () => genericExecutorCalls,
  };
}

export function approvalSigner(plan: CanvasMaterializationPlan) {
  return {
    approver: {
      kind: "human" as const,
      id: humanDecision(plan).approver.id,
      keyId: HUMAN_APPROVAL_ROOT.keyId,
    },
    trustRootId: HUMAN_APPROVAL_ROOT.trustRootId,
    trustRootFingerprint: HUMAN_APPROVAL_ROOT.fingerprint,
    signatureAlgorithm: "ed25519" as const,
    sign: HUMAN_APPROVAL_ROOT.sign,
  };
}

export async function approvedBatch(
  fixture: RuntimeFixture,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
): Promise<IssuedImportAuthorityBatch> {
  const reserved = await reserveApprovedImportAuthorityBatch(
    fixture.runtime,
    workspace,
    plan,
    fixture.lease,
    humanDecision(plan),
  );
  return issueApprovedImportAuthorityBatch(
    fixture.runtime,
    workspace,
    plan,
    reserved,
    approvalSigner(plan),
  );
}

export async function cleanupFixture(
  fixture: RuntimeFixture,
): Promise<void> {
  fixture.runtime.close();
  fixture.target.close();
  await rm(fixture.directory, { force: true, recursive: true });
}

interface TreeEntry {
  readonly path: string;
  readonly kind: "directory" | "file" | "symlink";
  readonly mode: number;
  readonly size: number;
  readonly contentHash?: string;
}

async function collectTree(
  root: string,
  path: string,
  entries: TreeEntry[],
): Promise<void> {
  const stats = await lstat(path);
  const normalized = relative(root, path).replaceAll("\\", "/") || ".";
  if (stats.isSymbolicLink()) {
    entries.push({
      path: normalized,
      kind: "symlink",
      mode: stats.mode,
      size: stats.size,
    });
    return;
  }
  if (stats.isDirectory()) {
    entries.push({
      path: normalized,
      kind: "directory",
      mode: stats.mode,
      size: stats.size,
    });
    for (const child of (await readdir(path)).sort()) {
      await collectTree(root, join(path, child), entries);
    }
    return;
  }
  const bytes = await readFile(path);
  entries.push({
    path: normalized,
    kind: "file",
    mode: stats.mode,
    size: stats.size,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
}

export async function sourceTreeDigest(): Promise<string> {
  const entries: TreeEntry[] = [];
  await collectTree(FIXTURE_ROOT, FIXTURE_ROOT, entries);
  return hashCanonicalValue(entries);
}

export function databaseCounts(runtimePath: string, targetPath: string): {
  readonly commands: number;
  readonly outbox: number;
  readonly grants: number;
  readonly approvals: number;
  readonly targetReceipts: number;
  readonly targetAuthorityReceipts: number;
  readonly acceptedVerificationAttempts: number;
  readonly traceBindings: number;
  readonly events: number;
  readonly projections: number;
  readonly canonicalReceipts: number;
  readonly latches: number;
} {
  const database = new DatabaseSync(runtimePath);
  const count = (table: string): number =>
    Number(
      (
        database
          .prepare(`SELECT count(*) AS count FROM "${table}"`)
          .get() as { readonly count: number }
      ).count,
    );
  const result = {
    commands: count("commands"),
    outbox: count("outbox"),
    grants: count("capability_grants"),
    approvals: count("approval_receipts"),
    targetReceipts: count("target_receipts"),
    targetAuthorityReceipts: 0,
    acceptedVerificationAttempts: Number(
      (
        database
          .prepare(
            `SELECT count(*) AS count
             FROM target_verification_attempts
             WHERE state = 'accepted'`,
          )
          .get() as { readonly count: number }
      ).count,
    ),
    traceBindings: count("trace_effect_bindings"),
    events: count("trace_events"),
    projections: count("trace_projection_outbox"),
    canonicalReceipts: count("effect_receipts"),
    latches: count("target_schedule_latches"),
  };
  database.close();
  const target = new DatabaseSync(targetPath);
  const targetAuthorityReceipts = Number(
    (
      target
        .prepare("SELECT count(*) AS count FROM receipts")
        .get() as { readonly count: number }
    ).count,
  );
  target.close();
  return { ...result, targetAuthorityReceipts };
}
