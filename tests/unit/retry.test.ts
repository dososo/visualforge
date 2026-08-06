import { describe, expect, it } from "vitest";
import { createRetryTask } from "@styleforge/core";
import { taskRecordSchema } from "@styleforge/contracts";

describe("Retry", () => {
  it("保留原输入并创建新的任务身份，不覆盖历史任务", () => {
    const original = taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId: "original-task",
      projectId: "project",
      retryOfTaskId: null,
      generationEventId: "old-event",
      generationEventIds: ["old-event"],
      operation: "GENERATION",
      status: "FAILED",
      startedAt: 10,
      finishedAt: 20,
      retryCount: 0,
      error: { code: "FAILED", message: "失败", retryable: true },
      heartbeat: 20,
      input: {
        sourceAssetId: "source",
        visualDNA: null,
        prompt: "原始 Prompt",
        parameters: {
          aspectRatio: "4:3",
          count: 1,
          userInstruction: "原始要求",
          providerParameters: { seed: 7 }
        },
        parentGenerationId: "parent-event"
      }
    });

    const retry = createRetryTask(original, "retry-task", 30);
    expect(retry.taskId).not.toBe(original.taskId);
    expect(retry.input).toEqual(original.input);
    expect(retry.generationEventIds).toEqual([]);
    expect(original.generationEventIds).toEqual(["old-event"]);
  });
});
