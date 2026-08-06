import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { AssetRecord, CreationSet, ProjectRecord } from "@styleforge/contracts";
import { createCreationSetPlan, createMigrationDomainProfile } from "@styleforge/core";
import { taskRecordSchema } from "@styleforge/contracts";
import * as db from "../../apps/extension/lib/db";
import { dna } from "./contracts.test";

function setFixture(id: string, updatedAt: number): CreationSet {
  return {
    schemaVersion: "1.0.0",
    id,
    projectId: `project-${id}`,
    title: "本地创作组",
    domainProfile: createMigrationDomainProfile(),
    requestedCount: 4,
    userIntent: "形成完整叙事",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    sharedInvariants: ["核心风格"],
    allowedVariations: ["机位"],
    status: "READY",
    completedCount: 0,
    failedCount: 0,
    createdAt: 1,
    updatedAt,
    qualityReport: null,
    planItems: createCreationSetPlan("photography", 4)
  };
}

describe("CreationSet IndexedDB", () => {
  it("两个窗口原子更新同一套图时同时保留标题与人工最终选择", async () => {
    const updateCreationSet = (db as Record<string, unknown>).updateCreationSet;
    expect(updateCreationSet).toBeTypeOf("function");
    if (typeof updateCreationSet !== "function") return;
    const set = setFixture(`set-concurrent-${crypto.randomUUID()}`, 5);
    const candidate = {
      outputAssetId: "concurrent-output",
      outputSha256: "c".repeat(64),
      byteLength: 12,
      generationEventId: "concurrent-event",
      taskId: "concurrent-task",
      createdAt: 5,
      source: "initial" as const,
      issueType: null
    };
    set.planItems[0] = {
      ...set.planItems[0]!,
      status: "COMPLETED",
      outputAssetId: candidate.outputAssetId,
      outputCandidates: [candidate]
    };
    set.status = "PARTIAL";
    set.completedCount = 1;
    await db.saveCreationSet(set);

    type AtomicUpdate = (
      id: string,
      transform: (current: CreationSet) => CreationSet
    ) => Promise<CreationSet | undefined>;
    await Promise.all([
      (updateCreationSet as AtomicUpdate)(set.id, (current) => ({
        ...current,
        title: "窗口甲改名",
        updatedAt: 10
      })),
      (updateCreationSet as AtomicUpdate)(set.id, (current) => ({
        ...current,
        updatedAt: 11,
        planItems: current.planItems.map((item, index) => index === 0 ? {
          ...item,
          selectedOutputAssetId: candidate.outputAssetId,
          finalSelection: {
            assetId: candidate.outputAssetId,
            outputSha256: candidate.outputSha256,
            byteLength: candidate.byteLength,
            generationEventId: candidate.generationEventId,
            criticDisposition: "skipped" as const,
            criticReportId: null,
            criticCheckedAt: null,
            selectedAt: 11
          }
        } : item)
      }))
    ]);

    const saved = await db.getCreationSet(set.id);
    expect(saved?.title).toBe("窗口甲改名");
    expect(saved?.planItems[0]?.finalSelection?.assetId).toBe(candidate.outputAssetId);
    await db.deleteCreationSet(set.id);
  });

  it("读取旧版无报告 checked 记录时保留人工选择并降级为明确跳过检查", async () => {
    const set = setFixture(`legacy-checked-${crypto.randomUUID()}`, 6);
    const candidate = {
      outputAssetId: "legacy-output",
      outputSha256: "d".repeat(64),
      byteLength: 18,
      generationEventId: "legacy-event",
      taskId: "legacy-task",
      createdAt: 6,
      source: "initial" as const,
      issueType: null
    };
    set.planItems[0] = {
      ...set.planItems[0]!,
      status: "COMPLETED",
      taskId: candidate.taskId,
      generationEventId: candidate.generationEventId,
      outputAssetId: candidate.outputAssetId,
      outputCandidates: [candidate],
      selectedOutputAssetId: candidate.outputAssetId,
      finalSelection: {
        assetId: candidate.outputAssetId,
        outputSha256: candidate.outputSha256,
        byteLength: candidate.byteLength,
        generationEventId: candidate.generationEventId,
        criticDisposition: "checked",
        criticReportId: null,
        criticCheckedAt: null,
        selectedAt: 6
      }
    };
    set.status = "PARTIAL";
    set.completedCount = 1;
    const raw = await db.openVisualForgeDB();
    await raw.put("creationSets", set);

    const migrated = await db.getCreationSet(set.id);
    expect(migrated?.planItems[0]?.selectedOutputAssetId).toBe(candidate.outputAssetId);
    expect(migrated?.planItems[0]?.finalSelection).toMatchObject({
      assetId: candidate.outputAssetId,
      criticDisposition: "skipped",
      criticReportId: null,
      criticCheckedAt: null
    });
    await db.deleteCreationSet(set.id);
  });

  it("真实保存、更新、读取和按更新时间列出整组", async () => {
    await db.saveCreationSet(setFixture("set-db-1", 10));
    await db.saveCreationSet({ ...setFixture("set-db-2", 20), title: "第二组" });
    await db.saveCreationSet({ ...setFixture("set-db-1", 30), status: "GENERATING" });
    expect(await db.getCreationSet("set-db-1")).toMatchObject({
      status: "GENERATING",
      planItems: expect.arrayContaining([expect.objectContaining({ role: "environment" })])
    });
    expect((await db.listCreationSets()).map((set) => set.id)).toEqual(["set-db-1", "set-db-2"]);
  });

  it("仅删除分组时保留记录之外的作品数据", async () => {
    await db.deleteCreationSet("set-db-1");
    expect(await db.getCreationSet("set-db-1")).toBeUndefined();
    expect(await db.getCreationSet("set-db-2")).toBeDefined();
  });

  it("删除分组和组内作品时只移除本组输出", async () => {
    const set = setFixture("set-delete-works", 40);
    const outputId = "set-delete-output";
    const keptId = "set-delete-kept";
    set.planItems[0] = {
      ...set.planItems[0]!,
      status: "COMPLETED",
      outputAssetId: outputId,
      generationEventId: "set-delete-event",
      taskId: "set-delete-task"
    };
    set.completedCount = 1;
    set.status = "PARTIAL";
    const asset = (id: string): AssetRecord => ({
      id,
      hash: id.padEnd(64, "a").slice(0, 64),
      role: "output",
      mimeType: "image/png",
      width: 10,
      height: 10,
      byteLength: 1,
      blob: new Blob(["x"], { type: "image/png" }),
      thumbnailBlob: new Blob(["x"], { type: "image/png" }),
      source: { type: "generated" },
      createdAt: 1
    });
    const project: ProjectRecord = {
      id: set.projectId,
      title: "删除测试",
      mode: "direct",
      referenceAssetIds: [keptId],
      outputAssetIds: [outputId, keptId],
      userInstruction: "",
      aspectRatio: "4:3",
      count: 1,
      provider: "mock",
      favorite: false,
      createdAt: 1,
      updatedAt: 1
    };
    await db.saveAsset(asset(outputId));
    await db.saveAsset(asset(keptId));
    await db.saveProject(project);
    await db.saveCreationSet(set);

    await db.deleteCreationSetWithWorks(set.id);
    expect(await db.getCreationSet(set.id)).toBeUndefined();
    expect(await db.getAsset(outputId)).toBeUndefined();
    expect(await db.getAsset(keptId)).toBeDefined();
    expect((await db.getProject(project.id))?.outputAssetIds).toEqual([keptId]);
  });

  it("删除单图作品时保留同项目套图、套图输出和参考图", async () => {
    const removeStandalone = (db as Record<string, unknown>).deleteStandaloneProjectWorks;
    expect(removeStandalone).toBeTypeOf("function");
    if (typeof removeStandalone !== "function") return;

    const set = setFixture("shared-project", 45);
    const standaloneId = "standalone-output";
    const setOutputId = "set-output-kept";
    const referenceId = "reference-kept";
    set.planItems[0] = {
      ...set.planItems[0]!,
      status: "COMPLETED",
      outputAssetId: setOutputId
    };
    set.completedCount = 1;
    set.status = "PARTIAL";
    const asset = (id: string, role: AssetRecord["role"]): AssetRecord => ({
      id,
      hash: id.padEnd(64, "b").slice(0, 64),
      role,
      mimeType: "image/png",
      width: 300,
      height: 300,
      byteLength: 1,
      blob: new Blob(["x"], { type: "image/png" }),
      thumbnailBlob: new Blob(["x"], { type: "image/png" }),
      source: role === "output" ? { type: "generated" } : { type: "upload" },
      createdAt: 1
    });
    const project: ProjectRecord = {
      id: set.projectId,
      title: "共享项目",
      mode: "direct",
      referenceAssetIds: [referenceId],
      outputAssetIds: [standaloneId, setOutputId],
      userInstruction: "",
      aspectRatio: "4:3",
      count: 1,
      provider: "mock",
      favorite: false,
      createdAt: 1,
      updatedAt: 1
    };
    await db.saveAsset(asset(standaloneId, "output"));
    await db.saveAsset(asset(setOutputId, "output"));
    await db.saveAsset(asset(referenceId, "style_layout"));
    await db.saveProject(project);
    await db.saveCreationSet(set);

    await (removeStandalone as (projectId: string) => Promise<void>)(project.id);

    expect(await db.getAsset(standaloneId)).toBeUndefined();
    expect(await db.getAsset(setOutputId)).toBeDefined();
    expect(await db.getAsset(referenceId)).toBeDefined();
    expect(await db.getCreationSet(set.id)).toBeDefined();
    expect((await db.getProject(project.id))?.outputAssetIds).toEqual([setOutputId]);
  });

  it("重启对账时保留完成项并把运行中断项标记为中断", async () => {
    const set = setFixture("set-reconcile", 50);
    set.status = "GENERATING";
    set.planItems[0] = { ...set.planItems[0]!, status: "COMPLETED", outputAssetId: "done-output" };
    set.planItems[1] = { ...set.planItems[1]!, status: "GENERATING", taskId: "interrupted-set-task" };
    set.completedCount = 1;
    await db.saveCreationSet(set);
    await db.saveTaskRecord(taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId: "interrupted-set-task",
      projectId: set.projectId,
      retryOfTaskId: null,
      generationEventId: null,
      generationEventIds: [],
      operation: "GENERATION",
      status: "INTERRUPTED",
      startedAt: 1,
      finishedAt: 2,
      retryCount: 0,
      error: { code: "INTERRUPTED", message: "中断", retryable: true },
      heartbeat: 2,
      input: {
        sourceAssetId: "source",
        references: [],
        visualDNA: set.sharedVisualDNASnapshot,
        prompt: "冻结 Prompt",
        parameters: { aspectRatio: "4:3", count: 1, userInstruction: "", providerParameters: {} },
        parentGenerationId: null,
        setId: set.id,
        planItemId: set.planItems[1]!.id,
        domainProfile: set.domainProfile
      }
    }));

    const [reconciled] = await db.reconcileCreationSets();
    expect(reconciled?.planItems[0]?.status).toBe("COMPLETED");
    expect(reconciled?.planItems[1]?.status).toBe("INTERRUPTED");
    expect(reconciled?.status).toBe("INTERRUPTED");
  });

  it("第二窗口对账不会中断仍有新鲜心跳的套图画面", async () => {
    const set = setFixture("set-fresh-window", Date.now());
    const taskId = "fresh-set-task";
    set.status = "GENERATING";
    set.planItems[0] = { ...set.planItems[0]!, status: "GENERATING", taskId };
    await db.saveCreationSet(set);
    await db.saveTaskRecord(taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId,
      projectId: set.projectId,
      retryOfTaskId: null,
      generationEventId: null,
      generationEventIds: [],
      operation: "GENERATION",
      status: "GENERATING",
      startedAt: Date.now() - 1_000,
      finishedAt: null,
      retryCount: 0,
      error: null,
      heartbeat: Date.now(),
      input: {
        sourceAssetId: "source",
        references: [],
        visualDNA: set.sharedVisualDNASnapshot,
        prompt: "冻结 Prompt",
        parameters: { aspectRatio: "4:3", count: 1, userInstruction: "", providerParameters: {} },
        parentGenerationId: null,
        setId: set.id,
        planItemId: set.planItems[0]!.id,
        domainProfile: set.domainProfile
      }
    }));

    const reconciled = (await db.reconcileCreationSets()).find((item) => item.id === set.id);
    expect(reconciled?.planItems[0]?.status).toBe("GENERATING");
    expect(reconciled?.status).toBe("GENERATING");
  });

  it("任务已取消但套图状态尚未落盘时，对账会把对应画面标记为已取消", async () => {
    const set = setFixture(`set-cancelled-task-${crypto.randomUUID()}`, Date.now());
    const taskId = `cancelled-set-task-${crypto.randomUUID()}`;
    set.status = "GENERATING";
    set.planItems[0] = { ...set.planItems[0]!, status: "GENERATING", taskId };
    await db.saveCreationSet(set);
    await db.saveTaskRecord(taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId,
      projectId: set.projectId,
      retryOfTaskId: null,
      generationEventId: null,
      generationEventIds: [],
      operation: "GENERATION",
      status: "CANCELLED",
      startedAt: 1,
      finishedAt: 2,
      retryCount: 0,
      error: null,
      heartbeat: 2,
      input: {
        sourceAssetId: "source",
        references: [],
        visualDNA: set.sharedVisualDNASnapshot,
        prompt: "冻结 Prompt",
        parameters: { aspectRatio: "4:3", count: 1, userInstruction: "", providerParameters: {} },
        parentGenerationId: null,
        setId: set.id,
        planItemId: set.planItems[0]!.id,
        domainProfile: set.domainProfile
      }
    }));

    const reconciled = (await db.reconcileCreationSets()).find((item) => item.id === set.id);
    expect(reconciled?.planItems[0]).toMatchObject({ status: "CANCELLED", error: null });
  });

  it("完成任务对账会结束遗留 checking 状态并明确标记质检不可用", async () => {
    const set = setFixture(`set-completed-checking-${crypto.randomUUID()}`, Date.now());
    const taskId = `completed-set-task-${crypto.randomUUID()}`;
    const eventId = `completed-set-event-${crypto.randomUUID()}`;
    const outputId = `completed-set-output-${crypto.randomUUID()}`;
    set.status = "GENERATING";
    set.planItems[0] = {
      ...set.planItems[0]!,
      status: "GENERATING",
      taskId,
      qualityStatus: "checking"
    };
    await db.saveCreationSet(set);
    await db.saveGenerationEvents([{
      schemaVersion: "1.0.0",
      id: eventId,
      projectId: set.projectId,
      generationManifestId: `manifest-${eventId}`,
      setId: set.id,
      planItemId: set.planItems[0]!.id,
      parentGenerationId: null,
      sourceAssetId: "source",
      visualDNAId: "a".repeat(64),
      visualDNASchemaVersion: "1.1.0",
      dnaRevision: 1,
      prompt: "冻结 Prompt",
      promptCompilerVersion: "test",
      model: { provider: "mock", name: "mock", version: "1" },
      parameters: { aspectRatio: "4:3", count: 1, userInstruction: "", providerParameters: {} },
      outputAssetId: outputId,
      outputHash: "b".repeat(64),
      createdAt: 2
    }]);
    await db.saveTaskRecord(taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId,
      projectId: set.projectId,
      retryOfTaskId: null,
      generationEventId: eventId,
      generationEventIds: [eventId],
      operation: "GENERATION",
      status: "COMPLETED",
      startedAt: 1,
      finishedAt: 2,
      retryCount: 0,
      error: null,
      heartbeat: 2,
      input: {
        sourceAssetId: "source",
        references: [],
        visualDNA: set.sharedVisualDNASnapshot,
        prompt: "冻结 Prompt",
        parameters: { aspectRatio: "4:3", count: 1, userInstruction: "", providerParameters: {} },
        parentGenerationId: null,
        setId: set.id,
        planItemId: set.planItems[0]!.id,
        domainProfile: set.domainProfile
      }
    }));

    const reconciled = (await db.reconcileCreationSets()).find((item) => item.id === set.id);
    expect(reconciled?.planItems[0]).toMatchObject({
      status: "COMPLETED",
      qualityStatus: "unavailable",
      error: { code: "QUALITY_CHECK_UNAVAILABLE" }
    });
  });
});
