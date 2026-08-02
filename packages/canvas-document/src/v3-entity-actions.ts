import {
  CanvasAssetV3Schema,
  CanvasComponentDefinitionV3Schema,
  CanvasPageV3Schema,
  CanvasSingleActionV3Schema,
  CanvasVariableCollectionV3Schema,
  CanvasVariableV3Schema,
  EditableReconstructionV1Schema,
  PrototypeConnectionV3Schema,
  RuntimeEvidenceV1Schema,
  type CanvasDocumentV3,
  type CanvasSingleActionIntentV3,
  type CanvasSingleActionV3,
} from "@memi/protocol";

export function prepareEntityActionV3(
  document: CanvasDocumentV3,
  intent: CanvasSingleActionIntentV3,
): CanvasSingleActionV3 {
  if (intent.type === "page.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        pageId: intent.payload.pageId,
        prior: document.pagesById[intent.payload.pageId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : CanvasPageV3Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "component.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        componentId: intent.payload.componentId,
        prior: document.componentsById[intent.payload.componentId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : CanvasComponentDefinitionV3Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "variable-collection.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        collectionId: intent.payload.collectionId,
        prior:
          document.variableCollectionsById[intent.payload.collectionId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : CanvasVariableCollectionV3Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "variable.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        variableId: intent.payload.variableId,
        prior: document.variablesById[intent.payload.variableId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : CanvasVariableV3Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "asset.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        assetId: intent.payload.assetId,
        prior: document.assetsById[intent.payload.assetId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : CanvasAssetV3Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "prototype.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        connectionId: intent.payload.connectionId,
        prior:
          document.prototypeConnectionsById[intent.payload.connectionId] ??
          null,
        next:
          intent.payload.next === null
            ? null
            : PrototypeConnectionV3Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "evidence.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        evidenceId: intent.payload.evidenceId,
        prior: document.evidenceById[intent.payload.evidenceId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : RuntimeEvidenceV1Schema.parse(intent.payload.next),
      },
    });
  }
  if (intent.type === "reconstruction.define") {
    return CanvasSingleActionV3Schema.parse({
      type: intent.type,
      payload: {
        reconstructionId: intent.payload.reconstructionId,
        prior:
          document.reconstructionsById[intent.payload.reconstructionId] ?? null,
        next:
          intent.payload.next === null
            ? null
            : EditableReconstructionV1Schema.parse(intent.payload.next),
      },
    });
  }
  throw new Error(`Canvas action is not an entity definition: ${intent.type}`);
}
