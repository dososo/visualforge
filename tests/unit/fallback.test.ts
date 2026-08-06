import { describe, expect, it, vi } from "vitest";
import {
  CAPTURE_FALLBACK_MESSAGE,
  captureWithFallback
} from "../../apps/extension/lib/capture";

describe("网页图片捕获降级", () => {
  it("优先使用 direct image source", async () => {
    const domCanvas = vi.fn();
    const visibleScreenshot = vi.fn();
    const result = await captureWithFallback({
      direct: async () => "direct-data",
      domCanvas,
      visibleScreenshot
    });
    expect(result).toEqual({ value: "direct-data", method: "direct", fallbackMessage: null });
    expect(domCanvas).not.toHaveBeenCalled();
  });

  it("direct 失败后使用 DOM/canvas 并返回用户提示", async () => {
    const calls: string[] = [];
    const result = await captureWithFallback({
      direct: async () => { calls.push("direct"); throw new Error("CORS"); },
      domCanvas: async () => { calls.push("dom"); return "canvas-data"; },
      visibleScreenshot: async () => { calls.push("screenshot"); return "screenshot-data"; }
    });
    expect(calls).toEqual(["direct", "dom"]);
    expect(result).toEqual({
      value: "canvas-data",
      method: "dom-canvas",
      fallbackMessage: CAPTURE_FALLBACK_MESSAGE
    });
  });

  it("前两种方式失败后使用可见截图", async () => {
    const result = await captureWithFallback({
      direct: async () => Promise.reject(new Error("direct failed")),
      domCanvas: async () => Promise.reject(new Error("canvas tainted")),
      visibleScreenshot: async () => "screenshot-data"
    });
    expect(result.method).toBe("visible-screenshot");
    expect(result.fallbackMessage).toBe(CAPTURE_FALLBACK_MESSAGE);
  });

  it("全部失败时不泄露技术错误", async () => {
    await expect(captureWithFallback({
      direct: async () => Promise.reject(new Error("403 Forbidden")),
      domCanvas: async () => Promise.reject(new Error("SecurityError: Tainted canvas")),
      visibleScreenshot: async () => Promise.reject(new Error("captureVisibleTab failed"))
    })).rejects.toThrow("暂时无法捕获这张图片，请使用“框选截图”。");
  });
});
