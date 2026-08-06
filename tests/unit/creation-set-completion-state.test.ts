import { describe, expect, it } from "vitest";
import type { CreationSet, CreationSetPlanItem } from "@styleforge/contracts";
import {
  createCreationSetPlan,
  createMigrationDomainProfile
} from "@styleforge/core";
import * as core from "@styleforge/core";
import * as setView from "../../apps/extension/entrypoints/sidepanel/CreationSetView";
import { dna } from "./contracts.test";

function fixture(): CreationSet {
  const planItems = createCreationSetPlan("portrait", 2).map((item, index) => ({
    ...item,
    status: index === 0 ? "FAILED" as const : "COMPLETED" as const,
    taskId: `task-${index + 1}`,
    generationEventId: `event-${index + 1}`,
    outputAssetId: `output-${index + 1}`,
    outputCandidates: [{
      outputAssetId: `output-${index + 1}`,
      outputSha256: "a".repeat(64),
      byteLength: 10,
      generationEventId: `event-${index + 1}`,
      taskId: `task-${index + 1}`,
      createdAt: 10,
      source: "initial" as const,
      issueType: null
    }],
    qualityStatus: index === 0 ? "needs_repair" as const : "passed" as const,
    qualityMessage: index === 0 ? "建议调整动作" : null,
    error: index === 0 ? {
      code: "NEEDS_REPAIR",
      message: "建议调整动作",
      retryable: true
    } : null
  }));
  return {
    schemaVersion: "1.0.0",
    id: "completion-state",
    projectId: "project-completion-state",
    title: "二宫格",
    domainProfile: createMigrationDomainProfile(),
    requestedCount: 2,
    userIntent: "保持参考画面",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    sharedInvariants: [],
    allowedVariations: [],
    status: "PARTIAL",
    completedCount: 1,
    failedCount: 1,
    createdAt: 1,
    updatedAt: 10,
    qualityReport: null,
    planItems
  };
}

describe("套图最终选择与宫格即时完成", () => {
  it("选定已有候选后原子纠正完成状态，同时保留质量建议", () => {
    const finalizeCreationSetOutput = (core as unknown as {
      finalizeCreationSetOutput?: (
        set: CreationSet,
        input: {
          itemId: string;
          outputAssetId: string;
          outputSha256: string;
          byteLength: number;
          criticDisposition: "checked" | "skipped";
          criticReportId: string | null;
          criticCheckedAt: number | null;
          selectedAt: number;
        },
        updatedAt: number
      ) => CreationSet;
    }).finalizeCreationSetOutput;
    expect(finalizeCreationSetOutput).toBeTypeOf("function");
    if (!finalizeCreationSetOutput) return;

    const original = fixture();
    const target = original.planItems[0]!;
    const completed = finalizeCreationSetOutput(original, {
      itemId: target.id,
      outputAssetId: target.outputAssetId!,
      outputSha256: "a".repeat(64),
      byteLength: 10,
      criticDisposition: "skipped",
      criticReportId: null,
      criticCheckedAt: null,
      selectedAt: 20
    }, 20);

    expect(completed).toMatchObject({
      status: "COMPLETED",
      completedCount: 2,
      failedCount: 0
    });
    expect(completed.planItems[0]).toMatchObject({
      status: "COMPLETED",
      qualityStatus: "needs_repair",
      qualityMessage: "建议调整动作",
      error: null,
      selectedOutputAssetId: "output-1",
      finalSelection: {
        assetId: "output-1",
        criticDisposition: "skipped"
      }
    });
  });

  it("宫格就绪只看每格是否有可用图片，不受滞后的完成计数阻塞", () => {
    const getGridCompositeProgress = (setView as unknown as {
      getGridCompositeProgress?: (
        items: CreationSetPlanItem[],
        availableAssetIds: ReadonlySet<string>
      ) => { readyCount: number; ready: boolean };
    }).getGridCompositeProgress;
    expect(getGridCompositeProgress).toBeTypeOf("function");
    if (!getGridCompositeProgress) return;

    const original = fixture();
    original.planItems[0] = {
      ...original.planItems[0]!,
      selectedOutputAssetId: "output-1"
    };
    expect(getGridCompositeProgress(
      original.planItems,
      new Set(["output-1", "output-2"])
    )).toEqual({ readyCount: 2, ready: true });
  });

  it("本地宫格合成失败时停止转圈并只提供重新合成", () => {
    const getGridCompositePresentation = (setView as unknown as {
      getGridCompositePresentation?: (input: {
        hasImage: boolean;
        error?: string;
        readyCount: number;
        requestedCount: number;
      }) => { busy: boolean; title: string; action: string | null };
    }).getGridCompositePresentation;
    expect(getGridCompositePresentation).toBeTypeOf("function");
    if (!getGridCompositePresentation) return;

    expect(getGridCompositePresentation({
      hasImage: false,
      error: "Canvas 暂不可用",
      readyCount: 2,
      requestedCount: 2
    })).toEqual({
      busy: false,
      title: "宫格合成暂不可用",
      action: "重新合成宫格"
    });
  });
});
