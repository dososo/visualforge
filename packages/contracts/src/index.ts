export {
  NATIVE_HOST_NAME,
  NATIVE_PROTOCOL_VERSION,
  NATIVE_HOST_CAPABILITIES,
  MAX_GENERATION_REFERENCE_COUNT,
  codexExecutableSecuritySchema,
  codexDiscoveryResultSchema,
  hostDiagnosticsSchema,
  nativeHostHandshakeSchema,
  imagegenSkillProvenanceSchema,
  nativeAssetDescriptorSchema,
  nativeErrorSchema,
  nativeRequestSchema,
  nativeResponseSchema
} from "./native-messaging";
export type {
  CodexDiscoveryResult,
  CodexExecutableSecurity,
  HostDiagnostics,
  NativeHostHandshake,
  ImagegenSkillProvenance,
  NativeAssetDescriptor,
  NativeGenerationTimings,
  NativeRequest,
  NativeResponse
} from "./native-messaging";
export {
  GENERATION_EVENT_SCHEMA_VERSION,
  generationEventSchema
} from "./generation-event";
export type { GenerationEvent } from "./generation-event";
export {
  GENERATION_MANIFEST_SCHEMA_VERSION,
  generationModelSchema,
  generationParametersSchema,
  generationManifestSchema
} from "./generation-manifest";
export type { GenerationManifest } from "./generation-manifest";
export {
  DEFAULT_VISUAL_DNA_LOCKS,
  VISUAL_DNA_ANALYSIS_VERSION,
  VISUAL_DNA_SCHEMA_VERSION,
  migrateVisualDNA,
  visualDNAJsonSchema,
  visualDNALocksSchema,
  visualDNASchema
} from "./visual-dna";
export type { VisualDNA, VisualDNALocks } from "./visual-dna";
export {
  TRANSFORMATION_BLUEPRINT_SCHEMA_VERSION,
  transformationBlueprintJsonSchema,
  transformationBlueprintSchema
} from "./transformation-blueprint";
export type { TransformationBlueprint } from "./transformation-blueprint";
export {
  VISUAL_DNA_REVISION_SCHEMA_VERSION,
  visualDNAChangeDimensionSchema,
  visualDNARevisionChangeSchema,
  visualDNARevisionSchema
} from "./visual-dna-revision";
export type {
  VisualDNAChangeDimension,
  VisualDNARevision,
  VisualDNARevisionChange
} from "./visual-dna-revision";
export {
  PREFERENCE_EVENT_SCHEMA_VERSION,
  PREFERENCE_SUMMARY_DISMISSAL_SCHEMA_VERSION,
  preferenceEventSchema,
  preferenceSummaryDismissalSchema,
  preferenceValueSchema,
  userPreferenceSummarySchema
} from "./preference";
export type {
  PreferenceEvent,
  PreferenceEventSource,
  PreferenceSummaryDismissal,
  PreferenceValue,
  UserPreferenceSummary
} from "./preference";
import type { VisualDNA } from "./visual-dna";
export {
  TASK_RECORD_SCHEMA_VERSION,
  taskErrorSchema,
  taskRecordSchema,
  taskStatusSchema
} from "./task-lifecycle";
export {
  SUBJECT_ASSET_SCHEMA_VERSION,
  SUBJECT_QUALITY_SCHEMA_VERSION,
  generationReferenceRoleSchema,
  generationReferenceSnapshotSchema,
  qualityCheckResultSchema,
  productIdentityLockSchema,
  subjectAssetSchema,
  subjectAssetSnapshotSchema,
  subjectAssetTypeSchema,
  subjectQualityJsonSchema,
  subjectQualityReportSchema
} from "./subject-asset";
export type {
  GenerationReferenceRole,
  GenerationReferenceSnapshot,
  SubjectAsset,
  SubjectAssetSnapshot,
  SubjectAssetType,
  SubjectQualityReport,
  IdentityBoard,
  ProductIdentityLock
} from "./subject-asset";
export { identityBoardSchema } from "./subject-asset";
export {
  DOMAIN_PROFILE_SCHEMA_VERSION,
  domainClassificationJsonSchema,
  domainClassificationSchema,
  domainAnalysisResultJsonSchema,
  domainAnalysisResultSchema,
  domainProfileJsonSchema,
  domainProfileSchema,
  domainCandidateSchema,
  domainSchema
} from "./domain-profile";
export type {
  Domain,
  DomainCandidate,
  DomainClassification,
  DomainAnalysisResult,
  DomainProfile
} from "./domain-profile";
export {
  CREATION_SET_SCHEMA_VERSION,
  SET_QUALITY_SCHEMA_VERSION,
  creativeShotPlanSchema,
  creationSetItemStatusSchema,
  creationSetPlanItemSchema,
  creationSetOutputCandidateSchema,
  creationSetSchema,
  creationSetStatusSchema,
  gridCellAnalysisResultJsonSchema,
  gridCellAnalysisResultSchema,
  gridCellAnalysisSchema,
  gridLayoutSchema,
  normalizeSetQualityIssues,
  normalizeSetQualityIssueType,
  setQualityIssueSchema,
  setQualityReportJsonSchema,
  setQualityReportSchema,
  targetedRetryDirectiveSchema
} from "./creation-set";
export { visualVariationDimensionSchema } from "./creation-set";
export type {
  CreationSet,
  CreativeShotPlan,
  CreationSetItemStatus,
  CreationSetPlanItem,
  CreationSetStatus,
  CreationSetOutputCandidate,
  GridCellAnalysis,
  GridCellAnalysisResult,
  GridLayout,
  SetQualityIssue,
  SetQualityReport
} from "./creation-set";
export {
  PERFORMANCE_TRACE_SCHEMA_VERSION,
  performanceTraceSchema,
  performanceTraceStagesSchema
} from "./performance-trace";
export type { PerformanceTrace, PerformanceTraceStages } from "./performance-trace";
export {
  ANALYSIS_CACHE_SCHEMA_VERSION,
  analysisCacheEntrySchema,
  analysisCacheModeSchema
} from "./analysis-cache";
export type { AnalysisCacheEntry, AnalysisCacheMode } from "./analysis-cache";
export {
  SIGNATURE_STYLE_LIBRARY_VERSION,
  SIGNATURE_STYLE_SCHEMA_VERSION,
  signatureStyleCategorySchema,
  signatureStyleEvidenceKeySchema,
  signatureStyleLibrarySchema,
  signatureStyleSelectionSchema,
  signatureStyleSchema
} from "./signature-style";
export type {
  SignatureStyle,
  SignatureStyleCategory,
  SignatureStyleEvidenceKey,
  SignatureStyleSelection,
  SignatureStyleLibrary
} from "./signature-style";
export type {
  LegacyTaskRecord,
  LegacyTaskStatus,
  TaskError,
  TaskRecord,
  TaskStatus
} from "./task-lifecycle";
export type AssetRole = "style_layout" | "subject" | "identity" | "output";
export type AspectRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export type CaptureMethod = "direct" | "dom-canvas" | "visible-screenshot" | "area-selection";

export interface AssetSource {
  type: "upload" | "paste" | "web" | "capture" | "generated";
  sourceUrl?: string;
  pageUrl?: string;
  pageTitle?: string;
  capturedAt?: number;
  captureMethod?: CaptureMethod;
}

export interface AssetRecord {
  id: string;
  hash: string;
  role: AssetRole;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  byteLength: number;
  blob: Blob;
  thumbnailBlob: Blob;
  source: AssetSource;
  createdAt: number;
}

export interface ProjectRecord {
  id: string;
  title: string;
  mode: "direct" | "analyze" | "edit";
  referenceAssetIds: string[];
  selectedSubjectAssetId?: string | null;
  signatureStyleSelection?: import("./signature-style").SignatureStyleSelection | null;
  domainProfile?: import("./domain-profile").DomainProfile;
  referenceSnapshots?: import("./subject-asset").GenerationReferenceSnapshot[];
  outputAssetIds: string[];
  finalSelection?: {
    assetId: string;
    outputSha256: string;
    generationEventId: string;
    criticDisposition: "checked" | "skipped";
    criticReportId: string | null;
    criticCheckedAt: number | null;
    selectedAt: number;
  } | null;
  userInstruction: string;
  aspectRatio: AspectRatio;
  count: 1 | 2 | 4;
  visualDNA?: VisualDNA;
  compiledPrompt?: string;
  provider: "mock" | "codex";
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  defaultAspectRatio: AspectRatio;
  defaultCount: 1 | 2 | 4;
  saveSourceUrl: boolean;
  hoverCaptureEnabled: boolean;
  lastRoute: "create" | "library" | "settings";
}

export { nativeRequestSchema as nativeEnvelopeSchema } from "./native-messaging";
