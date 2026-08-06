import type { CanvasTextV2 } from "@memi/protocol";

import type { WorkbenchNode } from "./model.js";

export type WorkbenchTextAppearance = Pick<
  WorkbenchNode,
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "letterSpacing"
  | "lineHeight"
  | "textAlign"
>;

type WorkbenchTextSource = Readonly<{
  fontFamily?: string | undefined;
  fontSize?: number | undefined;
  fontWeight?: number | undefined;
  letterSpacing?: number | undefined;
  lineHeight?: number | undefined;
  name: string;
  text?: string | undefined;
  textAlign?: WorkbenchNode["textAlign"] | undefined;
}>;

export function canvasTextFromWorkbench(
  node: WorkbenchTextSource,
  characters = node.text ?? node.name,
): CanvasTextV2 {
  return {
    autoResize: "width-height",
    characters,
    ...(node.fontFamily === undefined
      ? {}
      : { fontFamily: node.fontFamily }),
    ...(node.fontSize === undefined ? {} : { fontSize: node.fontSize }),
    ...(node.fontWeight === undefined
      ? {}
      : { fontWeight: node.fontWeight }),
    ...(node.letterSpacing === undefined
      ? {}
      : { letterSpacing: node.letterSpacing }),
    ...(node.lineHeight === undefined
      ? {}
      : { lineHeight: node.lineHeight }),
    ...(node.textAlign === undefined ? {} : { textAlign: node.textAlign }),
  };
}

export function workbenchTextAppearance(
  text: CanvasTextV2,
): WorkbenchTextAppearance {
  return {
    ...(text.fontFamily === undefined ? {} : { fontFamily: text.fontFamily }),
    ...(text.fontSize === undefined ? {} : { fontSize: text.fontSize }),
    ...(text.fontWeight === undefined ? {} : { fontWeight: text.fontWeight }),
    ...(text.letterSpacing === undefined
      ? {}
      : { letterSpacing: text.letterSpacing }),
    ...(text.lineHeight === undefined ? {} : { lineHeight: text.lineHeight }),
    ...(text.textAlign === undefined ? {} : { textAlign: text.textAlign }),
  };
}

export function textAppearanceChanged(
  left: WorkbenchTextAppearance,
  right: WorkbenchTextAppearance,
): boolean {
  return (
    left.fontFamily !== right.fontFamily ||
    left.fontSize !== right.fontSize ||
    left.fontWeight !== right.fontWeight ||
    left.letterSpacing !== right.letterSpacing ||
    left.lineHeight !== right.lineHeight ||
    left.textAlign !== right.textAlign
  );
}
