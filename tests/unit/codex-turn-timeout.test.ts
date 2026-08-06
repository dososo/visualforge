import { afterEach, describe, expect, test, vi } from "vitest";
import { CodexClient, GRID_ANALYSIS_TURN_TIMEOUT_MS } from "../../apps/native-host/src/codex-client";
import { GRID_ANALYSIS_CLIENT_TIMEOUT_MS } from "../../apps/extension/lib/native-client";

describe("Codex turn 超时清理", () => {
  afterEach(() => vi.useRealTimers());

  test("等待图像生成超时后先中断对应 turn，再返回可恢复错误", async () => {
    vi.useFakeTimers();
    const client = new CodexClient("/tmp/codex");
    const calls: Array<{ method: string; params: unknown }> = [];
    client.call = async (method: string, params: unknown) => {
      calls.push({ method, params });
      return {};
    };

    const waiting = client.waitForTurn(
      "turn-timeout",
      420_000,
      "图像生成",
      { threadId: "thread-timeout", turnId: "turn-timeout" }
    );
    const rejection = expect(waiting).rejects.toThrow("Codex 图像生成响应超时");
    await vi.advanceTimersByTimeAsync(420_000);
    await rejection;

    expect(calls).toEqual([{
      method: "turn/interrupt",
      params: { threadId: "thread-timeout", turnId: "turn-timeout" }
    }]);
  });

  test("逐格分析由 Host 在 75 秒发起中断，客户端保证 90 秒用户上限", () => {
    expect(GRID_ANALYSIS_TURN_TIMEOUT_MS).toBe(75_000);
    expect(GRID_ANALYSIS_CLIENT_TIMEOUT_MS).toBe(90_000);
    expect(GRID_ANALYSIS_CLIENT_TIMEOUT_MS).toBeGreaterThan(GRID_ANALYSIS_TURN_TIMEOUT_MS);
  });
});
