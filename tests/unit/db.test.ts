import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { generationManifestSchema } from "@styleforge/contracts";
import type { AssetRecord, ProjectRecord } from "@styleforge/contracts";
import * as db from "../../apps/extension/lib/db";
import visualDNAExample from "../../packages/contracts/examples/visual-dna-v1.example.json";

describe("Generation Manifest IndexedDB", () => {
  it("首次安装默认使用更适合人物与商品展示的 3:4 比例", () => {
    expect(db.defaultSettings.defaultAspectRatio).toBe("3:4");
  });

  it("按作品保存并读取完整追溯清单", async () => {
    const save = (db as Record<string, unknown>).saveGenerationManifest;
    const get = (db as Record<string, unknown>).getGenerationManifest;
    const list = (db as Record<string, unknown>).listGenerationManifests;
    expect(save).toBeTypeOf("function");
    expect(get).toBeTypeOf("function");
    expect(list).toBeTypeOf("function");
    if (typeof save !== "function" || typeof get !== "function" || typeof list !== "function") return;

    const manifest = generationManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-db",
      projectId: "project-db",
      taskId: "task-db",
      createdAt: 100,
      completedAt: 200,
      source: {
        assetId: "source-db",
        hash: "a".repeat(64),
        mimeType: "image/png",
        file: { storage: "indexeddb", key: "source-db", name: "source.png" }
      },
      visualDNA: {
        schemaVersion: "1.1.0",
        revision: 1,
        hash: "b".repeat(64),
        snapshot: visualDNAExample
      },
      prompt: { compilerVersion: "visual-prompt-v2", text: "实际 Prompt" },
      model: { provider: "mock", name: "styleforge-mock", version: "1" },
      parameters: {
        aspectRatio: "4:3",
        count: 1,
        userInstruction: "",
        providerParameters: {}
      },
      outputs: [{
        assetId: "output-db",
        hash: "c".repeat(64),
        mimeType: "image/png",
        byteLength: 100,
        file: { storage: "indexeddb", key: "output-db", name: "output.png" }
      }]
    });

    await save(manifest);
    expect(await get(manifest.id)).toEqual(manifest);
    expect(await list(manifest.projectId)).toEqual([manifest]);
  });

  it("为旧 Manifest 懒回填事件并支持按输出查询", async () => {
    const list = (db as Record<string, unknown>).listGenerationEvents;
    const byOutput = (db as Record<string, unknown>).getGenerationEventByOutputAssetId;
    const latest = (db as Record<string, unknown>).getLatestGenerationEvent;
    expect(list).toBeTypeOf("function");
    expect(byOutput).toBeTypeOf("function");
    expect(latest).toBeTypeOf("function");
    if (typeof list !== "function" || typeof byOutput !== "function" || typeof latest !== "function") return;

    const events = await list("project-db");
    expect(events).toHaveLength(1);
    expect(events[0].parentGenerationId).toBeNull();
    expect(events[0].outputAssetId).toBe("output-db");
    expect((await byOutput("output-db"))?.generationManifestId).toBe("manifest-db");
    expect((await latest("project-db"))?.id).toBe(events[0].id);
  });

  it("读取旧项目时使用参考资产来源信息迁移 Visual DNA", async () => {
    const source: AssetRecord = {
      id: "legacy-source",
      hash: "d".repeat(64),
      role: "style_layout",
      mimeType: "image/png",
      width: 512,
      height: 512,
      byteLength: 1,
      blob: new Blob(["x"], { type: "image/png" }),
      thumbnailBlob: new Blob(["x"], { type: "image/png" }),
      source: { type: "upload" },
      createdAt: 10
    };
    await db.saveAsset(source);
    const legacyProject = {
      id: "legacy-project",
      title: "旧项目",
      mode: "analyze",
      referenceAssetIds: [source.id],
      outputAssetIds: [],
      userInstruction: "",
      aspectRatio: "4:3",
      count: 1,
      provider: "mock",
      favorite: false,
      createdAt: 10,
      updatedAt: 20,
      visualDNA: {
        schemaVersion: "1.0",
        domain: "photography",
        summary: "旧数据",
        subject: { description: "主体", count: 1 },
        composition: { shotType: "中景", cameraAngle: "平视", subjectPlacement: "中央", negativeSpace: "四周", depth: "浅" },
        lighting: { source: "窗光", direction: "左侧", quality: "柔和", contrast: "低", highlightBehavior: "柔和", shadowBehavior: "开放" },
        color: { dominantColors: ["灰"], saturation: "低", temperature: "中性", contrast: "低" },
        texture: { medium: "摄影", material: "纸", grain: "细", sharpness: "清晰", surfaceDetail: "真实" },
        style: { keywords: ["克制"], invariants: ["留白"], variables: ["主体"] },
        constraints: { preserve: ["构图"], avoid: ["Logo"] },
        generationBrief: "旧提示",
        confidence: 0.8
      }
    };
    await db.saveProject(legacyProject as unknown as ProjectRecord);

    const migrated = await db.getProject(legacyProject.id);
    expect(migrated?.visualDNA?.schemaVersion).toBe("1.1.0");
    expect(migrated?.visualDNA?.sourceImageHash).toBe(source.hash);
    expect((await db.listProjects()).find((project) => project.id === legacyProject.id)?.visualDNA?.camera.angle).toBe("平视");
  });

  it("清空浏览器数据时同时删除 local、session、后台瞬态状态与 IndexedDB", async () => {
    const clearAllBrowserData = (db as Record<string, unknown>).clearAllBrowserData;
    expect(clearAllBrowserData).toBeTypeOf("function");
    if (typeof clearAllBrowserData !== "function") return;
    const stored: Record<string, unknown> = {
      pendingWebImage: { dataUrl: "data:image/png;base64,a" },
      pendingCapture: { dataUrl: "data:image/png;base64,b" },
      hoverCaptureEnabled: false,
      visualForgeDataConsentV1: { acceptedAt: 1 }
    };
    const localStorage = {
      clear: async () => {
        for (const key of Object.keys(stored)) delete stored[key];
      }
    };
    const sessionStored: Record<string, unknown> = {
      styleforgeActiveTab: { id: 9, url: "https://example.com" },
      "visualForgeRightClickTarget:9:0": { token: "secret-target" }
    };
    const sessionStorage = {
      clear: async () => {
        for (const key of Object.keys(sessionStored)) delete sessionStored[key];
      }
    };
    let transientStateCleared = false;

    await clearAllBrowserData({
      localStorage,
      sessionStorage,
      clearTransientState: async () => { transientStateCleared = true; }
    });

    expect(stored).toEqual({});
    expect(sessionStored).toEqual({});
    expect(transientStateCleared).toBe(true);
    expect(await db.listProjects()).toEqual([]);
    expect(await db.getSettings()).toEqual(db.defaultSettings);
  });
});
