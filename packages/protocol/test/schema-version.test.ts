import { describe, expect, it } from "vitest";
import {
  ArtifactDescriptorSchema,
  CanvasDocumentSchema,
  CanvasOperationSchema,
  CapabilityGrantSchema,
  CapturePlanSchema,
  CheckpointSchema,
  CoverageLedgerSchema,
  FlowManifestSchema,
  LeaseSchema,
  OutboxRecordSchema,
  ProductManifestSchema,
  RecoveryRecordSchema,
  RouteManifestSchema,
  StateManifestSchema,
  TraceEventSchema,
} from "../src/index.js";
import {
  canvasDocumentFixture,
  coverageLedgerFixture,
  flowManifestFixture,
  hash,
  ids,
  productManifestFixture,
  routeManifestFixture,
  stateManifestFixture,
  timestamp,
  traceEventFixture,
  withSchemaVersion,
} from "./fixtures.js";

const versionedContracts = [
  ["ProductManifest", ProductManifestSchema, productManifestFixture],
  ["RouteManifest", RouteManifestSchema, routeManifestFixture],
  ["StateManifest", StateManifestSchema, stateManifestFixture],
  ["FlowManifest", FlowManifestSchema, flowManifestFixture],
  ["CoverageLedger", CoverageLedgerSchema, coverageLedgerFixture],
  ["CanvasDocument", CanvasDocumentSchema, canvasDocumentFixture],
  [
    "CanvasOperation",
    CanvasOperationSchema,
    {
      schemaVersion: 1,
      id: ids.operation,
      documentId: ids.canvasDocument,
      actorId: "local-user",
      occurredAt: timestamp,
      expectedBeforeHash: hash,
      resultingHash: hash,
      type: "node.delete",
      payload: {
        nodeId: ids.canvasNode,
        deletedNodeHash: hash,
      },
    },
  ],
  ["TraceEvent", TraceEventSchema, traceEventFixture],
  [
    "OutboxRecord",
    OutboxRecordSchema,
    {
      schemaVersion: 1,
      id: ids.outbox,
      commandId: "cmd_01J00000000000000000000000",
      projectId: ids.project,
      idempotencyKey: "idem_01J00000000000000000000000",
      actionDigest: hash,
      phase: "intent",
      effect: {
        kind: "canvas.operation",
        targetId: ids.canvasDocument,
        expectedBeforeHash: hash,
        payloadHash: hash,
      },
      createdAt: timestamp,
    },
  ],
  [
    "CapturePlan",
    CapturePlanSchema,
    {
      schemaVersion: 1,
      id: "cap_01J00000000000000000000000",
      projectId: ids.project,
      sourceRevision: "0123456789abcdef0123456789abcdef01234567",
      budgets: {
        maxCells: 1,
        maxRuntimeSeconds: 1,
        maxConcurrency: 1,
        maxBrowserStorageBytes: 1,
        maxArtifactBytes: 1,
      },
      cells: [],
    },
  ],
  [
    "ArtifactDescriptor",
    ArtifactDescriptorSchema,
    {
      schemaVersion: 1,
      id: ids.artifact,
      projectId: ids.project,
      contentHash: hash,
      byteLength: 1,
      mediaType: "application/json",
      classification: "project-private",
      storage: "content-addressed",
      redaction: "complete",
      createdAt: timestamp,
    },
  ],
  [
    "CapabilityGrant",
    CapabilityGrantSchema,
    {
      schemaVersion: 1,
      id: ids.capabilityGrant,
      projectId: ids.project,
      clientId: "local-client",
      capabilities: ["canvas:read"],
      constraints: {
        canonicalPaths: [],
        allowedHosts: [],
        actionDigest: hash,
        maximumUses: 1,
      },
      issuedAt: timestamp,
      expiresAt: "2026-07-28T12:05:00.000Z",
    },
  ],
  [
    "Lease",
    LeaseSchema,
    {
      schemaVersion: 1,
      id: ids.lease,
      projectId: ids.project,
      targetId: ids.canvasDocument,
      holderId: "local-client",
      fencingEpoch: 1,
      acquiredAt: timestamp,
      expiresAt: "2026-07-28T12:01:00.000Z",
    },
  ],
  [
    "Checkpoint",
    CheckpointSchema,
    {
      schemaVersion: 1,
      id: ids.checkpoint,
      projectId: ids.project,
      kind: "canvas-task",
      createdAt: timestamp,
      canvas: {
        documentId: ids.canvasDocument,
        operationCursor: ids.operation,
        stateHash: hash,
      },
      task: {
        taskId: ids.task,
        runId: ids.run,
        traceSequence: 1,
      },
      source: null,
    },
  ],
  [
    "RecoveryRecord",
    RecoveryRecordSchema,
    {
      schemaVersion: 1,
      id: ids.recoveryAttempt,
      projectId: ids.project,
      checkpointId: ids.checkpoint,
      action: "replay-read-only",
      requestedAt: timestamp,
      status: "requested",
    },
  ],
] as const;

describe("schemaVersion compatibility boundary", () => {
  it.each(versionedContracts)(
    "%s rejects a missing schemaVersion",
    (_name, schema, fixture) => {
      expect(
        schema.safeParse(withSchemaVersion(fixture, undefined)).success,
      ).toBe(false);
    },
  );

  it.each(versionedContracts)(
    "%s rejects legacy schema versions",
    (_name, schema, fixture) => {
      expect(schema.safeParse(withSchemaVersion(fixture, 0)).success).toBe(
        false,
      );
    },
  );

  it.each(versionedContracts)(
    "%s rejects unknown future schema versions",
    (_name, schema, fixture) => {
      expect(schema.safeParse(withSchemaVersion(fixture, 2)).success).toBe(
        false,
      );
    },
  );
});
