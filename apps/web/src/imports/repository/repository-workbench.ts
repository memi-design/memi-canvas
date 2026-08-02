import { CANVAS_HARNESSES } from "../../canvas/harness-config.js";
import { ProjectIdSchema } from "@memi/protocol";

import type {
  CanvasWorkbenchProject,
  ComponentInstanceBinding,
  SourceBinding,
  WorkbenchNode,
} from "../../canvas/model.js";
import type { RepositoryImportManifest } from "./repository-import.js";

const SAFE_LOCAL_PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,127}$/u;

function isSafeProjectId(value: string): boolean {
  return (
    SAFE_LOCAL_PROJECT_ID.test(value) ||
    ProjectIdSchema.safeParse(value).success
  );
}
const DESIGN_COLUMNS = 4;

function inventoryCount(
  manifest: RepositoryImportManifest,
  kind: "screens" | "components" | "tokens",
): number {
  const inventoryKey = `${kind.slice(0, -1)}Count` as
    "screenCount" | "componentCount" | "tokenCount";
  return manifest.inventory?.[inventoryKey] ?? manifest[kind].length;
}

function viewport(
  platform: RepositoryImportManifest["platform"],
): SourceBinding["viewport"] {
  return platform === "react-web"
    ? { name: "desktop", width: 1_280, height: 800 }
    : { name: "mobile", width: 390, height: 844 };
}

function screenColumns(
  platform: RepositoryImportManifest["platform"],
): number {
  return platform === "react-web" ? 2 : 5;
}

function inventoryProvenance(
  manifest: RepositoryImportManifest,
  sourcePath: string,
  routeId: string,
  coverageCellId: string,
) {
  return {
    repositoryRevision: manifest.revision,
    repositoryDirty: manifest.dirty,
    sourceAnchor: sourcePath,
    routeId,
    stateId: "inventory",
    coverageCellId,
  } as const;
}

function componentRole(
  name: string,
): ComponentInstanceBinding["role"] {
  const normalized = name.toLowerCase();
  if (/button|cta|action/.test(normalized)) return "button";
  if (/badge|tag|pill|chip/.test(normalized)) return "badge";
  if (/input|field|search|textarea/.test(normalized)) return "input";
  if (/header|top.?bar|toolbar/.test(normalized)) return "header";
  if (/bottom.?nav|tab.?bar|navigation/.test(normalized)) return "tab-bar";
  if (/tab/.test(normalized)) return "tab-item";
  if (/screen|shell|layout/.test(normalized)) return "screen-shell";
  return "card";
}

function componentAtomicLevel(
  role: ComponentInstanceBinding["role"],
): ComponentInstanceBinding["atomicLevel"] {
  if (role === "button" || role === "badge" || role === "input") {
    return "atom";
  }
  if (role === "tab-item" || role === "card") return "molecule";
  if (role === "tab-bar" || role === "header") return "organism";
  return "template";
}

function sourceComponentMaster(
  manifest: RepositoryImportManifest,
  component: RepositoryImportManifest["components"][number],
): ComponentInstanceBinding {
  const role = componentRole(component.name);
  return {
    atomicLevel: componentAtomicLevel(role),
    componentId: `source:${component.id}`,
    componentName: component.name,
    classification: "master",
    editable: {
      icon: false,
      label: true,
      selected: role === "tab-item",
      variant: true,
    },
    props: { label: component.name },
    role,
    source: {
      exportName: component.name,
      repositoryDirty: manifest.dirty,
      repositoryRevision: manifest.revision,
      sourceAnchor: component.sourcePath,
    },
  };
}

function componentNodes(
  manifest: RepositoryImportManifest,
  designRootId: string,
  baseY: number,
): readonly WorkbenchNode[] {
  return manifest.components.map((component, index) => ({
    id: `repository-component-${component.id}`,
    kind: "Component",
    name: component.name,
    parentId: designRootId,
    position: {
      x: 32 + (index % DESIGN_COLUMNS) * 280,
      y: baseY + 88 + Math.floor(index / DESIGN_COLUMNS) * 156,
    },
    size: { width: 240, height: 112 },
    locked: false,
    hidden: false,
    fill: "var(--studio-surface-raised)",
    stroke: "var(--studio-border-strong)",
    text: component.name,
    frameContent: component.sourcePath,
    component: sourceComponentMaster(manifest, component),
    provenance: inventoryProvenance(
      manifest,
      component.sourcePath,
      `component:${component.id}`,
      `repository-component-${component.id}`,
    ),
  }));
}

function tokenNodes(
  manifest: RepositoryImportManifest,
  designRootId: string,
  baseY: number,
  componentRows: number,
): readonly WorkbenchNode[] {
  const tokenBaseY = baseY + 104 + componentRows * 156;
  return manifest.tokens.map((token, index) => ({
    id: `repository-token-${token.id}`,
    kind: "Text",
    name: token.name,
    parentId: designRootId,
    position: {
      x: 32 + (index % DESIGN_COLUMNS) * 280,
      y: tokenBaseY + Math.floor(index / DESIGN_COLUMNS) * 72,
    },
    size: { width: 240, height: 40 },
    locked: false,
    hidden: false,
    fill: "var(--studio-ink-primary)",
    text: token.name,
    provenance: inventoryProvenance(
      manifest,
      token.sourcePath,
      `tokens:${token.id}`,
      `repository-token-${token.id}`,
    ),
  }));
}

function designSystemNodes(
  manifest: RepositoryImportManifest,
  projectId: string,
): readonly WorkbenchNode[] {
  if (manifest.components.length === 0 && manifest.tokens.length === 0) {
    return [];
  }
  const screenRows = Math.ceil(
    Math.max(1, manifest.screens.length) /
      screenColumns(manifest.platform),
  );
  const baseY =
    screenRows * (viewport(manifest.platform).height + 96) + 120;
  const componentRows = Math.ceil(
    manifest.components.length / DESIGN_COLUMNS,
  );
  const tokenRows = Math.ceil(manifest.tokens.length / DESIGN_COLUMNS);
  const designRootId = `repository-design-system-${projectId}`;
  const root: WorkbenchNode = {
    id: designRootId,
    kind: "Section",
    name: "Design system",
    parentId: null,
    position: { x: 0, y: baseY },
    size: {
      width: 1_152,
      height: Math.max(
        220,
        128 + componentRows * 156 + tokenRows * 72,
      ),
    },
    locked: false,
    hidden: false,
    fill: "var(--studio-surface-panel)",
    stroke: "var(--studio-border-strong)",
    frameContent:
      `${inventoryCount(manifest, "components")} components · ` +
      `${inventoryCount(manifest, "tokens")} token sources`,
  };
  return [
    root,
    ...componentNodes(manifest, designRootId, baseY),
    ...tokenNodes(
      manifest,
      designRootId,
      baseY,
      componentRows,
    ),
  ];
}

export function createRepositoryCanvasProject(
  manifest: RepositoryImportManifest,
  projectId: string,
  harnessId: string,
): CanvasWorkbenchProject {
  if (!isSafeProjectId(projectId)) {
    throw new Error("The imported project identity is invalid.");
  }
  const designSystem = designSystemNodes(manifest, projectId);
  const nodes = [...designSystem];
  return Object.freeze({
    id: projectId,
    title: manifest.projectName,
    selectedNodeId: designSystem[0]?.id ?? null,
    repositoryCatalog: {
      routes: manifest.screens.map((screen) => ({
        normalizedPath: screen.route,
        repositoryRevision: manifest.revision,
        routeId: screen.route,
        sourcePath: screen.sourcePath,
      })),
      evidence: [],
    },
    document: {
      id: `document-local-${projectId}`,
      revision: 1,
      nodes,
    },
    harness: {
      selectedId: harnessId,
      options: CANVAS_HARNESSES,
    },
    trace:
      nodes.length === 0
        ? []
        : [
            {
              id: `trace-repository-import-${projectId}`,
              action:
                `Deterministic repository inventory · ${inventoryCount(manifest, "screens")} screens · ` +
                `${inventoryCount(manifest, "components")} components`,
              targetNodeId: nodes[0]!.id,
              harnessId,
            },
          ],
  });
}
