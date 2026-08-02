export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_DIGEST_CONFLICT";
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      `Idempotency key "${idempotencyKey}" is already bound to another action digest.`,
    );
    this.name = "IdempotencyConflictError";
    this.idempotencyKey = idempotencyKey;
  }
}

export class AuthorizationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.code = code;
  }
}

export class LeaseConflictError extends Error {
  readonly code = "LEASE_HELD";

  constructor(targetId: string) {
    super(`Target "${targetId}" already has an active lease.`);
    this.name = "LeaseConflictError";
  }
}

export class StaleLeaseError extends Error {
  readonly code: "LEASE_NOT_ACTIVE" | "STALE_FENCE";

  constructor(
    code: "LEASE_NOT_ACTIVE" | "STALE_FENCE",
    message: string,
  ) {
    super(message);
    this.name = "StaleLeaseError";
    this.code = code;
  }
}

export class StaleWorkerClaimError extends Error {
  readonly code = "STALE_WORKER_CLAIM";

  constructor(commandId: string) {
    super(`Worker claim for command "${commandId}" is stale.`);
    this.name = "StaleWorkerClaimError";
  }
}

export class CommandDigestError extends Error {
  readonly code:
    | "INVALID_EFFECT_PAYLOAD"
    | "PAYLOAD_HASH_MISMATCH"
    | "ACTION_DIGEST_MISMATCH";

  constructor(
    code:
      | "INVALID_EFFECT_PAYLOAD"
      | "PAYLOAD_HASH_MISMATCH"
      | "ACTION_DIGEST_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "CommandDigestError";
    this.code = code;
  }
}

export class EffectVerificationError extends Error {
  readonly code:
    | "EFFECT_VERIFIER_REQUIRED"
    | "EFFECT_VERIFICATION_MISMATCH"
    | "COMMIT_TRACE_CONFLICT";

  constructor(
    code:
      | "EFFECT_VERIFIER_REQUIRED"
      | "EFFECT_VERIFICATION_MISMATCH"
      | "COMMIT_TRACE_CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "EffectVerificationError";
    this.code = code;
  }
}
