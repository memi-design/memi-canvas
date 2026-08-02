import type {
  CapabilityGrant,
  DurableCommand,
} from "../../protocol/src/index.js";

import { AuthorizationError } from "./errors.js";
import type { CommandPolicyValidator } from "./types.js";

const M0_EFFECT_KINDS = new Set([
  "canvas.operation",
  "artifact.persist",
]);

const M0_CAPABILITIES = new Set([
  "canvas:read",
  "canvas:propose",
  "canvas:apply",
]);

export function assertM0EffectAllowed(
  command: DurableCommand,
): void {
  const blockedCapabilities = command.requiredCapabilities.filter(
    (capability) => !M0_CAPABILITIES.has(capability),
  );
  if (
    !M0_EFFECT_KINDS.has(command.kind) ||
    blockedCapabilities.length > 0
  ) {
    throw new AuthorizationError(
      "EFFECT_CLASS_BLOCKED",
      `M0 blocks effect kind "${command.kind}" with capabilities ` +
        `"${command.requiredCapabilities.join(", ")}".`,
    );
  }
}

export function validateCommandPolicy(
  validator: CommandPolicyValidator | undefined,
  command: DurableCommand,
  effectPayload: unknown,
  grant: CapabilityGrant,
): void {
  assertM0EffectAllowed(command);
  if (validator === undefined) {
    return;
  }
  try {
    validator.validate({ command, effectPayload, grant });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw error;
    }
    throw new AuthorizationError(
      "POLICY_VALIDATION_FAILED",
      error instanceof Error
        ? error.message
        : "Command policy validation failed.",
    );
  }
}
