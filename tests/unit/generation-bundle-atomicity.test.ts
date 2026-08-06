import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { AssetRecord, CreationSet, ProjectRecord } from "@styleforge/contracts";
import {
  createCreationSetPlan,
  createGenerationEvents,
  createGenerationManifest,
  createMigrationDomainProfile,
  createVisualDNARevision,
  reviseVisualDNA
} from "@styleforge/core";
import * as db from "../../apps/extension/lib/db";
import { dna } from "./contracts.test";

function outputAsset(id: string, marker: string): AssetRecord {
  return {
    id,
    hash: marker.repeat(64),
    role: "output",
    mimeType: "image/png",
    width: 512,
    height: 512,
    byteLength: 1,
    blob: new Blob([marker], { type: "image/png" }),
    thumbnailBlob: new Blob([marker], { type: "image/png" }),
    source: { type: "generated" },
    createdAt: Date.now()
  };
}

function project(id: string): ProjectRecord {
  return {
    id,
    title: "原子生成",
    mode: "analyze",
    referenceAssetIds: ["source"],
    outputAssetIds: [],
    finalSelection: null,
    userInstruction: "",
    aspectRatio: "3:4",
    count: 1,
    visualDNA: dna,
    provider: "mock",
    favorite: false,
    createdAt: 1,
    updatedAt: 1
  };
}

async function bundleFor(
  base: ProjectRecord,
  asset: AssetRecord,
  manifestId: string,
  eventId: string,
  trace?: { setId: string; planItemId: string }
) {
  const manifest = await createGenerationManifest({
    id: manifestId,
    projectId: base.id,
    taskId: `task-${manifestId}`,
    ...(trace ?? {}),
    createdAt: 1,
    completedAt: 2,
    source: {
      assetId: "source",
      hash: "a".repeat(64),
      mimeType: "image/png",
      fileName: "source.png"
    },
    visualDNA: dna,
    prompt: "原子写入测试",
    model: { provider: "mock", name: "mock", version: "1" },
    parameters: {
      aspectRatio: "3:4",
      count: 1,
      userInstruction: "",
      providerParameters: {}
    },
    outputs: [{
      assetId: asset.id,
      hash: asset.hash,
      mimeType: asset.mimeType,
      byteLength: asset.byteLength,
      fileName: `${asset.id}.png`
    }]
  });
  return {
    assets: [asset],
    manifest,
    events: createGenerationEvents(manifest, { ids: [eventId], parentGenerationId: null }),
    project: { ...base, outputAssetIds: [...base.outputAssetIds, asset.id], updatedAt: Date.now() }
  };
}

describe("生成资产与追溯记录原子提交", () => {
  it("生成完成后的原子项目编辑不会回滚刚写入的输出", async () => {
    const updateProject = (db as Record<string, unknown>).updateProject;
    expect(updateProject).toBeTypeOf("function");
    if (typeof updateProject !== "function") return;
    const id = `atomic-edit-${crypto.randomUUID()}`;
    const base = project(id);
    const asset = outputAsset(`atomic-edit-output-${crypto.randomUUID()}`, "a");
    await db.saveProject(base);
    await db.saveGenerationBundle(await bundleFor(
      base,
      asset,
      `atomic-edit-manifest-${crypto.randomUUID()}`,
      `atomic-edit-event-${crypto.randomUUID()}`
    ));

    await (updateProject as (
      projectId: string,
      transform: (current: ProjectRecord) => ProjectRecord
    ) => Promise<ProjectRecord | undefined>)(id, (current) => ({
      ...current,
      title: "生成后改名",
      updatedAt: current.updatedAt + 1
    }));

    expect(await db.getProject(id)).toMatchObject({
      title: "生成后改名",
      outputAssetIds: [asset.id]
    });
  });

  it("保存 DNA Revision 时只更新分析字段，不覆盖并发完成的输出与改名", async () => {
    const id = `atomic-revision-${crypto.randomUUID()}`;
    const base = { ...project(id), visualDNA: dna };
    const nextDNA = reviseVisualDNA(dna, {
      locks: { ...dna.locks, lighting: "locked" }
    }, 10);
    const staleRevisionProject = { ...base, visualDNA: nextDNA, updatedAt: 10 };
    await db.saveProject({
      ...base,
      title: "并发改名",
      outputAssetIds: ["concurrent-output"],
      updatedAt: 20
    });
    const revision = createVisualDNARevision({
      id: `revision-${crypto.randomUUID()}`,
      projectId: id,
      dna: nextDNA,
      previousDNA: dna,
      origin: "edit",
      createdAt: 10
    });

    await db.saveProjectRevision(staleRevisionProject, revision);

    expect(await db.getProject(id)).toMatchObject({
      title: "并发改名",
      outputAssetIds: ["concurrent-output"],
      visualDNA: { revision: nextDNA.revision },
      updatedAt: 20
    });
  });

  it("生成结束使用旧项目快照时不回滚生成期间完成的用户编辑", async () => {
    const id = `preserve-project-${crypto.randomUUID()}`;
    const stale = project(id);
    await db.saveProject(stale);
    const current: ProjectRecord = {
      ...stale,
      title: "生成中改过的名称",
      userInstruction: "生成中新增的真实要求",
      aspectRatio: "16:9",
      count: 4,
      provider: "codex",
      favorite: true,
      referenceAssetIds: ["source", "new-reference"],
      selectedSubjectAssetId: "new-subject",
      compiledPrompt: "生成中确认的新提示词",
      updatedAt: 50
    };
    await db.saveProject(current);
    const asset = outputAsset(`preserve-output-${crypto.randomUUID()}`, "f");

    await db.saveGenerationBundle(await bundleFor(
      stale,
      asset,
      `preserve-manifest-${crypto.randomUUID()}`,
      `preserve-event-${crypto.randomUUID()}`
    ));

    const saved = await db.getProject(id);
    expect(saved).toMatchObject({
      title: current.title,
      userInstruction: current.userInstruction,
      aspectRatio: current.aspectRatio,
      count: current.count,
      provider: current.provider,
      favorite: current.favorite,
      referenceAssetIds: current.referenceAssetIds,
      selectedSubjectAssetId: current.selectedSubjectAssetId,
      compiledPrompt: current.compiledPrompt,
      outputAssetIds: [asset.id]
    });
    expect(saved!.updatedAt).toBeGreaterThanOrEqual(current.updatedAt);
  });

  it("两个窗口并发提交同一项目时合并候选，不覆盖先完成的结果", async () => {
    const id = `atomic-project-${crypto.randomUUID()}`;
    const base = project(id);
    await db.saveProject(base);
    const first = outputAsset(`atomic-a-${crypto.randomUUID()}`, "b");
    const second = outputAsset(`atomic-b-${crypto.randomUUID()}`, "c");

    await Promise.all([
      db.saveGenerationBundle(await bundleFor(base, first, `manifest-a-${crypto.randomUUID()}`, `event-a-${crypto.randomUUID()}`)),
      db.saveGenerationBundle(await bundleFor(base, second, `manifest-b-${crypto.randomUUID()}`, `event-b-${crypto.randomUUID()}`))
    ]);

    expect((await db.getProject(id))?.outputAssetIds).toEqual(expect.arrayContaining([first.id, second.id]));
  });

  it("项目已删除时拒绝旧生成快照，不能复活项目或遗留输出", async () => {
    const id = `deleted-project-${crypto.randomUUID()}`;
    const base = project(id);
    const asset = outputAsset(`deleted-output-${crypto.randomUUID()}`, "d");
    const bundle = await bundleFor(
      base,
      asset,
      `deleted-manifest-${crypto.randomUUID()}`,
      `deleted-event-${crypto.randomUUID()}`
    );
    await db.saveProject(base);
    await db.deleteProject(id);

    await expect(db.saveGenerationBundle(bundle)).rejects.toThrow(/项目.*不存在|已删除/);
    expect(await db.getProject(id)).toBeUndefined();
    expect(await db.getAsset(asset.id)).toBeUndefined();
  });

  it("套图输出已提交但进度尚未回写时，删除整组仍清理追溯输出", async () => {
    const id = `set-delete-race-project-${crypto.randomUUID()}`;
    const setId = `set-delete-race-${crypto.randomUUID()}`;
    const base = project(id);
    const planItems = createCreationSetPlan("photography", 2)
      .map((item) => ({ ...item, id: `${setId}:${item.id}` }));
    const creationSet: CreationSet = {
      schemaVersion: "1.0.0",
      id: setId,
      projectId: id,
      title: "删除竞态",
      domainProfile: createMigrationDomainProfile(),
      requestedCount: 2,
      userIntent: "验证删除",
      sharedVisualDNARevision: 1,
      sharedVisualDNASnapshot: dna,
      sharedReferenceSnapshots: [],
      subjectAssetSnapshots: [],
      sourceGenerationEventId: null,
      sharedInvariants: [],
      allowedVariations: [],
      status: "READY",
      completedCount: 0,
      failedCount: 0,
      createdAt: 1,
      updatedAt: 1,
      qualityReport: null,
      planItems
    };
    const asset = outputAsset(`set-delete-race-output-${crypto.randomUUID()}`, "e");
    await db.saveProject(base);
    await db.saveCreationSet(creationSet);
    await db.saveGenerationBundle(await bundleFor(
      base,
      asset,
      `set-delete-race-manifest-${crypto.randomUUID()}`,
      `set-delete-race-event-${crypto.randomUUID()}`,
      { setId, planItemId: planItems[0]!.id }
    ));

    await db.deleteCreationSetWithWorks(setId);
    expect(await db.getCreationSet(setId)).toBeUndefined();
    expect(await db.getAsset(asset.id)).toBeUndefined();
    expect((await db.getProject(id))?.outputAssetIds).not.toContain(asset.id);
  });

  it("事件内容与 Manifest 不一致时整包拒绝写入", async () => {
    const id = `event-mismatch-project-${crypto.randomUUID()}`;
    const base = project(id);
    const asset = outputAsset(`event-mismatch-output-${crypto.randomUUID()}`, "f");
    await db.saveProject(base);
    const bundle = await bundleFor(
      base,
      asset,
      `event-mismatch-manifest-${crypto.randomUUID()}`,
      `event-mismatch-event-${crypto.randomUUID()}`
    );
    bundle.events[0] = { ...bundle.events[0]!, outputHash: "0".repeat(64) };

    await expect(db.saveGenerationBundle(bundle)).rejects.toThrow(/不一致/);
    expect(await db.getAsset(asset.id)).toBeUndefined();
  });

  it("后段事件唯一索引失败时回滚同事务内的资产与 Manifest", async () => {
    const id = `rollback-project-${crypto.randomUUID()}`;
    const base = project(id);
    await db.saveProject(base);
    const outputId = `rollback-output-${crypto.randomUUID()}`;
    const first = outputAsset(outputId, "d");
    const firstBundle = await bundleFor(
      base,
      first,
      `rollback-manifest-a-${crypto.randomUUID()}`,
      `rollback-event-a-${crypto.randomUUID()}`
    );
    await db.saveGenerationBundle(firstBundle);

    const replacement = outputAsset(outputId, "e");
    const secondManifestId = `rollback-manifest-b-${crypto.randomUUID()}`;
    const secondBundle = await bundleFor(
      base,
      replacement,
      secondManifestId,
      `rollback-event-b-${crypto.randomUUID()}`
    );
    await expect(db.saveGenerationBundle(secondBundle)).rejects.toBeDefined();

    expect((await db.getAsset(outputId))?.hash).toBe(first.hash);
    expect(await db.getGenerationManifest(secondManifestId)).toBeUndefined();
    expect(await db.listGenerationEvents(id)).toHaveLength(1);
  });
});
