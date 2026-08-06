import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_CAPTURE_PIXEL_COUNT,
  MAX_CAPTURE_RESPONSE_BYTES,
  MAX_PENDING_CAPTURE_BYTES,
  assertCapturePixelCount,
  assertPendingCaptureSize,
  captureWithFallback,
  captureFallbackPolicy,
  isMatchingRightClickTarget,
  readBoundedImageResponse,
  rightClickTargetStorageKey
} from "../../apps/extension/lib/capture";
import * as captureModule from "../../apps/extension/lib/capture";

const backgroundSource = readFileSync(
  new URL("../../apps/extension/entrypoints/background.ts", import.meta.url),
  "utf8"
);
const hoverContentSource = readFileSync(
  new URL("../../apps/extension/entrypoints/hover.content.ts", import.meta.url),
  "utf8"
);

describe("右键图片实例绑定", () => {
  it("同一 URL 出现多次时，以右键目标的 token、frame 与 currentSrc 锁定实例", () => {
    const target = {
      tabId: 9,
      frameId: 3,
      token: "target-b",
      currentSrc: "https://cdn.example.com/shared.webp",
      sourceUrl: "https://cdn.example.com/shared.webp",
      rect: { x: 420, y: 180, width: 360, height: 480, dpr: 2 },
      viewport: { width: 900, height: 700 },
      capturedAt: 10_000
    };

    expect(rightClickTargetStorageKey(9, 3)).toBe("visualForgeRightClickTarget:9:3");
    expect(isMatchingRightClickTarget(target, {
      tabId: 9,
      frameId: 3,
      srcUrl: "https://cdn.example.com/shared.webp",
      now: 20_000
    })).toBe(true);
    expect(isMatchingRightClickTarget(target, {
      tabId: 9,
      frameId: 2,
      srcUrl: "https://cdn.example.com/shared.webp",
      now: 20_000
    })).toBe(false);
  });

  it("内容脚本在 contextmenu 时保存 token、currentSrc、rect 与 viewport，后台按 token 查找而非按面积排序", () => {
    expect(hoverContentSource).toContain('type: "context-image.target"');
    expect(hoverContentSource).toContain("visualforgeContextToken");
    expect(hoverContentSource).toContain("currentSrc:");
    expect(backgroundSource).toContain("rightClickTargetStorageKey");
    expect(backgroundSource).toContain("element.dataset.visualforgeContextToken === locator.token");
    expect(backgroundSource).toContain("if (!tokenElement) return null");
    expect(backgroundSource).not.toContain("images.find");
    expect(backgroundSource).not.toContain("sort((left, right) => right.clientWidth * right.clientHeight");
  });

  it("子 frame 只安装右键目标记录，不重复渲染网页悬浮工具条", () => {
    expect(hoverContentSource).toContain("installContextTargetCapture();");
    expect(hoverContentSource).toContain("if (window.top === window) installHoverCapture();");
  });

  it("悬浮捕获也携带实例 token、currentSrc，并由后台绑定 sender.frameId", () => {
    const hoverCapture = hoverContentSource.slice(hoverContentSource.indexOf('type: "hover.capture"'));
    expect(hoverCapture).toContain("targetToken,");
    expect(hoverCapture).toContain("currentSrc:");
    expect(backgroundSource).toContain("const frameId = sender.frameId ?? 0");
    expect(backgroundSource).toContain("frameId,");
    expect(backgroundSource).toContain("targetToken: message.targetToken");
  });

  it("重复 URL 且 direct 与 canvas 都失败时，没有实例 token 就禁止按 URL 猜图", () => {
    expect(captureFallbackPolicy({ targetToken: undefined, frameId: 0 })).toEqual({
      allowDomCanvas: false,
      allowVisibleScreenshot: false,
      recoveryMessage: "无法确认你选择的是哪张图片，请使用“框选区域”重新选择。"
    });
    expect(backgroundSource).not.toMatch(/images\.find\(\(candidate\) =>[\s\S]*?candidate\.currentSrc/);
  });

  it("offset iframe 在 direct 与 canvas 都失败时禁止用子 frame 坐标裁顶层截图", () => {
    expect(captureFallbackPolicy({ targetToken: "frame-target", frameId: 7 })).toEqual({
      allowDomCanvas: true,
      allowVisibleScreenshot: false,
      recoveryMessage: "这张图片位于嵌入页面中，无法安全自动裁切，请使用“框选区域”。"
    });
    expect(backgroundSource).toContain("fallbackPolicy.allowVisibleScreenshot");
  });
});

describe("浏览器侧图片捕获上限", () => {
  it("在 Content-Length 已超限时，不读取响应体", async () => {
    let readerRequested = false;
    const response = {
      headers: new Headers({
        "content-length": String(MAX_CAPTURE_RESPONSE_BYTES + 1),
        "content-type": "image/jpeg"
      }),
      body: {
        getReader() {
          readerRequested = true;
          throw new Error("不应读取响应体");
        }
      }
    } as unknown as Response;

    await expect(readBoundedImageResponse(response)).rejects.toThrow(/框选区域/);
    expect(readerRequested).toBe(false);
  });

  it("没有 Content-Length 时按流累计，并在超过响应上限时停止", async () => {
    const response = new Response(new Uint8Array(MAX_CAPTURE_RESPONSE_BYTES + 1), {
      headers: { "content-type": "image/png" }
    });

    await expect(readBoundedImageResponse(response)).rejects.toThrow(/框选区域/);
  });

  it("拒绝解码后像素数过大的图片", () => {
    expect(() => assertCapturePixelCount(10_000, 10_000)).toThrow(/像素/);
    expect(() => assertCapturePixelCount(6_000, 6_000)).not.toThrow();
    expect(MAX_CAPTURE_PIXEL_COUNT).toBe(36_000_000);
  });

  it("在写入 storage.local 前拒绝过大的 Data URL", () => {
    expect(() => assertPendingCaptureSize("a".repeat(MAX_PENDING_CAPTURE_BYTES + 1)))
      .toThrow(/未写入.*框选区域/);
    expect(() => assertPendingCaptureSize("a".repeat(MAX_PENDING_CAPTURE_BYTES))).not.toThrow();
  });

  it("框选截图写入超限时也把可恢复错误交给 Side Panel", () => {
    const selectionHandler = backgroundSource.slice(
      backgroundSource.indexOf('message?.type !== "capture.selection"')
    );
    expect(selectionHandler).toContain("assertPendingCaptureSize(dataUrl)");
    expect(selectionHandler).toContain("recoverableCaptureMessage(error)");
    expect(selectionHandler).toContain("pendingCapture:");
    expect(selectionHandler).toContain('type: "capture.ready"');
  });

  it("真实原图请求超时会主动中断，迟到响应不能重新完成", async () => {
    const fetchImageWithTimeout = (captureModule as Record<string, unknown>).fetchImageWithTimeout as
      ((sourceUrl: string, options: {
        timeoutMs: number;
        fetcher: (sourceUrl: string, init: RequestInit) => Promise<Response>;
      }) => Promise<Blob>) | undefined;
    expect(fetchImageWithTimeout).toBeTypeOf("function");
    if (!fetchImageWithTimeout) return;
    let signal: AbortSignal | undefined;
    let resolveLate: ((response: Response) => void) | undefined;
    const request = fetchImageWithTimeout("https://img.example/hanging.jpg", {
      timeoutMs: 5,
      fetcher: async (_sourceUrl, init) => {
        signal = init.signal as AbortSignal;
        return new Promise<Response>((resolve) => { resolveLate = resolve; });
      }
    });

    await expect(request).rejects.toThrow("原图读取超时");
    expect(signal?.aborted).toBe(true);
    resolveLate?.(new Response(new Uint8Array([1]), { headers: { "content-type": "image/jpeg" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("同一个超时和 AbortSignal 覆盖响应头与响应体读取", async () => {
    let fetchSignal: AbortSignal | undefined;
    let readerCancelled = false;
    const response = {
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: {
        getReader() {
          return {
            read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined),
            cancel: async () => { readerCancelled = true; }
          };
        }
      }
    } as unknown as Response;

    const request = captureModule.fetchImageWithTimeout("https://img.example/body-hangs.jpg", {
      timeoutMs: 5,
      fetcher: async (_sourceUrl, init) => {
        fetchSignal = init.signal as AbortSignal;
        return response;
      }
    });

    await expect(request).rejects.toThrow("原图读取超时");
    expect(fetchSignal?.aborted).toBe(true);
    expect(readerCancelled).toBe(true);
  });

  it("明确取消不会被备用捕获路径吞掉", async () => {
    let fallbackAttempts = 0;
    await expect(captureWithFallback({
      direct: async () => { throw new Error("CAPTURE_CANCELLED"); },
      domCanvas: async () => { fallbackAttempts += 1; return "dom"; },
      visibleScreenshot: async () => { fallbackAttempts += 1; return "screenshot"; }
    })).rejects.toThrow("CAPTURE_CANCELLED");
    expect(fallbackAttempts).toBe(0);
  });

  it("Hover 只按 requestId 的真实终态显示成功，失败与超时都明确可重试", () => {
    expect(backgroundSource).toContain('type: "hover.capture.result"');
    expect(backgroundSource).toContain('sendHoverCaptureResult(tabId, frameId, requestId, "success")');
    expect(backgroundSource).toContain('sendHoverCaptureResult(tabId, frameId, requestId, "error"');
    expect(backgroundSource).toContain("chrome.tabs.sendMessage");
    expect(hoverContentSource).toContain("waitForCaptureTerminal");
    expect(hoverContentSource).toContain('result.type !== "hover.capture.result"');
    expect(hoverContentSource).toContain('setCaptureButtonState("success")');
    expect(hoverContentSource).toContain('"捕获失败，重试"');
    expect(hoverContentSource).toContain('"捕获超时，重试"');
  });

  it("Side Panel 打开失败会中断并清除该请求的 controller", () => {
    const hoverHandler = backgroundSource.slice(backgroundSource.indexOf('message?.type === "hover.capture"'));
    const openFailure = hoverHandler.slice(hoverHandler.indexOf("(error) => {"), hoverHandler.indexOf("return true;"));
    expect(openFailure).toContain("captureController.abort()");
    expect(openFailure).toContain("activeHoverCaptureControllers.delete(requestId)");
  });

  it("捕获失败会持久化可理解错误并通知 Side Panel", async () => {
    const reportWebCaptureFailure = (captureModule as Record<string, unknown>).reportWebCaptureFailure as
      ((error: unknown, dependencies: {
        set: (value: Record<string, unknown>) => Promise<void>;
        notify: () => Promise<void>;
      }) => Promise<string>) | undefined;
    expect(reportWebCaptureFailure).toBeTypeOf("function");
    if (!reportWebCaptureFailure) return;
    const writes: Record<string, unknown>[] = [];
    let notifications = 0;
    const message = await reportWebCaptureFailure(new Error(
      "原图读取超时，已停止等待。请使用“框选区域”重试。"
    ), {
      set: async (value) => { writes.push(value); },
      notify: async () => { notifications += 1; }
    });
    expect(message).toContain("原图读取超时");
    expect(writes).toEqual([{ pendingWebImage: { error: message } }]);
    expect(notifications).toBe(1);
  });
});
