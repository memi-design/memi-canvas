import { z } from "zod";

const safeText = (maximum: number) => z.string().min(1).max(maximum);
const idSchema = safeText(512);
const componentSourceSchema = z
  .object({
    repositoryRevision: safeText(512),
    repositoryDirty: z.boolean().optional(),
    sourceAnchor: safeText(4_096),
    sourceContentHash: safeText(512).optional(),
    exportName: safeText(512).optional(),
  })
  .strict();
const componentPreviewItemSchema = z
  .object({
    icon: z.string().max(512).optional(),
    label: z.string().max(2_048),
    status: z.string().max(512).optional(),
    supportingText: z.string().max(4_096).optional(),
    value: z.string().max(2_048).optional(),
  })
  .strict();

export const canvasClipboardComponentBindingSchema = z
  .object({
    atomicLevel: z.enum([
      "atom",
      "molecule",
      "organism",
      "template",
      "page",
    ]),
    componentId: idSchema,
    componentName: safeText(512),
    classification: z.enum(["master", "instance"]),
    editable: z
      .object({
        label: z.boolean(),
        icon: z.boolean(),
        selected: z.boolean(),
        variant: z.boolean(),
      })
      .strict(),
    masterId: idSchema.optional(),
    props: z
      .object({
        label: z.string().max(2_048).optional(),
        icon: z.string().max(512).optional(),
        selected: z.boolean().optional(),
        status: z.string().max(512).optional(),
        supportingText: z.string().max(4_096).optional(),
        placeholder: z.string().max(2_048).optional(),
        value: z.string().max(2_048).optional(),
        items: z.array(componentPreviewItemSchema).max(100).optional(),
      })
      .strict(),
    role: z.enum([
      "button",
      "tab-bar",
      "tab-item",
      "card",
      "input",
      "badge",
      "header",
      "screen-shell",
    ]),
    source: componentSourceSchema,
    variant: z.string().max(512).optional(),
  })
  .strict()
  .superRefine((component, context) => {
    if (
      component.classification === "master" &&
      component.masterId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Component masters cannot reference another master.",
        path: ["masterId"],
      });
    }
    if (
      component.classification === "instance" &&
      component.masterId === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Component instances must reference their master.",
        path: ["masterId"],
      });
    }
  });
