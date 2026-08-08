import {
  CanvasComponentBindingV2Schema,
  CanvasComponentDefinitionV2Schema,
  CanvasDetachedProvenanceV2Schema,
  CanvasDocumentV2Schema,
  CanvasNodeV2Schema,
  CanvasReferenceBindingV2Schema,
  CanvasSourceBindingV2Schema,
  type CanvasDocumentV2,
  type CanvasNodeV2,
} from "@memi/protocol";
import {
  createCanvasDocumentV2,
  hashCanvasDocumentV2,
} from "@memi/canvas-document";
import { z } from "zod";

import type { LegacyNode } from "./canvas-state-migration.js";
import { serializeCanvasPath } from "./canvas-path.js";
import { DEFAULT_WORKBENCH_LAYOUT } from "./model.js";
import { canvasTextFromWorkbench } from "./workbench-text-style.js";

function nullableRepositoryFields(
  value: Readonly<Record<string, unknown>>,
) {
  return {
    ...value,
    dirtyFileFingerprint: value.dirtyFileFingerprint ?? null,
    repositoryDirty: value.repositoryDirty ?? null,
    sourceContentHash: value.sourceContentHash ?? null,
    sourceFingerprint: value.sourceFingerprint ?? null,
  };
}

function sourceBinding(
  node: LegacyNode,
): z.infer<typeof CanvasSourceBindingV2Schema> | null {
  const result = CanvasSourceBindingV2Schema.safeParse({
    ...nullableRepositoryFields(node.source ?? {}),
    captureState:
      node.source?.captureState ??
      (node.kind === "RoutePlaceholder" ? "placeholder" : "captured"),
  });
  return result.success ? result.data : null;
}

export function legacyNodeKind(
  node: LegacyNode,
): CanvasNodeV2["kind"] {
  if (
    sourceBinding(node) !== null ||
    node.kind === "CodeFrame" ||
    node.kind === "RoutePlaceholder" ||
    node.kind === "ReferenceFrame"
  ) {
    return "imported-source-frame";
  }
  if (node.kind === "DraftFrame") {
    return "frame";
  }
  if (node.kind === "ComponentInstance") {
    return node.component?.classification === "master"
      ? "component"
      : "instance";
  }
  const kinds = {
    Arrow: "arrow",
    Comment: "sticky",
    Component: "component",
    Ellipse: "ellipse",
    Frame: "frame",
    Group: "group",
    Image: "image",
    Line: "line",
    Rectangle: "rectangle",
    Section: "section",
    Slice: "section",
    Text: "text",
    Vector: "vector",
  } as const;
  return kinds[node.kind as keyof typeof kinds];
}

export function legacyComponentKey(node: LegacyNode): string | null {
  return node.component?.componentId ?? null;
}

function jsonOverrides(
  node: LegacyNode,
): Readonly<Record<string, z.infer<ReturnType<typeof z.json>>>> {
  if (
    node.kind !== "ComponentInstance" ||
    node.component?.classification !== "instance"
  ) {
    return {};
  }
  const parsed = z
    .record(z.string(), z.json())
    .safeParse(node.component.props ?? {});
  return parsed.success ? parsed.data : {};
}

export function canonicalNodeFromLegacy(
  legacy: LegacyNode,
  legacyById: ReadonlyMap<string, LegacyNode>,
  nodeIds: Readonly<Record<string, string>>,
  componentIds: Readonly<Record<string, string>>,
): CanvasNodeV2 {
  const parent =
    legacy.parentId === null ? undefined : legacyById.get(legacy.parentId);
  const kind = legacyNodeKind(legacy);
  const component = legacyComponentKey(legacy);
  const canonicalSourceBinding = sourceBinding(legacy);
  const provenanceResult = CanvasDetachedProvenanceV2Schema.safeParse({
    ...nullableRepositoryFields(legacy.provenance ?? {}),
    captureState:
      legacy.provenance?.captureState === "captured" ||
      legacy.provenance?.captureState === "placeholder"
        ? legacy.provenance.captureState
        : null,
    coverageCellId: legacy.provenance?.coverageCellId ?? null,
    routeId: legacy.provenance?.routeId ?? null,
    stateId: legacy.provenance?.stateId ?? null,
  });
  const provenance = provenanceResult.success
    ? provenanceResult.data
    : null;
  const referenceResult = CanvasReferenceBindingV2Schema.safeParse(
    legacy.reference ?? {},
  );
  const referenceBinding = referenceResult.success
    ? referenceResult.data
    : null;
  const componentBinding =
    legacy.component === undefined || component === null
      ? null
      : (() => {
          const {
            masterId,
            source,
            variant,
            ...componentValue
          } = legacy.component;
          return CanvasComponentBindingV2Schema.parse({
            ...componentValue,
            componentId: componentIds[component],
            masterNodeId:
              masterId === undefined ? null : nodeIds[masterId],
            source: {
              ...source,
              exportName: source.exportName ?? null,
              repositoryDirty: source.repositoryDirty ?? null,
              sourceContentHash: source.sourceContentHash ?? null,
            },
            variant: variant ?? null,
          });
        })();
  return CanvasNodeV2Schema.parse({
    childIds: [],
    componentBinding,
    componentId:
      kind === "instance" && component !== null
        ? componentIds[component]
        : null,
    geometry: {
      height: legacy.size.height,
      width: legacy.size.width,
    },
    id: nodeIds[legacy.id],
    content:
      legacy.kind === "Comment"
        ? { body: legacy.text ?? "", type: "note" }
        : legacy.kind === "Image" && legacy.image !== undefined
          ? {
              alt: legacy.image.alt,
              byteLength: legacy.image.byteLength,
              dataUri: legacy.image.src,
              height: legacy.image.height,
              type: "image",
              width: legacy.image.width,
            }
        : legacy.path !== undefined
          ? {
              pathData: serializeCanvasPath(legacy.path),
              type: "vector",
            }
        : legacy.kind !== "DraftFrame" &&
            legacy.frameContent === undefined
          ? null
          : {
              format: "plain-text",
              type: "frame",
              value: legacy.frameContent ?? "",
            },
    instanceOverrides: jsonOverrides(legacy),
    kind,
    layout: {
      ...DEFAULT_WORKBENCH_LAYOUT,
      ...legacy.layout,
      padding: {
        ...DEFAULT_WORKBENCH_LAYOUT.padding,
        ...legacy.layout?.padding,
      },
    },
    name: legacy.name,
    parentId: legacy.parentId === null ? null : nodeIds[legacy.parentId],
    provenance,
    referenceBinding,
    sourceAnchor: null,
    sourceBinding:
      kind === "imported-source-frame" ? canonicalSourceBinding : null,
    style: {
      cornerRadii: legacy.cornerRadii ?? [0, 0, 0, 0],
      ...(legacy.effects === undefined
        ? {}
        : { effects: legacy.effects.map((effect) => ({ ...effect })) }),
      fills:
        legacy.fill === undefined
          ? []
          : [{ color: legacy.fill, type: "solid" }],
      locked: legacy.locked,
      opacity: legacy.opacity ?? 1,
      ...(legacy.strokeWeight === undefined
        ? {}
        : { strokeWeight: legacy.strokeWeight }),
      ...(legacy.strokeAlign === undefined
        ? {}
        : { strokeAlign: legacy.strokeAlign }),
      strokes:
        legacy.stroke === undefined
          ? []
          : [{ color: legacy.stroke, type: "solid" }],
      visible: !legacy.hidden,
    },
    text:
      kind === "text"
        ? canvasTextFromWorkbench(legacy, legacy.text ?? "")
        : null,
    transform: {
      rotation: legacy.rotation ?? 0,
      scaleX: 1,
      scaleY: 1,
      x:
        parent === undefined
          ? legacy.position.x
          : legacy.position.x - parent.position.x,
      y:
        parent === undefined
          ? legacy.position.y
          : legacy.position.y - parent.position.y,
    },
  });
}

export function projectCanonicalDocumentFromLegacy(
  legacyNodes: readonly LegacyNode[],
  canonicalByLegacyId: ReadonlyMap<string, CanvasNodeV2>,
  nodeIds: Readonly<Record<string, string>>,
  componentIds: Readonly<Record<string, string>>,
  documentId: string,
  projectId: string,
): CanvasDocumentV2 {
  const childrenByParent = new Map<string, string[]>();
  for (const legacy of legacyNodes) {
    if (legacy.parentId === null) {
      continue;
    }
    const children = childrenByParent.get(legacy.parentId) ?? [];
    childrenByParent.set(legacy.parentId, [
      ...children,
      nodeIds[legacy.id] as string,
    ]);
  }
  const nodesById = Object.fromEntries(
    legacyNodes.map((legacy) => {
      const node = canonicalByLegacyId.get(legacy.id);
      if (node === undefined) {
        throw new Error(`Canonical node projection is missing ${legacy.id}.`);
      }
      return [
        node.id,
        {
          ...node,
          childIds: childrenByParent.get(legacy.id) ?? [],
        },
      ];
    }),
  );
  const componentsById = Object.fromEntries(
    legacyNodes.flatMap((legacy) => {
      const componentKey = legacyComponentKey(legacy);
      if (
        componentKey === null ||
        legacy.component?.classification !== "master"
      ) {
        return [];
      }
      const definition = CanvasComponentDefinitionV2Schema.parse({
        id: componentIds[componentKey],
        name: legacy.component.componentName,
        propertyKeys: Object.entries(legacy.component.editable)
          .filter(([, editable]) => editable)
          .map(([key]) => key),
        rootNodeId: nodeIds[legacy.id],
      });
      return [[definition.id, definition] as const];
    }),
  );
  const base = createCanvasDocumentV2({ id: documentId, projectId });
  const candidate = CanvasDocumentV2Schema.parse({
    ...base,
    componentsById,
    nodesById,
    rootIds: legacyNodes
      .filter((node) => node.parentId === null)
      .map((node) => nodeIds[node.id]),
  });
  return CanvasDocumentV2Schema.parse({
    ...candidate,
    stateHash: hashCanvasDocumentV2(candidate),
  });
}
