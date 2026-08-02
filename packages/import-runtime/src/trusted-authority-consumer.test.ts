import { DatabaseSync } from "node:sqlite";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import { compileCanvasOperations } from "@memi/product-import";
import {
  ProjectIdSchema,
  RunIdSchema,
  computeTrustedAuthorityBatchRoot,
  type CanvasOperation,
  type ContentHash,
  type DurableCommand,
  type RunId,
} from "@memi/protocol";
import { describe, expect, it } from "vitest";

import {
  executeApprovedImportBatch,
  issueApprovedImportAuthorityBatch,
  reserveApprovedImportAuthorityBatch,
  validateImportRuntimeEvidence,
} from "./index.js";
import {
  HUMAN_APPROVAL_ROOT,
  cleanupFixture,
  humanDecision,
  productPlan,
  runtimeFixture,
} from "../test-support.js";

interface ReservedConsumerEntry {
  readonly reservationRequest: object;
  readonly reservation: {
    readonly id: string;
    readonly requestDigest: ContentHash;
    readonly challenge: string;
    readonly grantId: string;
    readonly approvalId: string;
  };
  readonly command: DurableCommand;
  readonly operation: CanvasOperation;
}

interface ReservedConsumerBatch {
  readonly schemaVersion: 1;
  readonly kind: string;
  readonly batchDigest: ContentHash;
  readonly batchRootDigest: ContentHash;
  readonly workspaceDigest: ContentHash;
  readonly planDigest: ContentHash;
  readonly projectId: string;
  readonly documentId: string;
  readonly runId: RunId;
  readonly entries: readonly ReservedConsumerEntry[];
  readonly [key: string]: unknown;
}

interface InternalAuthoritySnapshot {
  readonly counts: Readonly<Record<string, number>>;
  readonly signedReviewedContext: {
    readonly workspaceDigest: ContentHash;
    readonly planDigest: ContentHash;
    readonly batchRootDigest: ContentHash;
  };
  readonly observedRuntimeWork: {
    readonly commandKinds: readonly string[];
    readonly targetKinds: readonly string[];
    readonly outsideBatchCommandIds: readonly string[];
  };
}

interface PublicAuthoritySummary {
  readonly snapshotDigest: ContentHash;
  readonly lineage: InternalAuthoritySnapshot["signedReviewedContext"];
  readonly counts: InternalAuthoritySnapshot["counts"];
  readonly observedCommandKinds: readonly string[];
  readonly observedTargetKinds: readonly string[];
  readonly unexpectedCommandIds: readonly string[];
}

function databaseBytes(path: string): string {
  const database = new DatabaseSync(path);
  const tables = (
    database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all() as unknown as readonly { readonly name: string }[]
  ).map((row) => row.name);
  const snapshot = tables.map((table) => ({
    table,
    rows: database
      .prepare(`SELECT * FROM "${table}" ORDER BY rowid`)
      .all(),
  }));
  database.close();
  return canonicalJson(snapshot);
}

function signer(plan: Awaited<ReturnType<typeof productPlan>>["plan"]) {
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

function recomputeOuterDigest(
  input: ReservedConsumerBatch,
): ReservedConsumerBatch {
  const { batchDigest: _oldDigest, ...body } =
    structuredClone(input);
  return {
    ...body,
    batchDigest: hashCanonicalValue(body),
  } as ReservedConsumerBatch;
}

function mutableBatch(input: ReservedConsumerBatch) {
  return structuredClone(input) as unknown as {
    schemaVersion: 1;
    kind: string;
    batchDigest: ContentHash;
    batchRootDigest: ContentHash;
    workspaceDigest: ContentHash;
    planDigest: ContentHash;
    projectId: string;
    documentId: string;
    runId: RunId;
    entries: ReservedConsumerEntry[];
    [key: string]: unknown;
  };
}

const ordinalCorrespondenceCases = Array.from(
  { length: 18 },
  (_, ordinal) =>
    ([
      [ordinal, "operation"],
      [ordinal, "action"],
      [ordinal, "command-reservation"],
    ] as const),
).flat();

function tamperCorrespondence(
  input: ReservedConsumerBatch,
  ordinal: number,
  kind:
    | "operation"
    | "action"
    | "command-reservation",
): ReservedConsumerBatch {
  const changed = mutableBatch(input);
  const entry = changed.entries[ordinal];
  const neighbor =
    changed.entries[(ordinal + 1) % changed.entries.length];
  if (entry === undefined || neighbor === undefined) {
    throw new Error("Ordinal correspondence fixture is incomplete.");
  }
  if (kind === "operation") {
    changed.entries[ordinal] = {
      ...entry,
      operation: structuredClone(neighbor.operation),
    };
  } else if (kind === "action") {
    changed.entries[ordinal] = {
      ...entry,
      operation: {
        ...entry.operation,
        actionDigest: neighbor.operation.actionDigest,
      },
    };
  } else {
    changed.entries[ordinal] = {
      ...entry,
      reservationRequest: structuredClone(
        neighbor.reservationRequest,
      ),
      reservation: structuredClone(neighbor.reservation),
    };
  }
  return recomputeOuterDigest(changed as ReservedConsumerBatch);
}

describe("import runtime trusted authority consumer", () => {
  it("reserves 18 unique opaque challenges, signs final commands, and emits bounded measured evidence", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    const signedPayloads: object[] = [];
    try {
      const operations = compileCanvasOperations(plan, workspace);
      const batchRootDigest = computeTrustedAuthorityBatchRoot({
        schemaVersion: 1,
        kind: "memi-import-authority-batch-root",
        projectId: plan.projectId,
        documentId: plan.documentId,
        workspaceDigest: workspace.workspaceDigest,
        planDigest: plan.planDigest,
        operations: operations.map((operation, ordinal) => ({
          ordinal,
          operationId: operation.id,
          actionDigest: operation.actionDigest,
        })),
      });
      const reserved =
        (await reserveApprovedImportAuthorityBatch(
          fixture.runtime,
          workspace,
          plan,
          fixture.lease,
          humanDecision(plan),
        )) as unknown as ReservedConsumerBatch;

      expect(reserved.batchRootDigest).toBe(batchRootDigest);
      expect(reserved.entries).toHaveLength(18);
      expect(
        new Set(
          reserved.entries.map((entry) => entry.reservation.id),
        ).size,
      ).toBe(18);
      expect(
        new Set(
          reserved.entries.map(
            (entry) => entry.reservation.challenge,
          ),
        ).size,
      ).toBe(18);
      expect(
        new Set(
          reserved.entries.flatMap((entry) => [
            entry.reservation.grantId,
            entry.reservation.approvalId,
          ]),
        ).size,
      ).toBe(36);
      for (const entry of reserved.entries) {
        expect(entry.reservation.requestDigest).toBe(
          hashCanonicalValue(entry.reservationRequest),
        );
        expect(entry.reservationRequest).not.toHaveProperty(
          "desiredGrantId",
        );
        expect(entry.reservationRequest).not.toHaveProperty(
          "desiredApprovalId",
        );
        expect(entry.command.authority).toMatchObject({
          capabilityGrantId: entry.reservation.grantId,
          approvalReceiptId: entry.reservation.approvalId,
        });
        expect(entry.command.kind).toBe("canvas.operation");
        expect(entry.command.requiredCapabilities).toEqual([
          "canvas:apply",
        ]);
      }

      const issued =
        (await issueApprovedImportAuthorityBatch(
          fixture.runtime,
          workspace,
          plan,
          reserved as never,
          {
            ...signer(plan),
            sign(unsignedIssuance: object) {
              signedPayloads.push(structuredClone(unsignedIssuance));
              return HUMAN_APPROVAL_ROOT.sign(unsignedIssuance);
            },
          },
        )) as unknown as ReservedConsumerBatch;
      expect(signedPayloads).toHaveLength(18);
      for (const [index, payload] of signedPayloads.entries()) {
        const entry = reserved.entries[index]!;
        expect(payload).toMatchObject({
          schemaVersion: 1,
          kind: "trusted-command-authority-issuance",
          reservationId: entry.reservation.id,
          reservationRequestDigest:
            entry.reservation.requestDigest,
          challenge: entry.reservation.challenge,
          grantId: entry.reservation.grantId,
          approvalId: entry.reservation.approvalId,
          projectId: plan.projectId,
          commandId: entry.command.id,
          operationId: entry.operation.id,
          actionDigest: entry.command.actionDigest,
          leaseId: fixture.lease.id,
          fencingEpoch: fixture.lease.fencingEpoch,
          reviewedContext: {
            workspaceDigest: workspace.workspaceDigest,
            planDigest: plan.planDigest,
            batchRootDigest,
          },
        });
      }

      const result = await executeApprovedImportBatch(
        fixture.runtime,
        workspace,
        plan,
        issued as never,
      );
      const measured =
        fixture.runtime.getExecutionAuthoritySnapshot({
          schemaVersion: 1,
          projectId: plan.projectId,
          runId: issued.runId,
          batchRootDigest,
        }) as unknown as InternalAuthoritySnapshot;
      const evidence = result.evidence as typeof result.evidence & {
        readonly authoritySummary: PublicAuthoritySummary;
      };
      expect(evidence.authoritySummary).toEqual({
        snapshotDigest: hashCanonicalValue(measured),
        lineage: measured.signedReviewedContext,
        counts: measured.counts,
        observedCommandKinds:
          measured.observedRuntimeWork.commandKinds,
        observedTargetKinds:
          measured.observedRuntimeWork.targetKinds,
        unexpectedCommandIds:
          measured.observedRuntimeWork.outsideBatchCommandIds,
      });
      expect(evidence).not.toHaveProperty("executionAuthority");
      expect(evidence.authoritySummary).not.toHaveProperty("rows");
      expect(evidence.authoritySummary).not.toHaveProperty(
        "observedCommandIds",
      );
      expect(evidence).not.toHaveProperty("metrics");
      const evidenceText = canonicalJson(evidence);
      expect(Buffer.byteLength(evidenceText)).toBeLessThanOrEqual(
        4_096,
      );
      expect(evidenceText).not.toMatch(
        /(?:signature|challenge|approver|keyId|publicKey|command_json|receipt_json|\/Users\/|\/Volumes\/)/iu,
      );
      expect(validateImportRuntimeEvidence(evidence)).toEqual(
        evidence,
      );
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it.each(ordinalCorrespondenceCases)(
    "rejects ordinal %i %s correspondence tamper before any issuance, command, or effect",
    async (ordinal, kind) => {
      const { workspace, plan } = await productPlan();
      const fixture = await runtimeFixture(plan);
      try {
        const reserved =
          (await reserveApprovedImportAuthorityBatch(
            fixture.runtime,
            workspace,
            plan,
            fixture.lease,
            humanDecision(plan),
          )) as unknown as ReservedConsumerBatch;
        const changed = tamperCorrespondence(
          reserved,
          ordinal,
          kind,
        );
        const runtimeBefore = databaseBytes(fixture.runtimePath);
        const targetBefore = databaseBytes(fixture.targetPath);

        await expect(
          issueApprovedImportAuthorityBatch(
            fixture.runtime,
            workspace,
            plan,
            changed as never,
            signer(plan),
          ),
        ).rejects.toThrow(
          /action|batch|command|digest|entry|operation|reservation/i,
        );
        expect(databaseBytes(fixture.runtimePath)).toBe(
          runtimeBefore,
        );
        expect(databaseBytes(fixture.targetPath)).toBe(targetBefore);
      } finally {
        await cleanupFixture(fixture);
      }
    },
  );

  it.each([
    "reordered entries",
    "removed entry",
    "duplicate entry",
    "foreign reservation",
    "foreign entry",
    "changed run",
    "changed project",
    "changed workspace",
    "changed plan",
    "changed batch root",
  ])("rejects %s before any issuance or execution mutation", async (kind) => {
    const primary = await productPlan();
    const alternate = await productPlan({
      revision: "1123456789abcdef0123456789abcdef01234567",
    });
    const foreign = await productPlan({
      projectId: ProjectIdSchema.parse(
        "prj_0000000000000000000000000V",
      ),
      revision: "2123456789abcdef0123456789abcdef01234567",
    });
    const fixture = await runtimeFixture(primary.plan);
    const foreignFixture = await runtimeFixture(foreign.plan);
    try {
      const reserved =
        (await reserveApprovedImportAuthorityBatch(
          fixture.runtime,
          primary.workspace,
          primary.plan,
          fixture.lease,
          humanDecision(primary.plan),
        )) as unknown as ReservedConsumerBatch;
      const foreignReserved =
        (await reserveApprovedImportAuthorityBatch(
          foreignFixture.runtime,
          foreign.workspace,
          foreign.plan,
          foreignFixture.lease,
          humanDecision(foreign.plan),
        )) as unknown as ReservedConsumerBatch;
      const changed = mutableBatch(reserved);
      if (kind === "reordered entries") {
        changed.entries.reverse();
      } else if (kind === "removed entry") {
        changed.entries.pop();
      } else if (kind === "duplicate entry") {
        changed.entries[17] = changed.entries[0]!;
      } else if (kind === "foreign reservation") {
        changed.entries[0] = {
          ...changed.entries[0]!,
          reservation:
            foreignReserved.entries[0]!.reservation,
        };
      } else if (kind === "foreign entry") {
        changed.entries[0] = foreignReserved.entries[0]!;
      } else if (kind === "changed run") {
        changed.runId = RunIdSchema.parse(
          "run_0000000000000000000000000V",
        );
      } else if (kind === "changed project") {
        changed.projectId = foreign.plan.projectId;
      } else if (kind === "changed workspace") {
        changed.workspaceDigest =
          alternate.workspace.workspaceDigest;
      } else if (kind === "changed plan") {
        changed.planDigest = alternate.plan.planDigest;
      } else {
        changed.batchRootDigest =
          foreignReserved.batchRootDigest;
      }
      const redigested = recomputeOuterDigest(
        changed as ReservedConsumerBatch,
      );
      const before = databaseBytes(fixture.runtimePath);

      await expect(
        issueApprovedImportAuthorityBatch(
          fixture.runtime,
          primary.workspace,
          primary.plan,
          redigested as never,
          signer(primary.plan),
        ),
      ).rejects.toThrow(
        /batch|digest|entry|foreign|lineage|plan|project|reservation|run|workspace/i,
      );
      expect(databaseBytes(fixture.runtimePath)).toBe(before);
    } finally {
      await cleanupFixture(fixture);
      await cleanupFixture(foreignFixture);
    }
  });
});
