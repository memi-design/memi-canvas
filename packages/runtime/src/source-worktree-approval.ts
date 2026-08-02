import type {
  RunWorktreeApproval,
  RunWorktreeApprovalAuthorityPort,
  RunWorktreeReview,
  SourceReviewDecisionActor,
} from "./source-worktree.types.js";

export function approveRunWorktreeReview(
  review: RunWorktreeReview,
  actor: SourceReviewDecisionActor,
  authority: RunWorktreeApprovalAuthorityPort,
  options: { readonly now?: () => string } = {},
): Promise<RunWorktreeApproval> {
  if (review.status !== "ready") {
    throw new Error("Only a ready run worktree review can be approved.");
  }
  if (actor.kind !== "human" || actor.id.trim().length === 0) {
    throw new Error("Run worktree approval requires a human actor.");
  }
  return authority.issue({
    approvedAt: (options.now ?? (() => new Date().toISOString()))(),
    approvedBy: structuredClone(actor),
    digest: review.digest,
    runId: review.run.runId,
  });
}
