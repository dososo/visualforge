import { describe, expect, it } from "vitest";
import { createElement } from "../../apps/extension/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../apps/extension/node_modules/react-dom/server.js";
import {
  generationReferenceSnapshotSchema,
  subjectAssetSchema
} from "@styleforge/contracts";
import { IdentityBoardPanel } from "../../apps/extension/entrypoints/sidepanel/SubjectAssets";

describe("人物基准图", () => {
  const identityBoard = {
    assetId: "board-asset",
    hash: "b".repeat(64),
    status: "confirmed" as const,
    generatedAt: 200,
    confirmedAt: 300,
    aiGenerated: true as const
  };

  it("人物卡可保存已确认的 AI 基准图，同时保留全部原始照片", () => {
    const asset = subjectAssetSchema.parse({
      schemaVersion: "1.0.0",
      id: "person-1",
      name: "虚构人物",
      type: "person",
      imageIds: ["original-1", "original-2"],
      primaryImageId: "original-1",
      qualityReport: null,
      identityBoard,
      createdAt: 100,
      updatedAt: 300
    });
    expect(asset.imageIds).toEqual(["original-1", "original-2"]);
    expect(asset.identityBoard?.aiGenerated).toBe(true);
  });

  it("Manifest 引用可区分原始人物照片和已确认基准图", () => {
    expect(generationReferenceSnapshotSchema.parse({
      assetId: "board-asset",
      hash: "b".repeat(64),
      mimeType: "image/png",
      role: "identity",
      sourceKind: "identity_board",
      subjectAsset: {
        subjectAssetId: "person-1",
        name: "虚构人物",
        type: "person",
        primaryImageId: "original-1",
        images: [{
          assetId: "original-1", hash: "a".repeat(64), mimeType: "image/png", width: 1024, height: 1024
        }],
        constraints: ["保持人物身份"],
        identityBoard
      }
    }).sourceKind).toBe("identity_board");
  });

  it("非人物主体不能保存人物基准图，且基准图不能冒充原始照片", () => {
    expect(subjectAssetSchema.safeParse({
      schemaVersion: "1.0.0",
      id: "product-1",
      name: "商品",
      type: "product",
      imageIds: ["original-1"],
      primaryImageId: "original-1",
      qualityReport: null,
      identityBoard,
      createdAt: 100,
      updatedAt: 300
    }).success).toBe(false);
    expect(subjectAssetSchema.safeParse({
      schemaVersion: "1.0.0",
      id: "person-1",
      name: "虚构人物",
      type: "person",
      imageIds: ["board-asset"],
      primaryImageId: "board-asset",
      qualityReport: null,
      identityBoard,
      createdAt: 100,
      updatedAt: 300
    }).success).toBe(false);
  });

  it("只有已确认的人物基准图能作为 identity_board 引用", () => {
    const reference = {
      assetId: "board-asset",
      hash: "b".repeat(64),
      mimeType: "image/png",
      role: "identity",
      sourceKind: "identity_board",
      subjectAsset: {
        subjectAssetId: "person-1",
        name: "虚构人物",
        type: "person",
        primaryImageId: "original-1",
        images: [{
          assetId: "original-1", hash: "a".repeat(64), mimeType: "image/png", width: 1024, height: 1024
        }],
        constraints: ["保持人物身份"],
        identityBoard
      }
    };
    expect(generationReferenceSnapshotSchema.safeParse({
      ...reference,
      role: "style"
    }).success).toBe(false);
    expect(generationReferenceSnapshotSchema.safeParse({
      ...reference,
      subjectAsset: {
        ...reference.subjectAsset,
        identityBoard: { ...identityBoard, status: "draft", confirmedAt: null }
      }
    }).success).toBe(false);
  });

  it("人物基准图详情提供生成、确认、停用、重新生成和删除入口", () => {
    const person = subjectAssetSchema.parse({
      schemaVersion: "1.0.0",
      id: "person-ui",
      name: "虚构人物",
      type: "person",
      imageIds: ["original-1"],
      primaryImageId: "original-1",
      qualityReport: null,
      identityBoard: null,
      createdAt: 100,
      updatedAt: 100
    });
    const callbacks = {
      onGenerate: () => undefined,
      onConfirm: () => undefined,
      onDisable: () => undefined,
      onEnable: () => undefined,
      onDelete: () => undefined
    };
    const empty = renderToStaticMarkup(
      createElement(IdentityBoardPanel, { subject: person, ...callbacks })
    );
    expect(empty).toContain("生成人物基准图");

    const draft = renderToStaticMarkup(
      createElement(IdentityBoardPanel, {
        subject: { ...person, identityBoard: { ...identityBoard, status: "draft", confirmedAt: null } },
        ...callbacks
      })
    );
    expect(draft).toContain("AI 生成");
    expect(draft).toContain("确认使用");
    expect(draft).toContain("重新生成");
    expect(draft).toContain("删除基准图");

    const confirmed = renderToStaticMarkup(
      createElement(IdentityBoardPanel, { subject: { ...person, identityBoard }, ...callbacks })
    );
    expect(confirmed).toContain("停用");

    const disabled = renderToStaticMarkup(
      createElement(IdentityBoardPanel, {
        subject: { ...person, identityBoard: { ...identityBoard, status: "disabled" } },
        ...callbacks
      })
    );
    expect(disabled).toContain("重新启用");
  });
});
