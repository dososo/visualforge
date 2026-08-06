import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { domainProfileSchema, type Domain } from "./domain-profile.js";
import {
  generationReferenceSnapshotSchema,
  subjectAssetSnapshotSchema
} from "./subject-asset.js";
import { visualDNASchema } from "./visual-dna.js";
import { transformationBlueprintSchema } from "./transformation-blueprint.js";
import { signatureStyleSelectionSchema } from "./signature-style.js";

export const CREATION_SET_SCHEMA_VERSION = "1.0.0" as const;
export const SET_QUALITY_SCHEMA_VERSION = "1.0.0" as const;

export const creationSetItemStatusSchema = z.enum([
  "PENDING", "GENERATING", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"
]);
export const creationSetStatusSchema = z.enum([
  "PLANNING", "READY", "GENERATING", "COMPLETED", "PARTIAL",
  "FAILED", "CANCELLED", "INTERRUPTED"
]);
export const gridLayoutSchema = z.object({
  count: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(9), z.literal(12)]),
  columns: z.number().int().min(1).max(4),
  rows: z.number().int().min(1).max(4),
  columnStops: z.array(z.number().gt(0).lt(1)).max(3),
  rowStops: z.array(z.number().gt(0).lt(1)).max(3),
  confidence: z.number().min(0).max(1),
  source: z.enum(["divider", "aspect-ratio", "manual"])
}).strict().superRefine((layout, context) => {
  if (layout.columns * layout.rows !== layout.count) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "宫格行列乘积必须等于画面数量" });
  }
  for (const [key, stops, expected] of [
    ["columnStops", layout.columnStops, layout.columns - 1],
    ["rowStops", layout.rowStops, layout.rows - 1]
  ] as const) {
    if (stops.length !== expected) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "分隔线数量必须匹配宫格行列" });
    }
    if (stops.some((stop, index) => index > 0 && stop - stops[index - 1]! < 0.08)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "分隔线必须递增且保留最小画面宽度" });
    }
  }
});
export const gridCellAnalysisSchema = z.object({
  index: z.number().int().min(0).max(11),
  composition: z.string().min(1),
  shotScale: z.string().min(1),
  action: z.string().min(1),
  emotion: z.string().min(1),
  source: z.enum(["baseline", "codex"]).default("baseline")
}).strict();
export const gridCellAnalysisResultSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  analysisVersion: z.literal("grid-semantics-v1"),
  model: z.string().min(1),
  sourceImageHash: z.string().regex(/^[a-f0-9]{64}$/i),
  cells: z.array(gridCellAnalysisSchema).min(1).max(12)
}).strict();
const lockedDimensionSchema = z.enum([
  "identity", "subject", "composition", "camera", "lighting",
  "palette", "material", "texture", "style"
]);
export const visualVariationDimensionSchema = z.enum([
  "shot_scale", "camera_angle", "composition", "pose_action", "environment",
  "lighting", "orientation", "negative_space", "visual_emphasis"
]);

const legacyCreativeShotPlan = {
  concept: "围绕参考图方法建立当前系列的核心视觉概念",
  narrativeContext: "当前镜头属于同一视觉世界并承担独立叙事作用",
  storyPurpose: "承担当前系列中的独立视觉目的",
  subjectState: "保持主体可信且符合当前画面",
  cameraLanguage: "沿用参考图摄影语言",
  cameraHeight: "与主体视线关系一致的自然相机高度",
  horizontalAngle: "根据当前镜头职责选择明确观看方向",
  pitchAngle: "保持自然透视并按当前职责轻微俯仰",
  shotScale: "沿用当前计划景别",
  lens: "沿用当前计划镜头",
  perspective: "保持主体比例可信的自然透视",
  composition: "沿用当前计划构图",
  pose: "沿用当前计划姿态或陈列状态",
  actionPhase: "动作停留在正在发生的中间帧",
  gaze: "视线服从当前叙事关系",
  gesture: "沿用当前计划互动方式",
  emotion: "沿用参考图情绪方向",
  timeSense: "时间线索与同组视觉世界一致",
  weatherSense: "天气或空气感与同组视觉世界一致",
  lightDirection: "沿用当前计划主光方向",
  lightQuality: "沿用参考图光质",
  shadowStrategy: "阴影保持真实接触关系与空间层次",
  colorSystem: "沿用参考图色彩关系而非复制具体物件颜色",
  lighting: "沿用当前计划光线",
  environment: "重建当前计划环境",
  atmosphere: "沿用参考图氛围",
  material: "保持参考图材质表现方法",
  postProcessing: "统一参考图的颗粒、锐度、反差与色彩收口",
  shotResponsibility: "让当前镜头在整套中承担不可替代的视觉职责"
};

export const creativeShotPlanSchema = z.object({
  concept: z.string().min(1).default(legacyCreativeShotPlan.concept),
  narrativeContext: z.string().min(1).default(legacyCreativeShotPlan.narrativeContext),
  storyPurpose: z.string().min(1),
  subjectState: z.string().min(1),
  cameraLanguage: z.string().min(1),
  cameraHeight: z.string().min(1).default(legacyCreativeShotPlan.cameraHeight),
  horizontalAngle: z.string().min(1).default(legacyCreativeShotPlan.horizontalAngle),
  pitchAngle: z.string().min(1).default(legacyCreativeShotPlan.pitchAngle),
  shotScale: z.string().min(1).default(legacyCreativeShotPlan.shotScale),
  lens: z.string().min(1),
  perspective: z.string().min(1).default(legacyCreativeShotPlan.perspective),
  composition: z.string().min(1),
  pose: z.string().min(1),
  actionPhase: z.string().min(1).default(legacyCreativeShotPlan.actionPhase),
  gaze: z.string().min(1).default(legacyCreativeShotPlan.gaze),
  gesture: z.string().min(1),
  emotion: z.string().min(1),
  timeSense: z.string().min(1).default(legacyCreativeShotPlan.timeSense),
  weatherSense: z.string().min(1).default(legacyCreativeShotPlan.weatherSense),
  lightDirection: z.string().min(1).default(legacyCreativeShotPlan.lightDirection),
  lightQuality: z.string().min(1).default(legacyCreativeShotPlan.lightQuality),
  shadowStrategy: z.string().min(1).default(legacyCreativeShotPlan.shadowStrategy),
  colorSystem: z.string().min(1).default(legacyCreativeShotPlan.colorSystem),
  lighting: z.string().min(1),
  environment: z.string().min(1),
  atmosphere: z.string().min(1),
  material: z.string().min(1),
  postProcessing: z.string().min(1).default(legacyCreativeShotPlan.postProcessing),
  shotResponsibility: z.string().min(1).default(legacyCreativeShotPlan.shotResponsibility)
}).strict();

export const setQualityDimensionSchema = z.enum([
  "face_identity",
  "body_proportion",
  "pose_plausibility",
  "expression_naturalness",
  "occlusion_chain",
  "reference_pose_fidelity",
  "reference_expression_fidelity",
  "wardrobe_continuity",
  "reference_composition_fidelity",
  "reference_lighting_fidelity",
  "set_continuity",
  "emotion_arc",
  "story_progression",
  "pose_diversity",
  "camera_diversity",
  "gaze_repetition",
  "gesture_repetition",
  "environment_relationship",
  "memorable_frame_missing",
  "advertising_intent",
  "product_hierarchy",
  "brand_coherence",
  "label_fidelity",
  "text_layout_fidelity",
  "logo_position_fidelity",
  "material_realism",
  "usage_causality",
  "prop_relevance",
  "shot_diversity"
]);

export const setQualityIssueSchema = z.object({
  type: z.enum([
    "identity_drift", "subject_drift", "style_inconsistency",
    "near_duplicate", "structural_error", "plan_mismatch",
    "body_proportion_drift", "pose_anomaly", "expression_anomaly",
    "reference_pose_mismatch", "reference_expression_mismatch",
    "wardrobe_continuity_drift", "reference_composition_mismatch",
    "reference_lighting_mismatch", "set_continuity_mismatch",
    "emotion_flat", "pose_repeat", "composition_repeat", "style_mismatch",
    "geometry_drift", "structure_mismatch", "material_inconsistency",
    "label_drift", "text_layout_drift", "logo_position_drift",
    "duplicate_angle", "advertising_weakness"
  ]),
  dimension: setQualityDimensionSchema.nullable().optional(),
  severity: z.enum(["notice", "warning"]),
  itemIds: z.array(z.string().min(1)).min(1),
  message: z.string().min(1),
  impact: z.string().min(1).nullable().optional(),
  retryFocus: z.string().min(1).nullable().optional(),
  preserve: z.array(z.string().min(1)).optional(),
  suggestion: z.string().min(1).nullable()
}).strict();

export const setQualityReportSchema = z.object({
  schemaVersion: z.literal(SET_QUALITY_SCHEMA_VERSION),
  checkedAt: z.number().int().nonnegative(),
  model: z.string().min(1),
  summary: z.string().min(1),
  checkedItemIds: z.array(z.string().min(1)).min(1).max(12),
  issues: z.array(setQualityIssueSchema),
  suggestedRetryItemIds: z.array(z.string().min(1))
}).strict();

export const targetedRetryDirectiveSchema = z.object({
  reportCheckedAt: z.number().int().nonnegative(),
  issueType: setQualityIssueSchema.shape.type,
  dimension: setQualityDimensionSchema.nullable().default(null),
  reason: z.string().min(1),
  impact: z.string().min(1).nullable().default(null),
  retryFocus: z.string().min(1).nullable().default(null),
  preserve: z.array(z.string().min(1)).default([]),
  sourceOutputAssetId: z.string().min(1),
  sourceGenerationEventId: z.string().min(1)
}).strict();

export const creationSetOutputCandidateSchema = z.object({
  outputAssetId: z.string().min(1),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  byteLength: z.number().int().positive().nullable().optional(),
  generationEventId: z.string().min(1),
  taskId: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  source: z.enum(["initial", "targeted_retry"]),
  issueType: setQualityIssueSchema.shape.type.nullable()
}).strict();

export const creationSetFinalSelectionSchema = z.object({
  assetId: z.string().min(1),
  outputSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  byteLength: z.number().int().positive(),
  generationEventId: z.string().min(1),
  criticDisposition: z.enum(["checked", "skipped"]),
  criticReportId: z.string().min(1).nullable(),
  criticCheckedAt: z.number().int().nonnegative().nullable(),
  selectedAt: z.number().int().nonnegative()
}).strict().superRefine((selection, context) => {
  if (selection.criticDisposition === "checked" &&
      (!selection.criticReportId || selection.criticCheckedAt === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["criticReportId"],
      message: "已检查的最终选择必须绑定 Critic 报告编号和检查时间"
    });
  }
});

export const creationSetPlanItemSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(1).max(12),
  role: z.string().min(1),
  userFacingTitle: z.string().min(1),
  shotType: z.string().min(1),
  composition: z.string().min(1),
  camera: z.string().min(1),
  poseOrAction: z.string().min(1),
  expression: z.string().min(1),
  scene: z.string().min(1),
  lightingVariation: z.string().min(1),
  creativePlan: creativeShotPlanSchema.default(legacyCreativeShotPlan),
  gridCellReference: generationReferenceSnapshotSchema.nullable().default(null),
  gridCellAnalysis: gridCellAnalysisSchema.nullable().default(null),
  promptDelta: z.string().min(1),
  variationDimensions: z.array(visualVariationDimensionSchema).max(2),
  finalPrompt: z.string().min(1).nullable(),
  lockedDimensions: z.array(lockedDimensionSchema),
  status: creationSetItemStatusSchema,
  taskId: z.string().min(1).nullable(),
  retryOfTaskId: z.string().min(1).nullable().default(null),
  generationEventId: z.string().min(1).nullable(),
  outputAssetId: z.string().min(1).nullable(),
  outputCandidates: z.array(creationSetOutputCandidateSchema).default([]),
  selectedOutputAssetId: z.string().min(1).nullable().default(null),
  finalSelection: creationSetFinalSelectionSchema.nullable().optional(),
  qualityStatus: z.enum([
    "not_checked", "checking", "passed", "needs_repair", "unavailable"
  ]).optional(),
  qualityMessage: z.string().min(1).nullable().optional(),
  qualityReport: setQualityReportSchema.nullable().optional(),
  retryDirective: targetedRetryDirectiveSchema.nullable().default(null),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean()
  }).strict().nullable()
}).strict().superRefine((item, context) => {
  if (item.selectedOutputAssetId &&
      !item.outputCandidates.some((candidate) => candidate.outputAssetId === item.selectedOutputAssetId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedOutputAssetId"],
      message: "最终选择必须属于当前镜头的候选作品"
    });
  }
  if (item.finalSelection && item.finalSelection.assetId !== item.selectedOutputAssetId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["finalSelection", "assetId"],
      message: "最终选择记录必须对应当前选中的候选作品"
    });
  }
  if (item.gridCellReference && item.gridCellReference.role !== "composition") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["gridCellReference", "role"],
      message: "宫格单格引用必须使用 composition 角色"
    });
  }
});

export const creationSetSchema = z.object({
  schemaVersion: z.literal(CREATION_SET_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1).max(120),
  domainProfile: domainProfileSchema,
  requestedCount: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(9), z.literal(12)]),
  deliveryMode: z.enum(["independent", "grid", "both"]).optional(),
  sourceGridLayout: gridLayoutSchema.nullable().optional(),
  compositeLayout: gridLayoutSchema.nullable().optional(),
  // 兼容 0.5.x 已保存作品；新流程分别读写 sourceGridLayout 与 compositeLayout。
  gridLayout: gridLayoutSchema.nullable().optional(),
  gridSemanticStatus: z.enum(["baseline", "refining", "enhanced", "unavailable"]).optional(),
  gridSemanticMessage: z.string().min(1).nullable().optional(),
  userIntent: z.string(),
  sharedVisualDNARevision: z.number().int().min(1),
  sharedVisualDNASnapshot: visualDNASchema,
  sharedReferenceSnapshots: z.array(generationReferenceSnapshotSchema),
  subjectAssetSnapshots: z.array(subjectAssetSnapshotSchema),
  sourceGenerationEventId: z.string().min(1).nullable(),
  transformationBlueprintSnapshot: transformationBlueprintSchema.nullable().default(null),
  signatureStyleSelection: signatureStyleSelectionSchema.nullable().default(null),
  sharedInvariants: z.array(z.string().min(1)).default([]),
  allowedVariations: z.array(z.string().min(1)).default([]),
  status: creationSetStatusSchema,
  completedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  qualityReport: setQualityReportSchema.nullable(),
  planItems: z.array(creationSetPlanItemSchema).min(1).max(12)
}).strict().superRefine((set, context) => {
  if (set.planItems.length !== set.requestedCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom, path: ["planItems"],
      message: "计划项数量必须与请求数量一致"
    });
  }
  if (new Set(set.planItems.map((item) => item.role)).size !== set.planItems.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom, path: ["planItems"],
      message: "计划 role 不得重复"
    });
  }
  set.planItems.forEach((item, index) => {
    const selection = item.finalSelection;
    if (!selection || selection.criticDisposition !== "checked") return;
    const report = [item.qualityReport, set.qualityReport].find((candidate) =>
      candidate?.checkedAt === selection.criticCheckedAt
      && candidate.checkedItemIds.includes(item.id));
    const expectedReportId = `${set.id}:${selection.criticCheckedAt}`;
    if (!report || selection.assetId !== item.outputAssetId ||
      selection.criticReportId !== expectedReportId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planItems", index, "finalSelection", "criticDisposition"],
        message: "checked 最终选择必须对应当前输出及其真实 Critic 报告"
      });
    }
  });
});

export const setQualityReportJsonSchema = zodToJsonSchema(setQualityReportSchema, {
  target: "jsonSchema7", $refStrategy: "none"
});
export const gridCellAnalysisResultJsonSchema = zodToJsonSchema(gridCellAnalysisResultSchema, {
  target: "jsonSchema7", $refStrategy: "none"
});
const setQualityIssueJsonSchema = (
  setQualityReportJsonSchema as {
    properties?: {
      issues?: {
        items?: {
          properties?: Record<string, unknown>;
          required?: string[];
        };
      };
    };
  }
).properties?.issues?.items;
if (setQualityIssueJsonSchema?.properties) {
  setQualityIssueJsonSchema.required = Object.keys(setQualityIssueJsonSchema.properties);
}

export type CreationSet = z.infer<typeof creationSetSchema>;
export type CreativeShotPlan = z.infer<typeof creativeShotPlanSchema>;
export type CreationSetPlanItem = z.infer<typeof creationSetPlanItemSchema>;
export type CreationSetStatus = z.infer<typeof creationSetStatusSchema>;
export type CreationSetItemStatus = z.infer<typeof creationSetItemStatusSchema>;
export type SetQualityIssue = z.infer<typeof setQualityIssueSchema>;
export type CreationSetOutputCandidate = z.infer<typeof creationSetOutputCandidateSchema>;
export type GridCellAnalysis = z.infer<typeof gridCellAnalysisSchema>;
export type GridCellAnalysisResult = z.infer<typeof gridCellAnalysisResultSchema>;
export type GridLayout = z.infer<typeof gridLayoutSchema>;

const portraitQualityIssueTypes = new Set<SetQualityIssue["type"]>([
  "identity_drift",
  "body_proportion_drift",
  "structural_error",
  "pose_anomaly",
  "expression_anomaly",
  "emotion_flat",
  "pose_repeat",
  "composition_repeat",
  "style_mismatch"
]);

const productQualityIssueTypes = new Set<SetQualityIssue["type"]>([
  "geometry_drift",
  "structure_mismatch",
  "material_inconsistency",
  "label_drift",
  "text_layout_drift",
  "logo_position_drift",
  "duplicate_angle",
  "advertising_weakness"
]);

export function normalizeSetQualityIssueType(
  domain: Domain,
  issue: Pick<SetQualityIssue, "type" | "message" | "suggestion">
): SetQualityIssue["type"] {
  if (domain === "portrait") {
    if (issue.type !== "style_mismatch" && portraitQualityIssueTypes.has(issue.type)) return issue.type;
    const structuralText = `${issue.message} ${issue.suggestion ?? ""}`;
    const text = issue.message;
    if (/身材|体型|头身比|头身关系|头大身小|大头小身|躯干|肩宽|肩胯|腰胯|腿身比|腿部比例|腿部长度|腿长|短腿|四肢粗细|高矮胖瘦|比例失调/.test(text)) {
      return "body_proportion_drift";
    }
    if (/缺失|缺肢|断肢|多余肢体|多手|多脚|融合|关节|手指|脚趾|腿|手臂|人体结构|身体结构|遮挡关系|穿模/.test(structuralText)) {
      return "structural_error";
    }
    if (/跨过.*腋下|腋下.*穿|跨越.*身体中线|反关节|道具.*悬空|错手|重复握持|动作.*不可能|姿态.*不自然|接触关系.*不成立/.test(text)) {
      return "pose_anomaly";
    }
    if (/夸张表情|怪表情|挤眼|嘴部异常|张嘴异常|表情.*僵硬|双眼.*异常/.test(text)) return "expression_anomaly";
    if (/情绪|表情|眼神/.test(text)) return "emotion_flat";
    if (/姿态|动作|手势/.test(text)) return "pose_repeat";
    if (/构图|景别|机位|环境|空间|留白/.test(text)) return "composition_repeat";
    if (/身份|脸型|五官|年龄|发型/.test(text)) return "identity_drift";
    return "style_mismatch";
  }
  if (domain === "product") {
    if (productQualityIssueTypes.has(issue.type)) return issue.type;
    const text = issue.message;
    if (/logo|标志|品牌标识/i.test(text) && /位置|偏移|漂移|错位|比例/.test(text)) return "logo_position_drift";
    if (/标签|标贴|贴标|标签区域/.test(text) && /位置|区域|偏移|漂移|错位|比例|安全区/.test(text)) return "label_drift";
    if (/文字|字体|字距|行距|版式|信息层级|阅读顺序/.test(text) && /漂移|错乱|错误|改变|不一致|层级/.test(text)) return "text_layout_drift";
    if (/结构|按钮|接口|组件|开合/.test(text)) return "structure_mismatch";
    if (/(材质|透明|反射|颜色|表面).*(不一致|漂移|错误|失真)|(不一致|漂移|错误|失真).*(材质|透明|反射|颜色|表面)/.test(text)) {
      return "material_inconsistency";
    }
    if (/角度|机位|景别|构图|观看方向|重复|近正面|俯视|正面/.test(text)) return "duplicate_angle";
    if (/(产品|商品|瓶体).*(外形|比例|轮廓|几何).*(不一致|漂移|错误|失真)|(不一致|漂移|错误|失真).*(产品|商品|瓶体).*(外形|比例|轮廓|几何)/.test(text)) {
      return "geometry_drift";
    }
    return "advertising_weakness";
  }
  return issue.type;
}

export function normalizeSetQualityIssues(
  domain: Domain,
  issues: SetQualityIssue[]
): SetQualityIssue[] {
  const normalized = new Map<string, SetQualityIssue>();
  const severityRank = { notice: 0, warning: 1 } as const;
  for (const issue of issues) {
    const next = { ...issue, type: normalizeSetQualityIssueType(domain, issue) };
    const key = `${next.type}:${[...next.itemIds].sort().join(",")}`;
    const existing = normalized.get(key);
    if (!existing) {
      normalized.set(key, next);
      continue;
    }
    normalized.set(key, {
      ...existing,
      severity: severityRank[next.severity] > severityRank[existing.severity]
        ? next.severity
        : existing.severity,
      message: existing.message === next.message
        ? existing.message
        : `${existing.message}；${next.message}`,
      suggestion: existing.suggestion === next.suggestion
        ? existing.suggestion
        : [existing.suggestion, next.suggestion].filter(Boolean).join("；") || null
    });
  }
  return [...normalized.values()];
}
export type SetQualityReport = z.infer<typeof setQualityReportSchema>;
