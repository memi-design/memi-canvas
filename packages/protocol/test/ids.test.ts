import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ArtifactIdSchema,
  ApprovalReceiptIdSchema,
  CanvasDocumentIdSchema,
  CanvasNodeIdSchema,
  CapabilityGrantIdSchema,
  ChangeSetIdSchema,
  CheckpointIdSchema,
  CoverageCellIdSchema,
  DurableCommandIdSchema,
  FlowIdSchema,
  LeaseIdSchema,
  OperationIdSchema,
  OutboxIdSchema,
  ProcessRequestIdSchema,
  ProjectIdSchema,
  RecoveryAttemptIdSchema,
  RouteIdSchema,
  RunIdSchema,
  SandboxProfileIdSchema,
  StateIdSchema,
  TaskIdSchema,
  TraceEventIdSchema,
  type ProjectId,
} from "../src/index.js";
import { ids } from "./fixtures.js";

describe("branded canonical IDs", () => {
  const cases = [
    [ProjectIdSchema, ids.project, "prj"],
    [FlowIdSchema, ids.flow, "flw"],
    [RouteIdSchema, ids.route, "rte"],
    [StateIdSchema, ids.state, "sta"],
    [CoverageCellIdSchema, ids.coverageCell, "cov"],
    [CanvasDocumentIdSchema, ids.canvasDocument, "doc"],
    [CanvasNodeIdSchema, ids.canvasNode, "nod"],
    [OperationIdSchema, ids.operation, "opn"],
    [TraceEventIdSchema, ids.traceEvent, "evt"],
    [ArtifactIdSchema, ids.artifact, "art"],
    [TaskIdSchema, ids.task, "tsk"],
    [RunIdSchema, ids.run, "run"],
    [ChangeSetIdSchema, ids.changeSet, "chg"],
    [CapabilityGrantIdSchema, ids.capabilityGrant, "grt"],
    [LeaseIdSchema, ids.lease, "lse"],
    [CheckpointIdSchema, ids.checkpoint, "chk"],
    [RecoveryAttemptIdSchema, ids.recoveryAttempt, "rcv"],
    [OutboxIdSchema, ids.outbox, "obx"],
    [DurableCommandIdSchema, ids.durableCommand, "cmd"],
    [ApprovalReceiptIdSchema, ids.approvalReceipt, "apr"],
    [SandboxProfileIdSchema, ids.sandboxProfile, "sbx"],
    [ProcessRequestIdSchema, ids.processRequest, "prq"],
  ] as const;

  it.each(cases)("accepts its own canonical prefix", (schema, value) => {
    expect(schema.parse(value)).toBe(value);
  });

  it.each(cases)(
    "%s rejects an ID from another domain",
    (schema, _value, ownPrefix) => {
      const foreignId =
        ownPrefix === "prj" ? ids.route : ids.project;
      expect(schema.safeParse(foreignId).success).toBe(false);
    },
  );

  it("rejects UUIDs, empty strings, whitespace, and non-canonical casing", () => {
    for (const value of [
      "",
      " ",
      "550e8400-e29b-41d4-a716-446655440000",
      ids.project.toUpperCase(),
      `${ids.project} `,
    ]) {
      expect(ProjectIdSchema.safeParse(value).success).toBe(false);
    }
  });

  it("brands inferred IDs so plain strings cannot be assigned", () => {
    expectTypeOf<string>().not.toExtend<ProjectId>();
    expectTypeOf<ProjectId>().toExtend<string>();
  });
});
