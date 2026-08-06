import { describe, expect, it } from "vitest";
import type { CreationSet, SetQualityReport } from "@styleforge/contracts";
import { createCreationSetPlan, createMigrationDomainProfile } from "@styleforge/core";
import { runCreationSet } from "../../apps/extension/lib/creation-set-runner";
import * as runner from "../../apps/extension/lib/creation-set-runner";
import { dna } from "./contracts.test";

function fixture(): CreationSet {
  return {
    schemaVersion: "1.0.0",
    id: "set-runner",
    projectId: "project-runner",
    title: "运行测试",
    domainProfile: createMigrationDomainProfile(),
    requestedCount: 4,
    userIntent: "形成一组",
    sharedVisualDNARevision: 3,
    sharedVisualDNASnapshot: { ...dna, revision: 3 },
    sharedReferenceSnapshots: [{
      assetId: "original-reference",
      hash: "a".repeat(64),
      mimeType: "image/png",
      role: "style",
      subjectAsset: null
    }],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    sharedInvariants: ["核心风格"],
    allowedVariations: ["机位"],
    status: "READY",
    completedCount: 0,
    failedCount: 0,
    createdAt: 1,
    updatedAt: 1,
    qualityReport: null,
    planItems: createCreationSetPlan("photography", 4)
  };
}

describe("CreationSet 顺序 Runner", () => {
  it("合并生成进度时不覆盖另一窗口的逐格编辑与人工最终选择", () => {
    const mergeCreationSetProgress = (runner as Record<string, unknown>).mergeCreationSetProgress;
    expect(mergeCreationSetProgress).toBeTypeOf("function");
    if (typeof mergeCreationSetProgress !== "function") return;
    const latest = fixture();
    const candidate = {
      outputAssetId: "kept-output",
      outputSha256: "e".repeat(64),
      byteLength: 22,
      generationEventId: "kept-event",
      taskId: "kept-task",
      createdAt: 9,
      source: "initial" as const,
      issueType: null
    };
    latest.title = "用户刚改的标题";
    latest.userIntent = "用户刚改的叙事";
    latest.planItems[0] = {
      ...latest.planItems[0]!,
      promptDelta: "用户刚改的单格提示词",
      composition: "用户确认的构图",
      outputCandidates: [candidate],
      selectedOutputAssetId: candidate.outputAssetId,
      finalSelection: {
        assetId: candidate.outputAssetId,
        outputSha256: candidate.outputSha256,
        byteLength: candidate.byteLength,
        generationEventId: candidate.generationEventId,
        criticDisposition: "skipped",
        criticReportId: null,
        criticCheckedAt: null,
        selectedAt: 9
      }
    };
    const incoming = fixture();
    incoming.planItems[0] = {
      ...incoming.planItems[0]!,
      status: "COMPLETED",
      taskId: "fresh-task",
      generationEventId: "fresh-event",
      outputAssetId: "fresh-output",
      outputCandidates: [{ ...candidate, outputAssetId: "fresh-output", generationEventId: "fresh-event" }]
    };
    incoming.completedCount = 1;
    incoming.status = "PARTIAL";

    const merged = (mergeCreationSetProgress as (
      latestSet: CreationSet,
      incomingSet: CreationSet
    ) => CreationSet)(latest, incoming);
    expect(merged).toMatchObject({ title: latest.title, userIntent: latest.userIntent });
    expect(merged.planItems[0]).toMatchObject({
      status: "COMPLETED",
      outputAssetId: "fresh-output",
      promptDelta: "用户刚改的单格提示词",
      composition: "用户确认的构图",
      selectedOutputAssetId: candidate.outputAssetId,
      finalSelection: { assetId: candidate.outputAssetId }
    });
    expect(merged.planItems[0]?.outputCandidates.map((entry) => entry.outputAssetId))
      .toEqual(expect.arrayContaining([candidate.outputAssetId, "fresh-output"]));
  });

  it("每项重新使用相同原始锚点，禁止把前序输出作为参考", async () => {
    const references: string[][] = [];
    const revisions: number[] = [];
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (set, item) => {
        references.push(set.sharedReferenceSnapshots.map((reference) => reference.assetId));
        revisions.push(set.sharedVisualDNARevision);
        return {
          taskId: `task-${item.order}`,
          generationEventId: `event-${item.order}`,
          outputAssetId: `output-${item.order}`,
          finalPrompt: `prompt-${item.order}`
        };
      }
    });
    expect(references).toEqual(Array.from({ length: 4 }, () => ["original-reference"]));
    expect(revisions).toEqual([3, 3, 3, 3]);
    expect(references.flat()).not.toContain("output-1");
    expect(result.status).toBe("COMPLETED");
  });

  it("单项失败后继续其他项并形成部分成功", async () => {
    const executed: number[] = [];
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (_set, item) => {
        executed.push(item.order);
        if (item.order === 2) throw new Error("第二项失败");
        return {
          taskId: `task-${item.order}`,
          generationEventId: `event-${item.order}`,
          outputAssetId: `output-${item.order}`,
          finalPrompt: `prompt-${item.order}`
        };
      }
    });
    expect(executed).toEqual([1, 2, 3, 4]);
    expect(result.completedCount).toBe(3);
    expect(result.failedCount).toBe(1);
    expect(result.status).toBe("PARTIAL");
  });

  it("单项超时后保留已完成作品，并给出只重试当前项的用户提示", async () => {
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (_set, item) => {
        if (item.order === 4) throw new Error("Codex 图像生成响应超时");
        return {
          taskId: `task-${item.order}`,
          generationEventId: `event-${item.order}`,
          outputAssetId: `output-${item.order}`,
          finalPrompt: `prompt-${item.order}`
        };
      }
    });

    expect(result.completedCount).toBe(3);
    expect(result.planItems[3]?.error?.message).toBe(
      "这张作品等待时间过长，已停止生成。前三张作品不受影响，点击“重试”只会重新生成这一张。"
    );
  });

  it("取消后保留完成项并不再启动等待项", async () => {
    let cancelled = false;
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => cancelled,
      execute: async (_set, item) => {
        cancelled = true;
        return {
          taskId: `task-${item.order}`,
          generationEventId: `event-${item.order}`,
          outputAssetId: `output-${item.order}`,
          finalPrompt: `prompt-${item.order}`
        };
      }
    });
    expect(result.completedCount).toBe(1);
    expect(result.planItems.slice(1).every((item) => item.status === "CANCELLED")).toBe(true);
  });

  it("质量检查发现问题时只保留建议，不自动重生也不把有效输出标成失败", async () => {
    let attempts = 0;
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (_set, item) => {
        if (item.order === 1) attempts += 1;
        return {
          taskId: `task-${item.order}-${attempts}`,
          generationEventId: `event-${item.order}-${attempts}`,
          outputAssetId: `output-${item.order}-${attempts}`,
          outputSha256: "a".repeat(64),
          byteLength: 10,
          finalPrompt: `prompt-${item.order}`
        };
      },
      qualityCheck: async (_set, item) => item.order === 1 ? {
        passed: false,
        issue: {
          type: "structural_error",
          severity: "warning",
          itemIds: [item.id],
          message: "双腿和地面接触无法解释",
          suggestion: "只修复当前画面的身体结构"
        }
      } : { passed: true }
    });

    expect(attempts).toBe(1);
    expect(result.planItems[0]).toMatchObject({
      status: "COMPLETED",
      selectedOutputAssetId: null,
      qualityStatus: "needs_repair",
      error: null
    });
    expect(result.planItems[0]?.outputCandidates).toHaveLength(1);
    expect(result.planItems[0]?.finalSelection).toBeFalsy();
    expect(result.completedCount).toBe(4);
    expect(result.failedCount).toBe(0);
    expect(result.status).toBe("COMPLETED");
  });

  it("质量建议不会创建新的 Task，也不会覆盖首次成功输出", async () => {
    const firstItemId = fixture().planItems[0]!.id;
    const observedTaskIds: Array<string | null> = [];
    const allocated = ["initial-task-id", "unused-retry-task-id"];
    let qualityChecks = 0;
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      createTaskId: () => allocated.shift() ?? crypto.randomUUID(),
      execute: async (_set, item) => {
        if (item.id !== firstItemId) return {
          taskId: item.taskId!,
          generationEventId: `event-${item.order}`,
          outputAssetId: `output-${item.order}`,
          outputSha256: "b".repeat(64),
          byteLength: 10,
          finalPrompt: "后续画面"
        };
        observedTaskIds.push(item.taskId);
        return {
          taskId: item.taskId!,
          generationEventId: "initial-event",
          outputAssetId: "initial-output",
          outputSha256: "a".repeat(64),
          byteLength: 10,
          finalPrompt: "首次画面"
        };
      },
      qualityCheck: async (_set, item) => {
        if (item.id !== firstItemId || qualityChecks++ > 0) return { passed: true };
        return {
          passed: false,
          issue: {
            type: "structural_error",
            severity: "warning",
            itemIds: [item.id],
            message: "肢体结构异常",
            suggestion: "仅修复当前画面"
          }
        };
      }
    });

    expect(observedTaskIds).toEqual(["initial-task-id"]);
    expect(result.planItems[0]).toMatchObject({
      status: "COMPLETED",
      taskId: "initial-task-id",
      retryOfTaskId: null,
      outputAssetId: "initial-output",
      qualityStatus: "needs_repair"
    });
  });

  it("生成异常不会把本机路径、异常类型或敏感细节展示给用户", async () => {
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async () => {
        throw new Error("TypeError: fetch failed at /Users/alice/private-token");
      }
    });
    const message = result.planItems[0]?.error?.message ?? "";
    expect(message).toContain("重试");
    expect(message).not.toContain("TypeError");
    expect(message).not.toContain("/Users/");
    expect(message).not.toContain("private-token");
  });

  it("Critic 执行期间取消会保留已生成候选且不启动定向重试", async () => {
    let cancelled = false;
    let executions = 0;
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => cancelled,
      execute: async (_set, item) => {
        executions += 1;
        return {
          taskId: `task-${item.order}`,
          generationEventId: `event-${item.order}`,
          outputAssetId: `output-${item.order}`,
          outputSha256: "b".repeat(64),
          byteLength: 20,
          finalPrompt: `prompt-${item.order}`
        };
      },
      qualityCheck: async (_set, item) => {
        cancelled = true;
        return {
          passed: false,
          issue: {
            type: "identity_drift",
            severity: "warning",
            itemIds: [item.id],
            message: "身份漂移",
            suggestion: "修复身份"
          }
        };
      }
    });

    expect(executions).toBe(1);
    expect(result.planItems[0]?.outputCandidates).toHaveLength(1);
    expect(result.planItems.slice(1).every((item) => item.status === "CANCELLED")).toBe(true);
  });

  it("Critic 抛错时保留已生成候选，但持久标记质检不可用且不代替用户选图", async () => {
    const qualityErrors: string[] = [];
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (_set, item) => ({
        taskId: `task-${item.order}`,
        generationEventId: `event-${item.order}`,
        outputAssetId: `output-${item.order}`,
        outputSha256: "c".repeat(64),
        byteLength: 30,
        finalPrompt: `prompt-${item.order}`
      }),
      qualityCheck: async () => { throw new Error("Critic 暂时不可用"); },
      onQualityCheckError: (_item, error) => qualityErrors.push(error.message)
    });

    expect(result.planItems.every((item) => item.status === "COMPLETED")).toBe(true);
    expect(result.planItems.every((item) => item.outputCandidates.length === 1)).toBe(true);
    expect(result.planItems.every((item) => item.outputAssetId?.startsWith("output-"))).toBe(true);
    expect(result.planItems.every((item) => item.qualityStatus === "unavailable")).toBe(true);
    expect(result.planItems.every((item) => item.selectedOutputAssetId === null)).toBe(true);
    expect(result.planItems.every((item) => item.error?.code === "QUALITY_CHECK_UNAVAILABLE")).toBe(true);
    expect(qualityErrors).toEqual(Array.from({ length: 4 }, () => "Critic 暂时不可用"));
  });

  it("自动质检通过只产生候选，不替用户确认 Final Selection", async () => {
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (_set, item) => ({
        taskId: `task-${item.order}`,
        generationEventId: `event-${item.order}`,
        outputAssetId: `output-${item.order}`,
        outputSha256: "d".repeat(64),
        byteLength: 40,
        finalPrompt: `prompt-${item.order}`
      }),
      qualityCheck: async () => ({ passed: true })
    });

    expect(result.planItems.every((item) => item.status === "COMPLETED")).toBe(true);
    expect(result.planItems.every((item) => item.qualityStatus === "passed")).toBe(true);
    expect(result.planItems.every((item) => item.selectedOutputAssetId === null)).toBe(true);
    expect(result.planItems.every((item) => item.finalSelection == null)).toBe(true);
  });

  it("逐格 Critic 报告随当前输出持久化，供之后的 Final Selection 使用", async () => {
    const reports = new Map<string, SetQualityReport>();
    const result = await runCreationSet(fixture(), {
      save: async () => undefined,
      cancelled: () => false,
      execute: async (_set, item) => ({
        taskId: `task-${item.order}`,
        generationEventId: `event-${item.order}`,
        outputAssetId: `output-${item.order}`,
        outputSha256: "f".repeat(64),
        byteLength: 50,
        finalPrompt: `prompt-${item.order}`
      }),
      qualityCheck: async (_set, item) => {
        const report = {
          schemaVersion: "1.0.0",
          checkedAt: 100 + item.order,
          model: "visual-critic",
          summary: `${item.id} 已检查`,
          checkedItemIds: [item.id],
          issues: [],
          suggestedRetryItemIds: []
        } satisfies SetQualityReport;
        reports.set(item.id, report);
        return { passed: true, report };
      }
    });

    for (const item of result.planItems) {
      expect(item).toMatchObject({
        outputAssetId: `output-${item.order}`,
        qualityStatus: "passed",
        qualityReport: reports.get(item.id)
      });
    }
  });
});
