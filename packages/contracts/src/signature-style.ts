import { z } from "zod";

export const SIGNATURE_STYLE_SCHEMA_VERSION = "2.0.0" as const;
export const SIGNATURE_STYLE_LIBRARY_VERSION = "4.0.0" as const;

export const signatureStyleEvidenceKeySchema = z.enum([
  "BAUHAUS_FORM_FUNCTION",
  "BAUHAUS_EXPERIMENT",
  "ALBERS_COLOR_RELATIVITY",
  "GESTALT_FIGURE_GROUND",
  "AIGA_GRID_HIERARCHY",
  "SONG_EMPTY_FULL",
  "CHINESE_MIND_LANDSCAPE",
  "CHINESE_REINVENTION",
  "ASC_VISUAL_STORY",
  "ASC_MOTIVATED_LIGHT",
  "COOPER_TEXTURE_TACTILITY",
  "COOPER_IMAGE_TEXTURE",
  "JAPANESE_ASYMMETRY",
  "MET_NEW_VISION",
  "MET_DRAPERY_GRAVITY",
  "MET_MOON_JAR_IMPERFECTION",
  "SMITHSONIAN_UNVEILING_RITUAL",
  "BFI_DEEP_FOCUS",
  "MOMA_EXPOSURE_TIME",
  "SMITHSONIAN_TWILIGHT_MATERIAL",
  "CHINESE_BORROWED_SCENERY",
  "MOMA_CAMERALESS_LIGHT",
  "VISION_OCCLUSION_DEPTH",
  "FILM_MONTAGE_CONTINUITY",
  "DESIGN_MUSEUM_WOVEN_COLOR",
  "MOMA_PHOTOMONTAGE_ASSEMBLY",
  "COOPER_POSTER_DEPTH",
  "COOPER_TEXTILE_CONTRAST",
  "MET_FASHION_LINE",
  "DESIGN_MUSEUM_MATERIAL_LITERACY",
  "NMAA_LACQUER_PANEL",
  "MOMA_STAGED_TABLEAU",
  "ASC_LIGHT_QUALITY"
]);

export const signatureStyleCategorySchema = z.enum([
  "人像与时装",
  "商品与品牌",
  "电影与叙事",
  "当代东方",
  "艺术与编辑",
  "生活方式与商业内容"
]);

const nonEmptyTexts = z.array(z.string().min(1)).min(1);

export const signatureStyleSchema = z.object({
  schemaVersion: z.literal(SIGNATURE_STYLE_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(2),
  englishName: z.string().min(3),
  category: signatureStyleCategorySchema,
  signatureTier: z.enum(["signature", "curated"]),
  summary: z.string().min(12),
  valueProposition: z.string().min(12),
  visualPhilosophy: z.string().min(12),
  unsuitableFor: nonEmptyTexts,
  suitableDomains: z.array(z.enum([
    "portrait", "product", "poster", "illustration", "photography"
  ])).min(1),
  signature: z.object({
    code: z.string().regex(/^SF-[A-Z]{2}-\d{2}$/),
    memoryAnchor: z.string().min(6),
    differentiation: z.string().min(12)
  }).strict(),
  method: z.object({
    visualEvent: z.string().min(8),
    composition: z.string().min(8),
    camera: z.string().min(4),
    lighting: z.string().min(6),
    color: z.string().min(6),
    material: z.string().min(6),
    texture: z.string().min(4),
    subject: z.string().min(6),
    emotion: z.string().min(4),
    narrative: z.string().min(8)
  }).strict(),
  production: z.object({
    shotScaleRule: z.string().min(8),
    cameraAndPerspective: z.string().min(8),
    lensLanguage: z.string().min(6),
    depthOfField: z.string().min(6),
    postProcessing: z.string().min(8)
  }).strict(),
  promptTemplates: z.object({
    portrait: z.string().min(20),
    product: z.string().min(20)
  }).strict(),
  fourShotSet: z.array(z.object({
    order: z.number().int().min(1).max(4),
    role: z.string().min(2),
    framing: z.string().min(2),
    direction: z.string().min(8)
  }).strict()).length(4).superRefine((shots, context) => {
    if (shots.some((shot, index) => shot.order !== index + 1)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "四镜头套图必须按 1—4 顺序排列"
      });
    }
  }),
  critic: z.object({
    dedicatedDimensions: z.array(z.string().min(2)).min(3),
    commonFailures: z.array(z.string().min(2)).min(2),
    retryStrategy: z.string().min(12)
  }).strict(),
  theory: z.object({
    evidenceKeys: z.array(signatureStyleEvidenceKeySchema).min(2),
    synthesis: z.string().min(20)
  }).strict(),
  recipe: z.object({
    dominantRule: z.string().min(8),
    counterRule: z.string().min(8),
    visualTension: z.string().min(8),
    sequenceLogic: z.string().min(8)
  }).strict(),
  acceptance: z.object({
    observableSignals: z.array(z.string().min(6)).min(4),
    failureSignals: z.array(z.string().min(2)).min(2)
  }).strict(),
  application: z.object({
    bestFor: nonEmptyTexts,
    preserve: nonEmptyTexts,
    recreate: nonEmptyTexts,
    avoid: nonEmptyTexts
  }).strict(),
  prompt: z.object({
    positive: nonEmptyTexts,
    negative: nonEmptyTexts
  }).strict(),
  provenance: z.object({
    origin: z.union([
      z.literal("VisualForge 原创方法"),
      z.literal("StyleForge 原创方法")
    ]).transform(() => "VisualForge 原创方法" as const),
    inspirationPolicy: z.literal("clean-room"),
    externalAssetDependency: z.literal(false)
  }).strict()
}).strict();

export const signatureStyleLibrarySchema = z.object({
  schemaVersion: z.literal(SIGNATURE_STYLE_SCHEMA_VERSION),
  title: z.union([
    z.literal("VisualForge Signature Style System v4"),
    z.literal("StyleForge Signature Style System v4"),
    z.literal("VisualForge Signature Style System v3"),
    z.literal("StyleForge Signature Style System v3")
  ]).transform(() => "VisualForge Signature Style System v4" as const),
  updatedAt: z.string().datetime({ offset: true }),
  styles: z.array(signatureStyleSchema).length(48)
}).strict().superRefine((library, context) => {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const counts = new Map<string, number>();
  let signatureCount = 0;

  library.styles.forEach((style, index) => {
    if (ids.has(style.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styles", index, "id"],
        message: `风格 id 重复：${style.id}`
      });
    }
    if (codes.has(style.signature.code)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styles", index, "signature", "code"],
        message: `Signature code 重复：${style.signature.code}`
      });
    }
    ids.add(style.id);
    codes.add(style.signature.code);
    counts.set(style.category, (counts.get(style.category) ?? 0) + 1);
    if (style.signatureTier === "signature") signatureCount += 1;
  });

  for (const category of signatureStyleCategorySchema.options) {
    if (counts.get(category) !== 8) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styles"],
        message: `${category} 必须恰好包含 8 个风格`
      });
    }
    const categorySignatureCount = library.styles.filter(
      (style) => style.category === category && style.signatureTier === "signature"
    ).length;
    if (categorySignatureCount < 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["styles"],
        message: `${category} 至少需要 3 个 Signature 方法`
      });
    }
  }
  if (signatureCount < 18) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["styles"],
      message: "原创 Signature 风格不得少于 18 个"
    });
  }
});

export const signatureStyleSelectionSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  styleId: z.string().min(1),
  styleName: z.string().min(2),
  signatureCode: z.string().regex(/^SF-[A-Z]{2}-\d{2}$/),
  libraryVersion: z.enum([
    SIGNATURE_STYLE_SCHEMA_VERSION,
    "3.0.0",
    SIGNATURE_STYLE_LIBRARY_VERSION
  ]),
  mode: z.enum(["style", "blend"]),
  recommendationReason: z.string().min(1),
  selectedAt: z.number().int().nonnegative(),
  styleSnapshot: signatureStyleSchema
}).strict().superRefine((selection, context) => {
  if (selection.styleId !== selection.styleSnapshot.id ||
      selection.styleName !== selection.styleSnapshot.name ||
      selection.signatureCode !== selection.styleSnapshot.signature.code) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "风格选择摘要必须与方法快照一致"
    });
  }
});

export type SignatureStyleCategory = z.infer<typeof signatureStyleCategorySchema>;
export type SignatureStyleEvidenceKey = z.infer<typeof signatureStyleEvidenceKeySchema>;
export type SignatureStyle = z.infer<typeof signatureStyleSchema>;
export type SignatureStyleLibrary = z.infer<typeof signatureStyleLibrarySchema>;
export type SignatureStyleSelection = z.infer<typeof signatureStyleSelectionSchema>;
