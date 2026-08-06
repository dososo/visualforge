import { z } from "zod";
import { visualDNASchema } from "./visual-dna.js";
import {
  generationReferenceRoleSchema,
  personImagePurposeSchema,
  subjectQualityReportSchema
} from "./subject-asset.js";
import { domainAnalysisResultSchema } from "./domain-profile.js";
import { domainSchema } from "./domain-profile.js";
import {
  creativeShotPlanSchema,
  gridCellAnalysisResultSchema,
  gridLayoutSchema,
  setQualityReportSchema
} from "./creation-set.js";

export const NATIVE_PROTOCOL_VERSION = 1 as const;
export const NATIVE_HOST_NAME = "com.blteam.styleforge";
export const MAX_GENERATION_REFERENCE_COUNT = 8;
export const NATIVE_HOST_CAPABILITIES = [
  "generation-v1",
  "generation-reference-evidence-v1",
  "generation-style-layout-v1",
  "grid-analysis-v1",
  "quality-check-v1",
  "self-uninstall-v1"
] as const;

const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const planItemIdSchema = z.string().regex(/^[a-zA-Z0-9:-]{1,200}$/);
const emptyPayloadSchema = z.object({}).strict();
const assetIdPayloadSchema = z.object({ assetId: idSchema }).strict();

export const codexExecutableSecuritySchema = z.object({
  resolvedPath: z.string().min(1),
  signatureStatus: z.enum(["verified", "unsigned", "invalid", "unavailable"]),
  teamId: z.string().min(1).nullable(),
  identifier: z.string().min(1).nullable(),
  trusted: z.boolean(),
  risk: z.string().min(1).nullable()
}).strict();

export const imagegenSkillProvenanceSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const codexDiscoveryResultSchema = z.discriminatedUnion("found", [
  z.object({
    found: z.literal(true),
    path: z.string().min(1),
    version: z.string().min(1),
    source: z.enum(["configured", "common", "path"]),
    security: codexExecutableSecuritySchema.optional(),
    error: z.null()
  }).strict(),
  z.object({
    found: z.literal(false),
    path: z.null(),
    version: z.null(),
    source: z.null(),
    error: z.string().min(1)
  }).strict()
]);

export const hostDiagnosticsSchema = z.object({
  state: z.enum(["connected", "codex-missing", "login-required", "error"]),
  label: z.string().min(1),
  codex: codexDiscoveryResultSchema,
  modelCount: z.number().int().nonnegative().optional(),
  imagegen: z.boolean().optional(),
  imagegenSkill: imagegenSkillProvenanceSchema.optional(),
  detail: z.string().optional()
}).strict();

export const nativeHostHandshakeSchema = z.object({
  protocolVersion: z.literal(NATIVE_PROTOCOL_VERSION),
  version: z.string().min(1),
  capabilities: z.array(z.string().min(1)).optional()
}).strict();

export const nativeAssetDescriptorSchema = z.object({
  assetId: idSchema,
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteLength: z.number().int().min(1).max(20 * 1024 * 1024),
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().min(1).max(100),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const nativeGenerationTimingsSchema = z.object({
  totalMs: z.number().nonnegative(),
  codexStartupMs: z.number().nonnegative(),
  skillDiscoveryMs: z.number().nonnegative(),
  generationTurnMs: z.number().nonnegative(),
  outputRegistrationMs: z.number().nonnegative(),
  outputReadMs: z.number().nonnegative()
}).strict();

const requestEnvelope = <T extends string, S extends z.ZodTypeAny>(type: T, payload: S) =>
  z.object({
    protocolVersion: z.literal(NATIVE_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(120),
    type: z.literal(type),
    payload
  }).strict();

export const nativeRequestSchema = z.discriminatedUnion("type", [
  requestEnvelope("host.ping", emptyPayloadSchema),
  requestEnvelope("host.diagnostics", emptyPayloadSchema),
  requestEnvelope("host.uninstall", emptyPayloadSchema),
  requestEnvelope("data.purge.temporary", emptyPayloadSchema),
  requestEnvelope("data.purge.all", emptyPayloadSchema),
  requestEnvelope("asset.write.start", z.object({
    assetId: idSchema,
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    byteLength: z.number().int().min(1).max(20 * 1024 * 1024),
    chunkCount: z.number().int().min(1).max(100),
    sha256: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict()),
  requestEnvelope("asset.write.chunk", z.object({
    assetId: idSchema,
    index: z.number().int().nonnegative().max(99),
    data: z.string().min(1).max(512 * 1024)
  }).strict()),
  requestEnvelope("asset.write.finish", assetIdPayloadSchema),
  requestEnvelope("task.cancel", z.object({ taskId: idSchema }).strict()),
  requestEnvelope("analysis.start", z.object({
    taskId: idSchema,
    assetId: idSchema
  }).strict()),
  requestEnvelope("domain.analysis.start", z.object({
    taskId: idSchema,
    assetId: idSchema
  }).strict()),
  requestEnvelope("grid.analysis.start", z.object({
    taskId: idSchema,
    assetId: idSchema,
    layout: gridLayoutSchema
  }).strict()),
  requestEnvelope("subject.quality.check", z.object({
    taskId: idSchema,
    assetIds: z.array(idSchema).min(1).max(5)
  }).strict()),
  requestEnvelope("creation-set.quality.check", z.object({
    taskId: idSchema,
    setId: idSchema,
    domain: domainSchema,
    references: z.array(z.object({
      assetId: idSchema,
      role: generationReferenceRoleSchema,
      imagePurpose: personImagePurposeSchema.optional()
    }).strict()).min(1).max(8),
    sharedInvariants: z.array(z.string().min(1).max(500)).max(30),
    signatureStyle: z.object({
      styleId: z.string().min(1).max(120),
      styleName: z.string().min(1).max(120),
      signatureCode: z.string().min(1).max(40),
      dedicatedDimensions: z.array(z.string().min(1).max(300)).min(3).max(12),
      observableSignals: z.array(z.string().min(1).max(500)).min(4).max(12),
      failureSignals: z.array(z.string().min(1).max(500)).min(2).max(12),
      retryStrategy: z.string().min(1).max(2000)
    }).strict().nullable().optional(),
    items: z.array(z.object({
      itemId: planItemIdSchema,
      assetId: idSchema,
      planTitle: z.string().min(1).max(200),
      creativePlan: creativeShotPlanSchema
    }).strict()).min(1).max(12)
  }).strict()),
  requestEnvelope("generation.start", z.object({
    taskId: idSchema,
    references: z.array(z.object({
      assetId: idSchema,
      role: generationReferenceRoleSchema,
      imagePurpose: personImagePurposeSchema.optional(),
      sourceKind: z.enum(["original", "identity_board"]).optional()
    }).strict()).min(1).max(MAX_GENERATION_REFERENCE_COUNT),
    prompt: z.string().min(1).max(50_000),
    count: z.number().int().min(1).max(2)
  }).strict()),
  requestEnvelope("asset.read.start", assetIdPayloadSchema),
  requestEnvelope("asset.read.chunk", z.object({
    assetId: idSchema,
    index: z.number().int().nonnegative().max(99)
  }).strict())
]);

const nativeSuccessDataSchema = z.union([
  nativeHostHandshakeSchema,
  hostDiagnosticsSchema,
  z.object({ accepted: z.literal(true) }).strict(),
  z.object({ stored: z.literal(true) }).strict(),
  z.object({
    removedFiles: z.number().int().nonnegative(),
    dataPreserved: z.literal(true)
  }).strict(),
  z.object({
    scope: z.enum(["temporary", "all"]),
    removedFiles: z.number().int().nonnegative(),
    removedDirectories: z.number().int().nonnegative()
  }).strict(),
  z.object({
    cancelled: z.boolean(),
    message: z.string().optional()
  }).strict(),
  visualDNASchema,
  domainAnalysisResultSchema,
  gridCellAnalysisResultSchema,
  subjectQualityReportSchema,
  setQualityReportSchema,
  z.object({
    outputs: z.array(nativeAssetDescriptorSchema).min(1).max(2),
    timings: nativeGenerationTimingsSchema.optional(),
    imagegenSkill: imagegenSkillProvenanceSchema.optional()
  }).strict(),
  nativeAssetDescriptorSchema,
  z.object({
    assetId: idSchema,
    index: z.number().int().nonnegative().max(99),
    data: z.string().min(1).max(512 * 1024)
  }).strict()
]);

export const nativeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
  detail: z.string().optional()
}).strict();

export const nativeResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    protocolVersion: z.literal(NATIVE_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(120),
    ok: z.literal(true),
    data: nativeSuccessDataSchema
  }).strict(),
  z.object({
    protocolVersion: z.literal(NATIVE_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(120),
    ok: z.literal(false),
    error: nativeErrorSchema
  }).strict()
]);

export type CodexDiscoveryResult = z.infer<typeof codexDiscoveryResultSchema>;
export type CodexExecutableSecurity = z.infer<typeof codexExecutableSecuritySchema>;
export type ImagegenSkillProvenance = z.infer<typeof imagegenSkillProvenanceSchema>;
export type HostDiagnostics = z.infer<typeof hostDiagnosticsSchema>;
export type NativeHostHandshake = z.infer<typeof nativeHostHandshakeSchema>;
export type NativeAssetDescriptor = z.infer<typeof nativeAssetDescriptorSchema>;
export type NativeGenerationTimings = z.infer<typeof nativeGenerationTimingsSchema>;
export type NativeRequest = z.infer<typeof nativeRequestSchema>;
export type NativeResponse = z.infer<typeof nativeResponseSchema>;
