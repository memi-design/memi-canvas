import type { ComponentInstanceBinding } from "../canvas/component-model.js";
import type { CanvasWorkbenchProject, WorkbenchNode } from "../canvas/model.js";
import type { ProjectRecord } from "./project-library.js";

export const LANDING_PAGE_DEMO_SOURCE_LABEL = "Landing page demo";

type Viewport = "Desktop" | "Tablet" | "Mobile";
type LandingPage = "Home" | "Pricing" | "Contact";

interface DemoFrame {
  readonly id: string;
  readonly page: LandingPage;
  readonly viewport: Viewport;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const pageFill = "var(--studio-surface-panel)";
const ink = "var(--studio-ink-primary)";
const mutedInk = "var(--studio-ink-secondary)";
const ruby = "var(--studio-accent)";
const rubySoft = "var(--studio-accent-soft)";
const border = "var(--studio-border-subtle)";
const documentSurface = "var(--studio-document-surface)";

const frames: readonly DemoFrame[] = Object.freeze([
  { id: "demo-home-desktop", page: "Home", viewport: "Desktop", x: 100, y: 120, width: 1440, height: 980 },
  { id: "demo-home-tablet", page: "Home", viewport: "Tablet", x: 1640, y: 120, width: 834, height: 980 },
  { id: "demo-home-mobile", page: "Home", viewport: "Mobile", x: 2574, y: 120, width: 390, height: 844 },
  { id: "demo-pricing-desktop", page: "Pricing", viewport: "Desktop", x: 100, y: 1240, width: 1440, height: 980 },
  { id: "demo-pricing-tablet", page: "Pricing", viewport: "Tablet", x: 1640, y: 1240, width: 834, height: 980 },
  { id: "demo-pricing-mobile", page: "Pricing", viewport: "Mobile", x: 2574, y: 1240, width: 390, height: 844 },
  { id: "demo-contact-desktop", page: "Contact", viewport: "Desktop", x: 100, y: 2360, width: 1440, height: 980 },
  { id: "demo-contact-tablet", page: "Contact", viewport: "Tablet", x: 1640, y: 2360, width: 834, height: 980 },
  { id: "demo-contact-mobile", page: "Contact", viewport: "Mobile", x: 2574, y: 2360, width: 390, height: 844 },
]);

function node(
  id: string,
  kind: WorkbenchNode["kind"],
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<WorkbenchNode> = {},
): WorkbenchNode {
  return {
    id,
    kind,
    name,
    parentId: null,
    position: { x, y },
    size: { width, height },
    locked: false,
    hidden: false,
    ...options,
  };
}

function component(
  documentId: string,
  componentId: string,
  componentName: string,
  atomicLevel: ComponentInstanceBinding["atomicLevel"],
  role: ComponentInstanceBinding["role"],
  classification: ComponentInstanceBinding["classification"],
  props: ComponentInstanceBinding["props"],
  masterId?: string,
): ComponentInstanceBinding {
  return {
    atomicLevel,
    componentId: `local:${documentId}:${componentId}`,
    componentName,
    classification,
    editable: { icon: false, label: true, selected: true, variant: true },
    ...(masterId === undefined ? {} : { masterId }),
    props,
    role,
    source: {
      repositoryRevision: `local:${documentId}`,
      sourceAnchor: `canvas://${documentId}/${componentId}`,
    },
  };
}

function pageFrame(frame: DemoFrame): WorkbenchNode {
  return node(frame.id, "Frame", `Aster · ${frame.page} · ${frame.viewport}`, frame.x, frame.y, frame.width, frame.height, {
    fill: pageFill,
    stroke: border,
    strokeWeight: 1,
    cornerRadii: [16, 16, 16, 16],
  });
}

function positioned(
  frame: DemoFrame,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
): readonly [number, number, number, number] {
  return [frame.x + offsetX, frame.y + offsetY, width, height];
}

function textNode(
  frame: DemoFrame,
  suffix: string,
  name: string,
  value: string,
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  fill = ink,
): WorkbenchNode {
  const [x, y, resolvedWidth, resolvedHeight] = positioned(
    frame,
    offsetX,
    offsetY,
    width,
    height,
  );
  return node(`${frame.id}-${suffix}`, "Text", name, x, y, resolvedWidth, resolvedHeight, {
    parentId: frame.id,
    text: value,
    fill,
  });
}

function componentInstance(
  documentId: string,
  frame: DemoFrame,
  suffix: string,
  masterId: string,
  componentId: string,
  componentName: string,
  atomicLevel: ComponentInstanceBinding["atomicLevel"],
  role: ComponentInstanceBinding["role"],
  props: ComponentInstanceBinding["props"],
  offsetX: number,
  offsetY: number,
  width: number,
  height: number,
  fill: string,
): WorkbenchNode {
  const [x, y, resolvedWidth, resolvedHeight] = positioned(
    frame,
    offsetX,
    offsetY,
    width,
    height,
  );
  return node(`${frame.id}-${suffix}`, "ComponentInstance", componentName, x, y, resolvedWidth, resolvedHeight, {
    parentId: frame.id,
    fill,
    cornerRadii: [10, 10, 10, 10],
    component: component(
      documentId,
      componentId,
      componentName,
      atomicLevel,
      role,
      "instance",
      props,
      masterId,
    ),
  });
}

function homeNodes(documentId: string, frame: DemoFrame): readonly WorkbenchNode[] {
  const mobile = frame.viewport === "Mobile";
  const tablet = frame.viewport === "Tablet";
  const horizontalInset = mobile ? 24 : tablet ? 56 : 104;
  const titleWidth = mobile ? 324 : tablet ? 510 : 650;
  const previewWidth = mobile ? 342 : tablet ? 286 : 452;
  const previewY = mobile ? 494 : 240;
  return [
    textNode(frame, "brand", "Aster wordmark", "ASTER", horizontalInset, 42, 100, 24),
    textNode(frame, "nav", "Navigation", mobile ? "Menu" : "Work    Pricing    About", frame.width - horizontalInset - (mobile ? 44 : 250), 42, mobile ? 44 : 250, 24, mutedInk),
    textNode(frame, "eyebrow", "Hero eyebrow", "A clearer way to ship ideas", horizontalInset, mobile ? 148 : 180, titleWidth, 24, ruby),
    textNode(frame, "headline", "Hero headline", mobile ? "Build what\npeople remember." : "Build the next\ngood thing.", horizontalInset, mobile ? 196 : 230, titleWidth, mobile ? 120 : 144),
    textNode(frame, "copy", "Hero description", "A responsive landing-page system that remains editable from a single component library.", horizontalInset, mobile ? 344 : 410, titleWidth, 60, mutedInk),
    componentInstance(documentId, frame, "cta", "demo-button-master", "button", "Primary button", "atom", "button", { label: "Start a project" }, horizontalInset, mobile ? 438 : 514, 164, 48, ruby),
    node(`${frame.id}-visual`, "Rectangle", "Hero visual", frame.x + (mobile ? 24 : frame.width - previewWidth - horizontalInset), frame.y + previewY, previewWidth, mobile ? 250 : 460, {
      parentId: frame.id,
      fill: rubySoft,
      stroke: "var(--studio-accent-hover)",
      strokeWeight: 1,
      cornerRadii: [mobile ? 20 : 28, mobile ? 20 : 28, mobile ? 20 : 28, mobile ? 20 : 28],
    }),
    textNode(frame, "visual-label", "Hero visual label", "Component\nfirst.", mobile ? 54 : frame.width - previewWidth - horizontalInset + 32, previewY + (mobile ? 72 : 74), 220, 64, ink),
  ];
}

function pricingNodes(documentId: string, frame: DemoFrame): readonly WorkbenchNode[] {
  const mobile = frame.viewport === "Mobile";
  const inset = mobile ? 24 : 72;
  const cardWidth = mobile ? 342 : frame.viewport === "Tablet" ? 316 : 360;
  return [
    textNode(frame, "eyebrow", "Pricing eyebrow", "ONE SIMPLE PLAN", inset, 104, 250, 24, ruby),
    textNode(frame, "headline", "Pricing headline", mobile ? "A fair way\nto keep moving." : "Simple plans for serious work.", inset, 156, mobile ? 330 : 620, 110),
    textNode(frame, "copy", "Pricing description", "Every view is an editable frame. Every repeated piece is a local component.", inset, mobile ? 292 : 292, mobile ? 330 : 540, 56, mutedInk),
    componentInstance(documentId, frame, "plan", "demo-card-master", "pricing-card", "Plan card", "molecule", "card", { label: "Studio", value: "$24 / month", supportingText: "Unlimited local files\nShared components\nVersion history" }, inset, mobile ? 398 : 410, cardWidth, mobile ? 266 : 290, documentSurface),
    textNode(frame, "plan-copy", "Plan contents", "Studio\n$24 / month\n\nUnlimited local files\nShared components\nVersion history", inset + 28, mobile ? 430 : 442, cardWidth - 56, 184, ink),
  ];
}

function contactNodes(documentId: string, frame: DemoFrame): readonly WorkbenchNode[] {
  const mobile = frame.viewport === "Mobile";
  const inset = mobile ? 24 : frame.viewport === "Tablet" ? 72 : 152;
  const formWidth = mobile ? 342 : frame.viewport === "Tablet" ? 512 : 560;
  return [
    textNode(frame, "eyebrow", "Contact eyebrow", "START A CONVERSATION", inset, 126, 320, 24, ruby),
    textNode(frame, "headline", "Contact headline", mobile ? "Make it\nmemorable." : "Make something people remember.", inset, 178, mobile ? 330 : 620, 112),
    textNode(frame, "copy", "Contact description", "Use this page to practise the exact editing loop: select, change, copy, group, and turn a local component into code.", inset, mobile ? 322 : 322, formWidth, 66, mutedInk),
    componentInstance(documentId, frame, "name", "demo-input-master", "input", "Text input", "atom", "input", { label: "Name", placeholder: "Your name" }, inset, mobile ? 438 : 454, formWidth, 52, documentSurface),
    componentInstance(documentId, frame, "email", "demo-input-master", "input", "Text input", "atom", "input", { label: "Email", placeholder: "you@company.com" }, inset, mobile ? 510 : 526, formWidth, 52, documentSurface),
    componentInstance(documentId, frame, "submit", "demo-button-master", "button", "Primary button", "atom", "button", { label: "Send note" }, inset, mobile ? 596 : 616, 146, 48, ruby),
  ];
}

function pageNodes(documentId: string, frame: DemoFrame): readonly WorkbenchNode[] {
  switch (frame.page) {
    case "Home":
      return homeNodes(documentId, frame);
    case "Pricing":
      return pricingNodes(documentId, frame);
    case "Contact":
      return contactNodes(documentId, frame);
  }
}

export function isLandingPageDemo(project: ProjectRecord): boolean {
  return project.kind === "design" && project.source.kind === "local" && project.source.label === LANDING_PAGE_DEMO_SOURCE_LABEL;
}

// Atomic Design template: an editable, local-only landing-page practice file.
// It demonstrates the same local component masters across desktop, tablet, and
// mobile frames without presenting any runtime pixels as source authority.
export function createLandingPageDemoProject(project: ProjectRecord): CanvasWorkbenchProject {
  const documentId = project.documentRef.replace("canvas:", "document-local-");
  const library = node("demo-library", "Frame", "Aster · Component library", 100, 3520, 1440, 420, {
    fill: "var(--studio-surface-raised)",
    stroke: border,
    strokeWeight: 1,
    cornerRadii: [16, 16, 16, 16],
  });
  const masters: readonly WorkbenchNode[] = [
    node("demo-button-master", "Component", "Primary button", 180, 3660, 172, 48, {
      parentId: library.id,
      fill: ruby,
      cornerRadii: [10, 10, 10, 10],
      component: component(documentId, "button", "Primary button", "atom", "button", "master", { label: "Start a project" }),
    }),
    node("demo-card-master", "Component", "Plan card", 472, 3608, 336, 246, {
      parentId: library.id,
      fill: documentSurface,
      stroke: border,
      strokeWeight: 1,
      cornerRadii: [16, 16, 16, 16],
      component: component(documentId, "pricing-card", "Plan card", "molecule", "card", "master", { label: "Studio" }),
    }),
    node("demo-input-master", "Component", "Text input", 928, 3660, 368, 52, {
      parentId: library.id,
      fill: documentSurface,
      stroke: border,
      strokeWeight: 1,
      cornerRadii: [10, 10, 10, 10],
      component: component(documentId, "input", "Text input", "atom", "input", "master", { label: "Input", placeholder: "Type here" }),
    }),
  ];
  const nodes = [
    ...frames.map(pageFrame),
    library,
    ...masters,
    ...frames.flatMap((frame) => pageNodes(documentId, frame)),
  ];

  return {
    id: project.id,
    title: project.name,
    selectedNodeId: frames[0]?.id ?? null,
    document: { id: documentId, revision: 1, nodes },
    harness: { selectedId: "codex", options: [{ id: "codex", label: "Codex" }] },
    trace: [],
  };
}
