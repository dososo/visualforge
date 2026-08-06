import { z } from "zod";
import { generationModelSchema, generationParametersSchema } from "./generation-manifest";
import { generationReferenceSnapshotSchema } from "./subject-asset";
import { domainProfileSchema } from "./domain-profile.js";
import { signatureStyleSelectionSchema } from "./signature-style.js";

export const GENERATION_EVENT_SCHEMA_VERSION = "1.0.0" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "必须是 SHA-256 哈希");

export const generationEventSchema = z.object({
  schemaVersion: z.literal(GENERATION_EVENT_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string().min(1),
  generationManifestId: z.string().min(1),
  setId: z.string().min(1).optional(),
  planItemId: z.string().min(1).optional(),
  domainProfile: domainProfileSchema.optional(),
  signatureStyleSelection: signatureStyleSelectionSchema.nullable().optional(),
  parentGenerationId: z.string().min(1).nullable(),
  sourceAssetId: z.string().min(1),
  references: z.array(generationReferenceSnapshotSchema).optional(),
  lockedFields: z.array(z.enum([
    "identity", "subject", "composition", "camera", "lighting", "palette", "material", "texture", "style"
  ])).optional(),
  visualDNAId: sha256Schema,
  visualDNASchemaVersion: z.string().min(1),
  dnaRevision: z.number().int().min(1),
  prompt: z.string().min(1),
  promptCompilerVersion: z.string().min(1),
  model: generationModelSchema,
  parameters: generationParametersSchema,
  outputAssetId: z.string().min(1),
  outputHash: sha256Schema,
  createdAt: z.number().int().nonnegative()
}).strict();

export type GenerationEvent = z.infer<typeof generationEventSchema>;
