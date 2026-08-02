import { hashCanonicalValue } from "@memi/canonical-json";

export const SCHEMA_VERSION = 1 as const;

export const ids = {
  project: "prj_01J00000000000000000000000",
  flow: "flw_01J00000000000000000000000",
  route: "rte_01J00000000000000000000000",
  state: "sta_01J00000000000000000000000",
  coverageCell: "cov_01J00000000000000000000000",
  canvasDocument: "doc_01J00000000000000000000000",
  canvasNode: "nod_01J00000000000000000000000",
  operation: "opn_01J00000000000000000000000",
  traceEvent: "evt_01J00000000000000000000000",
  artifact: "art_01J00000000000000000000000",
  task: "tsk_01J00000000000000000000000",
  run: "run_01J00000000000000000000000",
  changeSet: "chg_01J00000000000000000000000",
  capabilityGrant: "grt_01J00000000000000000000000",
  lease: "lse_01J00000000000000000000000",
  checkpoint: "chk_01J00000000000000000000000",
  recoveryAttempt: "rcv_01J00000000000000000000000",
  outbox: "obx_01J00000000000000000000000",
  durableCommand: "cmd_01J00000000000000000000000",
  approvalReceipt: "apr_01J00000000000000000000000",
  sandboxProfile: "sbx_01J00000000000000000000000",
  processRequest: "prq_01J00000000000000000000000",
} as const;

export const hash = `sha256:${"a".repeat(64)}`;
export const nextHash = `sha256:${"b".repeat(64)}`;
export const timestamp = "2026-07-28T12:00:00.000Z";

export const productManifestFixture = {
  schemaVersion: SCHEMA_VERSION,
  projectId: ids.project,
  importMode: "repository",
  source: {
    kind: "repository",
    root: "/workspace/product",
    revision: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    dirtyFileFingerprint: `sha256:${"d".repeat(64)}`,
  },
  framework: {
    kind: "vite-react",
    confidence: "verified",
  },
  commands: {
    install: {
      executable: "npm",
      args: ["ci"],
    },
    preview: {
      executable: "npm",
      args: ["run", "dev", "--", "--host", "0.0.0.0"],
    },
  },
  dimensions: {
    roles: ["anonymous"],
    themes: ["light"],
    locales: ["en-US"],
    flags: [],
    fixtures: ["default"],
  },
} as const;

export const routeManifestFixture = {
  schemaVersion: SCHEMA_VERSION,
  projectId: ids.project,
  routes: [
    {
      id: ids.route,
      displayName: "Home",
      path: "/",
      sourceScreen: "HomeScreen",
      sourceOwnership: "code-owned",
      sourceFile: "src/App.tsx",
      authentication: "public",
      parameters: [],
    },
  ],
} as const;

export const stateManifestFixture = {
  schemaVersion: SCHEMA_VERSION,
  projectId: ids.project,
  states: [
    {
      id: ids.state,
      routeId: ids.route,
      name: "default",
      kind: "default",
      provenance: "declared",
    },
  ],
} as const;

export const flowManifestFixture = {
  schemaVersion: SCHEMA_VERSION,
  projectId: ids.project,
  sourceContentFingerprint: hash,
  compilerFingerprint: nextHash,
  sourceFile: "src/app/flows.ts",
  routeManifestDigest: hashCanonicalValue(routeManifestFixture),
  stateManifestDigest: hashCanonicalValue(stateManifestFixture),
  flows: [
    {
      id: ids.flow,
      name: "Primary navigation",
      provenance: "declared",
      steps: [
        {
          order: 1,
          routeId: ids.route,
          stateId: ids.state,
          trigger: "flow-start",
          assertion: "home-screen-visible",
        },
      ],
    },
  ],
} as const;

export const coverageLedgerFixture = {
  schemaVersion: SCHEMA_VERSION,
  projectId: ids.project,
  capturePlanId: "cap_01J00000000000000000000000",
  cells: [
    {
      id: ids.coverageCell,
      routeId: ids.route,
      stateId: ids.state,
      role: "anonymous",
      theme: "light",
      locale: "en-US",
      fixture: "default",
      viewport: {
        name: "desktop",
        width: 1440,
        height: 900,
      },
      health: "current",
      evidenceLevel: "verified",
      frameKind: "code-frame",
      evidenceArtifactIds: [ids.artifact],
    },
  ],
} as const;

export const canvasDocumentFixture = {
  schemaVersion: SCHEMA_VERSION,
  id: ids.canvasDocument,
  projectId: ids.project,
  revision: 1,
  stateHash: hash,
  operationCursor: ids.operation,
  nodes: [
    {
      id: ids.canvasNode,
      kind: "code-frame",
      authority: "product-source",
      evidenceLevel: "verified",
      coverageHealth: "current",
      parentId: null,
      position: { x: 0, y: 0 },
      size: { width: 1440, height: 900 },
      source: {
        routeId: ids.route,
        stateId: ids.state,
        coverageCellId: ids.coverageCell,
      },
    },
  ],
  appliedOperations: [
    {
      id: ids.operation,
      actionDigest: hash,
      resultingHash: hash,
    },
  ],
} as const;

export const traceEventFixture = {
  schemaVersion: SCHEMA_VERSION,
  id: ids.traceEvent,
  sequence: 1,
  occurredAt: timestamp,
  projectId: ids.project,
  taskId: ids.task,
  runId: ids.run,
  family: "canvas.operation.committed",
  actor: {
    kind: "human",
    id: "local-user",
  },
  correlationId: "cor_01J00000000000000000000000",
  causationId: null,
  payload: {
    operationId: ids.operation,
  },
  artifactIds: [],
  beforeHash: hash,
  afterHash: nextHash,
  actionDigest: hash,
  previousEventHash: hash,
  eventHash: nextHash,
} as const;

export function withSchemaVersion<T extends object>(
  value: T,
  schemaVersion: number | undefined,
): Record<string, unknown> {
  const { schemaVersion: _ignored, ...rest } = value as T & {
    schemaVersion?: number;
  };

  return schemaVersion === undefined
    ? rest
    : { ...rest, schemaVersion };
}
