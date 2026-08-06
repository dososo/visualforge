import { describe, expect, it } from "vitest";
import {
  generationManifestSchema,
  subjectAssetSchema,
  subjectAssetSnapshotSchema,
  subjectQualityReportSchema
} from "@styleforge/contracts";
import { dna } from "./contracts.test";

const photo = {
  assetId: "photo-1",
  hash: "a".repeat(64),
  mimeType: "image/png",
  width: 1200,
  height: 1600
} as const;

describe("Subject Asset 契约", () => {
  it("保存 1～5 张图片、主体主照片和结构化人物质量结果", () => {
    const report = subjectQualityReportSchema.parse({
      schemaVersion: "1.0.0",
      checkedAt: 100,
      model: "codex-app-server-default",
      overall: "warning",
      blockingReasons: [],
      sameIdentity: {
        status: "unconfirmed",
        message: "无法确认",
        suggestion: "建议补充清晰正脸照",
        canContinue: true
      },
      images: [{
        assetId: photo.assetId,
        checks: {
          faceDetected: { status: "pass", message: "检测到人脸", suggestion: null, canContinue: true },
          multiplePeople: { status: "pass", message: "未发现多人", suggestion: null, canContinue: true },
          resolution: { status: "pass", message: "分辨率可用", suggestion: null, canContinue: true },
          underexposed: { status: "unconfirmed", message: "无法确认", suggestion: null, canContinue: true },
          overexposed: { status: "unconfirmed", message: "无法确认", suggestion: null, canContinue: true },
          facialOcclusion: { status: "unconfirmed", message: "无法确认", suggestion: null, canContinue: true },
          extremeProfile: { status: "unconfirmed", message: "无法确认", suggestion: null, canContinue: true },
          frontalInformation: { status: "unconfirmed", message: "无法确认", suggestion: "建议补充正脸照片", canContinue: true }
        }
      }]
    });
    const asset = subjectAssetSchema.parse({
      schemaVersion: "1.0.0",
      id: "person-1",
      name: "小林",
      type: "person",
      imageIds: [photo.assetId],
      primaryImageId: photo.assetId,
      qualityReport: report,
      createdAt: 100,
      updatedAt: 100
    });
    expect(asset.imageIds).toEqual(["photo-1"]);
    expect(subjectAssetSchema.safeParse({ ...asset, imageIds: [] }).success).toBe(false);
    expect(subjectAssetSchema.safeParse({
      ...asset,
      imageIds: ["1", "2", "3", "4", "5", "6"]
    }).success).toBe(false);
    const invalidPrimary = subjectAssetSchema.safeParse({
      ...asset,
      primaryImageId: "missing-photo"
    });
    expect(invalidPrimary.success).toBe(false);
    if (!invalidPrimary.success) {
      expect(invalidPrimary.error.issues[0]?.message).toBe("主体主照片必须属于主体资产");
    }
  });

  it("历史快照独立保存资产名称、类型、图片和约束", () => {
    expect(subjectAssetSnapshotSchema.parse({
      subjectAssetId: "product-1",
      name: "银色咖啡机",
      type: "product",
      primaryImageId: photo.assetId,
      images: [photo],
      constraints: [
        "尽量保持产品外形、材质和关键结构",
        "Logo 和文字只在模型能力允许时尽量保留"
      ]
    })).toMatchObject({ name: "银色咖啡机", type: "product" });
  });

  it("商品身份锁必须匹配商品类型，并区分待确认与已确认状态", () => {
    const lock = {
      status: "confirmed" as const,
      imageHashes: [photo.hash],
      invariants: ["保持完整外形与比例", "保持按钮和接口位置"],
      confirmedAt: 120
    };
    const product = subjectAssetSchema.parse({
      schemaVersion: "1.0.0",
      id: "product-lock",
      name: "银色咖啡机",
      type: "product",
      imageIds: [photo.assetId],
      primaryImageId: photo.assetId,
      qualityReport: null,
      productIdentityLock: lock,
      createdAt: 100,
      updatedAt: 120
    });
    expect(product.productIdentityLock?.status).toBe("confirmed");
    expect(subjectAssetSchema.safeParse({ ...product, type: "person" }).success).toBe(false);
    expect(subjectAssetSchema.safeParse({
      ...product,
      productIdentityLock: { ...lock, status: "draft", confirmedAt: 120 }
    }).success).toBe(false);
  });

  it("Generation Manifest 保存全部参考角色与主体快照", () => {
    const snapshot = subjectAssetSnapshotSchema.parse({
      subjectAssetId: "person-1",
      name: "小林",
      type: "person",
      primaryImageId: photo.assetId,
      images: [photo],
      constraints: ["保持人物身份、五官比例、年龄感和主要外观"]
    });
    const parsed = generationManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-subject",
      projectId: "project-subject",
      taskId: "task-subject",
      createdAt: 100,
      completedAt: 200,
      source: {
        assetId: "style-1",
        hash: "b".repeat(64),
        mimeType: "image/png",
        file: { storage: "indexeddb", key: "style-1", name: "style.png" }
      },
      references: [{
        assetId: "style-1",
        hash: "b".repeat(64),
        mimeType: "image/png",
        role: "style",
        subjectAsset: null
      }, {
        assetId: photo.assetId,
        hash: photo.hash,
        mimeType: photo.mimeType,
        role: "identity",
        subjectAsset: snapshot
      }],
      visualDNA: {
        schemaVersion: "1.1.0",
        revision: 1,
        hash: "c".repeat(64),
        snapshot: dna
      },
      prompt: { compilerVersion: "visual-prompt-v3", text: "保持人物身份" },
      model: { provider: "codex", name: "imagegen", version: null },
      parameters: {
        aspectRatio: "4:3",
        count: 1,
        userInstruction: "换成白衬衫",
        providerParameters: {}
      },
      outputs: [{
        assetId: "output-1",
        hash: "d".repeat(64),
        mimeType: "image/png",
        byteLength: 100,
        file: { storage: "indexeddb", key: "output-1", name: "output.png" }
      }]
    });
    expect(parsed.references.map((reference) => reference.role)).toEqual(["style", "identity"]);
    expect(parsed.references[1]?.subjectAsset?.name).toBe("小林");
  });
});
