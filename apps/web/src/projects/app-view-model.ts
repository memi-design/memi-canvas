import type { CanvasAgentDefaults } from "../canvas/CanvasWorkbench.js";
import type { HomeProject } from "../home/ProjectHome.js";
import {
  GLOBAL_HARNESS_CATALOG,
  globalHarnessDefinition,
  type GlobalAgentSettings,
} from "../settings/global-settings.js";
import type { ProjectRecord } from "./project-library.js";

export function homeProject(project: ProjectRecord): HomeProject {
  const repository = project.source.kind === "repository";
  const lifecycle =
    project.lifecycle ?? (repository ? "ready" : "draft");
  return {
    id: project.id,
    kind: project.kind,
    name: project.name,
    provenance: repository
      ? {
          label: project.source.label,
          detail: [
            project.source.platform,
            project.source.version?.slice(0, 7),
          ]
            .filter(Boolean)
            .join(" · "),
        }
      : {
          label: "Local",
          detail: "Private local workspace",
        },
    status: lifecycle === "importing" ? "syncing" : lifecycle,
    thumbnail: {
      alt: `${project.name} generative project pattern`,
      ...(repository
        ? { countLabel: `${project.source.screenCount ?? 0} screens` }
        : {}),
      presentation: "generative-pattern",
    },
    updatedAt: project.lastOpenedAt ?? project.updatedAt,
    updatedLabel: repository ? "Imported locally" : "Edited locally",
  };
}

export function canvasAgentDefaults(
  settings: GlobalAgentSettings,
  projectHarnessId?: string,
): CanvasAgentDefaults {
  const harness =
    GLOBAL_HARNESS_CATALOG.find(
      ({ id }) => id === projectHarnessId,
    ) ?? globalHarnessDefinition(settings.harnessId);
  const modelId = harness.models.some(
    ({ id }) => id === settings.modelId,
  )
    ? settings.modelId
    : harness.models[0]!.id;
  return {
    harnessId: harness.id,
    modelId,
    modelOptions: harness.models.map(({ id, label }) => ({ id, label })),
    permissionPolicy: settings.permissionPolicy,
    reasoningEffort: settings.reasoningEffort,
  };
}
