import {
  CAPTURE_UNAVAILABLE_MESSAGE,
  assertCapturePixelCount,
  assertPendingCaptureSize,
  captureWithFallback,
  captureFallbackPolicy,
  consumeRightClickTarget,
  createCaptureSource,
  fetchImageWithTimeout,
  isCaptureCancellation,
  isMatchingRightClickTarget,
  normalizeCaptureRect,
  recoverableCaptureMessage,
  reportWebCaptureFailure,
  rightClickTargetStorageKey,
  type CaptureRect,
  type RightClickCaptureTarget
} from "../lib/capture";
import { assertEncodedImageSize } from "../lib/image";
interface CapturedPayload {
  dataUrl: string;
  rect?: CaptureRect;
}

interface WebCaptureCandidate {
  sourceUrl: string;
  pageUrl: string;
  pageTitle: string;
  targetToken?: string;
  currentSrc?: string;
  frameId?: number;
  rect?: CaptureRect;
  viewport?: { width: number; height: number };
  intent?: "use-style" | "analyze" | "save";
}

const recentRightClickTargets = new Map<string, RightClickCaptureTarget>();
const activeHoverCaptureRequests = new Set<string>();
const completedHoverCaptureRequests = new Set<string>();
const cancelledHoverCaptureRequests = new Set<string>();
const activeHoverCaptureControllers = new Map<string, AbortController>();

async function readRightClickTarget(tabId: number, frameId: number) {
  return consumeRightClickTarget({
    recent: recentRightClickTargets,
    sessionStorage: chrome.storage.session,
    tabId,
    frameId
  });
}

async function blobToDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

async function captureDirect(sourceUrl: string, signal?: AbortSignal): Promise<CapturedPayload> {
  const blob = await fetchImageWithTimeout(sourceUrl, { signal });
  if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) {
    throw new Error("原图格式不受支持");
  }
  await assertEncodedImageSize(blob);
  const bitmap = await createImageBitmap(blob);
  try {
    assertCapturePixelCount(bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
  return { dataUrl: await blobToDataUrl(blob) };
}

async function inspectPageImage(tabId: number, locator: {
  sourceUrl: string;
  token?: string;
  currentSrc?: string;
  frameId?: number;
}) {
  const injection = (await chrome.scripting.executeScript({
    target: {
      tabId,
      ...(locator.frameId === undefined ? {} : { frameIds: [locator.frameId] })
    },
    args: [locator],
    func: (locator: { sourceUrl: string; token?: string; currentSrc?: string }) => {
      const tokenElement = locator.token
        ? Array.from(document.querySelectorAll<HTMLElement>(
          "[data-visualforge-context-token], [data-visualforge-capture-token]"
        )).find((element) =>
          element.dataset.visualforgeContextToken === locator.token ||
          element.dataset.visualforgeCaptureToken === locator.token
        )
        : undefined;
      if (!tokenElement) return null;
      const image = tokenElement instanceof HTMLImageElement ? tokenElement : null;
      const box = tokenElement.getBoundingClientRect();
      const rect = {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        dpr: devicePixelRatio
      };
      if (!image) {
        return { rect, viewport: { width: innerWidth, height: innerHeight }, dataUrl: null };
      }
      try {
        const maxEdge = 2400;
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        const context = canvas.getContext("2d");
        if (!context || canvas.width < 1 || canvas.height < 1) return { rect, dataUrl: null };
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return {
          rect,
          viewport: { width: innerWidth, height: innerHeight },
          dataUrl: canvas.toDataURL("image/png")
        };
      } catch {
        return {
          rect,
          viewport: { width: innerWidth, height: innerHeight },
          dataUrl: null
        };
      }
    }
  }))[0];
  return injection?.result ?? null;
}

async function captureWebCandidate(
  tab: chrome.tabs.Tab,
  candidate: WebCaptureCandidate,
  visibleSnapshot?: Promise<string>,
  cancelled: () => boolean = () => false,
  requestId?: string,
  signal?: AbortSignal
) {
  if (!tab.windowId) throw new Error("无法定位当前网页窗口");
  const capturedAt = Date.now();
  let inspected: Awaited<ReturnType<typeof inspectPageImage>> | undefined;
  const fallbackPolicy = captureFallbackPolicy(candidate);
  let result: Awaited<ReturnType<typeof captureWithFallback<CapturedPayload>>>;
  try {
    result = await captureWithFallback<CapturedPayload>({
      direct: () => captureDirect(candidate.sourceUrl, signal),
      domCanvas: async () => {
        if (cancelled() || signal?.aborted) throw new Error("CAPTURE_CANCELLED");
        if (!fallbackPolicy.allowDomCanvas) throw new Error(fallbackPolicy.recoveryMessage);
        if (!tab.id) throw new Error("无法访问页面");
        inspected = await inspectPageImage(tab.id, {
          sourceUrl: candidate.sourceUrl,
          token: candidate.targetToken,
          currentSrc: candidate.currentSrc,
          frameId: candidate.frameId
        });
        if (!inspected?.dataUrl) throw new Error("页面画布不可用");
        return { dataUrl: inspected.dataUrl };
      },
      visibleScreenshot: async () => {
        if (cancelled() || signal?.aborted) throw new Error("CAPTURE_CANCELLED");
        if (!fallbackPolicy.allowVisibleScreenshot) throw new Error(fallbackPolicy.recoveryMessage);
        if (!tab.id) throw new Error("无法访问页面");
        inspected ??= candidate.rect && candidate.viewport
          ? {
              rect: candidate.rect,
              viewport: candidate.viewport,
              dataUrl: null
            }
          : await inspectPageImage(tab.id, {
              sourceUrl: candidate.sourceUrl,
              token: candidate.targetToken,
              currentSrc: candidate.currentSrc,
              frameId: candidate.frameId
            });
        if (!inspected?.rect || !inspected.viewport) throw new Error("图片不在可见页面");
        return {
          dataUrl: await (visibleSnapshot ??
            chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })),
          rect: normalizeCaptureRect(inspected.rect, inspected.viewport)
        };
      }
    });
  } catch (error) {
    if (isCaptureCancellation(error)) throw error;
    if (!fallbackPolicy.allowVisibleScreenshot) throw new Error(fallbackPolicy.recoveryMessage);
    throw error;
  }
  if (cancelled() || signal?.aborted) throw new Error("CAPTURE_CANCELLED");
  assertPendingCaptureSize(result.value.dataUrl);
  await chrome.storage.local.set({
    pendingWebImage: {
      ...result.value,
      ...(requestId ? { requestId } : {}),
      intent: candidate.intent ?? "use-style",
      source: createCaptureSource({
        sourceUrl: candidate.sourceUrl,
        pageUrl: candidate.pageUrl,
        pageTitle: candidate.pageTitle,
        capturedAt,
        captureMethod: result.method
      }),
      fallbackMessage: result.fallbackMessage
    }
  });
  if (cancelled() || signal?.aborted) {
    const stored = await chrome.storage.local.get("pendingWebImage");
    if (stored.pendingWebImage?.requestId === requestId) {
      await chrome.storage.local.remove("pendingWebImage");
    }
    throw new Error("CAPTURE_CANCELLED");
  }
  await chrome.runtime.sendMessage({ type: "web-image.pending" }).catch(() => undefined);
}

async function sendHoverCaptureResult(
  tabId: number,
  frameId: number,
  requestId: string,
  status: "success" | "error",
  error?: string
) {
  await chrome.tabs.sendMessage(tabId, {
    type: "hover.capture.result",
    requestId,
    status,
    ...(error ? { error } : {})
  }, { frameId }).catch(() => undefined);
}

async function beginAreaCapture(tab: chrome.tabs.Tab, openPanel = true) {
  if (!tab.id || !tab.windowId) return;
  if (openPanel) await chrome.sidePanel.open({ windowId: tab.windowId });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-scripts/capture.js"]
    });
  } catch {
    await chrome.storage.local.set({
      pendingCapture: {
        error: CAPTURE_UNAVAILABLE_MESSAGE,
        source: createCaptureSource({
          pageUrl: tab.url ?? "",
          pageTitle: tab.title ?? "",
          capturedAt: Date.now(),
          captureMethod: "area-selection"
        })
      }
    });
    await chrome.runtime.sendMessage({ type: "capture.ready" }).catch(() => undefined);
  }
}

export default defineBackground(() => {
  const ensureContextMenus = () => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: "styleforge-reference-image",
        title: "用 VisualForge 参考这张图",
        contexts: ["image"]
      });
      chrome.contextMenus.create({
        id: "styleforge-capture-area",
        title: "用 VisualForge 框选截图",
        contexts: ["page"]
      });
    });
  };
  ensureContextMenus();
  chrome.runtime.onInstalled.addListener(() => {
    ensureContextMenus();
  });

  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => undefined);
  chrome.action.onClicked.addListener((tab) => {
    if (!tab.windowId) return;
    void chrome.storage.session.set({
      styleforgeActiveTab: {
        id: tab.id ?? null,
        url: tab.url ?? null,
        title: tab.title ?? null,
        windowId: tab.windowId
      }
    });
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  });

  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.windowId) return;
    if (info.menuItemId === "styleforge-reference-image" && info.srcUrl) {
      const frameId = info.frameId ?? 0;
      const savedTarget = tab.id === undefined
        ? undefined
        : await readRightClickTarget(tab.id, frameId);
      const target = tab.id !== undefined && isMatchingRightClickTarget(savedTarget, {
        tabId: tab.id,
        frameId,
        srcUrl: info.srcUrl,
        now: Date.now()
      }) ? savedTarget : undefined;
      const visibleSnapshot = chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      void chrome.sidePanel.open({ windowId: tab.windowId });
      try {
        await captureWebCandidate(tab, {
          sourceUrl: target?.sourceUrl ?? info.srcUrl,
          currentSrc: target?.currentSrc,
          targetToken: target?.token,
          frameId,
          ...(target?.frameId === 0 ? { rect: target.rect, viewport: target.viewport } : {}),
          pageUrl: info.pageUrl ?? tab.url ?? "",
          pageTitle: tab.title ?? "",
          intent: "use-style"
        }, visibleSnapshot);
      } catch (error) {
        await reportWebCaptureFailure(error, {
          set: (value) => chrome.storage.local.set(value),
          notify: () => chrome.runtime.sendMessage({ type: "web-image.pending" })
        });
      }
    }
    if (info.menuItemId === "styleforge-capture-area" && tab.id) {
      await beginAreaCapture(tab);
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "privacy.clear-transient") {
      recentRightClickTargets.clear();
      for (const requestId of activeHoverCaptureRequests) {
        cancelledHoverCaptureRequests.add(requestId);
      }
      for (const controller of activeHoverCaptureControllers.values()) controller.abort();
      activeHoverCaptureRequests.clear();
      activeHoverCaptureControllers.clear();
      completedHoverCaptureRequests.clear();
      void Promise.all([
        chrome.storage.session.clear(),
        chrome.storage.local.remove(["pendingWebImage", "pendingCapture"])
      ]).then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false })
      );
      return true;
    }
    if (message?.type === "context-image.target") {
      if (sender.tab?.id === undefined || typeof message.target?.token !== "string") {
        sendResponse({ ok: false });
        return;
      }
      const frameId = sender.frameId ?? 0;
      const target: RightClickCaptureTarget = {
        ...message.target,
        tabId: sender.tab.id,
        frameId
      };
      const key = rightClickTargetStorageKey(target.tabId, target.frameId);
      recentRightClickTargets.set(key, target);
      void chrome.storage.session.set({ [key]: target }).then(
        () => sendResponse({ ok: true }),
        () => sendResponse({ ok: false })
      );
      return true;
    }
    if (message?.type === "capture.area.request") {
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab?.id || !tab.windowId) throw new Error("当前页面不能框选");
        return beginAreaCapture(tab, false);
      }).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error) })
      );
      return true;
    }
    if (message?.type === "hover.capture") {
      const requestId = typeof message.requestId === "string" ? message.requestId : message.targetToken;
      if (!sender.tab?.windowId || sender.tab.id === undefined || typeof requestId !== "string") {
        sendResponse({ ok: false, error: "无法定位当前网页窗口" });
        return;
      }
      const tabId = sender.tab.id;
      const frameId = sender.frameId ?? 0;
      if (completedHoverCaptureRequests.has(requestId)) {
        sendResponse({ ok: true, completed: true, deduplicated: true });
        return;
      }
      if (activeHoverCaptureRequests.has(requestId)) {
        sendResponse({ ok: true, accepted: true, deduplicated: true });
        return;
      }
      activeHoverCaptureRequests.add(requestId);
      const captureController = new AbortController();
      activeHoverCaptureControllers.set(requestId, captureController);
      const visibleSnapshot = chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
      void visibleSnapshot.catch(() => undefined);
      void chrome.sidePanel.open({ windowId: sender.tab.windowId }).then(
        () => {
          if (cancelledHoverCaptureRequests.has(requestId)
            || activeHoverCaptureControllers.get(requestId) !== captureController) {
            cancelledHoverCaptureRequests.delete(requestId);
            sendResponse({ ok: false, error: "捕获已取消，请重试" });
            return;
          }
          sendResponse({ ok: true, accepted: true });
          void captureWebCandidate(sender.tab!, {
            sourceUrl: message.sourceUrl,
            targetToken: message.targetToken,
            currentSrc: message.currentSrc,
            frameId,
            pageUrl: message.pageUrl ?? sender.tab?.url ?? "",
            pageTitle: message.pageTitle ?? sender.tab?.title ?? "",
            rect: message.rect,
            viewport: message.viewport,
            intent: message.intent
          }, visibleSnapshot, () => cancelledHoverCaptureRequests.has(requestId), requestId,
          captureController.signal).then(
            async () => {
              const isCurrent = activeHoverCaptureControllers.get(requestId) === captureController
                && !cancelledHoverCaptureRequests.has(requestId);
              activeHoverCaptureRequests.delete(requestId);
              if (activeHoverCaptureControllers.get(requestId) === captureController) {
                activeHoverCaptureControllers.delete(requestId);
              }
              if (!isCurrent) {
                cancelledHoverCaptureRequests.delete(requestId);
                return;
              }
              completedHoverCaptureRequests.add(requestId);
              if (completedHoverCaptureRequests.size > 100) {
                completedHoverCaptureRequests.delete(completedHoverCaptureRequests.values().next().value!);
              }
              await sendHoverCaptureResult(tabId, frameId, requestId, "success");
            },
            async (error) => {
              activeHoverCaptureRequests.delete(requestId);
              if (activeHoverCaptureControllers.get(requestId) === captureController) {
                activeHoverCaptureControllers.delete(requestId);
              }
              if (cancelledHoverCaptureRequests.has(requestId)) {
                cancelledHoverCaptureRequests.delete(requestId);
                return;
              }
              const errorMessage = await reportWebCaptureFailure(error, {
                set: (value) => chrome.storage.local.set(value),
                notify: () => chrome.runtime.sendMessage({ type: "web-image.pending" })
              });
              await sendHoverCaptureResult(tabId, frameId, requestId, "error", errorMessage);
            }
          );
        },
        (error) => {
          captureController.abort();
          activeHoverCaptureRequests.delete(requestId);
          if (activeHoverCaptureControllers.get(requestId) === captureController) {
            activeHoverCaptureControllers.delete(requestId);
          }
          if (!cancelledHoverCaptureRequests.delete(requestId)) {
            void sendHoverCaptureResult(tabId, frameId, requestId, "error", "无法打开 VisualForge，请重试");
          }
          sendResponse({ ok: false, error: String(error) });
        }
      );
      return true;
    }
    if (message?.type === "hover.capture.cancel") {
      const requestId = typeof message.requestId === "string" ? message.requestId : "";
      if (requestId) {
        cancelledHoverCaptureRequests.add(requestId);
        activeHoverCaptureRequests.delete(requestId);
        activeHoverCaptureControllers.get(requestId)?.abort();
        activeHoverCaptureControllers.delete(requestId);
        void chrome.storage.local.get("pendingWebImage").then((stored) => {
          if (stored.pendingWebImage?.requestId === requestId) {
            return chrome.storage.local.remove("pendingWebImage");
          }
        });
      }
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === "hover.capture-area") {
      if (!sender.tab) {
        sendResponse({ ok: false, error: "无法定位当前网页" });
        return;
      }
      void beginAreaCapture(sender.tab).then(
        () => sendResponse({ ok: true }),
        (error) => sendResponse({ ok: false, error: String(error) })
      );
      return true;
    }
    if (message?.type !== "capture.selection") return;
    void (async () => {
      try {
        if (!sender.tab?.windowId) throw new Error("无法定位当前网页窗口");
        const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
        assertPendingCaptureSize(dataUrl);
        const rect = normalizeCaptureRect(message.rect, message.viewport);
        await chrome.storage.local.set({
          pendingCapture: {
            dataUrl,
            rect,
            source: createCaptureSource({
              pageUrl: sender.tab.url ?? "",
              pageTitle: sender.tab.title ?? "",
              capturedAt: Date.now(),
              captureMethod: "area-selection"
            })
          }
        });
        await chrome.runtime.sendMessage({ type: "capture.ready" }).catch(() => undefined);
        sendResponse({ ok: true });
      } catch (error) {
        const errorMessage = recoverableCaptureMessage(error);
        await chrome.storage.local.set({
          pendingCapture: { error: errorMessage }
        });
        await chrome.runtime.sendMessage({ type: "capture.ready" }).catch(() => undefined);
        sendResponse({ ok: false, error: errorMessage });
      }
    })();
    return true;
  });
});
