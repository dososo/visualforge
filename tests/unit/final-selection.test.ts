import { describe, expect, it } from "vitest";
import {
  creationSetSchema,
  type AssetRecord,
  type GenerationEvent,
  type ProjectRecord,
  type SetQualityReport
} from "@styleforge/contracts";
import { createCreationSetPlan, createMigrationDomainProfile, sha256Hex } from "@styleforge/core";
import {
  createProjectFinalSelection,
  resolveProjectFinalAsset,
  verifyProjectFinalAsset
} from "../../apps/extension/lib/final-selection";
import { dna } from "./contracts.test";

async function asset(id: string, value: string): Promise<AssetRecord> {
  const blob = new Blob([value], { type: "image/png" });
  return {
    id,
    hash: await sha256Hex(new Uint8Array(await blob.arrayBuffer())),
    role: "output",
    mimeType: "image/png",
    width: 512,
    height: 512,
    byteLength: blob.size,
    blob,
    thumbnailBlob: blob,
    source: { type: "generated" },
    createdAt: 1
  };
}

function event(output: AssetRecord): GenerationEvent {
  return {
    schemaVersion: "1.0.0",
    id: `event-${output.id}`,
    projectId: "project-1",
    generationManifestId: "manifest-1",
    parentGenerationId: null,
    sourceAssetId: "source-1",
    visualDNAId: "a".repeat(64),
    visualDNASchemaVersion: "1.1.0",
    dnaRevision: 1,
    prompt: "prompt",
    promptCompilerVersion: "5",
    model: { provider: "codex", name: "imagegen", version: null },
    parameters: { count: 1, aspectRatio: "3:4", providerParameters: {} },
    outputAssetId: output.id,
    outputHash: output.hash,
    createdAt: 1
  };
}

function project(outputs: AssetRecord[]): ProjectRecord {
  return {
    id: "project-1",
    title: "作品",
    mode: "direct",
    referenceAssetIds: ["source-1"],
    outputAssetIds: outputs.map((item) => item.id),
    userInstruction: "",
    aspectRatio: "3:4",
    count: 1,
    provider: "codex",
    favorite: false,
    createdAt: 1,
    updatedAt: 1
  };
}

function qualityReport(itemId: string, checkedAt = 90): SetQualityReport {
  return {
    schemaVersion: "1.0.0",
    checkedAt,
    model: "visual-critic",
    summary: "当前输出已完成质量检查",
    checkedItemIds: [itemId],
    issues: [],
    suggestedRetryItemIds: []
  };
}

function creationSetSelectionFixture(input: {
  itemReport?: SetQualityReport;
  groupReport?: SetQualityReport;
  criticReportId?: string | null;
  criticCheckedAt?: number | null;
}) {
  const [selected, ...rest] = createCreationSetPlan("photography", 4);
  if (!selected) throw new Error("测试计划缺少第一项");
  const outputAssetId = "set-output-1";
  const generationEventId = "set-event-1";
  const taskId = "set-task-1";
  const checkedAt = input.criticCheckedAt ?? input.itemReport?.checkedAt ?? input.groupReport?.checkedAt ?? null;
  const selectedItem = {
    ...selected,
    status: "COMPLETED",
    taskId,
    generationEventId,
    outputAssetId,
    outputCandidates: [{
      outputAssetId,
      outputSha256: "e".repeat(64),
      byteLength: 2048,
      generationEventId,
      taskId,
      createdAt: 80,
      source: "initial",
      issueType: null
    }],
    selectedOutputAssetId: outputAssetId,
    qualityStatus: "passed",
    qualityMessage: null,
    ...(input.itemReport ? { qualityReport: input.itemReport } : {}),
    finalSelection: {
      assetId: outputAssetId,
      outputSha256: "e".repeat(64),
      byteLength: 2048,
      generationEventId,
      criticDisposition: "checked",
      criticReportId: input.criticReportId ?? null,
      criticCheckedAt: checkedAt,
      selectedAt: 100
    }
  };
  return {
    schemaVersion: "1.0.0",
    id: "set-final-selection",
    projectId: "project-1",
    title: "最终选择证据",
    domainProfile: createMigrationDomainProfile(),
    requestedCount: 4,
    userIntent: "验证最终选择",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    sharedInvariants: [],
    allowedVariations: [],
    status: "PARTIAL",
    completedCount: 1,
    failedCount: 0,
    createdAt: 1,
    updatedAt: 100,
    qualityReport: input.groupReport ?? null,
    planItems: [selectedItem, ...rest]
  };
}

describe("Final Selection 字节绑定", () => {
  it("没有人工 Final Selection 时不把最后一个候选冒充最终作品", async () => {
    const first = await asset("first", "first");
    const second = await asset("second", "second");
    expect(resolveProjectFinalAsset(project([first, second]), [first, second])).toBeUndefined();
  });

  it("导出对象始终解析为用户最终选择，而不是当前分页", async () => {
    const first = await asset("first", "first");
    const second = await asset("second", "second");
    const selection = createProjectFinalSelection(first, event(first), undefined, undefined, 10);
    const record = { ...project([first, second]), finalSelection: selection };
    expect(resolveProjectFinalAsset(record, [first, second])?.id).toBe("first");
  });

  it("记录 Critic checked 或显式 skipped 状态", async () => {
    const output = await asset("checked", "checked");
    const report = {
      schemaVersion: "1.0.0",
      checkedAt: 9,
      model: "critic",
      summary: "通过",
      checkedItemIds: [output.id],
      issues: [],
      suggestedRetryItemIds: []
    } satisfies SetQualityReport;
    expect(createProjectFinalSelection(output, event(output), report, output.id, 10).criticDisposition).toBe("checked");
    expect(createProjectFinalSelection(output, event(output), undefined, undefined, 10).criticDisposition).toBe("skipped");
  });

  it("导出前拒绝被替换的 Blob", async () => {
    const output = await asset("final", "original");
    const selection = createProjectFinalSelection(output, event(output), undefined, undefined, 10);
    const replaced = { ...output, blob: new Blob(["replaced"], { type: "image/png" }) };
    await expect(verifyProjectFinalAsset(replaced, selection)).rejects.toThrow("校验失败");
  });

  it("CreationSet 的 checked 最终选择必须同时带 Critic 报告编号和检查时间", () => {
    const withoutEvidenceFields = creationSetSelectionFixture({
      criticReportId: null,
      criticCheckedAt: null
    });
    expect(creationSetSchema.safeParse(withoutEvidenceFields).success).toBe(false);
  });

  it("CreationSet 的 checked 最终选择不能只写报告编号，必须存在对应逐格或整组报告", () => {
    const withoutReport = creationSetSelectionFixture({
      criticReportId: "set-final-selection:90",
      criticCheckedAt: 90
    });
    expect(creationSetSchema.safeParse(withoutReport).success).toBe(false);
  });

  it("CreationSet 持久化当前输出的逐格报告后才允许标记 checked", () => {
    const itemId = createCreationSetPlan("photography", 4)[0]!.id;
    const report = qualityReport(itemId);
    const parsed = creationSetSchema.safeParse(creationSetSelectionFixture({
      itemReport: report,
      criticReportId: "set-final-selection:90",
      criticCheckedAt: 90
    }));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.planItems[0]).toMatchObject({ qualityReport: report });
  });

  it("整组报告覆盖当前格时也允许把该输出标记 checked", () => {
    const itemId = createCreationSetPlan("photography", 4)[0]!.id;
    const report = qualityReport(itemId);
    expect(creationSetSchema.safeParse(creationSetSelectionFixture({
      groupReport: report,
      criticReportId: "set-final-selection:90",
      criticCheckedAt: 90
    })).success).toBe(true);
  });

  it("checked 记录必须绑定覆盖当前格且检查时间一致的报告", () => {
    const secondItemId = createCreationSetPlan("photography", 4)[1]!.id;
    const staleReport = qualityReport(secondItemId, 91);
    expect(creationSetSchema.safeParse(creationSetSelectionFixture({
      groupReport: staleReport,
      criticReportId: "set-final-selection:90",
      criticCheckedAt: 90
    })).success).toBe(false);
  });

  it("checked 记录必须绑定当前套图及检查时间推导出的精确报告 ID", () => {
    const itemId = createCreationSetPlan("photography", 4)[0]!.id;
    const report = qualityReport(itemId);
    expect(creationSetSchema.safeParse(creationSetSelectionFixture({
      itemReport: report,
      criticReportId: "其他套图:90",
      criticCheckedAt: 90
    })).success).toBe(false);
  });
});
