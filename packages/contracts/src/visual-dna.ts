import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const VISUAL_DNA_SCHEMA_VERSION = "1.1.0" as const;
export const VISUAL_DNA_ANALYSIS_VERSION = "visual-dna-v1" as const;

const shortListSchema = z.array(z.string().min(1)).max(12);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "必须是 SHA-256 哈希");
const lockStateSchema = z.enum(["locked", "unlocked"]);

export const DEFAULT_VISUAL_DNA_LOCKS = {
  identity: "unlocked",
  subject: "unlocked",
  composition: "unlocked",
  camera: "unlocked",
  lighting: "unlocked",
  palette: "unlocked",
  material: "unlocked",
  texture: "unlocked",
  style: "unlocked"
} as const;

export const visualDNALocksSchema = z.object({
  identity: lockStateSchema,
  subject: lockStateSchema,
  composition: lockStateSchema,
  camera: lockStateSchema,
  lighting: lockStateSchema,
  palette: lockStateSchema,
  material: lockStateSchema,
  texture: lockStateSchema,
  style: lockStateSchema
}).strict();

export const visualDNASchema = z.object({
  schemaVersion: z.literal(VISUAL_DNA_SCHEMA_VERSION),
  revision: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  sourceImageHash: sha256Schema.nullable(),
  analysisModel: z.string().min(1),
  analysisVersion: z.string().min(1),
  domain: z.enum(["portrait", "product", "poster", "illustration", "photography", "other"]),
  summary: z.string().min(1),
  identity: z.object({
    description: z.string(),
    distinctiveFeatures: shortListSchema,
    preserve: shortListSchema
  }).strict(),
  subject: z.object({
    description: z.string(),
    count: z.number().int().min(0),
    action: z.string().nullable(),
    environment: z.string().nullable()
  }).strict(),
  composition: z.object({
    shotType: z.string(),
    subjectPlacement: z.string(),
    negativeSpace: z.string(),
    depth: z.string(),
    aspectRatioHint: z.string().nullable()
  }).strict(),
  camera: z.object({
    angle: z.string(),
    lens: z.string(),
    focalLength: z.string(),
    distance: z.string(),
    depthOfField: z.string(),
    perspective: z.string()
  }).strict(),
  lighting: z.object({
    source: z.string(),
    direction: z.string(),
    quality: z.string(),
    contrast: z.string(),
    highlightBehavior: z.string(),
    shadowBehavior: z.string()
  }).strict(),
  palette: z.object({
    dominantColors: z.array(z.string().min(1)).min(1).max(8),
    accentColors: z.array(z.string().min(1)).max(6),
    saturation: z.string(),
    temperature: z.string(),
    contrast: z.string()
  }).strict(),
  material: z.object({
    types: shortListSchema,
    finish: z.string(),
    reflectivity: z.string(),
    translucency: z.string()
  }).strict(),
  texture: z.object({
    medium: z.string(),
    grain: z.string(),
    sharpness: z.string(),
    surfaceDetail: z.string()
  }).strict(),
  mood: z.object({
    keywords: shortListSchema,
    emotionalTone: z.string(),
    atmosphere: z.string()
  }).strict(),
  style: z.object({
    keywords: shortListSchema,
    medium: z.string()
  }).strict(),
  locks: visualDNALocksSchema,
  references: z.array(z.object({
    assetId: z.string().min(1).nullable(),
    sourceImageHash: sha256Schema,
    role: z.enum(["style_layout", "style", "subject", "identity", "composition", "palette", "material"]),
    influence: z.number().min(0).max(1),
    notes: z.string().nullable()
  }).strict()).max(8),
  constraints: z.object({
    preserve: shortListSchema,
    avoid: shortListSchema
  }).strict(),
  invariants: shortListSchema,
  variables: shortListSchema,
  generationBrief: z.string().min(1),
  confidence: z.number().min(0).max(1)
}).strict();

export type VisualDNA = z.infer<typeof visualDNASchema>;
export type VisualDNALocks = z.infer<typeof visualDNALocksSchema>;
export const visualDNAJsonSchema = zodToJsonSchema(visualDNASchema, {
  target: "jsonSchema7",
  $refStrategy: "none"
});

const legacyVisualDNASchema = z.object({
  schemaVersion: z.literal("1.0"),
  domain: z.enum(["portrait", "product", "poster", "illustration", "photography", "other"]),
  summary: z.string().min(1),
  subject: z.object({
    description: z.string(),
    count: z.number().int().min(0),
    action: z.string().optional(),
    environment: z.string().optional()
  }).strict(),
  composition: z.object({
    shotType: z.string(),
    cameraAngle: z.string(),
    subjectPlacement: z.string(),
    negativeSpace: z.string(),
    depth: z.string(),
    aspectRatioHint: z.string().optional()
  }).strict(),
  lighting: z.object({
    source: z.string(),
    direction: z.string(),
    quality: z.string(),
    contrast: z.string(),
    highlightBehavior: z.string(),
    shadowBehavior: z.string()
  }).strict(),
  color: z.object({
    dominantColors: z.array(z.string().min(1)).min(1).max(6),
    saturation: z.string(),
    temperature: z.string(),
    contrast: z.string()
  }).strict(),
  texture: z.object({
    medium: z.string(),
    material: z.string(),
    grain: z.string(),
    sharpness: z.string(),
    surfaceDetail: z.string()
  }).strict(),
  style: z.object({
    keywords: shortListSchema,
    invariants: shortListSchema,
    variables: shortListSchema
  }).strict(),
  constraints: z.object({
    preserve: shortListSchema,
    avoid: shortListSchema
  }).strict(),
  generationBrief: z.string().min(1),
  confidence: z.number().min(0).max(1)
}).strict();

export interface VisualDNAMigrationContext {
  createdAt?: number;
  updatedAt?: number;
  sourceImageHash?: string | null;
  analysisModel?: string;
}

export function migrateVisualDNA(input: unknown, context: VisualDNAMigrationContext = {}): VisualDNA {
  const current = visualDNASchema.safeParse(input);
  if (current.success) return current.data;

  const previousCurrent = visualDNASchema.omit({ locks: true }).extend({
    schemaVersion: z.literal("1.0.0")
  }).safeParse(input);
  if (previousCurrent.success) {
    return visualDNASchema.parse({
      ...previousCurrent.data,
      schemaVersion: VISUAL_DNA_SCHEMA_VERSION,
      locks: DEFAULT_VISUAL_DNA_LOCKS
    });
  }

  const legacy = legacyVisualDNASchema.parse(input);
  const createdAt = context.createdAt ?? Date.now();
  const sourceImageHash = context.sourceImageHash ?? null;
  return visualDNASchema.parse({
    schemaVersion: VISUAL_DNA_SCHEMA_VERSION,
    revision: 1,
    createdAt,
    updatedAt: context.updatedAt ?? createdAt,
    sourceImageHash,
    analysisModel: context.analysisModel ?? "legacy-unknown",
    analysisVersion: "legacy-1.0",
    domain: legacy.domain,
    summary: legacy.summary,
    identity: {
      description: legacy.domain === "portrait" ? legacy.subject.description : "无特定人物身份",
      distinctiveFeatures: [],
      preserve: []
    },
    subject: {
      ...legacy.subject,
      action: legacy.subject.action ?? null,
      environment: legacy.subject.environment ?? null
    },
    composition: {
      shotType: legacy.composition.shotType,
      subjectPlacement: legacy.composition.subjectPlacement,
      negativeSpace: legacy.composition.negativeSpace,
      depth: legacy.composition.depth,
      aspectRatioHint: legacy.composition.aspectRatioHint ?? null
    },
    camera: {
      angle: legacy.composition.cameraAngle,
      lens: "未记录",
      focalLength: "未记录",
      distance: "未记录",
      depthOfField: legacy.composition.depth,
      perspective: "未记录"
    },
    lighting: legacy.lighting,
    palette: {
      ...legacy.color,
      accentColors: []
    },
    material: {
      types: legacy.texture.material ? [legacy.texture.material] : [],
      finish: "未记录",
      reflectivity: "未记录",
      translucency: "未记录"
    },
    texture: {
      medium: legacy.texture.medium,
      grain: legacy.texture.grain,
      sharpness: legacy.texture.sharpness,
      surfaceDetail: legacy.texture.surfaceDetail
    },
    mood: {
      keywords: legacy.style.keywords,
      emotionalTone: legacy.style.keywords.join("、") || "未记录",
      atmosphere: "未记录"
    },
    style: {
      keywords: legacy.style.keywords,
      medium: legacy.texture.medium
    },
    locks: DEFAULT_VISUAL_DNA_LOCKS,
    references: sourceImageHash ? [{
      assetId: null,
      sourceImageHash,
      role: "style_layout",
      influence: 1,
      notes: null
    }] : [],
    constraints: legacy.constraints,
    invariants: legacy.style.invariants,
    variables: legacy.style.variables,
    generationBrief: legacy.generationBrief,
    confidence: legacy.confidence
  });
}
