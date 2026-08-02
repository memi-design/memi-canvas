import type {
  CanvasMaterializationPlan,
  ProductWorkspace,
} from "@memi/product-import";
import type { DurableRuntime } from "@memi/runtime";
import type { WorkspaceDocumentation } from "@memi/workspace-documentation";
import {
  projectWorkspaceDocumentation,
  type CanonicalCanvasReplay,
} from "@memi/workspace-documentation/projector";

export function composeExecutedImportDocumentation(
  runtime: DurableRuntime,
  workspace: ProductWorkspace,
  plan: CanvasMaterializationPlan,
): WorkspaceDocumentation {
  const projectId = workspace.projectId;
  const replay = runtime.replayCanvasTrace(projectId);
  return projectWorkspaceDocumentation({
    workspace,
    plan,
    canonicalReplay: replay as unknown as CanonicalCanvasReplay,
  });
}
