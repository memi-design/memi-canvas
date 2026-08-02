import type {
  HarnessRuntimeSnapshot,
  SharedProductRunState,
} from "./types.js";

export function projectSharedProductState(
  snapshot: HarnessRuntimeSnapshot,
): SharedProductRunState {
  const common = {
    taskId: snapshot.taskId,
    runId: snapshot.runId,
    status: snapshot.status,
    harness: Object.freeze({ ...snapshot.harness }),
    lastSequence: snapshot.lastSequence,
  };

  return Object.freeze({
    ...common,
    ...(snapshot.pendingApproval === undefined
      ? {}
      : {
          pendingApproval: Object.freeze({
            ...snapshot.pendingApproval,
            scopes: Object.freeze([
              ...snapshot.pendingApproval.scopes,
            ]),
            targetRefs: Object.freeze(
              snapshot.pendingApproval.targetRefs.map((target) =>
                Object.freeze({ ...target }),
              ),
            ),
          }),
        }),
    ...(snapshot.checkpointId === undefined
      ? {}
      : { checkpointId: snapshot.checkpointId }),
  });
}
