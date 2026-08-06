import { describe, expect, it } from "vitest";
import { interruptStaleTask } from "@styleforge/core";
import * as core from "@styleforge/core";
import { taskRecordSchema } from "@styleforge/contracts";

describe("Recovery", () => {
  const staleAfterMs = 2 * 60 * 1000;

  it("统一使用 2 分钟心跳租约，崩溃后不会假活半小时", () => {
    expect((core as Record<string, unknown>).TASK_STALE_AFTER_MS).toBe(staleAfterMs);
  });

  it.each(["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"] as const)(
    "第二个窗口打开时保留仍有新鲜心跳的 %s 任务",
    (status) => {
      const task = taskRecordSchema.parse({
        schemaVersion: "1.0.0",
        taskId: `task-${status}`,
        projectId: "project",
        retryOfTaskId: null,
        generationEventId: null,
        generationEventIds: [],
        operation: "GENERATION",
        status,
        startedAt: status === "CREATED" ? null : 10,
        finishedAt: null,
        retryCount: 0,
        error: null,
        heartbeat: 11,
        input: {
          sourceAssetId: "source",
          visualDNA: null,
          prompt: "Prompt",
          parameters: null,
          parentGenerationId: null
        }
      });
      const recovered = interruptStaleTask(task, task.heartbeat + staleAfterMs - 1);
      expect(recovered).toBe(task);
      expect(recovered.status).toBe(status);
      expect(recovered.error).toBeNull();
      expect(recovered.finishedAt).toBeNull();
    }
  );

  it("只把超过心跳阈值的活动任务标记为 INTERRUPTED", () => {
    const task = taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId: "task-stale",
      projectId: "project",
      retryOfTaskId: null,
      generationEventId: null,
      generationEventIds: [],
      operation: "GENERATION",
      status: "GENERATING",
      startedAt: 10,
      finishedAt: null,
      retryCount: 0,
      error: null,
      heartbeat: 11,
      input: {
        sourceAssetId: "source",
        visualDNA: null,
        prompt: "Prompt",
        parameters: null,
        parentGenerationId: null
      }
    });
    const now = task.heartbeat + staleAfterMs + 1;
    const recovered = interruptStaleTask(task, now);
    expect(recovered.status).toBe("INTERRUPTED");
    expect(recovered.error?.code).toBe("INTERRUPTED");
    expect(recovered.finishedAt).toBe(now);
  });
});
