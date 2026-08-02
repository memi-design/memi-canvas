import { hashCanonicalValue } from "@memi/canonical-json";
import {
  compileProductWorkspace,
  createCanvasMaterializationPlan,
  type CanvasMaterializationPlan,
  type ProductWorkspace,
} from "@memi/product-import";
import {
  ProjectIdSchema,
  type CanvasOperationCommittedEvent,
  type ProjectId,
} from "@memi/protocol";

import { compileProductImport } from "../import-compiler/src/index.js";
import { executeApprovedImportBatch } from "../import-runtime/src/index.js";
import {
  FIXTURE_ROOT,
  NOW,
  PROJECT_ID,
  approvedBatch,
  cleanupFixture,
  productPlan,
  runtimeFixture,
} from "../import-runtime/test-support.js";

export interface CanonicalReplay {
  readonly projectId: ProjectId;
  readonly lastSequence: number;
  readonly lastEventHash: string | null;
  readonly events: readonly CanvasOperationCommittedEvent[];
}

export interface DocumentationInput {
  readonly workspace: ProductWorkspace;
  readonly plan: CanvasMaterializationPlan;
  readonly canonicalReplay: CanonicalReplay;
}

let committedInputPromise: Promise<DocumentationInput> | undefined;

export function mutable<Value>(value: Value): Value {
  return structuredClone(value);
}

export function canonicalPrefix(
  input: DocumentationInput,
  length: number,
): DocumentationInput {
  const events = input.canonicalReplay.events.slice(0, length);
  return {
    workspace: input.workspace,
    plan: input.plan,
    canonicalReplay: {
      projectId: input.canonicalReplay.projectId,
      lastSequence: events.length,
      lastEventHash: events.at(-1)?.eventHash ?? null,
      events,
    },
  };
}

export function recomputeReplayHashes(
  replay: CanonicalReplay,
): CanonicalReplay {
  let previousEventHash: string | null = null;
  const events = replay.events.map((event, index) => {
    const {
      eventActionDigest: _oldActionDigest,
      eventHash: _oldEventHash,
      previousEventHash: _oldPreviousHash,
      sequence: _oldSequence,
      occurredAt: _oldOccurredAt,
      ...actionMaterial
    } = event;
    void _oldActionDigest;
    void _oldEventHash;
    void _oldPreviousHash;
    void _oldSequence;
    const sequence = index + 1;
    const eventActionDigest = hashCanonicalValue(actionMaterial);
    const eventHash = hashCanonicalValue({
      ...actionMaterial,
      sequence,
      occurredAt: _oldOccurredAt,
      previousEventHash,
      eventActionDigest,
    });
    const next = {
      ...actionMaterial,
      sequence,
      occurredAt: _oldOccurredAt,
      previousEventHash,
      eventActionDigest,
      eventHash,
    } as CanvasOperationCommittedEvent;
    previousEventHash = eventHash;
    return next;
  });
  return {
    projectId: replay.projectId,
    lastSequence: events.length,
    lastEventHash: events.at(-1)?.eventHash ?? null,
    events,
  };
}

export async function committedInput(): Promise<DocumentationInput> {
  if (committedInputPromise !== undefined) {
    return committedInputPromise;
  }
  const created = (async (): Promise<DocumentationInput> => {
    const { workspace, plan } = await productPlan();
    const fixture = await runtimeFixture(plan);
    try {
      const batch = await approvedBatch(fixture, workspace, plan);
      await executeApprovedImportBatch(
        fixture.runtime,
        workspace,
        plan,
        batch,
      );
      return {
        workspace,
        plan,
        canonicalReplay: {
          ...structuredClone(
            fixture.runtime.replayCanvasTrace(plan.projectId),
          ),
          projectId: ProjectIdSchema.parse(plan.projectId),
        },
      };
    } finally {
      await cleanupFixture(fixture);
    }
  })();
  committedInputPromise = created;
  return created;
}

export async function blockedInput(): Promise<DocumentationInput> {
  const imported = await compileProductImport({
    rootDir: FIXTURE_ROOT,
    projectId: PROJECT_ID,
    repository: {
      revision: "0123456789abcdef0123456789abcdef01234567",
      dirty: false,
      dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
    },
    adapterVersion: "vite-react-static@1",
    budgets: {
      maxFileBytes: 64 * 1024,
      maxTotalBytes: 256 * 1024,
    },
  });
  const capture = imported.capturePlan.cells[0]!;
  const coverage = imported.coverageLedger.cells[0]!;
  const workspace = compileProductWorkspace({
    ...imported,
    capturePlan: {
      ...imported.capturePlan,
      cells: [
        {
          ...capture,
          status: "blocked" as const,
          reason: "authentication-required",
        },
        ...imported.capturePlan.cells.slice(1),
      ],
    },
    coverageLedger: {
      ...imported.coverageLedger,
      cells: [
        {
          ...coverage,
          health: "blocked" as const,
          evidenceLevel: null,
          frameKind: null,
          reason: "authentication-required",
        },
        ...imported.coverageLedger.cells.slice(1),
      ],
    },
  });
  const plan = createCanvasMaterializationPlan(workspace, {
    actorId: "memi-import-pipeline",
    occurredAt: NOW,
  });
  return {
    workspace,
    plan,
    canonicalReplay: {
      projectId: workspace.projectId,
      lastSequence: 0,
      lastEventHash: null,
      events: [],
    },
  };
}
