import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import * as core from "@styleforge/core";
import visualDNAExample from "../../packages/contracts/examples/visual-dna-v1.example.json";

const taskInput = {
  schemaVersion: "1.0.0",
  taskId: "task-1",
  projectId: "project-1",
  retryOfTaskId: null,
  generationEventId: null,
  generationEventIds: [],
  operation: "GENERATION",
  status: "CREATED",
  startedAt: null,
  finishedAt: null,
  retryCount: 0,
  error: null,
  heartbeat: 100,
  input: {
    sourceAssetId: "source-1",
    visualDNA: visualDNAExample,
    prompt: "实际 Prompt",
    parameters: {
      aspectRatio: "4:3",
      count: 1,
      userInstruction: "商品摄影",
      providerParameters: {}
    },
    parentGenerationId: null
  }
};

describe("Task Lifecycle", () => {
  it("校验统一 TaskRecord", () => {
    const schema = (contracts as Record<string, unknown>).taskRecordSchema as {
      parse: (input: unknown) => unknown;
      safeParse: (input: unknown) => { success: boolean };
    } | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;
    expect(schema.parse(taskInput)).toEqual(taskInput);
    expect(schema.safeParse({ ...taskInput, status: "rendering" }).success).toBe(false);
  });

  it("只允许状态机声明的转换并更新时间", () => {
    const transition = (core as Record<string, unknown>).transitionTask;
    expect(transition).toBeTypeOf("function");
    if (typeof transition !== "function") return;
    const uploading = transition(taskInput, "UPLOADING", 110);
    expect(uploading.status).toBe("UPLOADING");
    expect(uploading.startedAt).toBe(110);
    expect(uploading.heartbeat).toBe(110);
    expect(() => transition({ ...taskInput, status: "COMPLETED" }, "GENERATING", 120)).toThrow(/不允许/);
  });

  it("Retry 创建新任务并完整保留执行快照", () => {
    const retry = (core as Record<string, unknown>).createRetryTask;
    expect(retry).toBeTypeOf("function");
    if (typeof retry !== "function") return;
    const failed = {
      ...taskInput,
      status: "FAILED",
      finishedAt: 200,
      error: { code: "GENERATION_FAILED", message: "失败", retryable: true }
    };
    const next = retry(failed, "task-2", 300);
    expect(next.taskId).toBe("task-2");
    expect(next.retryOfTaskId).toBe("task-1");
    expect(next.retryCount).toBe(1);
    expect(next.status).toBe("RETRYING");
    expect(next.input).toEqual(taskInput.input);
    expect(next.generationEventId).toBeNull();
  });

  it("启动恢复只把心跳过期的活动任务标记为 INTERRUPTED", () => {
    const interrupt = (core as Record<string, unknown>).interruptStaleTask;
    expect(interrupt).toBeTypeOf("function");
    if (typeof interrupt !== "function") return;
    const active = { ...taskInput, status: "GENERATING", startedAt: 100 };
    expect(interrupt(active, 500)).toBe(active);
    const interrupted = interrupt(active, 30 * 60 * 1000 + 101);
    expect(interrupted.status).toBe("INTERRUPTED");
    expect(interrupted.finishedAt).toBe(30 * 60 * 1000 + 101);
    expect(interrupted.error.code).toBe("INTERRUPTED");
    expect(interrupt({ ...taskInput, status: "COMPLETED" }, 500).status).toBe("COMPLETED");
  });
});
