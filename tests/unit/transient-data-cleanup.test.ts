import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as capture from "../../apps/extension/lib/capture";
import * as db from "../../apps/extension/lib/db";

const backgroundSource = readFileSync(
  new URL("../../apps/extension/entrypoints/background.ts", import.meta.url),
  "utf8"
);

describe("浏览器瞬态数据删除", () => {
  it("右键目标被消费时立即从内存和 storage.session 删除", async () => {
    const consume = (capture as Record<string, unknown>).consumeRightClickTarget;
    expect(consume).toBeTypeOf("function");
    if (typeof consume !== "function") return;
    const key = "visualForgeRightClickTarget:9:3";
    const target = { token: "target-b", capturedAt: 10_000 };
    const recent = new Map([[key, target]]);
    const stored: Record<string, unknown> = { [key]: target };

    const result = await consume({
      recent,
      sessionStorage: {
        get: async (name: string) => ({ [name]: stored[name] }),
        remove: async (name: string) => { delete stored[name]; }
      },
      tabId: 9,
      frameId: 3
    });

    expect(result).toEqual(target);
    expect(recent.size).toBe(0);
    expect(stored).toEqual({});
  });

  it("过期目标也在读取检查时立即删除，不继续保留 token", async () => {
    const consume = (capture as Record<string, unknown>).consumeRightClickTarget;
    expect(consume).toBeTypeOf("function");
    if (typeof consume !== "function") return;
    const key = "visualForgeRightClickTarget:2:0";
    const expired = { token: "expired", capturedAt: 1 };
    const recent = new Map<string, unknown>();
    const stored: Record<string, unknown> = { [key]: expired };

    const result = await consume({
      recent,
      sessionStorage: {
        get: async (name: string) => ({ [name]: stored[name] }),
        remove: async (name: string) => { delete stored[name]; }
      },
      tabId: 2,
      frameId: 0
    });

    expect(result).toEqual(expired);
    expect(stored).toEqual({});
  });

  it("后台响应隐私清理请求并清空 recentRightClickTargets", () => {
    expect(backgroundSource).toContain('message?.type === "privacy.clear-transient"');
    expect(backgroundSource).toContain("recentRightClickTargets.clear()");
    expect(backgroundSource).toContain("consumeRightClickTarget");
  });

  it("隐私清理先取消全部活动捕获，并清除活动表和待处理图片", () => {
    const handler = backgroundSource.slice(
      backgroundSource.indexOf('message?.type === "privacy.clear-transient"'),
      backgroundSource.indexOf('message?.type === "context-image.target"')
    );
    expect(handler).toContain("for (const requestId of activeHoverCaptureRequests)");
    expect(handler).toContain("cancelledHoverCaptureRequests.add(requestId)");
    expect(handler).toContain("controller.abort()");
    expect(handler).toContain("activeHoverCaptureRequests.clear()");
    expect(handler).toContain("activeHoverCaptureControllers.clear()");
    expect(handler).toContain("completedHoverCaptureRequests.clear()");
    expect(handler).toContain('chrome.storage.local.remove(["pendingWebImage", "pendingCapture"])');
    expect(backgroundSource).toContain("activeHoverCaptureControllers.get(requestId) === captureController");
    expect(backgroundSource).toContain("!cancelledHoverCaptureRequests.has(requestId)");
    expect(backgroundSource).not.toContain("cancelledHoverCaptureRequests.size > 100");
  });
});

describe("分层清理结果", () => {
  it("只有浏览器和 Host 都成功时才报告全部成功", () => {
    const summarize = (db as Record<string, unknown>).summarizeDataClearResult;
    expect(summarize).toBeTypeOf("function");
    if (typeof summarize !== "function") return;

    expect(summarize({ browser: "cleared", host: "cleared" })).toMatchObject({ complete: true });
    expect(summarize({ browser: "cleared", host: "failed" })).toMatchObject({
      complete: false,
      message: expect.stringContaining("本地连接数据未清空")
    });
    expect(summarize({ browser: "failed", host: "cleared" })).toMatchObject({
      complete: false,
      message: expect.stringContaining("浏览器数据未完全清空")
    });
    expect(summarize({ browser: "failed", host: "failed" })).toMatchObject({ complete: false });
  });
});
