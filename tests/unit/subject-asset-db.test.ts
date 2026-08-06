import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { AssetRecord, SubjectAsset } from "@styleforge/contracts";
import { generationManifestSchema, taskRecordSchema } from "@styleforge/contracts";
import { createGenerationEvents } from "@styleforge/core";
import * as db from "../../apps/extension/lib/db";
import visualDNA from "../../packages/contracts/examples/visual-dna-v1.example.json";

const image = (id: string): AssetRecord => ({
  id,
  hash: id.padEnd(64, "a").slice(0, 64),
  role: "identity",
  mimeType: "image/png",
  width: 1200,
  height: 1600,
  byteLength: 1,
  blob: new Blob(["x"], { type: "image/png" }),
  thumbnailBlob: new Blob(["x"], { type: "image/png" }),
  source: { type: "upload" },
  createdAt: 10
});

const subject = (imageIds: string[]): SubjectAsset => ({
  schemaVersion: "1.0.0",
  id: "person-db",
  name: "小林",
  type: "person",
  imageIds,
  primaryImageId: imageIds[0]!,
  qualityReport: null,
  createdAt: 10,
  updatedAt: 10
});

describe("Subject Asset IndexedDB", () => {
  it("保存多张照片、切换主图、删除与替换图片并在重新读取后恢复", async () => {
    await db.saveAsset(image("photo-db-1"));
    await db.saveAsset(image("photo-db-2"));
    await db.saveSubjectAsset(subject(["photo-db-1", "photo-db-2"]));
    await db.saveSubjectAsset({
      ...(await db.getSubjectAsset("person-db"))!,
      imageIds: ["photo-db-2"],
      primaryImageId: "photo-db-2",
      updatedAt: 20
    });
    expect(await db.getSubjectAsset("person-db")).toMatchObject({
      imageIds: ["photo-db-2"],
      primaryImageId: "photo-db-2"
    });
    expect(await db.getAsset("photo-db-1")).toBeDefined();
    expect(await db.listSubjectAssets()).toHaveLength(1);
  });

  it("删除人物卡不删除图片、作品、Manifest、Event 和 Task 历史", async () => {
    await db.deleteSubjectAsset("person-db");
    expect(await db.getSubjectAsset("person-db")).toBeUndefined();
    expect(await db.getAsset("photo-db-1")).toBeDefined();
    expect(await db.getAsset("photo-db-2")).toBeDefined();
  });

  it("删除商品主体不破坏作品、Manifest、Event、Task 和图片快照", async () => {
    const productImage = { ...image("product-db-photo"), hash: "d".repeat(64), role: "subject" as const };
    await db.saveAsset(productImage);
    const product = { ...subject([productImage.id]), id: "product-db", name: "咖啡机", type: "product" as const };
    await db.saveSubjectAsset(product);
    const snapshot = {
      subjectAssetId: product.id,
      name: product.name,
      type: product.type,
      primaryImageId: product.primaryImageId,
      images: [{
        assetId: productImage.id,
        hash: productImage.hash,
        mimeType: productImage.mimeType,
        width: productImage.width,
        height: productImage.height
      }],
      constraints: ["保持产品外形、材质和关键结构"]
    };
    const manifest = generationManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "product-history-manifest",
      projectId: "product-history-project",
      taskId: "product-history-task",
      createdAt: 100,
      completedAt: 200,
      source: {
        assetId: productImage.id,
        hash: productImage.hash,
        mimeType: productImage.mimeType,
        file: { storage: "indexeddb", key: productImage.id, name: "source.png" }
      },
      references: [{
        assetId: productImage.id,
        hash: productImage.hash,
        mimeType: productImage.mimeType,
        role: "subject",
        subjectAsset: snapshot
      }],
      visualDNA: { schemaVersion: "1.1.0", revision: 1, hash: "b".repeat(64), snapshot: visualDNA },
      prompt: { compilerVersion: "visual-prompt-v3", text: "保持产品结构" },
      model: { provider: "mock", name: "styleforge-mock", version: "1" },
      parameters: { aspectRatio: "4:3", count: 1, userInstruction: "", providerParameters: {} },
      outputs: [{
        assetId: "product-history-output",
        hash: "c".repeat(64),
        mimeType: "image/png",
        byteLength: 100,
        file: { storage: "indexeddb", key: "product-history-output", name: "output.png" }
      }]
    });
    await db.saveGenerationManifest(manifest);
    await db.saveGenerationEvents(createGenerationEvents(manifest, {
      ids: ["product-history-event"],
      parentGenerationId: null
    }));
    await db.saveTaskRecord(taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId: manifest.taskId,
      projectId: manifest.projectId,
      retryOfTaskId: null,
      generationEventId: "product-history-event",
      generationEventIds: ["product-history-event"],
      operation: "GENERATION",
      status: "COMPLETED",
      startedAt: 100,
      finishedAt: 200,
      retryCount: 0,
      error: null,
      heartbeat: 200,
      input: {
        sourceAssetId: productImage.id,
        references: manifest.references,
        visualDNA,
        prompt: manifest.prompt.text,
        parameters: manifest.parameters,
        parentGenerationId: null
      }
    }));

    await db.deleteSubjectAsset(product.id);
    expect(await db.getSubjectAsset(product.id)).toBeUndefined();
    expect(await db.getAsset(productImage.id)).toBeDefined();
    expect((await db.getGenerationManifest(manifest.id))?.references?.[0]?.subjectAsset?.name).toBe("咖啡机");
    expect((await db.listGenerationEvents(manifest.projectId))[0]?.references?.[0]?.subjectAsset?.name).toBe("咖啡机");
    expect((await db.getTaskRecord(manifest.taskId))?.input.references?.[0]?.subjectAsset?.name).toBe("咖啡机");
  });
});
