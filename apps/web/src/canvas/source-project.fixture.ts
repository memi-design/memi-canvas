import { CANVAS_HARNESSES } from "./harness-config.js";
import type { CanvasWorkbenchProject } from "./model.js";

const revision = "northstar@abc123";
const primaryButtonSource = {
  repositoryRevision: revision,
  sourceAnchor: "src/components/Button.tsx",
  sourceContentHash: `sha256:${"a".repeat(64)}`,
};

export const sourceProjectFixture: CanvasWorkbenchProject = {
  id: "northstar-source-project",
  title: "Northstar source project",
  selectedNodeId: "northstar-home",
  repositoryCatalog: {
    routes: [
      {
        normalizedPath: "/",
        repositoryRevision: revision,
        routeId: "home",
        sourcePath: "src/pages/Home.tsx",
      },
      {
        normalizedPath: "/settings",
        repositoryRevision: revision,
        routeId: "settings",
        sourcePath: "src/pages/Settings.tsx",
      },
    ],
    evidence: [],
  },
  document: {
    id: "document-northstar-source-project",
    revision: 3,
    nodes: [
      {
        id: "northstar-home",
        kind: "CodeFrame",
        name: "Home",
        parentId: null,
        position: { x: 100, y: 100 },
        size: { width: 390, height: 844 },
        locked: false,
        hidden: false,
        source: {
          captureState: "captured",
          repositoryRevision: revision,
          routeId: "home",
          stateId: "default",
          coverageCellId: "home-mobile",
          sourceAnchor: "src/pages/Home.tsx",
          sourceContentHash: `sha256:${"a".repeat(64)}`,
          viewport: { name: "mobile", width: 390, height: 844 },
        },
      },
      {
        id: "northstar-settings",
        kind: "RoutePlaceholder",
        name: "Settings",
        parentId: null,
        position: { x: 586, y: 100 },
        size: { width: 390, height: 844 },
        locked: false,
        hidden: false,
        source: {
          captureState: "placeholder",
          repositoryRevision: revision,
          routeId: "settings",
          stateId: "default",
          coverageCellId: "settings-mobile",
          sourceAnchor: "src/pages/Settings.tsx",
          sourceContentHash: `sha256:${"b".repeat(64)}`,
          viewport: { name: "mobile", width: 390, height: 844 },
        },
      },
      {
        id: "northstar-button-primary-master",
        kind: "Component",
        name: "Button / Primary",
        parentId: null,
        position: { x: 100, y: 1_060 },
        size: { width: 240, height: 44 },
        locked: false,
        hidden: false,
        fill: "#ff5470",
        component: {
          atomicLevel: "atom",
          classification: "master",
          componentId: "northstar.button.primary",
          componentName: "Button",
          editable: {
            icon: false,
            label: true,
            selected: false,
            variant: true,
          },
          props: { label: "Continue" },
          role: "button",
          source: primaryButtonSource,
          variant: "primary",
        },
      },
    ],
  },
  harness: { selectedId: "codex", options: CANVAS_HARNESSES },
  trace: [
    {
      id: "trace-source-import",
      action: "Imported repository source",
      targetNodeId: "northstar-home",
    },
  ],
};
