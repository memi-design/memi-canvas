import type {
  CanvasWorkbenchProject,
  WorkbenchNode,
} from "./model.js";

export type ProductMapCategory =
  | "routes"
  | "screen-families"
  | "components"
  | "tokens"
  | "flows"
  | "evidence"
  | "findings";

export type ProductMapAuthority =
  | "source-owned"
  | "cached"
  | "canvas-only"
  | "immutable-evidence"
  | "proposal";

export type ProductMapStatus =
  | "fresh"
  | "stale"
  | "placeholder"
  | "blocked"
  | "missing"
  | "divergent"
  | "verified";

export interface ProductMapItem {
  readonly authority: ProductMapAuthority;
  readonly category: ProductMapCategory;
  readonly id: string;
  readonly label: string;
  readonly nodeId?: string;
  readonly nodeKind?: WorkbenchNode["kind"];
  readonly repositoryRevision?: string;
  readonly sourcePath?: string;
  readonly status: ProductMapStatus;
  readonly supportingText?: string;
}

export interface ProductMapGroup {
  readonly count: number;
  readonly id: ProductMapCategory;
  readonly items: readonly ProductMapItem[];
  readonly label: string;
}

export interface ProductMap {
  readonly groups: readonly ProductMapGroup[];
  readonly projectId: string;
  readonly totalCount: number;
}

export interface ProductMapFilter {
  readonly authority?: ProductMapAuthority | "all";
  readonly category?: ProductMapCategory | "all";
  readonly query?: string;
  readonly status?: ProductMapStatus | "all";
}

const GROUPS: readonly {
  readonly id: ProductMapCategory;
  readonly label: string;
}[] = [
  { id: "routes", label: "Routes" },
  { id: "screen-families", label: "Screen families" },
  { id: "components", label: "Components" },
  { id: "tokens", label: "Tokens" },
  { id: "flows", label: "Flows" },
  { id: "evidence", label: "Evidence" },
  { id: "findings", label: "Findings" },
];

function sourceStatus(node: WorkbenchNode): ProductMapStatus {
  return node.source?.repositoryDirty === true ||
    node.component?.source.repositoryDirty === true ||
    node.provenance?.repositoryDirty === true
    ? "stale"
    : "fresh";
}

function sourceRevision(node: WorkbenchNode): string | undefined {
  return (
    node.source?.repositoryRevision ??
    node.component?.source.repositoryRevision ??
    node.provenance?.repositoryRevision
  );
}

function sourcePath(node: WorkbenchNode): string | undefined {
  return (
    node.component?.source?.sourceAnchor ??
    node.source?.sourceAnchor ??
    node.provenance?.sourceAnchor
  );
}

function routeItems(
  nodes: readonly WorkbenchNode[],
): readonly ProductMapItem[] {
  const routes = new Map<string, ProductMapItem>();
  for (const node of nodes) {
    const source = node.source;
    if (source === undefined || routes.has(source.routeId)) {
      continue;
    }
    const routeId = source.routeId;
    const placeholder = node.kind === "RoutePlaceholder";
    routes.set(routeId, {
      authority: placeholder ? "cached" : "source-owned",
      category: "routes",
      id: `route-${routeId}`,
      label: routeId,
      nodeId: node.id,
      nodeKind: node.kind,
      repositoryRevision: source.repositoryRevision,
      sourcePath: source.sourceAnchor,
      status: placeholder ? "placeholder" : sourceStatus(node),
      supportingText: placeholder
        ? "Planned source frame · capture not verified"
        : source.stateId,
    });
  }
  return [...routes.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function catalogRouteItems(
  project: CanvasWorkbenchProject,
): readonly ProductMapItem[] | undefined {
  const routes = project.repositoryCatalog?.routes;
  if (routes === undefined) {
    return undefined;
  }
  const scenarioByRouteId = new Map<string, WorkbenchNode>();
  for (const node of project.document.nodes) {
    if (
      (node.kind === "CodeFrame" ||
        node.kind === "RoutePlaceholder") &&
      node.source !== undefined &&
      (!scenarioByRouteId.has(node.source.routeId) ||
        node.kind === "CodeFrame")
    ) {
      scenarioByRouteId.set(node.source.routeId, node);
    }
  }
  return routes
    .map((route): ProductMapItem => {
      const scenario = scenarioByRouteId.get(route.routeId);
      const placeholder = scenario?.kind === "RoutePlaceholder";
      return {
        authority: placeholder ? "cached" : "source-owned",
        category: "routes",
        id: `route-${route.routeId}`,
        label: route.normalizedPath,
        ...(scenario === undefined
          ? {}
          : {
              nodeId: scenario.id,
              nodeKind: scenario.kind,
            }),
        repositoryRevision: route.repositoryRevision,
        sourcePath: route.sourcePath,
        status:
          placeholder
            ? "placeholder"
            : scenario === undefined
              ? "fresh"
              : sourceStatus(scenario),
        supportingText:
          scenario === undefined
            ? "Expo Router source inventory"
            : placeholder
              ? "Mobile route on canvas · runtime capture pending"
              : "Editable source-backed mobile view",
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function screenFamily(routeId: string): string {
  const normalized = routeId.replace(/^\/+/u, "");
  const first = normalized.split("/").find((segment) => segment.length > 0);
  return first ?? "Root";
}

function screenFamilyItems(
  routes: readonly ProductMapItem[],
): readonly ProductMapItem[] {
  const families = new Map<string, ProductMapItem>();
  for (const route of routes) {
    const label = screenFamily(route.label);
    const current = families.get(label);
    if (current === undefined) {
      families.set(label, {
        ...route,
        category: "screen-families",
        id: `screen-family-${label}`,
        label,
        supportingText: `1 route · ${route.authority}`,
      });
      continue;
    }
    const count =
      Number.parseInt(current.supportingText ?? "1", 10) + 1;
    families.set(label, {
      ...current,
      supportingText: `${count} routes · mixed source coverage`,
      status:
        current.status === "placeholder" && route.status === "placeholder"
          ? "placeholder"
          : "fresh",
    });
  }
  return [...families.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function componentItems(
  nodes: readonly WorkbenchNode[],
): readonly ProductMapItem[] {
  const components = new Map<string, ProductMapItem>();
  for (const node of nodes) {
    const component = node.component;
    if (component === undefined) {
      if (node.kind !== "Component" || node.source === undefined) {
        continue;
      }
      const sourcePath = node.source.sourceAnchor;
      components.set(node.id, {
        authority: "source-owned",
        category: "components",
        id: `component-${node.id}`,
        label: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        repositoryRevision: node.source.repositoryRevision,
        sourcePath,
        status: sourceStatus(node),
        supportingText: "Declared source component",
      });
      continue;
    }
    const identity =
      component.classification === "master"
        ? `${component.componentId}:${component.variant ?? node.id}`
        : component.componentId;
    const current = components.get(identity);
    if (
      current !== undefined &&
      component.classification !== "master"
    ) {
      continue;
    }
    const repositoryRevision = sourceRevision(node);
    const componentSourcePath = sourcePath(node);
    components.set(identity, {
      authority: "source-owned",
      category: "components",
      id: `component-${identity}`,
      label: node.name,
      nodeId: node.id,
      nodeKind: node.kind,
      ...(repositoryRevision === undefined
        ? {}
        : { repositoryRevision }),
      ...(componentSourcePath === undefined
        ? {}
        : { sourcePath: componentSourcePath }),
      status: sourceStatus(node),
      supportingText: `${component.atomicLevel} · ${component.role}`,
    });
  }
  return [...components.values()].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

function tokenItems(
  nodes: readonly WorkbenchNode[],
): readonly ProductMapItem[] {
  return nodes
    .filter(
      (node) =>
        node.kind !== "Section" &&
        (/token|design system/iu.test(node.name) ||
          node.source?.routeId.startsWith("tokens:") === true ||
          node.provenance?.routeId?.startsWith("tokens:") === true),
    )
    .map((node): ProductMapItem => {
      const repositoryRevision = sourceRevision(node);
      const tokenSourcePath = sourcePath(node);
      return {
        authority:
          node.source === undefined && node.provenance === undefined
            ? "canvas-only"
            : "source-owned",
        category: "tokens",
        id: `token-${node.id}`,
        label: node.name,
        nodeId: node.id,
        nodeKind: node.kind,
        ...(repositoryRevision === undefined
          ? {}
          : { repositoryRevision }),
        ...(tokenSourcePath === undefined
          ? {}
          : { sourcePath: tokenSourcePath }),
        status:
          node.source === undefined && node.provenance === undefined
            ? "fresh"
            : sourceStatus(node),
        supportingText:
          node.source === undefined && node.provenance === undefined
            ? "Canvas token evidence"
            : (node.source?.routeId ?? node.provenance?.routeId ?? "").startsWith(
                  "tokens:",
                )
              ? "Declared source token"
              : "Repository token evidence",
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function evidenceItems(
  nodes: readonly WorkbenchNode[],
): readonly ProductMapItem[] {
  return nodes
    .filter((node) => node.kind === "ReferenceFrame")
    .map((node): ProductMapItem => ({
      authority: "immutable-evidence" as const,
      category: "evidence" as const,
      id: `evidence-${node.id}`,
      label: node.name,
      nodeId: node.id,
      nodeKind: node.kind,
      ...(node.reference?.sourceUrl === undefined
        ? {}
        : { sourcePath: node.reference.sourceUrl }),
      status: "fresh" as const,
      supportingText: `${node.reference?.authority ?? "Reference"} · not editable source`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function catalogEvidenceItems(
  project: CanvasWorkbenchProject,
): readonly ProductMapItem[] | undefined {
  const evidence = project.repositoryCatalog?.evidence;
  if (evidence === undefined) {
    return undefined;
  }
  return evidence
    .map((item): ProductMapItem => ({
      authority: "immutable-evidence",
      category: "evidence",
      id: `evidence-${item.id}`,
      label: item.label,
      sourcePath: item.sourceUrl,
      status: "fresh",
      supportingText: item.supportingText,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function findingItems(
  project: CanvasWorkbenchProject,
): readonly ProductMapItem[] {
  return project.trace
    .filter(({ action }) =>
      /blocked|unavailable|dirty|mismatch|failed/iu.test(action),
    )
    .map((trace) => ({
      authority: "cached" as const,
      category: "findings" as const,
      id: `finding-${trace.id}`,
      label: trace.action,
      nodeId: trace.targetNodeId,
      status: "blocked" as const,
      supportingText: "Local audit finding",
    }));
}

export function buildProductMap(
  project: CanvasWorkbenchProject,
): ProductMap {
  const routes =
    catalogRouteItems(project) ?? routeItems(project.document.nodes);
  const components = componentItems(project.document.nodes);
  const itemsByGroup: Readonly<
    Record<ProductMapCategory, readonly ProductMapItem[]>
  > = {
    components,
    evidence:
      catalogEvidenceItems(project) ??
      evidenceItems(project.document.nodes),
    findings: findingItems(project),
    flows: routes
      .filter(({ label }) => label.split("/").filter(Boolean).length > 1)
      .slice(0, 24)
      .map((route) => ({
        ...route,
        category: "flows" as const,
        id: `flow-${route.id}`,
        supportingText: "Route-linked product flow",
      })),
    routes,
    "screen-families": screenFamilyItems(routes),
    tokens: tokenItems(project.document.nodes),
  };
  const groups = GROUPS.map(({ id, label }) => ({
    count: itemsByGroup[id].length,
    id,
    items: itemsByGroup[id],
    label,
  }));
  return {
    groups,
    projectId: project.id,
    totalCount: groups.reduce((total, group) => total + group.count, 0),
  };
}

export function filterProductMap(
  map: ProductMap,
  filter: ProductMapFilter,
): ProductMap {
  const query = filter.query?.trim().toLowerCase() ?? "";
  const groups = map.groups
    .filter(
      ({ id }) =>
        filter.category === undefined ||
        filter.category === "all" ||
        filter.category === id,
    )
    .map((group) => {
      const items = group.items.filter((item) => {
        const matchesQuery =
          query.length === 0 ||
          `${item.label} ${item.supportingText ?? ""} ${item.sourcePath ?? ""}`
            .toLowerCase()
            .includes(query);
        const matchesAuthority =
          filter.authority === undefined ||
          filter.authority === "all" ||
          filter.authority === item.authority;
        const matchesStatus =
          filter.status === undefined ||
          filter.status === "all" ||
          filter.status === item.status;
        return matchesQuery && matchesAuthority && matchesStatus;
      });
      return { ...group, count: items.length, items };
    })
    .filter(({ count }) => count > 0);
  return {
    ...map,
    groups,
    totalCount: groups.reduce((total, group) => total + group.count, 0),
  };
}
