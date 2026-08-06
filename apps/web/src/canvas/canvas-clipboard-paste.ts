import type {
  CanvasClipboardPasteResult,
  CanvasClipboardPayload,
} from "./canvas-clipboard.js";
import type {
  ComponentInstanceBinding,
  WorkbenchNode,
} from "./model.js";

function nextPastedId(knownIds: Set<string>, sourceId: string): string {
  const base = `${sourceId}-copy`;
  let suffix = 1;
  let candidate = `${base}-${suffix}`;
  while (knownIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  knownIds.add(candidate);
  return candidate;
}

function destinationMasterId(
  nodes: readonly WorkbenchNode[],
  component: ComponentInstanceBinding,
): string | undefined {
  if (component.masterId === undefined) {
    return undefined;
  }
  const candidates = nodes.filter((node) => {
    const candidate = node.component;
    return (
      candidate?.classification === "master" &&
      candidate.componentId === component.componentId &&
      (node.id === component.masterId ||
        (candidate.source.sourceAnchor === component.source.sourceAnchor &&
          candidate.source.exportName === component.source.exportName))
    );
  });
  return (
    candidates.find(({ id }) => id === component.masterId)?.id ??
    (candidates.length === 1 ? candidates[0]?.id : undefined)
  );
}

export function pasteValidatedCanvasClipboard(
  nodes: readonly WorkbenchNode[],
  payload: CanvasClipboardPayload,
  offset: number,
): CanvasClipboardPasteResult {
  const knownIds = new Set(nodes.map((node) => node.id));
  const pastedIdBySourceId = new Map<string, string>();
  const rootIds = new Set(payload.rootIds);
  for (const node of payload.nodes) {
    pastedIdBySourceId.set(node.id, nextPastedId(knownIds, node.id));
  }

  const pastedNodes = payload.nodes.map((node): WorkbenchNode => {
    const component = node.component;
    const resolvedMasterId =
      (component?.masterId === undefined
        ? undefined
        : pastedIdBySourceId.get(component.masterId)) ??
      (component === undefined
        ? undefined
        : destinationMasterId(nodes, component));
    const pastedComponent =
      component === undefined
        ? undefined
        : componentWithMaster(component, resolvedMasterId);
    return {
      ...structuredClone(node),
      id: pastedIdBySourceId.get(node.id) as string,
      // Name only pasted roots. Their descendants retain their component or
      // layer names, while the visible copy has the familiar editor label.
      ...(rootIds.has(node.id) ? { name: `${node.name} copy` } : {}),
      parentId:
        node.parentId === null
          ? null
          : pastedIdBySourceId.get(node.parentId) ?? null,
      position: {
        x: node.position.x + offset,
        y: node.position.y + offset,
      },
      ...(pastedComponent === undefined
        ? {}
        : { component: pastedComponent }),
    };
  });
  return {
    nodes: [...nodes, ...pastedNodes],
    pastedNodes,
    selectedIds: payload.rootIds.flatMap((id) => {
      const pastedId = pastedIdBySourceId.get(id);
      return pastedId === undefined ? [] : [pastedId];
    }),
  };
}

function componentWithMaster(
  component: ComponentInstanceBinding,
  masterId: string | undefined,
): ComponentInstanceBinding {
  const { masterId: _sourceMasterId, ...withoutMaster } =
    structuredClone(component);
  return masterId === undefined
    ? withoutMaster
    : { ...withoutMaster, masterId };
}
