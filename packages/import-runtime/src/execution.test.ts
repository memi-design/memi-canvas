import { DatabaseSync } from "node:sqlite";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  hashCanonicalValue,
} from "@memi/canonical-json";
import { compileCanvasOperations } from "@memi/product-import";
import {
  computeTrustedAuthorityBatchRoot,
  type ContentHash,
} from "@memi/protocol";
import type { DurableRuntime } from "@memi/runtime";

import {
  IMPORT_RUNTIME_EVIDENCE_RELATIVE_PATH,
  executeApprovedImportBatch,
  validateImportRuntimeEvidence,
} from "./index.js";
import {
  approvedBatch,
  cleanupFixture,
  databaseCounts,
  productPlan,
  runtimeFixture,
  sourceTreeDigest,
} from "../test-support.js";

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

interface ProductionSource {
  readonly path: string;
  readonly source: string;
}

async function productionSources(
  directory = resolve(
    process.cwd(),
    "packages/import-runtime/src",
  ),
): Promise<readonly ProductionSource[]> {
  const nested = await Promise.all(
    (await readdir(directory, { withFileTypes: true })).map(
      async (entry): Promise<readonly ProductionSource[]> => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          return productionSources(path);
        }
        if (
          !entry.isFile() ||
          !entry.name.endsWith(".ts") ||
          entry.name.endsWith(".test.ts")
        ) {
          return [];
        }
        return [
          {
            path: relative(process.cwd(), path).replaceAll("\\", "/"),
            source: await readFile(path, "utf8"),
          },
        ];
      },
    ),
  );
  return nested.flat().sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function terminalRows(path: string): {
  readonly operationIds: readonly string[];
  readonly committedCommands: number;
} {
  const database = new DatabaseSync(path);
  const operationIds = (
    database
      .prepare(
        `SELECT json_extract(event_json, '$.operationId') AS operation_id
         FROM trace_events ORDER BY sequence`,
      )
      .all() as unknown as readonly { readonly operation_id: string }[]
  ).map((row) => row.operation_id);
  const committedCommands = Number(
    (
      database
        .prepare(
          `SELECT count(*) AS count FROM commands
           WHERE state = 'committed'`,
        )
        .get() as { readonly count: number }
    ).count,
  );
  database.close();
  return { operationIds, committedCommands };
}

describe("approved import batch execution", () => {
  it("has no production import or source path to process, network, Git, or deploy effects", async () => {
    const forbiddenCore =
      /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["'](?:node:)?(?:child_process|net|http|https|tls|dgram|worker_threads)(?:\/[^"']*)?["']/u;
    const forbiddenSdk =
      /(?:from\s+|import\s+|import\s*\(\s*|require\s*\(\s*)["'](?:undici|node-fetch|axios|got|ky|@octokit(?:\/[^"']+)?|octokit|simple-git|isomorphic-git|nodegit|@gitbeaker(?:\/[^"']+)?|@vercel(?:\/[^"']+)?|vercel|@netlify(?:\/[^"']+)?|netlify|wrangler|@cloudflare(?:\/[^"']+)?|@aws-sdk(?:\/[^"']+)?|aws-sdk|firebase-admin|@google-cloud(?:\/[^"']+)?|@azure(?:\/[^"']+)?|heroku-client|digitalocean|@pulumi(?:\/[^"']+)?|cdktf|flyctl|railway)["']/u;
    const forbiddenPrimitive =
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(|\bprocess\s*\.|\b(?:Deno|Bun)\s*\./u;
    const forbiddenEffectCall =
      /\b(?:git|deploy|publish|pushToRemote|createDeployment)\s*\(/u;
    const violations = (await productionSources()).flatMap(
      ({ path, source }) =>
        [
          ["forbidden core module", forbiddenCore],
          ["network, Git, or deploy SDK", forbiddenSdk],
          ["host effect primitive", forbiddenPrimitive],
          ["Git or deploy effect", forbiddenEffectCall],
        ].flatMap(([label, pattern]) =>
          (pattern as RegExp).test(source)
            ? [`${path}: ${label as string}`]
            : [],
        ),
    );

    expect(violations).toEqual([]);
  });

  it("materializes the real 18-operation plan through target and canonical trace", async () => {
    const sourceBefore = await sourceTreeDigest();
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const batch = await approvedBatch(fixture, workspace, plan);
      let fetchCalls = 0;
      const result = await (async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => {
          fetchCalls += 1;
          throw new Error("Import execution must not call fetch.");
        }) as typeof globalThis.fetch;
        try {
          return await executeApprovedImportBatch(
            fixture.runtime,
            workspace,
            plan,
            batch,
          );
        } finally {
          globalThis.fetch = originalFetch;
        }
      })();

      expect(result).toMatchObject({
        batchDigest: batch.batchDigest,
        committedCount: 18,
        totalCount: 18,
      });
      expect(result.commandIds).toEqual(
        batch.entries.map((entry) => entry.command.id),
      );
      expect(databaseCounts(fixture.runtimePath, fixture.targetPath)).toEqual({
        commands: 18,
        outbox: 18,
        grants: 18,
        approvals: 18,
        targetReceipts: 18,
        targetAuthorityReceipts: 18,
        acceptedVerificationAttempts: 18,
        traceBindings: 18,
        events: 18,
        projections: 18,
        canonicalReceipts: 18,
        latches: 0,
      });
      for (const entry of batch.entries) {
        expect(fixture.runtime.getOutboxForCommand(entry.command.id)).toMatchObject({
          phase: "committed",
        });
        expect(fixture.runtime.getEffectReceipt(entry.command.id)).toBeDefined();
        expect(fixture.runtime.getTargetReceipt(entry.command.id)).toBeDefined();
        expect(fixture.runtime.getGrantUsage(entry.grant.id)).toBe(1);
        expect(fixture.runtime.getApprovalUsage(entry.approval.id)).toBe(1);
      }
      const document = fixture.target.readDocument(
        plan.projectId,
        plan.documentId,
      );
      expect(document).toMatchObject({
        revision: 18,
        stateHash: plan.finalDocument.stateHash,
        operationCursor: plan.finalDocument.operationCursor,
      });
      expect(document.nodes).toHaveLength(18);
      expect(document.appliedOperations.map((operation) => operation.id)).toEqual(
        batch.entries.map((entry) => entry.operation.id),
      );
      fixture.target.close();

      const replay = fixture.runtime.replayCanvasTrace(plan.projectId);
      expect(replay).toMatchObject({
        lastSequence: 18,
      });
      expect(replay.events).toHaveLength(18);
      expect(replay.events.map((event) => event.sequence)).toEqual(
        Array.from({ length: 18 }, (_, index) => index + 1),
      );
      expect(replay.events.map((event) => event.previousEventHash)).toEqual([
        null,
        ...replay.events.slice(0, -1).map((event) => event.eventHash),
      ]);
      expect(replay.events.map((event) => event.operationId)).toEqual(
        batch.entries.map((entry) => entry.operation.id),
      );
      expect(terminalRows(fixture.runtimePath)).toEqual({
        operationIds: batch.entries.map((entry) => entry.operation.id),
        committedCommands: 18,
      });
      expect(canonicalJson(replay)).not.toContain("import.completed");
      expect(await sourceTreeDigest()).toBe(sourceBefore);
      expect(fetchCalls).toBe(0);
      expect(fixture.genericExecutorCallCount()).toBe(0);

      const evidence = validateImportRuntimeEvidence(result.evidence);
      expect(evidence).toMatchObject({
        schemaVersion: 1,
        kind: "import-runtime-e2e",
        batchDigest: batch.batchDigest,
        planDigest: plan.planDigest,
        initialStateHash: plan.initialDocument.stateHash,
        finalStateHash: plan.finalDocument.stateHash,
        lastEventHash: replay.lastEventHash,
        counts: {
          operations: 18,
          targetReceipts: 18,
          committedReceipts: 18,
          traceEvents: 18,
          projectionIntents: 18,
        },
      });
      expect(evidence).not.toHaveProperty("metrics");
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
      const measured =
        fixture.runtime.getExecutionAuthoritySnapshot({
          schemaVersion: 1,
          projectId: plan.projectId,
          runId: batch.runId,
          batchRootDigest,
        }) as unknown as InternalAuthoritySnapshot;
      const scopedEvidence = evidence as typeof evidence & {
        readonly authoritySummary: {
          readonly snapshotDigest: ContentHash;
          readonly lineage:
            InternalAuthoritySnapshot["signedReviewedContext"];
          readonly counts: InternalAuthoritySnapshot["counts"];
          readonly observedCommandKinds: readonly string[];
          readonly observedTargetKinds: readonly string[];
          readonly unexpectedCommandIds: readonly string[];
        };
      };
      expect(scopedEvidence.authoritySummary).toEqual({
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
      const evidencePath = resolve(
        process.cwd(),
        IMPORT_RUNTIME_EVIDENCE_RELATIVE_PATH,
        "e2e.json",
      );
      await mkdir(resolve(evidencePath, ".."), { recursive: true });
      const evidenceText = `${canonicalJson(evidence)}\n`;
      expect(Buffer.byteLength(evidenceText)).toBeLessThanOrEqual(4_096);
      expect(evidenceText).not.toMatch(
        /(?:\/Users\/|\/Volumes\/|nonce|rawReceipt|secret|sourceContent)/u,
      );
      await writeFile(evidencePath, evidenceText, {
        encoding: "utf8",
        flag: "w",
        mode: 0o600,
      });
      expect(await readFile(evidencePath, "utf8")).toBe(evidenceText);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("replays the exact batch without new authority uses or effects", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const batch = await approvedBatch(fixture, workspace, plan);
      const first = await executeApprovedImportBatch(
        fixture.runtime,
        workspace,
        plan,
        batch,
      );
      const firstTrace = fixture.runtime.replayCanvasTrace(plan.projectId);
      const firstCounts = databaseCounts(
        fixture.runtimePath,
        fixture.targetPath,
      );
      const second = await executeApprovedImportBatch(
        fixture.runtime,
        workspace,
        plan,
        batch,
      );

      expect(second).toEqual(first);
      expect(
        databaseCounts(fixture.runtimePath, fixture.targetPath),
      ).toEqual(firstCounts);
      expect(fixture.runtime.replayCanvasTrace(plan.projectId)).toEqual(
        firstTrace,
      );
      for (const entry of batch.entries) {
        expect(fixture.runtime.getGrantUsage(entry.grant.id)).toBe(1);
        expect(fixture.runtime.getApprovalUsage(entry.approval.id)).toBe(1);
      }
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("validates the whole batch before mutating execution state", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const batch = structuredClone(
        await approvedBatch(fixture, workspace, plan),
      ) as unknown as {
        entries: Array<{
          grant: { capabilities: string[] };
        }>;
      };
      const before = databaseCounts(
        fixture.runtimePath,
        fixture.targetPath,
      );
      batch.entries[17]!.grant.capabilities.push("git:push");

      await expect(
        executeApprovedImportBatch(
          fixture.runtime,
          workspace,
          plan,
          batch as never,
        ),
      ).rejects.toThrow();
      expect(
        databaseCounts(fixture.runtimePath, fixture.targetPath),
      ).toEqual(before);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("preserves an honest committed prefix and never submits the suffix", async () => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const batch = await approvedBatch(fixture, workspace, plan);
      let submissionCount = 0;
      const interrupted = new Proxy(fixture.runtime, {
        get(target, property, receiver) {
          if (property === "submitCommand") {
            return (...args: Parameters<DurableRuntime["submitCommand"]>) => {
              if (submissionCount === 5) {
                throw new Error("TEST_PREFIX_INTERRUPT");
              }
              submissionCount += 1;
              return target.submitCommand(...args);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      await expect(
        executeApprovedImportBatch(
          interrupted,
          workspace,
          plan,
          batch,
        ),
      ).rejects.toThrow("TEST_PREFIX_INTERRUPT");
      expect(databaseCounts(fixture.runtimePath, fixture.targetPath)).toEqual({
        commands: 5,
        outbox: 5,
        grants: 18,
        approvals: 18,
        targetReceipts: 5,
        targetAuthorityReceipts: 5,
        acceptedVerificationAttempts: 5,
        traceBindings: 5,
        events: 5,
        projections: 5,
        canonicalReceipts: 5,
        latches: 0,
      });
      expect(terminalRows(fixture.runtimePath)).toEqual({
        operationIds: batch.entries
          .slice(0, 5)
          .map((entry) => entry.operation.id),
        committedCommands: 5,
      });
      for (const entry of batch.entries.slice(5)) {
        expect(fixture.runtime.getCommand(entry.command.id)).toBeUndefined();
      }
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
