import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SUBJECT_ASSET_SCHEMA_VERSION = "1.0.0" as const;
export const SUBJECT_QUALITY_SCHEMA_VERSION = "1.0.0" as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "必须是 SHA-256 哈希");
const mimeTypeSchema = z.enum(["image/png", "image/jpeg", "image/webp"]);

export const subjectAssetTypeSchema = z.enum([
  "person", "product", "object", "character", "pet"
]);
export const personImagePurposeSchema = z.enum(["face", "full_body"]);

export const identityBoardSchema = z.object({
  assetId: z.string().min(1),
  hash: sha256Schema,
  status: z.enum(["draft", "confirmed", "disabled"]),
  generatedAt: z.number().int().nonnegative(),
  confirmedAt: z.number().int().nonnegative().nullable(),
  aiGenerated: z.literal(true)
}).strict().superRefine((board, context) => {
  if (board.status === "draft" && board.confirmedAt !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedAt"],
      message: "待确认的人物基准图不能记录确认时间"
    });
  }
  if (board.status !== "draft" && board.confirmedAt === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedAt"],
      message: "已确认或停用的人物基准图必须保留确认时间"
    });
  }
});

export const productIdentityLockSchema = z.object({
  status: z.enum(["draft", "confirmed", "disabled"]),
  imageHashes: z.array(sha256Schema).min(1).max(5),
  invariants: z.array(z.string().min(1)).min(1).max(12),
  confirmedAt: z.number().int().nonnegative().nullable()
}).strict().superRefine((lock, context) => {
  if (lock.status === "draft" && lock.confirmedAt !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedAt"],
      message: "待确认的商品身份锁不能记录确认时间"
    });
  }
  if (lock.status !== "draft" && lock.confirmedAt === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmedAt"],
      message: "已确认或停用的商品身份锁必须保留确认时间"
    });
  }
});

export const qualityCheckResultSchema = z.object({
  status: z.enum(["pass", "warning", "fail", "unconfirmed"]),
  message: z.string().min(1),
  suggestion: z.string().min(1).nullable(),
  canContinue: z.boolean()
}).strict();

const imageQualityChecksSchema = z.object({
  faceDetected: qualityCheckResultSchema,
  multiplePeople: qualityCheckResultSchema,
  resolution: qualityCheckResultSchema,
  underexposed: qualityCheckResultSchema,
  overexposed: qualityCheckResultSchema,
  facialOcclusion: qualityCheckResultSchema,
  extremeProfile: qualityCheckResultSchema,
  frontalInformation: qualityCheckResultSchema
}).strict();

export const subjectQualityReportSchema = z.object({
  schemaVersion: z.literal(SUBJECT_QUALITY_SCHEMA_VERSION),
  checkedAt: z.number().int().nonnegative(),
  model: z.string().min(1),
  overall: z.enum(["pass", "warning", "blocked"]),
  blockingReasons: z.array(z.string().min(1)),
  sameIdentity: qualityCheckResultSchema,
  images: z.array(z.object({
    assetId: z.string().min(1),
    checks: imageQualityChecksSchema
  }).strict()).min(1).max(5)
}).strict();

export const subjectAssetSchema = z.object({
  schemaVersion: z.literal(SUBJECT_ASSET_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  type: subjectAssetTypeSchema,
  imageIds: z.array(z.string().min(1)).min(1).max(5),
  primaryImageId: z.string().min(1),
  imagePurposes: z.record(z.string(), personImagePurposeSchema).optional(),
  qualityReport: subjectQualityReportSchema.nullable(),
  identityBoard: identityBoardSchema.nullable().optional(),
  productIdentityLock: productIdentityLockSchema.nullable().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
}).strict().superRefine((asset, context) => {
  if (!asset.imageIds.includes(asset.primaryImageId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryImageId"],
      message: "主体主照片必须属于主体资产"
    });
  }
  if (new Set(asset.imageIds).size !== asset.imageIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["imageIds"],
      message: "主体资产不能包含重复图片"
    });
  }
  if (asset.identityBoard && asset.type !== "person") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identityBoard"],
      message: "只有人物卡可以保存人物基准图"
    });
  }
  if (asset.productIdentityLock && asset.type !== "product") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["productIdentityLock"],
      message: "只有商品可以保存商品身份锁"
    });
  }
  if (asset.identityBoard && asset.imageIds.includes(asset.identityBoard.assetId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identityBoard", "assetId"],
      message: "人物基准图不能替代或冒充原始照片"
    });
  }
});

export const subjectAssetImageSnapshotSchema = z.object({
  assetId: z.string().min(1),
  hash: sha256Schema,
  mimeType: mimeTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive()
}).strict();

export const subjectAssetSnapshotSchema = z.object({
  subjectAssetId: z.string().min(1),
  name: z.string().min(1),
  type: subjectAssetTypeSchema,
  primaryImageId: z.string().min(1),
  imagePurposes: z.record(z.string(), personImagePurposeSchema).optional(),
  images: z.array(subjectAssetImageSnapshotSchema).min(1).max(5),
  constraints: z.array(z.string().min(1)).min(1),
  identityBoard: identityBoardSchema.nullable().optional(),
  productIdentityLock: productIdentityLockSchema.nullable().optional()
}).strict().superRefine((snapshot, context) => {
  if (snapshot.identityBoard && snapshot.type !== "person") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identityBoard"],
      message: "只有人物快照可以包含人物基准图"
    });
  }
  if (snapshot.identityBoard &&
      snapshot.images.some((image) => image.assetId === snapshot.identityBoard?.assetId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["identityBoard", "assetId"],
      message: "人物基准图必须与原始照片快照分开保存"
    });
  }
  if (snapshot.productIdentityLock && snapshot.type !== "product") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["productIdentityLock"],
      message: "只有商品快照可以包含商品身份锁"
    });
  }
});

export const generationReferenceRoleSchema = z.enum([
  "style_layout", "style", "identity", "subject", "composition", "edit_base"
]);

export const generationReferenceSnapshotSchema = z.object({
  assetId: z.string().min(1),
  hash: sha256Schema,
  mimeType: mimeTypeSchema,
  role: generationReferenceRoleSchema,
  sourceKind: z.enum(["original", "identity_board"]).default("original"),
  subjectAsset: subjectAssetSnapshotSchema.nullable()
}).strict().superRefine((reference, context) => {
  if (reference.sourceKind !== "identity_board") return;
  const board = reference.subjectAsset?.identityBoard;
  if (reference.role !== "identity") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["role"],
      message: "人物基准图只能作为人物身份参考"
    });
  }
  if (reference.subjectAsset?.type !== "person" || !board) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectAsset"],
      message: "人物基准图引用必须包含人物卡快照"
    });
    return;
  }
  if (board.status !== "confirmed") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["subjectAsset", "identityBoard", "status"],
      message: "人物基准图必须经用户确认后才能使用"
    });
  }
  if (board.assetId !== reference.assetId || board.hash !== reference.hash) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assetId"],
      message: "人物基准图引用必须与人物快照中的基准图一致"
    });
  }
});

export const subjectQualityJsonSchema = zodToJsonSchema(subjectQualityReportSchema, {
  target: "jsonSchema7",
  $refStrategy: "none"
});

export type SubjectAsset = z.infer<typeof subjectAssetSchema>;
export type SubjectAssetType = z.infer<typeof subjectAssetTypeSchema>;
export type SubjectQualityReport = z.infer<typeof subjectQualityReportSchema>;
export type SubjectAssetSnapshot = z.infer<typeof subjectAssetSnapshotSchema>;
export type IdentityBoard = z.infer<typeof identityBoardSchema>;
export type ProductIdentityLock = z.infer<typeof productIdentityLockSchema>;
export type GenerationReferenceRole = z.infer<typeof generationReferenceRoleSchema>;
export type GenerationReferenceSnapshot = z.infer<typeof generationReferenceSnapshotSchema>;
