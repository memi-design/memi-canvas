import { z } from "zod";
import {
  ContentHashSchema,
  IsoTimestampSchema,
  SchemaVersionSchema,
} from "./common.js";
import {
  ArtifactIdSchema,
  CorrelationIdSchema,
  ProjectIdSchema,
  RunIdSchema,
  TaskIdSchema,
  TraceEventIdSchema,
} from "./ids.js";

export const TraceActorSchema = z.strictObject({
  kind: z.enum(["human", "agent", "harness", "system"]),
  id: z.string().trim().min(1),
});

export const JsonPrimitiveSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

type JsonValue =
  | z.infer<typeof JsonPrimitiveSchema>
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    JsonPrimitiveSchema,
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const TraceEventFamilySchema = z.enum([
  "import.completed",
  "canvas.matrix.materialized",
  "canvas.operation.committed",
  "task.started",
  "approval.requested",
  "approval.resolved",
  "verification.completed",
  "checkpoint.created",
  "recovery.completed",
]);

const traceEventInputFields = {
  schemaVersion: SchemaVersionSchema,
  id: TraceEventIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  runId: RunIdSchema,
  family: TraceEventFamilySchema,
  actor: TraceActorSchema,
  correlationId: CorrelationIdSchema,
  causationId: TraceEventIdSchema.nullable(),
  payload: z.record(z.string(), JsonValueSchema),
  artifactIds: z.array(ArtifactIdSchema),
  beforeHash: ContentHashSchema.nullable(),
  afterHash: ContentHashSchema.nullable(),
};

export const TraceEventInputSchema = z.strictObject(traceEventInputFields);
export type TraceEventInput = z.input<typeof TraceEventInputSchema>;

export const TraceEventSchema = z.strictObject({
  ...traceEventInputFields,
  sequence: z.number().int().positive(),
  occurredAt: IsoTimestampSchema,
  actionDigest: ContentHashSchema,
  previousEventHash: ContentHashSchema.nullable(),
  eventHash: ContentHashSchema,
});
export type TraceEvent = z.infer<typeof TraceEventSchema>;
