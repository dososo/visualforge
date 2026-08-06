import { describe, expect, it, vi } from "vitest";
import { CodexClient } from "../../apps/native-host/src/codex-client";
import { cancelNativeTask } from "../../apps/extension/lib/native-client";

describe("Codex turn 真实取消", () => {
  it("Extension 没有活动任务时返回明确结果", async () => {
    await expect(cancelNativeTask("missing-task")).resolves.toEqual({
      cancelled: false,
      message: "当前没有可取消的任务"
    });
  });

  it("没有活动 turn 时返回明确结果", async () => {
    const client = new CodexClient() as CodexClient & {
      interruptActiveTurn?: () => Promise<{ cancelled: boolean; message?: string }>;
    };
    expect(client.interruptActiveTurn).toBeTypeOf("function");
    if (!client.interruptActiveTurn) return;
    await expect(client.interruptActiveTurn()).resolves.toEqual({
      cancelled: false,
      message: "当前没有可取消的 Codex turn"
    });
  });

  it("向当前 thread 和 turn 发送 turn/interrupt", async () => {
    const client = new CodexClient() as CodexClient & {
      interruptActiveTurn?: () => Promise<{ cancelled: boolean }>;
    };
    const calls: Array<{ method: string; params: unknown }> = [];
    let finishTurn: ((turn: Record<string, unknown>) => void) | undefined;
    client.call = vi.fn(async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      if (method === "turn/interrupt") return {};
      throw new Error(`未预期调用：${method}`);
    });
    client.waitForTurn = vi.fn(() => new Promise((resolve) => {
      finishTurn = resolve;
    }));

    const analysis = client.analyzeImage("/tmp/reference.png", "a".repeat(64));
    await vi.waitFor(() => expect(calls.some((call) => call.method === "turn/start")).toBe(true));

    expect(client.interruptActiveTurn).toBeTypeOf("function");
    if (!client.interruptActiveTurn) return;
    await expect(client.interruptActiveTurn()).resolves.toEqual({ cancelled: true });
    expect(calls.find((call) => call.method === "turn/interrupt")?.params).toEqual({
      threadId: "thread-1",
      turnId: "turn-1"
    });

    finishTurn?.({ id: "turn-1", status: "interrupted", error: null });
    await expect(analysis).rejects.toThrow(/未完成/);
  });
});
