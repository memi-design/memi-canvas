import { z } from "zod";
import { ImportInventorySchemaV1 } from "@memi/protocol";

const containedPath = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value
        .split("/")
        .every((part) => part.length > 0 && part !== "." && part !== ".."),
    "Paths must remain inside the imported repository.",
  );

const catalogItem = z.strictObject({
  id: z.string().min(1).max(160),
  name: z.string().trim().min(1).max(256),
  sourcePath: containedPath,
});

export const RepositoryImportManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  projectName: z.string().trim().min(1).max(256),
  rootPath: z.string().min(1).max(4_096).startsWith("/"),
  revision: z.string().trim().min(1).max(64),
  remote: z.string().trim().min(1).max(2_048).optional(),
  platform: z.enum([
    "mixed",
    "react-native-expo",
    "react-web",
    "swiftui",
    "unknown",
  ]),
  dirty: z.boolean(),
  inventory: ImportInventorySchemaV1.optional(),
  files: z
    .array(
      z.strictObject({
        path: containedPath,
        kind: z.enum(["asset", "config", "source", "style"]),
        size: z.number().int().min(0).max(5_000_000),
      }),
    )
    .max(20_000),
  screens: z
    .array(
      catalogItem.extend({
        route: z.string().trim().min(1).max(512),
      }),
    )
    .max(10_000),
  components: z.array(catalogItem).max(10_000),
  tokens: z.array(catalogItem).max(2_000),
});

export type RepositoryImportManifest = z.infer<
  typeof RepositoryImportManifestSchema
>;

export type RepositoryImporter = (
  rootPath: string,
) => Promise<RepositoryImportManifest>;
