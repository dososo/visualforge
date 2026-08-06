import type { AssetSource, CaptureMethod } from "@styleforge/contracts";

export const CAPTURE_FALLBACK_MESSAGE = "原图不可直接访问，已切换备用捕获方式。";
export const CAPTURE_UNAVAILABLE_MESSAGE = "暂时无法捕获这张图片，请使用“框选截图”。";
export const CAPTURE_LIMIT_MESSAGE = "这张图片过大，已停止读取。请返回网页，使用“框选区域”截取需要的部分。";
export const CAPTURE_STORAGE_LIMIT_MESSAGE = "捕获结果过大，未写入浏览器存储。请返回网页，使用“框选区域”缩小范围。";
export const MAX_CAPTURE_RESPONSE_BYTES = 6 * 1024 * 1024;
export const MAX_PENDING_CAPTURE_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTURE_PIXEL_COUNT = 36_000_000;
export const CAPTURE_DIRECT_TIMEOUT_MS = 30_000;
export const CAPTURE_DIRECT_TIMEOUT_MESSAGE = "原图读取超时，已停止等待。请使用“框选区域”重试。";
export const RIGHT_CLICK_TARGET_MAX_AGE_MS = 15_000;
export const UNBOUND_CAPTURE_RECOVERY_MESSAGE = "无法确认你选择的是哪张图片，请使用“框选区域”重新选择。";
export const IFRAME_CAPTURE_RECOVERY_MESSAGE = "这张图片位于嵌入页面中，无法安全自动裁切，请使用“框选区域”。";

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
  dpr: number;
}

export interface RightClickCaptureTarget {
  tabId: number;
  frameId: number;
  token: string;
  currentSrc: string;
  src?: string;
  sourceUrl: string;
  rect: CaptureRect;
  viewport: { width: number; height: number };
  capturedAt: number;
}

type CaptureFetcher = (sourceUrl: string, init: RequestInit) => Promise<Response>;

export async function fetchImageWithTimeout(sourceUrl: string, options: {
  timeoutMs?: number;
  fetcher?: CaptureFetcher;
  signal?: AbortSignal;
} = {}) {
  const controller = new AbortController();
  const fetcher = options.fetcher ?? ((url, init) => fetch(url, init));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onExternalAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    if (options.signal?.aborted) {
      const error = new Error("CAPTURE_CANCELLED");
      controller.abort(error);
      reject(error);
      return;
    }
    onExternalAbort = () => {
      const error = new Error("CAPTURE_CANCELLED");
      controller.abort(error);
      reject(error);
    };
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
    timeout = setTimeout(() => {
      const error = new Error(CAPTURE_DIRECT_TIMEOUT_MESSAGE);
      controller.abort(error);
      reject(error);
    }, options.timeoutMs ?? CAPTURE_DIRECT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(sourceUrl, {
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("原图请求失败");
        return readBoundedImageResponse(response, MAX_CAPTURE_RESPONSE_BYTES, controller.signal);
      })(),
      interrupted
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onExternalAbort) options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

export function recoverableCaptureMessage(error: unknown) {
  return error instanceof Error && error.message.includes("框选")
    ? error.message
    : CAPTURE_UNAVAILABLE_MESSAGE;
}

export async function reportWebCaptureFailure(error: unknown, dependencies: {
  set: (value: Record<string, unknown>) => Promise<void>;
  notify: () => Promise<void>;
}) {
  const message = recoverableCaptureMessage(error);
  await dependencies.set({ pendingWebImage: { error: message } });
  await dependencies.notify().catch(() => undefined);
  return message;
}

export function rightClickTargetStorageKey(tabId: number, frameId: number) {
  return `visualForgeRightClickTarget:${tabId}:${frameId}`;
}

export async function consumeRightClickTarget(options: {
  recent: Map<string, RightClickCaptureTarget>;
  sessionStorage: Pick<typeof chrome.storage.session, "get" | "remove">;
  tabId: number;
  frameId: number;
}) {
  const key = rightClickTargetStorageKey(options.tabId, options.frameId);
  const recent = options.recent.get(key);
  const stored = recent ?? (await options.sessionStorage.get(key))[key] as RightClickCaptureTarget | undefined;
  options.recent.delete(key);
  await options.sessionStorage.remove(key);
  return stored;
}

export function isMatchingRightClickTarget(
  target: RightClickCaptureTarget | undefined,
  click: { tabId: number; frameId: number; srcUrl: string; now: number }
) {
  if (!target) return false;
  if (target.tabId !== click.tabId || target.frameId !== click.frameId) return false;
  if (click.now - target.capturedAt < 0 || click.now - target.capturedAt > RIGHT_CLICK_TARGET_MAX_AGE_MS) return false;
  return target.currentSrc === click.srcUrl || target.src === click.srcUrl || target.sourceUrl === click.srcUrl;
}

export function captureFallbackPolicy(input: { targetToken?: string; frameId?: number }) {
  const hasBoundTarget = Boolean(input.targetToken);
  const isTopFrame = (input.frameId ?? 0) === 0;
  return {
    allowDomCanvas: hasBoundTarget,
    allowVisibleScreenshot: hasBoundTarget && isTopFrame,
    recoveryMessage: !hasBoundTarget
      ? UNBOUND_CAPTURE_RECOVERY_MESSAGE
      : IFRAME_CAPTURE_RECOVERY_MESSAGE
  };
}

export async function readBoundedImageResponse(
  response: Response,
  maxBytes = MAX_CAPTURE_RESPONSE_BYTES,
  signal?: AbortSignal
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(CAPTURE_LIMIT_MESSAGE);
  }
  if (!response.body) throw new Error("无法安全读取原图响应");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let onAbort: (() => void) | undefined;
  const interrupted = signal ? new Promise<never>((_resolve, reject) => {
    const abort = () => {
      void reader.cancel().catch(() => undefined);
      reject(signal.reason instanceof Error ? signal.reason : new Error("CAPTURE_CANCELLED"));
    };
    if (signal.aborted) return abort();
    onAbort = abort;
    signal.addEventListener("abort", abort, { once: true });
  }) : undefined;
  try {
    while (true) {
      const { done, value } = await (interrupted
        ? Promise.race([reader.read(), interrupted])
        : reader.read());
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(CAPTURE_LIMIT_MESSAGE);
      }
      chunks.push(value);
    }
  } finally {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
  const type = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  return new Blob(chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer), { type });
}

export function assertCapturePixelCount(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("无法确认图片像素尺寸，请改用“框选区域”。");
  }
  if (width * height > MAX_CAPTURE_PIXEL_COUNT) {
    throw new Error(`图片像素超过 ${MAX_CAPTURE_PIXEL_COUNT.toLocaleString("zh-CN")}，请改用“框选区域”。`);
  }
}

export function assertPendingCaptureSize(dataUrl: string) {
  if (dataUrl.length > MAX_PENDING_CAPTURE_BYTES) {
    throw new Error(CAPTURE_STORAGE_LIMIT_MESSAGE);
  }
}

export function normalizeCaptureRect(
  rect: CaptureRect,
  viewport: { width: number; height: number }
): CaptureRect {
  const left = Math.max(0, Math.min(viewport.width, rect.x));
  const top = Math.max(0, Math.min(viewport.height, rect.y));
  const right = Math.max(left, Math.min(viewport.width, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(viewport.height, rect.y + rect.height));
  const normalized = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    dpr: Math.max(1, rect.dpr)
  };
  if (normalized.width < 32 || normalized.height < 32) {
    throw new Error("框选区域的宽高至少需要 32px。");
  }
  return normalized;
}

export function createCaptureSource(input: {
  sourceUrl?: string;
  pageUrl: string;
  pageTitle: string;
  capturedAt: number;
  captureMethod: CaptureMethod;
}): AssetSource {
  return {
    type: input.captureMethod === "area-selection" ? "capture" : "web",
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    capturedAt: input.capturedAt,
    captureMethod: input.captureMethod
  };
}

export async function captureWithFallback<T>(steps: {
  direct: () => Promise<T>;
  domCanvas: () => Promise<T>;
  visibleScreenshot: () => Promise<T>;
}): Promise<{ value: T; method: Exclude<CaptureMethod, "area-selection">; fallbackMessage: string | null }> {
  try {
    return { value: await steps.direct(), method: "direct", fallbackMessage: null };
  } catch (error) {
    if (isCaptureCancellation(error)) throw error;
    try {
      return {
        value: await steps.domCanvas(),
        method: "dom-canvas",
        fallbackMessage: CAPTURE_FALLBACK_MESSAGE
      };
    } catch (error) {
      if (isCaptureCancellation(error)) throw error;
      try {
        return {
          value: await steps.visibleScreenshot(),
          method: "visible-screenshot",
          fallbackMessage: CAPTURE_FALLBACK_MESSAGE
        };
      } catch (error) {
        if (isCaptureCancellation(error)) throw error;
        throw new Error(CAPTURE_UNAVAILABLE_MESSAGE);
      }
    }
  }
}

export function isCaptureCancellation(error: unknown) {
  return error instanceof Error && error.message === "CAPTURE_CANCELLED";
}
