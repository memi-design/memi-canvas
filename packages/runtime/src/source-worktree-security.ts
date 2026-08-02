import type {
  SourceRepositoryProcessPolicy,
  SourceWorktreeMutationAuthorizationPort,
  SourceWorktreeMutationAuthorizationRequest,
} from "./source-worktree.types.js";
import {
  frozenClone,
  SHA256_PATTERN,
} from "./source-worktree-guards.js";

export const SOURCE_REPOSITORY_PROCESS_POLICY: SourceRepositoryProcessPolicy =
  deepFreezePolicy({
    allowExternalFilters: false,
    allowHooks: false,
    allowNetwork: false,
    allowShell: false,
    allowSubmodules: false,
  });

function deepFreezePolicy(
  policy: SourceRepositoryProcessPolicy,
): SourceRepositoryProcessPolicy {
  return Object.freeze({ ...policy });
}

export async function authorizeSourceWorktreeMutation(
  authority: SourceWorktreeMutationAuthorizationPort,
  request: SourceWorktreeMutationAuthorizationRequest,
): Promise<void> {
  const receipt = await authority.authorizeMutation(frozenClone(request));
  if (
    receipt.authorized !== true ||
    !SHA256_PATTERN.test(receipt.policyDigest)
  ) {
    throw new Error(
      "Source-worktree mutation authorization did not return a valid policy receipt.",
    );
  }
}
