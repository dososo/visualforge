import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord, CreationSet } from "@styleforge/contracts";
import { createCreationSetPlan, createMigrationDomainProfile, sha256Hex } from "@styleforge/core";
import { createCreationSetZip } from "../../apps/extension/lib/creation-set-export";
import * as creationSetExportModule from "../../apps/extension/lib/creation-set-export";
import { createGridLayout } from "../../apps/extension/lib/grid-layout";
import { dna } from "./contracts.test";

function compositeFixture(width: number, height: number) {
  const planItems = createCreationSetPlan("photography", 2).map((item, index) => ({
    ...item,
    status: "COMPLETED" as const,
    outputAssetId: `composite-output-${index}`
  }));
  const gridLayout = createGridLayout(2, 1);
  const creationSet: CreationSet = {
    schemaVersion: "1.0.0",
    id: "set-composite",
    projectId: "project-composite",
    title: "直接宫格导出",
    domainProfile: createMigrationDomainProfile(),
    requestedCount: 2,
    deliveryMode: "grid",
    gridLayout,
    userIntent: "验证宫格导出",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    transformationBlueprintSnapshot: null,
    signatureStyleSelection: null,
    sharedInvariants: [],
    allowedVariations: [],
    status: "COMPLETED",
    completedCount: 2,
    failedCount: 0,
    createdAt: 1,
    updatedAt: 2,
    qualityReport: null,
    planItems
  };
  const assets = new Map(planItems.map((item, index) => {
    const blob = new Blob([`composite-${index}`], { type: "image/png" });
    const asset: AssetRecord = {
      id: item.outputAssetId!,
      hash: String(index).repeat(64),
      role: "output",
      mimeType: "image/png",
      width,
      height,
      byteLength: 1024 * 1024,
      blob,
      thumbnailBlob: blob,
      source: { type: "generated" },
      createdAt: 1
    };
    return [asset.id, asset] as const;
  }));
  return { creationSet, assets, gridLayout };
}

describe("CreationSet ZIP 导出", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("在整组文件全部驻内存前拒绝超过安全内存预算的导出", () => {
    const assertCreationSetExportBudget = (creationSetExportModule as Record<string, unknown>)
      .assertCreationSetExportBudget as ((
        creationSet: CreationSet,
        assets: Map<string, AssetRecord>
      ) => void) | undefined;
    expect(assertCreationSetExportBudget).toBeTypeOf("function");
    if (!assertCreationSetExportBudget) return;
    const planItems = createCreationSetPlan("photography", 2).map((item, index) => ({
      ...item,
      status: "COMPLETED" as const,
      outputAssetId: `large-output-${index}`,
      selectedOutputAssetId: `large-output-${index}`
    }));
    const creationSet = { planItems } as CreationSet;
    const assets = new Map(planItems.map((item) => [item.outputAssetId!, {
      id: item.outputAssetId!,
      byteLength: 90 * 1024 * 1024
    } as AssetRecord]));
    expect(() => assertCreationSetExportBudget(creationSet, assets))
      .toThrow(/整组导出预计读取.*请先导出单张/);
  });

  it("按实际 ZIP 条目累计重复引用，不能用 assetId 去重低估峰值", () => {
    const assertCreationSetExportBudget = (creationSetExportModule as Record<string, unknown>)
      .assertCreationSetExportBudget as ((
        creationSet: CreationSet,
        assets: Map<string, AssetRecord>
      ) => void) | undefined;
    expect(assertCreationSetExportBudget).toBeTypeOf("function");
    if (!assertCreationSetExportBudget) return;
    const planItems = createCreationSetPlan("photography", 2).map((item) => ({
      ...item,
      status: "COMPLETED" as const,
      outputAssetId: "shared-large-output",
      selectedOutputAssetId: "shared-large-output"
    }));
    const creationSet = { planItems } as CreationSet;
    const assets = new Map([["shared-large-output", {
      id: "shared-large-output",
      byteLength: 40 * 1024 * 1024
    } as AssetRecord]]);

    expect(() => assertCreationSetExportBudget(creationSet, assets))
      .toThrow(/整组导出预计读取.*请先导出单张/);
  });

  it("极端宽高比的宫格合成尺寸仍受边长和像素预算约束", () => {
    const calculateGridCompositeSize = (creationSetExportModule as Record<string, unknown>)
      .calculateGridCompositeSize as ((
        first: Pick<AssetRecord, "width" | "height">,
        layout: { rows: number; columns: number }
      ) => { width: number; height: number }) | undefined;
    expect(calculateGridCompositeSize).toBeTypeOf("function");
    if (!calculateGridCompositeSize) return;

    const size = calculateGridCompositeSize(
      { width: 200, height: 12_000 },
      { rows: 12, columns: 1 }
    );
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4_096);
    expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
  });

  it("宫格导出预算计入单张完整解码位图、画布和编码副本", () => {
    const planItems = createCreationSetPlan("photography", 2).map((item, index) => ({
      ...item,
      status: "COMPLETED" as const,
      outputAssetId: `decoded-output-${index}`,
      selectedOutputAssetId: `decoded-output-${index}`
    }));
    const creationSet = {
      planItems,
      requestedCount: 2,
      deliveryMode: "both",
      gridLayout: {
        kind: "grid" as const,
        count: 2 as const,
        rows: 2,
        columns: 1,
        columnStops: [0, 1],
        rowStops: [0, 0.5, 1],
        confidence: 1,
        source: "confirmed" as const
      }
    } as CreationSet;
    const assets = new Map(planItems.map((item) => [item.outputAssetId!, {
      id: item.outputAssetId!,
      byteLength: 1024 * 1024,
      width: 6_000,
      height: 6_000
    } as AssetRecord]));

    expect(() => creationSetExportModule.assertCreationSetExportBudget(creationSet, assets))
      .toThrow(/工作内存/);
  });

  it("直接调用宫格合成时也在创建画布和解码前拒绝超预算", async () => {
    const { creationSet, assets, gridLayout } = compositeFixture(6_000, 6_000);
    const canvasConstructor = vi.fn(function () {
      throw new Error("不应创建画布");
    });
    const decoder = vi.fn();
    vi.stubGlobal("OffscreenCanvas", canvasConstructor);
    vi.stubGlobal("createImageBitmap", decoder);

    await expect(creationSetExportModule.createGridComposite(
      creationSet,
      assets,
      gridLayout
    )).rejects.toThrow(/宫格合成预计占用.*工作内存/);
    expect(canvasConstructor).not.toHaveBeenCalled();
    expect(decoder).not.toHaveBeenCalled();
  });

  it("绘制宫格失败时仍关闭已经解码的位图", async () => {
    const { creationSet, assets, gridLayout } = compositeFixture(100, 100);
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 100, close })));
    vi.stubGlobal("OffscreenCanvas", class {
      constructor(_width: number, _height: number) {}
      getContext() {
        return {
          fillStyle: "",
          fillRect: vi.fn(),
          drawImage: () => { throw new Error("模拟绘制失败"); }
        };
      }
      async convertToBlob() {
        return new Blob(["grid"], { type: "image/png" });
      }
    });

    await expect(creationSetExportModule.createGridComposite(
      creationSet,
      assets,
      gridLayout
    )).rejects.toThrow("模拟绘制失败");
    expect(close).toHaveBeenCalledOnce();
  });

  it("只导出成功作品和用户可理解 metadata，不泄露参考图、哈希或完整 Prompt", async () => {
    const items = createCreationSetPlan("photography", 4).map((item, index) => ({
      ...item,
      status: index < 2 ? "COMPLETED" as const : "FAILED" as const,
      outputAssetId: index < 2 ? `output-${index + 1}` : null,
      outputCandidates: index === 0 ? [{
        outputAssetId: "selected-output-1",
        generationEventId: "selected-event-1",
        taskId: "selected-task-1",
        createdAt: 2,
        source: "initial" as const,
        issueType: null
      }, {
        outputAssetId: "output-1",
        generationEventId: "retry-event-1",
        taskId: "retry-task-1",
        createdAt: 3,
        source: "targeted_retry" as const,
        issueType: "composition_repeat" as const
      }] : [],
      selectedOutputAssetId: index === 0 ? "selected-output-1" : null,
      finalPrompt: "内部完整 Prompt 不得导出"
    }));
    const set: CreationSet = {
      schemaVersion: "1.0.0",
      id: "set-export",
      projectId: "project-export",
      title: "周末街拍",
      domainProfile: createMigrationDomainProfile(),
      requestedCount: 4,
      userIntent: "记录周末",
      sharedVisualDNARevision: 1,
      sharedVisualDNASnapshot: dna,
      sharedReferenceSnapshots: [{
        assetId: "private-reference",
        hash: "f".repeat(64),
        mimeType: "image/png",
        role: "identity",
        subjectAsset: null
      }],
      subjectAssetSnapshots: [],
      sourceGenerationEventId: null,
      sharedInvariants: ["人物身份"],
      allowedVariations: ["机位"],
      status: "PARTIAL",
      completedCount: 2,
      failedCount: 2,
      createdAt: 1,
      updatedAt: 2,
      qualityReport: null,
      planItems: items
    };
    const assets = new Map<string, AssetRecord>(["selected-output-1", "output-1", "output-2"].map((id) => [id, {
      id,
      hash: "a".repeat(64),
      role: "output",
      mimeType: "image/png",
      width: 10,
      height: 10,
      byteLength: 3,
      blob: new Blob([id], { type: "image/png" }),
      thumbnailBlob: new Blob([id], { type: "image/png" }),
      source: { type: "generated" },
      createdAt: 1
    }]));
    const selectedAsset = assets.get("selected-output-1")!;
    selectedAsset.hash = await sha256Hex(new Uint8Array(await selectedAsset.blob.arrayBuffer()));
    selectedAsset.byteLength = selectedAsset.blob.size;
    set.planItems[0]!.finalSelection = {
      assetId: selectedAsset.id,
      outputSha256: selectedAsset.hash,
      byteLength: selectedAsset.byteLength,
      generationEventId: "selected-event-1",
      criticDisposition: "checked",
      criticReportId: "report-1",
      criticCheckedAt: 4,
      selectedAt: 5
    };

    const archive = unzipSync(new Uint8Array(await (await createCreationSetZip(set, assets)).arrayBuffer()));
    expect(Object.keys(archive).sort()).toEqual([
      "01-环境建立.png",
      "02-主体画面.png",
      "metadata.json"
    ]);
    const metadata = strFromU8(archive["metadata.json"]!);
    expect(metadata).toContain("周末街拍");
    expect(metadata).toContain("环境建立");
    expect(metadata).not.toContain("private-reference");
    expect(metadata).not.toContain("内部完整 Prompt");
    expect(metadata).not.toContain("f".repeat(64));
    expect(strFromU8(archive["01-环境建立.png"]!)).toBe("selected-output-1");
    expect(metadata).toContain("\"selected\": true");
    expect(metadata).toContain(`\"outputSha256\": \"${selectedAsset.hash}\"`);
    expect(metadata).toContain("\"generationEventId\": \"selected-event-1\"");
    expect(metadata).toContain("\"criticDisposition\": \"checked\"");

    assets.set(selectedAsset.id, {
      ...selectedAsset,
      blob: new Blob(["tampered"], { type: "image/png" })
    });
    await expect(createCreationSetZip(set, assets)).rejects.toThrow("校验失败");
  });
});
