import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { taskRecordSchema } from "@styleforge/contracts";
import * as db from "../../apps/extension/lib/db";
import visualDNAExample from "../../packages/contracts/examples/visual-dna-v1.example.json";

const task = taskRecordSchema.parse({
  schemaVersion: "1.0.0",
  taskId: "lifecycle-task",
  projectId: "lifecycle-project",
  retryOfTaskId: null,
  generationEventId: null,
  generationEventIds: [],
  operation: "GENERATION",
  status: "GENERATING",
  startedAt: 100,
  finishedAt: null,
  retryCount: 0,
  error: null,
  heartbeat: 110,
  input: {
    sourceAssetId: "source-task",
    visualDNA: visualDNAExample,
    prompt: "保留的实际 Prompt",
    parameters: {
      aspectRatio: "4:3",
      count: 1,
      userInstruction: "商品摄影",
      providerParameters: {}
    },
    parentGenerationId: null
  }
});

describe("TaskRecord IndexedDB", () => {
  it("任务心跳虽旧但跨窗口生成锁仍被持有时不得误判中断", async () => {
    const active = {
      ...task,
      taskId: `stale-but-locked-${crypto.randomUUID()}`,
      projectId: `stale-but-locked-project-${crypto.randomUUID()}`,
      heartbeat: 1
    };
    await db.saveTaskRecord(active);
    try {
      const recovered = await db.recoverInterruptedTaskRecords(new Set([
        `visualforge:project:${active.projectId}`
      ]));
      expect(recovered.map((item) => item.taskId)).not.toContain(active.taskId);
      expect((await db.getTaskRecord(active.taskId))?.status).toBe("GENERATING");
    } finally {
      await db.deleteTaskRecord(active.taskId);
    }
  });

  it("另一个窗口恢复时不打断刚更新心跳的任务", async () => {
    const fresh = {
      ...task,
      taskId: "fresh-task-from-another-window",
      heartbeat: Date.now()
    };
    await db.saveTaskRecord(fresh);
    try {
      const recovered = await db.recoverInterruptedTaskRecords(new Set([
        `visualforge:project:${fresh.projectId}`
      ]));
      expect(recovered.map((item) => item.taskId)).not.toContain(fresh.taskId);
      expect((await db.getTaskRecord(fresh.taskId))?.status).toBe("GENERATING");
    } finally {
      await db.deleteTaskRecord(fresh.taskId);
    }
  });

  it("没有任何窗口持有生成租约时立即恢复新鲜的假活任务", async () => {
    const abandoned = {
      ...task,
      taskId: `abandoned-${crypto.randomUUID()}`,
      projectId: `abandoned-project-${crypto.randomUUID()}`,
      heartbeat: Date.now()
    };
    await db.saveTaskRecord(abandoned);
    try {
      const recovered = await db.recoverInterruptedTaskRecords(new Set());
      expect(recovered.map((item) => item.taskId)).toContain(abandoned.taskId);
      expect((await db.getTaskRecord(abandoned.taskId))?.status).toBe("INTERRUPTED");
    } finally {
      await db.deleteTaskRecord(abandoned.taskId);
    }
  });

  it("长任务可只刷新持久心跳而不改变当前状态", async () => {
    const active = { ...task, taskId: "heartbeat-task", heartbeat: 100 };
    await db.saveTaskRecord(active);
    try {
      await expect(db.refreshTaskHeartbeat(active.taskId, 500)).resolves.toBe(true);
      expect(await db.getTaskRecord(active.taskId)).toMatchObject({
        status: "GENERATING",
        heartbeat: 500
      });
    } finally {
      await db.deleteTaskRecord(active.taskId);
    }
  });

  it("保存、恢复和删除任务且不删除资产", async () => {
    const save = (db as Record<string, unknown>).saveTaskRecord;
    const get = (db as Record<string, unknown>).getTaskRecord;
    const recover = (db as Record<string, unknown>).recoverInterruptedTaskRecords;
    const remove = (db as Record<string, unknown>).deleteTaskRecord;
    expect(save).toBeTypeOf("function");
    expect(get).toBeTypeOf("function");
    expect(recover).toBeTypeOf("function");
    expect(remove).toBeTypeOf("function");
    if ([save, get, recover, remove].some((item) => typeof item !== "function")) return;

    await save(task);
    expect(await get(task.taskId)).toEqual(task);
    const interrupted = await recover();
    expect(interrupted.find((item: { taskId: string }) => item.taskId === task.taskId)?.status).toBe("INTERRUPTED");
    await remove(task.taskId);
    expect(await get(task.taskId)).toBeUndefined();
  });

  it("旧中断任务已有后继重试时，不再重复提示用户继续", async () => {
    const interrupted = {
      ...task,
      taskId: "interrupted-parent",
      status: "INTERRUPTED" as const,
      error: { code: "INTERRUPTED", message: "任务中断", retryable: true }
    };
    const retried = {
      ...task,
      taskId: "completed-retry",
      retryOfTaskId: interrupted.taskId,
      status: "COMPLETED" as const,
      startedAt: 120,
      finishedAt: 140,
      heartbeat: 140
    };

    await db.saveTaskRecord(interrupted);
    await db.saveTaskRecord(retried);
    expect((await db.listInterruptedTaskRecords()).map((item) => item.taskId))
      .not.toContain(interrupted.taskId);
    await db.deleteTaskRecord(interrupted.taskId);
    await db.deleteTaskRecord(retried.taskId);
  });

  it("同时恢复失败和中断任务，并排除已经有后继重试的旧记录", async () => {
    const listRetryable = (db as Record<string, unknown>).listRetryableTaskRecords;
    expect(listRetryable).toBeTypeOf("function");
    if (typeof listRetryable !== "function") return;

    const failed = {
      ...task,
      taskId: "failed-retryable",
      status: "FAILED" as const,
      error: { code: "GENERATION_FAILED", message: "生成超时", retryable: true }
    };
    const interrupted = {
      ...task,
      taskId: "interrupted-retryable",
      status: "INTERRUPTED" as const,
      heartbeat: 130,
      error: { code: "INTERRUPTED", message: "应用关闭", retryable: true }
    };
    await db.saveTaskRecord(failed);
    await db.saveTaskRecord(interrupted);

    const records = await (listRetryable as () => Promise<typeof task[]>)();
    expect(records.map((item) => item.taskId)).toEqual([
      interrupted.taskId,
      failed.taskId
    ]);

    await db.deleteTaskRecord(failed.taskId);
    await db.deleteTaskRecord(interrupted.taskId);
  });
});
