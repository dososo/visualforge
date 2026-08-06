import { describe, expect, it } from "vitest";
import type { CreationSet, SetQualityIssue } from "@styleforge/contracts";
import {
  createCreationSetPlan,
  createMigrationDomainProfile,
  overrideDomainProfile,
  prepareCreationSetItemRetry,
  prepareTargetedRetry
} from "@styleforge/core";
import { creationSetSchema } from "@styleforge/contracts";
import { runCreationSet } from "../../apps/extension/lib/creation-set-runner";
import { dna } from "./contracts.test";

function fixture(): CreationSet {
  const planItems = createCreationSetPlan("portrait", 4).map((item, index) => ({
    ...item,
    status: "COMPLETED" as const,
    taskId: `task-${index + 1}`,
    generationEventId: `event-${index + 1}`,
    outputAssetId: `output-${index + 1}`,
    outputCandidates: [{
      outputAssetId: `output-${index + 1}`,
      generationEventId: `event-${index + 1}`,
      taskId: `task-${index + 1}`,
      createdAt: 10,
      source: "initial" as const,
      issueType: null
    }],
    selectedOutputAssetId: `output-${index + 1}`
  }));
  return {
    schemaVersion: "1.0.0",
    id: "targeted-retry",
    projectId: "project-1",
    title: "人物写真",
    domainProfile: overrideDomainProfile(createMigrationDomainProfile(), "portrait"),
    requestedCount: 4,
    userIntent: "同一人物完成四张写真",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    transformationBlueprintSnapshot: null,
    sharedInvariants: ["保持人物身份"],
    allowedVariations: ["镜头"],
    status: "COMPLETED",
    completedCount: 4,
    failedCount: 0,
    createdAt: 1,
    updatedAt: 10,
    qualityReport: {
      schemaVersion: "1.0.0",
      checkedAt: 20,
      model: "critic",
      summary: "第三张情绪不足",
      checkedItemIds: planItems.map((item) => item.id),
      issues: [],
      suggestedRetryItemIds: [planItems[2]!.id]
    },
    planItems
  };
}

describe("Visual Critic 定向重试与最终选择", () => {
  function withCheckedFinalSelection(original: CreationSet, index = 2) {
    const item = original.planItems[index]!;
    const checkedAt = original.qualityReport!.checkedAt;
    original.planItems[index] = {
      ...item,
      outputCandidates: item.outputCandidates.map((candidate) => ({
        ...candidate,
        outputSha256: "f".repeat(64),
        byteLength: 42
      })),
      qualityStatus: "passed",
      qualityReport: original.qualityReport,
      finalSelection: {
        assetId: item.outputAssetId!,
        outputSha256: "f".repeat(64),
        byteLength: 42,
        generationEventId: item.generationEventId!,
        criticDisposition: "checked",
        criticReportId: `${original.id}:${checkedAt}`,
        criticCheckedAt: checkedAt,
        selectedAt: 25
      }
    };
    return original;
  }

  it("按用户点击的精确问题调度，不改写稳定镜头计划并保留原图候选", () => {
    const original = fixture();
    const target = original.planItems[2]!;
    const issue: SetQualityIssue = {
      type: "emotion_flat",
      dimension: "emotion_arc",
      severity: "warning",
      itemIds: [target.id],
      message: "情绪没有形成高潮",
      impact: "整组缺少情绪推进。",
      retryFocus: "强化眼神和微表情。",
      preserve: ["人物身份", "服装", "原始光线"],
      suggestion: "只增强眼神与微表情"
    };
    const prepared = prepareTargetedRetry(original, target.id, issue, 30);
    const retried = prepared.planItems[2]!;
    expect(prepared.qualityReport).toBeNull();
    expect(retried.promptDelta).toBe(target.promptDelta);
    expect(retried.retryDirective).toMatchObject({
      issueType: "emotion_flat",
      dimension: "emotion_arc",
      impact: "整组缺少情绪推进。",
      retryFocus: "强化眼神和微表情。",
      preserve: ["人物身份", "服装", "原始光线"],
      sourceOutputAssetId: "output-3",
      sourceGenerationEventId: "event-3"
    });
    expect(retried.outputCandidates.map((candidate) => candidate.outputAssetId)).toEqual(["output-3"]);
    expect(retried.selectedOutputAssetId).toBe("output-3");
    expect(retried.outputAssetId).toBeNull();
    expect(prepared.planItems[0]).toEqual(original.planItems[0]);
  });

  it("重试成功后追加候选但保留用户原选择，等待明确 Final Selection", async () => {
    const original = fixture();
    const target = original.planItems[2]!;
    const issue: SetQualityIssue = {
      type: "emotion_flat",
      severity: "warning",
      itemIds: [target.id],
      message: "情绪不足",
      suggestion: "加强眼神"
    };
    const prepared = prepareTargetedRetry(original, target.id, issue, 30);
    const completed = await runCreationSet(prepared, {
      save: async () => undefined,
      cancelled: () => false,
      now: () => 40,
      execute: async () => ({
        taskId: "retry-task-3",
        generationEventId: "retry-event-3",
        outputAssetId: "retry-output-3",
        finalPrompt: "基础镜头计划 + 一次定向修复"
      })
    });
    const retried = completed.planItems[2]!;
    expect(retried.outputCandidates.map((candidate) => candidate.outputAssetId))
      .toEqual(["output-3", "retry-output-3"]);
    expect(retried.outputCandidates[1]).toMatchObject({
      source: "targeted_retry",
      issueType: "emotion_flat"
    });
    expect(retried.selectedOutputAssetId).toBe("output-3");
    expect(retried.promptDelta).toBe(target.promptDelta);
  });

  it("定向重试保留人工候选但撤销已失效的 checked 证据，结果仍通过 Schema", () => {
    const original = withCheckedFinalSelection(fixture());
    const target = original.planItems[2]!;
    const prepared = prepareTargetedRetry(original, target.id, {
      type: "emotion_flat",
      severity: "warning",
      itemIds: [target.id],
      message: "情绪不足",
      suggestion: "加强眼神"
    }, 30);

    expect(creationSetSchema.safeParse(prepared).success).toBe(true);
    expect(prepared.planItems[2]).toMatchObject({
      selectedOutputAssetId: target.outputAssetId,
      finalSelection: {
        assetId: target.outputAssetId,
        criticDisposition: "skipped",
        criticReportId: null,
        criticCheckedAt: null
      }
    });
  });

  it("普通重试也使用同一安全状态转换，不保留失效的 checked 证据", () => {
    const original = withCheckedFinalSelection(fixture());
    const target = original.planItems[2]!;
    const prepared = prepareCreationSetItemRetry(original, target.id, 30);

    expect(creationSetSchema.safeParse(prepared).success).toBe(true);
    expect(prepared.planItems[2]?.finalSelection).toMatchObject({
      assetId: target.outputAssetId,
      criticDisposition: "skipped",
      criticReportId: null,
      criticCheckedAt: null
    });
  });
});
