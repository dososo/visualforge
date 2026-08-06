import { z } from "zod";
import { generationParametersSchema } from "./generation-manifest";
import { visualDNASchema } from "./visual-dna";
import { generationReferenceSnapshotSchema } from "./subject-asset";
import { domainProfileSchema } from "./domain-profile.js";

export const TASK_RECORD_SCHEMA_VERSION = "1.0.0" as const;

export const taskStatusSchema = z.enum([
  "CREATED",
  "UPLOADING",
  "ANALYZING",
  "READY",
  "GENERATING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
  "RETRYING"
]);

export const taskErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean()
}).strict();

export const taskRecordSchema = z.object({
  schemaVersion: z.literal(TASK_RECORD_SCHEMA_VERSION),
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  retryOfTaskId: z.string().min(1).nullable(),
  generationEventId: z.string().min(1).nullable(),
  generationEventIds: z.array(z.string().min(1)),
  operation: z.enum(["ANALYSIS", "GENERATION"]),
  status: taskStatusSchema,
  startedAt: z.number().int().nonnegative().nullable(),
  finishedAt: z.number().int().nonnegative().nullable(),
  retryCount: z.number().int().nonnegative(),
  error: taskErrorSchema.nullable(),
  heartbeat: z.number().int().nonnegative(),
  input: z.object({
    sourceAssetId: z.string().min(1),
    references: z.array(generationReferenceSnapshotSchema).optional(),
    visualDNA: visualDNASchema.nullable(),
    prompt: z.string().min(1).nullable(),
    parameters: generationParametersSchema.nullable(),
    parentGenerationId: z.string().min(1).nullable()
    ,
    setId: z.string().min(1).optional(),
    planItemId: z.string().min(1).optional(),
    domainProfile: domainProfileSchema.optional()
  }).strict()
}).strict();

export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskError = z.infer<typeof taskErrorSchema>;
export type TaskRecord = z.infer<typeof taskRecordSchema>;

export type LegacyTaskStatus =
  | "created" | "analyzing" | "ready" | "queued"
  | "rendering" | "saving" | "completed" | "failed" | "cancelled";

export interface LegacyTaskRecord {
  id: string;
  projectId: string;
  status: LegacyTaskStatus;
  stageLabel: string;
  error?: { code: string; message: string; retryable: boolean };
  generationManifestId?: string;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}
