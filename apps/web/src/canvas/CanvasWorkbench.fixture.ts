export type WorkbenchNodeKind =
  | "CodeFrame"
  | "DraftFrame"
  | "Text"
  | "Rectangle"
  | "Frame";

export interface WorkbenchNodeFixture {
  readonly id: string;
  readonly kind: WorkbenchNodeKind;
  readonly name: string;
  readonly parentId: string | null;
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
  readonly size: {
    readonly width: number;
    readonly height: number;
  };
  readonly locked: boolean;
  readonly hidden: boolean;
  readonly text?: string;
  readonly fill?: string;
  readonly source?: {
    readonly repositoryRevision: string;
    readonly routeId: string;
    readonly stateId: string;
    readonly coverageCellId: string;
    readonly sourceAnchor: string;
    readonly viewport: {
      readonly name: "desktop" | "tablet" | "mobile";
      readonly width: number;
      readonly height: number;
    };
  };
}

export interface CanvasWorkbenchFixture {
  readonly id: string;
  readonly title: string;
  readonly selectedNodeId: string;
  readonly document: {
    readonly id: string;
    readonly revision: number;
    readonly nodes: readonly WorkbenchNodeFixture[];
  };
  readonly harness: {
    readonly selectedId: string;
    readonly options: readonly {
      readonly id: string;
      readonly label: string;
    }[];
  };
  readonly trace: readonly {
    readonly id: string;
    readonly action: string;
    readonly targetNodeId: string;
    readonly harnessId?: string;
  }[];
}

export const canvasWorkbenchFixture: CanvasWorkbenchFixture = {
  id: "northstar-canvas",
  title: "Northstar Commerce",
  selectedNodeId: "node-dashboard-desktop",
  document: {
    id: "document-northstar",
    revision: 7,
    nodes: [
      {
        id: "node-dashboard-desktop",
        kind: "CodeFrame",
        name: "Dashboard desktop",
        parentId: null,
        position: { x: 100, y: 120 },
        size: { width: 720, height: 450 },
        locked: false,
        hidden: false,
        source: {
          repositoryRevision: "fixture@abc123",
          routeId: "route-dashboard",
          stateId: "state-dashboard-default",
          coverageCellId: "coverage-dashboard-desktop",
          sourceAnchor: "src/routes/dashboard.tsx:24",
          viewport: {
            name: "desktop",
            width: 1440,
            height: 900,
          },
        },
      },
      {
        id: "node-campaign-card",
        kind: "DraftFrame",
        name: "Campaign card",
        parentId: null,
        position: { x: 920, y: 160 },
        size: { width: 360, height: 240 },
        locked: false,
        hidden: false,
        fill: "#FFFFFF",
      },
      {
        id: "node-welcome-headline",
        kind: "Text",
        name: "Welcome headline",
        parentId: "node-campaign-card",
        position: { x: 952, y: 192 },
        size: { width: 240, height: 40 },
        locked: false,
        hidden: false,
        text: "Welcome back",
        fill: "#111827",
      },
      {
        id: "node-promo-panel",
        kind: "Rectangle",
        name: "Promo panel",
        parentId: "node-campaign-card",
        position: { x: 952, y: 256 },
        size: { width: 296, height: 112 },
        locked: false,
        hidden: false,
        fill: "#DBEAFE",
      },
      {
        id: "node-checkout-exploration",
        kind: "Frame",
        name: "Checkout exploration",
        parentId: null,
        position: { x: 100, y: 720 },
        size: { width: 390, height: 844 },
        locked: false,
        hidden: false,
        fill: "#FFFFFF",
      },
    ],
  },
  harness: {
    selectedId: "codex",
    options: [
      { id: "codex", label: "Codex" },
      { id: "claude", label: "Claude" },
    ],
  },
  trace: [
    {
      id: "trace-import",
      action: "Imported Dashboard desktop",
      targetNodeId: "node-dashboard-desktop",
    },
  ],
};
