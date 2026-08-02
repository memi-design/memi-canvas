import type {
  WorkspaceDocumentation,
  WorkspaceScreen,
} from "./schema.js";

export function selectWorkspaceScreen(
  documentation: WorkspaceDocumentation,
  coverageCellId: string,
): WorkspaceScreen | undefined {
  return documentation.screens.find(
    (screen) => screen.id === coverageCellId,
  );
}

export function selectWorkspaceScreensByRoute(
  documentation: WorkspaceDocumentation,
  routeId: string,
): readonly WorkspaceScreen[] {
  return Object.freeze(
    documentation.screens.filter(
      (screen) => screen.route.id === routeId,
    ),
  );
}
