import { z } from "zod";
import { visualDNASchema } from "./visual-dna";
import { generationReferenceSnapshotSchema } from "./subject-asset";
import { domainProfileSchema } from "./domain-profile.js";
import { signatureStyleSelectionSchema } from "./signature-style.js";

export const GENERATION_MANIFEST_SCHEMA_VERSION = "1.0.0" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "必须是 SHA-256 哈希");
const mimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);
const indexedDBFileSchema = z.object({
  storage: z.literal("indexeddb"),
  key: z.string().min(1),
  name: z.string().min(1)
}).strict();

export const generationModelSchema = z.object({
  provider: z.enum(["codex", "mock"]),
  name: z.string().min(1),
  version: z.string().min(1).nullable()
}).strict();

export const generationParametersSchema = z.object({
  aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]),
  count: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  userInstruction: z.string(),
  providerParameters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
}).strict();

export const generationManifestSchema = z.object({
  schemaVersion: z.literal(GENERATION_MANIFEST_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string().min(1),
  taskId: z.string().min(1),
  setId: z.string().min(1).optional(),
  planItemId: z.string().min(1).optional(),
  domainProfile: domainProfileSchema.optional(),
  signatureStyleSelection: signatureStyleSelectionSchema.nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative(),
  source: z.object({
    assetId: z.string().min(1),
    hash: sha256Schema,
    mimeType: mimeTypeSchema,
    file: indexedDBFileSchema
  }).strict(),
  references: z.array(generationReferenceSnapshotSchema).optional(),
  visualDNA: z.object({
    schemaVersion: z.literal("1.1.0"),
    revision: z.number().int().min(1),
    hash: sha256Schema,
    snapshot: visualDNASchema
  }).strict(),
  prompt: z.object({
    compilerVersion: z.string().min(1),
    text: z.string().min(1)
  }).strict(),
  model: generationModelSchema,
  parameters: generationParametersSchema,
  outputs: z.array(z.object({
    assetId: z.string().min(1),
    hash: sha256Schema,
    mimeType: mimeTypeSchema,
    byteLength: z.number().int().positive(),
    file: indexedDBFileSchema
  }).strict()).min(1)
}).strict().superRefine((manifest, context) => {
  if (manifest.outputs.length > manifest.parameters.count) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["outputs"],
      message: "实际输出数量不得超过原始请求数量"
    });
  }
  const receivedCount = manifest.outputs.length;
  const missingCount = manifest.parameters.count - receivedCount;
  const metadata = manifest.parameters.providerParameters;
  const hasPartialMetadata = [
    "requestedCount", "receivedCount", "missingCount", "partialGeneration"
  ].some((key) => key in metadata);
  if (missingCount > 0 || hasPartialMetadata) {
    const expected = {
      requestedCount: manifest.parameters.count,
      receivedCount,
      missingCount,
      partialGeneration: missingCount > 0
    };
    for (const [key, value] of Object.entries(expected)) {
      if (metadata[key] !== value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["parameters", "providerParameters", key],
          message: "生成数量元数据必须与实际输出一致"
        });
      }
    }
  }
});

export type GenerationManifest = z.infer<typeof generationManifestSchema>;
