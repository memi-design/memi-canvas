import {
  ApprovalReceiptSchema,
  type ApprovalReceiptId,
  CapabilityGrantSchema,
  type CapabilityGrantId,
  type DurableCommandId,
  DurableCommandSchema,
  type IdempotencyKey,
  LeaseIdSchema,
  OutboxIdSchema,
  type OutboxId,
  type ProcessRequestId,
  ProjectIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceEventIdSchema,
  type ApprovalReceipt,
  type CapabilityGrant,
  type DurableCommand,
} from "../../protocol/src/index.js";
import type {
  CommandSubmission,
  EffectExecutor,
} from "./index.js";
import { bindCommandAction } from "./index.js";
import { LEGACY_CANVAS_FIXTURE } from "./fixture-compat.js";

const ID_BODY_PREFIX = "0".repeat(25);

export function sortableId(
  prefix: "cmd",
  suffix: string,
): DurableCommandId;
export function sortableId(
  prefix: "idem",
  suffix: string,
): IdempotencyKey;
export function sortableId(
  prefix: "grt",
  suffix: string,
): CapabilityGrantId;
export function sortableId(
  prefix: "apr",
  suffix: string,
): ApprovalReceiptId;
export function sortableId(
  prefix: "prq",
  suffix: string,
): ProcessRequestId;
export function sortableId(prefix: string, suffix: string): string;
export function sortableId(
  prefix: string,
  suffix: string,
): string {
  return `${prefix}_${ID_BODY_PREFIX}${suffix}`;
}

export const PROJECT_ID = ProjectIdSchema.parse(
  sortableId("prj", "1"),
);
export const TASK_ID = TaskIdSchema.parse(sortableId("tsk", "1"));
export const RUN_ID = RunIdSchema.parse(sortableId("run", "1"));
export const TRACE_EVENT_ID = TraceEventIdSchema.parse(
  sortableId("evt", "1"),
);
export const LEASE_ID = LeaseIdSchema.parse(
  sortableId("lse", "1"),
);
export const OUTBOX_ID = OutboxIdSchema.parse(
  sortableId("obx", "1"),
);
export const EFFECT_PAYLOAD = Object.freeze({
  operation: "set-token",
  token: "space.compact",
});

export function contentHash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

export class MutableClock {
  #milliseconds: number;

  constructor(isoTimestamp = "2026-07-28T12:00:00.000Z") {
    this.#milliseconds = Date.parse(isoTimestamp);
  }

  now = (): string => new Date(this.#milliseconds).toISOString();

  advance(milliseconds: number): void {
    this.#milliseconds += milliseconds;
  }
}

export class RecordingEffectExecutor implements EffectExecutor {
  readonly [LEGACY_CANVAS_FIXTURE] = true as const;
  readonly calls: Parameters<EffectExecutor["execute"]>[0][] = [];
  readonly resultingHash: string;

  constructor(resultingHash = contentHash("e")) {
    this.resultingHash = resultingHash;
  }

  async execute(
    request: Parameters<EffectExecutor["execute"]>[0],
  ): Promise<Awaited<ReturnType<EffectExecutor["execute"]>>> {
    this.calls.push(request);

    return {
      status: "applied",
      resultingHash: this.resultingHash,
      receipt: {
        kind: "test-effect",
        targetId: request.command.target.id,
      },
    };
  }
}

export function legacyCanvasFixtureExecutor<
  T extends EffectExecutor,
>(executor: T): T {
  Object.defineProperty(executor, LEGACY_CANVAS_FIXTURE, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return executor;
}

export function matchingEffectVerifier(
  clock: () => string = () => "2026-07-28T12:00:00.000Z",
) {
  return {
    verify: (request: { readonly resultingHash: string }) => ({
      observedTargetHash: request.resultingHash,
      evidenceHash: contentHash("f"),
      verifiedAt: clock(),
    }),
  };
}

export function durableCommand(
  overrides: Partial<DurableCommand> = {},
): DurableCommand {
  const base = {
    schemaVersion: 1,
    id: sortableId("cmd", "1"),
    projectId: PROJECT_ID,
    taskId: TASK_ID,
    runId: RUN_ID,
    issuerId: "runtime-agent",
    kind: "canvas.operation",
    target: {
      kind: "canvas-document",
      id: "canvas:document:product",
      expectedBeforeHash: contentHash("a"),
      baseline: {
        kind: "canvas-revision",
        revision: 1,
        stateHash: contentHash("a"),
      },
    },
    payloadHash: contentHash("b"),
    idempotencyKey: sortableId("idem", "1"),
    actionDigest: contentHash("c"),
    requiredCapabilities: ["canvas:apply"],
    authority: {
      capabilityGrantId: sortableId("grt", "1"),
      approvalReceiptId: sortableId("apr", "1"),
      leaseId: LEASE_ID,
      fencingEpoch: 1,
    },
    issuedAt: "2026-07-28T12:00:00.000Z",
  } as const;

  const command = DurableCommandSchema.parse({
    ...base,
    ...overrides,
    target: {
      ...base.target,
      ...overrides.target,
    },
    authority: {
      ...base.authority,
      ...overrides.authority,
    },
  });
  return bindCommandAction(command, EFFECT_PAYLOAD);
}

export function commandSubmission(
  command = durableCommand(),
  outboxId: OutboxId = OUTBOX_ID,
): CommandSubmission {
  return {
    command,
    outboxId,
    effectPayload: EFFECT_PAYLOAD,
  };
}

export function grantFor(
  command: DurableCommand,
  overrides: {
    readonly id?: string;
    readonly capabilities?: CapabilityGrant["capabilities"];
    readonly actionDigest?: string;
    readonly maximumUses?: number;
    readonly canonicalPaths?: readonly string[];
    readonly issuedAt?: string;
    readonly expiresAt?: string;
  } = {},
): CapabilityGrant {
  return CapabilityGrantSchema.parse({
    schemaVersion: 1,
    id: overrides.id ?? command.authority.capabilityGrantId,
    projectId: command.projectId,
    clientId: command.issuerId,
    capabilities:
      overrides.capabilities ?? command.requiredCapabilities,
    constraints: {
      canonicalPaths: overrides.canonicalPaths ?? [],
      allowedHosts: [],
      actionDigest:
        overrides.actionDigest ?? command.actionDigest,
      maximumUses: overrides.maximumUses ?? 10,
    },
    issuedAt: overrides.issuedAt ?? "2026-07-28T11:00:00.000Z",
    expiresAt:
      overrides.expiresAt ?? "2026-07-28T13:00:00.000Z",
  });
}

export function approvalFor(
  command: DurableCommand,
  overrides: Partial<ApprovalReceipt> = {},
): ApprovalReceipt {
  const base = {
    schemaVersion: 1,
    id: command.authority.approvalReceiptId,
    projectId: command.projectId,
    approver: { kind: "human", id: "local-user" },
    target: command.target,
    actionDigest: command.actionDigest,
    capabilities: command.requiredCapabilities,
    consequence: "Apply the reviewed canvas operation.",
    issuedAt: "2026-07-28T11:00:00.000Z",
    expiresAt: "2026-07-28T13:00:00.000Z",
    maximumUses: 10,
  } as const;

  return ApprovalReceiptSchema.parse({
    ...base,
    ...overrides,
    target: {
      ...base.target,
      ...overrides.target,
    },
  });
}

export function alternateOutboxId(suffix: string) {
  return OutboxIdSchema.parse(sortableId("obx", suffix));
}

export function alternateLeaseId(suffix: string) {
  return LeaseIdSchema.parse(sortableId("lse", suffix));
}
