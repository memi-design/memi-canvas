import {
  ContentHashSchema,
  CrashRecoveryDecisionSchema,
  DurableCommandIdSchema,
  DurableCommandSchema,
  OutboxRecordSchema,
  durableCommandTargetKindMatches,
  OutboxTransitionSchema,
  type ApprovalReceipt,
  type ApprovalReceiptId,
  type CapabilityGrant,
  type CapabilityGrantId,
  type CrashRecoveryDecision,
  type DurableCommand,
  type DurableRunState,
  type Lease,
  type OutboxRecord,
} from "../../protocol/src/index.js";
import { AuthorityStore } from "./authority-store.js";
import { CanvasEffectCoordinator } from "./canvas-effect-coordinator.js";
import { createCanvasExecutionRuntime } from "./canvas-execution-runtime.js";
import { CanvasFenceCoordinator } from "./canvas-fence-coordinator.js";
import { CanvasTraceRuntime } from "./canvas-trace-runtime.js";
import { RuntimeDatabase } from "./database.js";
import { computeCommandDigests } from "./digests.js";
import { EffectCommitStore } from "./effect-commit-store.js";
import {
  AuthorizationError,
  CommandDigestError,
  IdempotencyConflictError,
  StaleLeaseError,
} from "./errors.js";
import { HarnessStore } from "./harness-store.js";
import { HarnessLifecycleStore } from "./harness-lifecycle-store.js";
import { isLegacyCanvasFixtureExecutor } from "./fixture-compat.js";
import { LegacyEffectRunner } from "./legacy-effect-runner.js";
import { secureTraceEventIdFactory } from "./trace-event-id.js";
import {
  LeaseStore,
  type AcquireLeaseRequest,
  type AssertLeaseRequest,
} from "./lease-store.js";
import {
  assertM0EffectAllowed,
  validateCommandPolicy,
} from "./policy.js";
import {
  isBefore,
  json,
  parsed,
  rowText,
  type AcceptedCommand,
  type RecoverySummary,
} from "./runtime-records.js";
import { TargetScheduleStore } from "./target-schedule-store.js";
import { TrustedRuntimeFacade } from "./trusted-runtime-facade.js";
import type {
  CommandSubmission,
  CommitClaim,
  CommitClaimRequest,
  CommittedEffectReceipt,
  DurableRuntimeOptions,
  HarnessDispatch,
  HarnessDispatchRequest,
  DemoHarnessApprovalResolutionInput,
  HarnessHandoff,
  HarnessHandoffInput,
  HarnessLifecycleEvent,
  HarnessRunControlInput,
  HarnessRunResumeInput,
  HarnessRunSnapshot,
  HarnessRunStartInput,
  HarnessTaskInput,
  HarnessTraceReferenceInput,
  VerifyAndCommitRequest,
  WorkerClaim,
} from "./types.js";

export class DurableRuntime extends TrustedRuntimeFacade {
  readonly #database: RuntimeDatabase;
  readonly #authority: AuthorityStore;
  readonly #harnesses: HarnessStore;
  readonly #harnessLifecycle: HarnessLifecycleStore;
  readonly #leases: LeaseStore;
  readonly #effectCommits: EffectCommitStore;
  readonly #canvasTrace: CanvasTraceRuntime;
  readonly #canvasFence: CanvasFenceCoordinator | undefined;
  readonly #canvasEffects: CanvasEffectCoordinator | undefined;
  readonly #allowLegacyCanvasFixture: boolean;
  readonly #targetSchedule: TargetScheduleStore;
  readonly #legacyEffects: LegacyEffectRunner;
  readonly #clock: () => string;
  readonly #policyValidator: DurableRuntimeOptions["policyValidator"];
  readonly #recoveryProbe: DurableRuntimeOptions["recoveryProbe"];

  constructor(options: DurableRuntimeOptions) {
    super();
    this.#database = new RuntimeDatabase(options.databasePath);
    this.#clock = options.clock;
    this.#authority = new AuthorityStore(this.#database, this.#clock);
    this.#harnesses = new HarnessStore(
      this.#database,
      this.#clock,
      options.harnesses ?? [],
    );
    this.#harnessLifecycle = new HarnessLifecycleStore(
      this.#database,
      this.#clock,
      options.lifecycleHarnesses ?? [],
    );
    this.#leases = new LeaseStore(this.#database, this.#clock);
    this.#canvasTrace = new CanvasTraceRuntime(this.#database, this.#leases, options);
    this.#canvasTrace.audit();
    this.#allowLegacyCanvasFixture =
      options.canvasTarget === undefined &&
      isLegacyCanvasFixtureExecutor(options.effectExecutor);
    const canvasExecution = createCanvasExecutionRuntime(
      this.#database, this.#authority, this.#leases, options,
    );
    this.#canvasFence = canvasExecution.fence;
    this.#canvasEffects = canvasExecution.effects;
    this.#targetSchedule = new TargetScheduleStore(this.#database);
    this.initializeTrustedExecution({
      database: this.#database,
      leases: this.#leases,
      schedule: this.#targetSchedule,
      clock: this.#clock,
      roots: options.approvalTrustRoots ?? [],
      allowCanvas:
        this.#canvasEffects !== undefined ||
        this.#allowLegacyCanvasFixture,
      allowInvalidLegacyCanvasPayload: this.#allowLegacyCanvasFixture,
      canvasEffects: this.#canvasEffects,
    });
    this.#legacyEffects = new LegacyEffectRunner(
      this.#database,
      this.#authority,
      this.#clock,
      options.effectExecutor,
      options.policyValidator,
      {
        fail: (outbox, error, code) =>
          this.#failOutbox(outbox, error, code),
        outcomeUnknown: (command, outbox) =>
          this.#recordOutcomeUnknown(command, outbox),
      },
    );
    this.#effectCommits = new EffectCommitStore(
      this.#database,
      this.#authority,
      this.#clock,
      options.effectVerifier,
      options.traceEventIdFactory ?? secureTraceEventIdFactory,
    );
    this.#policyValidator = options.policyValidator;
    this.#recoveryProbe = options.recoveryProbe;
  }

  close(): void {
    this.#database.close();
  }
  inspectDatabase() {
    return this.#database.inspect();
  }
  registerGrant(input: CapabilityGrant): CapabilityGrant {
    return this.#authority.registerGrant(input);
  }
  registerApprovalReceipt(input: ApprovalReceipt): ApprovalReceipt {
    return this.#authority.registerApproval(input);
  }
  submitCommand(input: CommandSubmission): AcceptedCommand {
    const command = DurableCommandSchema.parse(input.command);
    let computedDigests;
    try {
      computedDigests = computeCommandDigests(
        command,
        input.effectPayload,
      );
    } catch (error) {
      throw new CommandDigestError(
        "INVALID_EFFECT_PAYLOAD",
        error instanceof Error ? error.message : "Effect payload is invalid.",
      );
    }
    if (computedDigests.payloadHash !== command.payloadHash) {
      throw new CommandDigestError(
        "PAYLOAD_HASH_MISMATCH",
        "Effect payload does not match the command payload hash.",
      );
    }
    if (computedDigests.actionDigest !== command.actionDigest) {
      throw new CommandDigestError(
        "ACTION_DIGEST_MISMATCH",
        "Command fields do not match the claimed action digest.",
      );
    }
    assertM0EffectAllowed(command);
    this.assertTrustedCommand(command, input.effectPayload);
    const createdAt = this.#clock();
    return this.#database.transaction(() => {
      const replay = this.#database.one(
        `SELECT id, action_digest, state
         FROM commands
         WHERE project_id = ? AND idempotency_key = ?`,
        command.projectId,
        command.idempotencyKey,
      );
      if (replay !== undefined) {
        if (rowText(replay, "action_digest") !== command.actionDigest) {
          throw new IdempotencyConflictError(command.idempotencyKey);
        }
        return {
          commandId: DurableCommandIdSchema.parse(
            rowText(replay, "id"),
          ),
          state: rowText(replay, "state"),
          actionDigest: ContentHashSchema.parse(
            rowText(replay, "action_digest"),
          ),
        };
      }

      const authority = this.#authority.reserve(command, createdAt);
      validateCommandPolicy(
        this.#policyValidator,
        command,
        input.effectPayload,
        authority.grant,
      );
      this.#database.run(
        `INSERT INTO commands (
          id, project_id, target_kind, target_id, idempotency_key,
          action_digest, grant_id, approval_id, state, command_json,
          effect_payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?)`,
        command.id,
        command.projectId,
        command.target.kind,
        command.target.id,
        command.idempotencyKey,
        command.actionDigest,
        authority.grant.id,
        authority.approval.id,
        json(command),
        computedDigests.canonicalPayload,
      );
      this.#database.run(
        `INSERT INTO capability_grant_uses
          (grant_id, command_id, use_number, used_at)
         VALUES (?, ?, ?, ?)`,
        authority.grant.id,
        command.id,
        authority.grantUseNumber,
        createdAt,
      );
      this.#database.run(
        `INSERT INTO approval_uses
          (approval_id, command_id, use_number, used_at)
         VALUES (?, ?, ?, ?)`,
        authority.approval.id,
        command.id,
        authority.approvalUseNumber,
        createdAt,
      );

      const outbox = OutboxRecordSchema.parse({
        schemaVersion: 1,
        id: input.outboxId,
        commandId: command.id,
        projectId: command.projectId,
        idempotencyKey: command.idempotencyKey,
        actionDigest: command.actionDigest,
        phase: "intent",
        effect: {
          kind: command.kind,
          targetId: command.target.id,
          expectedBeforeHash: command.target.expectedBeforeHash,
          payloadHash: command.payloadHash,
        },
        createdAt,
      });
      this.#database.run(
        `INSERT INTO outbox (
          id, command_id, project_id, target_kind, target_id,
          phase, record_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        outbox.id,
        command.id,
        command.projectId,
        command.target.kind,
        command.target.id,
        outbox.phase,
        json(outbox),
      );
      return {
        commandId: command.id,
        state: "intent",
        actionDigest: command.actionDigest,
      };
    });
  }

  getCommand(commandId: DurableCommand["id"]): DurableCommand | undefined {
    const row = this.#database.one(
      "SELECT command_json FROM commands WHERE id = ?",
      commandId,
    );
    return row === undefined
      ? undefined
      : DurableCommandSchema.parse(parsed(row.command_json));
  }
  getOutboxForCommand(
    commandId: DurableCommand["id"],
  ): OutboxRecord | undefined {
    const row = this.#database.one(
      "SELECT record_json FROM outbox WHERE command_id = ?",
      commandId,
    );
    return row === undefined
      ? undefined
      : OutboxRecordSchema.parse(parsed(row.record_json));
  }
  getGrantUsage(grantId: CapabilityGrantId): number {
    return this.#authority.getGrantUsage(grantId);
  }
  getApprovalUsage(approvalId: ApprovalReceiptId | null): number {
    return this.#authority.getApprovalUsage(approvalId);
  }
  acquireLease(input: AcquireLeaseRequest): Lease {
    return this.#leases.acquire(
      input,
      this.#allowLegacyCanvasFixture
        ? "active"
        : "pending-fence",
    );
  }

  assertLease(input: AssertLeaseRequest): Lease {
    return this.#leases.assert(input);
  }
  activateCanvasLease(
    input: AssertLeaseRequest,
  ): Promise<Lease> {
    if (this.#canvasFence === undefined) {
      throw new Error(
        "A platform-owned canvas target adapter is required.",
      );
    }
    return this.#canvasFence.activate(input);
  }
  claimNextEffect(input: {
    readonly workerId: string;
    readonly claimTtlMilliseconds: number;
  }): WorkerClaim | null {
    if (!Number.isSafeInteger(input.claimTtlMilliseconds) ||
        input.claimTtlMilliseconds <= 0) {
      throw new RangeError("Claim TTL must be a positive integer.");
    }
    return this.#database.transaction(() => {
      const now = this.#clock();
      while (true) {
        const candidate = this.#targetSchedule.nextCandidate(
          now,
          this.#canvasEffects !== undefined ||
            this.#allowLegacyCanvasFixture,
        );
        if (candidate === undefined) {
          return null;
        }
        const candidateRow = candidate.row;
        const command = this.#requireCommand(
          DurableCommandIdSchema.parse(
            rowText(candidateRow, "command_id"),
          ),
        );
        const outbox = OutboxRecordSchema.parse(
          parsed(candidateRow.record_json),
        );
        if (candidate.hadClaim) {
          if (
            command.kind === "canvas.operation" &&
            this.#canvasEffects !== undefined
          ) {
            return null;
          }
          if (
            command.kind === "canvas.operation" ||
            command.kind === "artifact.persist"
          ) {
            const evidence = this.#recoveryProbe?.({ command, outbox });
            if (
              evidence === undefined ||
              evidence.observedTargetHash !==
                command.target.expectedBeforeHash
            ) {
              this.#recordOutcomeUnknown(command, outbox);
              continue;
            }
            ContentHashSchema.parse(evidence.evidenceHash);
            ContentHashSchema.parse(evidence.observedTargetHash);
            this.#recordRetryDecision(command, outbox, evidence);
          } else {
            this.#recordOutcomeUnknown(command, outbox);
            continue;
          }
        }
        const fencingEpoch = Number(candidateRow.claim_epoch) + 1;
        const expiresAt = new Date(
          Date.parse(now) + input.claimTtlMilliseconds,
        ).toISOString();
        return this.#targetSchedule.claim(
          candidate,
          input.workerId,
          fencingEpoch,
          expiresAt,
          now,
        );
      }
    });
  }
  async applyClaimedEffect(
    claim: WorkerClaim,
  ): Promise<OutboxRecord> {
    const command = this.#requireCommand(claim.commandId);
    this.assertTrustedCommand(command);
    if (command.kind === "artifact.persist") {
      throw new Error(
        "A platform-owned artifact persistence adapter is required.",
      );
    }
    if (command.kind === "canvas.operation") {
      if (this.#canvasEffects !== undefined) {
        return this.#canvasEffects.apply(claim);
      }
      if (!this.#allowLegacyCanvasFixture) {
        throw new Error(
          "A platform-owned canvas target adapter is required.",
        );
      }
    }
    return this.#legacyEffects.apply(claim);
  }
  async applyNextEffect(input: {
    readonly workerId: string;
    readonly claimTtlMilliseconds: number;
  }): Promise<OutboxRecord | null> {
    if (this.#canvasEffects !== undefined) {
      const recovery = await this.#canvasEffects.reconcileNext();
      if (
        recovery !== undefined &&
        recovery !== "retry" &&
        recovery !== "blocked"
      ) {
        return recovery;
      }
    }
    const claim = this.claimNextEffect(input);
    return claim === null ? null : this.applyClaimedEffect(claim);
  }
  claimEffectCommit(input: CommitClaimRequest): CommitClaim {
    return (
      this.#canvasTrace.claim(
        input,
        this.#allowLegacyCanvasFixture,
      ) ?? this.#effectCommits.claim(input)
    );
  }
  verifyAndCommit(
    input: VerifyAndCommitRequest,
  ): Promise<CommittedEffectReceipt> {
    return (
      this.#canvasTrace.verifyAndCommit(
        input,
        this.#allowLegacyCanvasFixture,
      ) ?? this.#effectCommits.verifyAndCommit(input)
    );
  }
  getEffectReceipt(
    commandId: DurableCommand["id"],
  ): CommittedEffectReceipt | undefined {
    return (
      this.#canvasTrace.receipt(commandId) ??
      this.#effectCommits.getReceipt(commandId)
    );
  }
  getTargetReceipt(commandId: DurableCommand["id"]) {
    return this.#canvasEffects?.getReceipt(commandId);
  }
  getTraceReference(commandId: DurableCommand["id"]) {
    return (
      this.#canvasTrace.trace(commandId) ??
      this.#effectCommits.getTrace(commandId)
    );
  }
  replayCanvasTrace(projectId: string) {
    return this.#canvasTrace.replay(projectId);
  }
  recover(): RecoverySummary {
    this.assertTrustedRecovery();
    this.#canvasTrace.audit();
    return this.#database.transaction(() => {
      const now = this.#clock();
      const intents: string[] = [];
      const effects: string[] = [];
      const blocked = this.#database
        .all(
          `SELECT outbox.command_id
           FROM outbox
           LEFT JOIN target_schedule_latches
             ON target_schedule_latches.outbox_id = outbox.id
           WHERE (
             outbox.phase = 'failed'
             AND json_extract(
               outbox.record_json,
               '$.error.code'
             ) = 'OUTCOME_UNKNOWN'
           ) OR target_schedule_latches.state = 'blocked-unknown'
           ORDER BY outbox.rowid`,
        )
        .map((row) => rowText(row, "command_id"));

      for (const row of this.#database.all(
        `SELECT outbox.*,
                target_schedule_latches.state AS latch_state,
                json_extract(
                  commands.command_json,
                  '$.kind'
                ) AS command_kind
         FROM outbox
         JOIN commands ON commands.id = outbox.command_id
         LEFT JOIN target_schedule_latches
           ON target_schedule_latches.outbox_id = outbox.id
         ORDER BY outbox.rowid`,
      )) {
        const outbox = OutboxRecordSchema.parse(
          parsed(row.record_json),
        );
        const commandKind = rowText(row, "command_kind");
        const targetKind = rowText(row, "target_kind");
        if (
          commandKind === "artifact.persist" ||
          !durableCommandTargetKindMatches(
            commandKind,
            targetKind,
          )
        ) {
          blocked.push(outbox.commandId);
          if (
            row.latch_state !== null &&
            String(row.latch_state) !== "blocked-unknown"
          ) {
            this.#database.run(
              `UPDATE target_schedule_latches
               SET state = 'blocked-unknown', recovery_json = ?,
                   updated_at = ?
               WHERE outbox_id = ?`,
              json({
                status: "authority-unavailable",
                commandKind,
                targetKind,
              }),
              now,
              outbox.id,
            );
          }
          continue;
        }
        if (outbox.phase === "effect-applied") {
          if (String(row.latch_state) !== "blocked-unknown") {
            effects.push(outbox.commandId);
          }
          continue;
        }
        if (outbox.phase !== "intent") {
          continue;
        }
        if (String(row.latch_state) === "blocked-unknown") {
          continue;
        }
        const command = this.#requireCommand(outbox.commandId);
        const workerId = row.worker_id;
        if (workerId === null) {
          intents.push(outbox.commandId);
          continue;
        }
        if (isBefore(now, rowText(row, "claim_expires_at"))) {
          continue;
        }
        if (
          command.kind === "canvas.operation" &&
          this.#canvasEffects !== undefined &&
          String(row.latch_state) === "pending-fence"
        ) {
          blocked.push(outbox.commandId);
          continue;
        }
        if (command.kind === "canvas.operation") {
          const evidence = this.#recoveryProbe?.({ command, outbox });
          if (
            evidence !== undefined &&
            evidence.observedTargetHash ===
              command.target.expectedBeforeHash
          ) {
            ContentHashSchema.parse(evidence.evidenceHash);
            ContentHashSchema.parse(evidence.observedTargetHash);
            this.#recordRetryDecision(command, outbox, evidence);
            this.#database.run(
              `UPDATE outbox
               SET worker_id = NULL, claim_expires_at = NULL
               WHERE id = ?`,
              outbox.id,
            );
            intents.push(outbox.commandId);
            continue;
          }
          this.#recordOutcomeUnknown(command, outbox);
          blocked.push(outbox.commandId);
          continue;
        }
        this.#recordOutcomeUnknown(command, outbox);
        blocked.push(outbox.commandId);
      }
      return {
        intentsAwaitingEffect: intents,
        effectsAwaitingCommit: effects,
        blockedOutcomeUnknown: [...new Set(blocked)],
      };
    });
  }

  getRecoveryDecision(
    commandId: string,
  ): CrashRecoveryDecision | undefined {
    const row = this.#database.one(
      `SELECT decision_json FROM recovery_decisions
       WHERE command_id = ?
       ORDER BY sequence DESC
       LIMIT 1`,
      commandId,
    );
    return row === undefined
      ? undefined
      : CrashRecoveryDecisionSchema.parse(parsed(row.decision_json));
  }

  getRecoveryDecisions(
    commandId: string,
  ): readonly CrashRecoveryDecision[] {
    return this.#database
      .all(
        `SELECT decision_json FROM recovery_decisions
         WHERE command_id = ?
         ORDER BY sequence`,
        commandId,
      )
      .map((row) =>
        CrashRecoveryDecisionSchema.parse(
          parsed(row.decision_json),
        ),
      );
  }

  dispatchHarness(
    input: HarnessDispatchRequest,
  ): HarnessDispatch {
    return this.#harnesses.dispatch(input);
  }

  getRunState(runId: string): DurableRunState | undefined {
    return this.#harnesses.getState(runId);
  }

  createHarnessTask(input: HarnessTaskInput) {
    return this.#harnessLifecycle.createTask(input);
  }

  startHarnessRun(
    input: HarnessRunStartInput,
  ): Promise<HarnessRunSnapshot> {
    return this.#harnessLifecycle.start(input);
  }

  resumeHarnessRun(
    input: HarnessRunResumeInput,
  ): Promise<HarnessRunSnapshot> {
    return this.#harnessLifecycle.resume(input);
  }

  pauseHarnessRun(
    input: HarnessRunControlInput,
  ): HarnessRunSnapshot {
    return this.#harnessLifecycle.pause(input);
  }

  stopHarnessRun(
    input: HarnessRunControlInput,
  ): HarnessRunSnapshot {
    return this.#harnessLifecycle.stop(input);
  }

  resolveDemoHarnessApproval(
    input: DemoHarnessApprovalResolutionInput,
  ): HarnessRunSnapshot {
    return this.#harnessLifecycle.resolveApproval(input);
  }

  getHarnessRun(runId: string): HarnessRunSnapshot | undefined {
    return this.#harnessLifecycle.getRun(runId);
  }

  getHarnessRunEvents(
    runId: string,
  ): readonly HarnessLifecycleEvent[] {
    return this.#harnessLifecycle.getEvents(runId);
  }

  createHarnessHandoff(input: HarnessHandoffInput): HarnessHandoff {
    return this.#harnessLifecycle.createHandoff(input);
  }

  attachHarnessCanonicalTraceRef(
    input: HarnessTraceReferenceInput,
  ): void {
    this.#harnessLifecycle.attachTraceReference(input);
  }

  #requireCommand(commandId: DurableCommand["id"]): DurableCommand {
    const command = this.getCommand(commandId);
    if (command === undefined) {
      throw new Error(`Command "${commandId}" was not found.`);
    }
    return command;
  }

  #failOutbox(
    outbox: OutboxRecord,
    error: unknown,
    code?: string,
  ): void {
    if (
      outbox.phase !== "intent" &&
      outbox.phase !== "effect-applied"
    ) {
      return;
    }
    const failed = OutboxRecordSchema.parse({
      ...outbox,
      phase: "failed",
      failedFrom: outbox.phase,
      failedAt: this.#clock(),
      error: {
        code:
          code ??
          (error instanceof AuthorizationError ||
          error instanceof StaleLeaseError
            ? error.code
            : "EFFECT_EXECUTION_FAILED"),
        message:
          error instanceof Error ? error.message : "Effect failed.",
        retryable: false,
      },
    });
    OutboxTransitionSchema.parse({ from: outbox, to: failed });
    this.#database.run(
      `UPDATE outbox
       SET phase = ?, record_json = ?, worker_id = NULL,
           claim_expires_at = NULL
       WHERE id = ?`,
      failed.phase,
      json(failed),
      failed.id,
    );
    this.#database.run(
      "UPDATE commands SET state = 'failed' WHERE id = ?",
      outbox.commandId,
    );
  }

  #recordOutcomeUnknown(
    command: DurableCommand,
    outbox: OutboxRecord,
  ): void {
    const recovery = this.#nextRecoveryIdentity();
    const decision = CrashRecoveryDecisionSchema.parse({
      schemaVersion: 1,
      id: recovery.id,
      projectId: command.projectId,
      commandId: command.id,
      outboxId: outbox.id,
      checkpointId: null,
      decidedAt: this.#clock(),
      observedPhase: "intent",
      decision: "block-outcome-unknown",
      effectKind: command.kind,
      reason:
        "A claimed effect may have produced effects before acknowledgement.",
    });
    this.#database.run(
      `INSERT INTO recovery_decisions
        (sequence, id, command_id, decision_json)
       VALUES (?, ?, ?, ?)`,
      recovery.sequence,
      decision.id,
      command.id,
      json(decision),
    );
    this.#failOutbox(
      outbox,
      new Error("Effect outcome is unknown after worker interruption."),
      "OUTCOME_UNKNOWN",
    );
  }

  #recordRetryDecision(
    command: DurableCommand,
    outbox: OutboxRecord,
    evidence: NonNullable<
      ReturnType<NonNullable<DurableRuntimeOptions["recoveryProbe"]>>
    >,
  ): void {
    const recovery = this.#nextRecoveryIdentity();
    const decision = CrashRecoveryDecisionSchema.parse({
      schemaVersion: 1,
      id: recovery.id,
      projectId: command.projectId,
      commandId: command.id,
      outboxId: outbox.id,
      checkpointId: null,
      decidedAt: this.#clock(),
      observedPhase: "intent",
      decision: "retry-idempotent-effect",
      effectKind: command.kind,
      retryClass: "proven-idempotent",
      expectedBeforeHash: command.target.expectedBeforeHash,
      observedTargetHash: evidence.observedTargetHash,
      probe: {
        kind: "target-state-hash",
        checkedAt: evidence.checkedAt,
        evidenceHash: evidence.evidenceHash,
      },
    });
    this.#database.run(
      `INSERT INTO recovery_decisions
        (sequence, id, command_id, decision_json)
       VALUES (?, ?, ?, ?)`,
      recovery.sequence,
      decision.id,
      command.id,
      json(decision),
    );
  }

  #nextRecoveryIdentity(): {
    readonly sequence: number;
    readonly id: string;
  } {
    const row = this.#database.one(
      `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
       FROM recovery_decisions`,
    );
    const sequence = Number(row?.next_sequence);
    const body = String(sequence).padStart(26, "0");
    if (!Number.isSafeInteger(sequence) || body.length !== 26) {
      throw new Error("Recovery decision sequence is exhausted.");
    }
    return { sequence, id: `rcv_${body}` };
  }
}
