import {
  candidateKey,
  canBindNestedImageFromTarget,
  choosePersistentCaptureCandidateIndex,
  chooseHoverToolbarPosition,
  hoverBlockerSelector,
  isBlockingHoverControl,
  isEligibleHoverCandidate,
  isHoverOverlayEvent,
  resolveHoverImage,
  runWithoutCaptureOverlay,
  siteAdapterForHost,
  siteAdapterRulesForHost,
  type HoverCandidateDiscovery
} from "../lib/hover-capture";

type HoverIntent = "use-style" | "analyze" | "save";
type LastCaptureAction = HoverIntent | "area";
type CaptureButtonState = "idle" | "capturing" | "success" | "error";

const CAPTURE_TIMEOUT_MS = 45_000;

interface ActiveCandidate {
  element: HTMLElement;
  sourceUrl: string;
  currentSrc: string;
  key: string;
  label: string;
  discovery: HoverCandidateDiscovery;
}

function waitForCaptureTerminal(requestId: string, timeoutMs: number) {
  let timer: number | undefined;
  let listener: ((message: unknown) => void) | undefined;
  const dispose = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    if (listener) chrome.runtime.onMessage.removeListener(listener);
  };
  const promise = new Promise<void>((resolve, reject) => {
    listener = (message: unknown) => {
      const result = message as {
        type?: string;
        requestId?: string;
        status?: "success" | "error";
        error?: string;
      };
      if (result.type !== "hover.capture.result" || result.requestId !== requestId) return;
      dispose();
      if (result.status === "success") resolve();
      else reject(new Error(result.error || "网页图片捕获失败"));
    };
    chrome.runtime.onMessage.addListener(listener);
    timer = window.setTimeout(() => {
      dispose();
      reject(new Error("CAPTURE_TIMEOUT"));
    }, timeoutMs);
  });
  void promise.catch(() => undefined);
  return { promise, dispose };
}

export default defineContentScript({
  matches: ["https://*/*"],
  allFrames: true,
  runAt: "document_idle",
  async main() {
    const { hoverCaptureEnabled = true, visualForgeDataConsentV1 } = await chrome.storage.local.get([
      "hoverCaptureEnabled",
      "visualForgeDataConsentV1"
    ]);
    if (!visualForgeDataConsentV1 || !hoverCaptureEnabled) return;
    installContextTargetCapture();
    if (window.top === window) installHoverCapture();
  }
});

function installContextTargetCapture() {
  if (document.documentElement.dataset.visualforgeContextCapture === "1") return;
  document.documentElement.dataset.visualforgeContextCapture = "1";
  let contextTarget: HTMLImageElement | null = null;
  const onContextMenu = (event: MouseEvent) => {
    const start = event.composedPath().find((item): item is HTMLElement => item instanceof HTMLElement);
    const image = start ? findImageElement(start) : null;
    if (!(image instanceof HTMLImageElement)) return;
    const currentSrc = image.currentSrc || image.src;
    if (!currentSrc || currentSrc.startsWith("data:image/svg")) return;
    contextTarget?.removeAttribute("data-visualforge-context-token");
    const token = `vf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    image.dataset.visualforgeContextToken = token;
    contextTarget = image;
    const rect = image.getBoundingClientRect();
    const candidate = readCandidate(image, "direct");
    void chrome.runtime.sendMessage({
      type: "context-image.target",
      target: {
        token,
        currentSrc,
        src: image.src,
        sourceUrl: candidate?.sourceUrl ?? currentSrc,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          dpr: devicePixelRatio
        },
        viewport: { width: innerWidth, height: innerHeight },
        capturedAt: Date.now()
      }
    }).catch(() => undefined);
  };
  const onDisable = (message: unknown) => {
    if ((message as { type?: string })?.type !== "hover.disable") return;
    document.removeEventListener("contextmenu", onContextMenu, true);
    chrome.runtime.onMessage.removeListener(onDisable);
    contextTarget?.removeAttribute("data-visualforge-context-token");
    delete document.documentElement.dataset.visualforgeContextCapture;
  };
  document.addEventListener("contextmenu", onContextMenu, true);
  chrome.runtime.onMessage.addListener(onDisable);
}

function installHoverCapture() {
  const existingRoot = document.getElementById("styleforge-hover-root");
  if (existingRoot?.dataset.version === "4") return;
  existingRoot?.remove();

  const host = document.createElement("div");
  host.id = "styleforge-hover-root";
  host.dataset.version = "4";
  host.dataset.adapter = siteAdapterForHost(location.hostname);
  Object.assign(host.style, {
    all: "initial",
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    zIndex: "2147483646"
  });
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .tools { position: fixed; display: flex; visibility: hidden; pointer-events: none; align-items: center; width: 158px;
      box-sizing: border-box; gap: 2px; padding: 3px; border: 1px solid #d9d7d0; border-radius: 9px; background: rgba(255,253,249,.97);
      box-shadow: 0 6px 18px rgba(24,25,26,.16); color: #20201e;
      font: 12px/1.2 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
    .tools.visible { visibility: visible; pointer-events: auto; }
    .tools.capture-hidden { visibility: hidden !important; pointer-events: none !important; }
    button { appearance: none; height: 40px; min-height: 40px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent;
      color: inherit; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover, button:focus-visible { background: #efeee9; }
    button:focus-visible { outline: 2px solid #245d91; outline-offset: 1px; }
    button:disabled { cursor: wait; opacity: .7; }
    .primary { flex: 1 1 auto; min-width: 0; }
    .more { flex: 0 0 40px; width: 40px; padding: 0; border-left: 1px solid #d9d7d0;
      border-radius: 0 6px 6px 0; font-size: 16px; }
    .menu { position: absolute; top: calc(100% + 5px); right: 0; min-width: 124px; display: none;
      padding: 4px; border: 1px solid #d9d7d0; border-radius: 8px; background: #fffdf9;
      box-shadow: 0 8px 24px rgba(24,25,26,.14); }
    .menu.open { display: grid; }
    .menu button { text-align: left; }
    .sr-only { position: fixed; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
      clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  `;
  const tools = document.createElement("div");
  tools.className = "tools";
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "VisualForge 图片操作");
  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "primary";
  primary.textContent = "VisualForge";
  const more = document.createElement("button");
  more.type = "button";
  more.className = "more";
  more.textContent = "⋯";
  more.setAttribute("aria-label", "更多 VisualForge 图片操作");
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  const status = document.createElement("p");
  status.className = "sr-only";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const actions: Array<[string, HoverIntent | "area"]> = [
    ["拆解风格", "analyze"],
    ["保存灵感", "save"],
    ["框选区域", "area"]
  ];
  for (const [label, intent] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("role", "menuitem");
    button.addEventListener("click", () => {
      closeMenu();
      if (intent === "area") {
        void sendAreaCapture();
      } else {
        sendCapture(intent);
      }
    });
    menu.append(button);
  }
  tools.append(primary, more, menu);
  shadow.append(style, tools, status);
  document.documentElement.append(host);

  let active: ActiveCandidate | null = null;
  let frame = 0;
  let revealTimer = 0;
  let persistentTimer = 0;
  let captureState: CaptureButtonState = "idle";
  let captureErrorLabel = "捕获失败，重试";
  let lastCaptureIntent: HoverIntent = "use-style";
  let lastCaptureAction: LastCaptureAction = "use-style";
  let activeCaptureRequestId = "";
  const mutationObserver = new MutationObserver(() => schedulePersistentCandidate());
  const closeMenu = () => {
    menu.classList.remove("open");
    more.setAttribute("aria-expanded", "false");
  };
  const openMenu = () => {
    menu.classList.add("open");
    more.setAttribute("aria-expanded", "true");
    menu.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  };
  const captureAccessibleLabel = (state: CaptureButtonState) => {
    const label = active?.label || "网页图片";
    return state === "capturing"
      ? `正在处理：${label}`
      : state === "success" ? `已接收：${label}`
        : state === "error" ? `${captureErrorLabel}：${label}`
          : `用 VisualForge 创作：${label}`;
  };
  const captureStatusAnnouncement = (state: CaptureButtonState) => {
    const label = active?.label || "网页图片";
    return state === "capturing"
      ? `正在处理${label}`
      : state === "success" ? `已接收${label}`
        : state === "error" ? `${captureErrorLabel}，${label}` : "";
  };
  const setCaptureButtonState = (state: CaptureButtonState, errorLabel?: string) => {
    if (errorLabel) captureErrorLabel = errorLabel;
    captureState = state;
    primary.disabled = state === "capturing";
    primary.dataset.captureState = state;
    primary.setAttribute("aria-busy", String(state === "capturing"));
    primary.setAttribute("aria-label", captureAccessibleLabel(state));
    status.textContent = captureStatusAnnouncement(state);
    primary.textContent = state === "capturing"
      ? "正在加入…"
      : state === "success" ? "已接收"
        : state === "error" ? captureErrorLabel : "VisualForge";
  };
  const resetCaptureButton = () => {
    activeCaptureRequestId = "";
    setCaptureButtonState("idle");
  };
  const hide = () => {
    clearTimeout(revealTimer);
    active = null;
    closeMenu();
    tools.classList.remove("visible");
  };
  const schedulePersistentCandidate = () => {
    clearTimeout(persistentTimer);
    persistentTimer = window.setTimeout(showPersistentCandidate, 120);
  };
  const showPersistentCandidate = () => {
    const adapter = siteAdapterRulesForHost(location.hostname);
    const selector = Array.from(new Set(["img", "[style*='background-image' i]", ...adapter.imageSelectors])).join(",");
    const seen = new Set<HTMLElement>();
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .map((element) => readCandidate(element, "persistent"))
      .filter((candidate): candidate is ActiveCandidate => {
        if (!candidate || seen.has(candidate.element)) return false;
        seen.add(candidate.element);
        return true;
      });
    const index = choosePersistentCaptureCandidateIndex(
      candidates.map((candidate) => {
        const rect = candidate.element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      }),
      { width: innerWidth, height: innerHeight }
    );
    if (index < 0) return hide();
    active = candidates[index] ?? null;
    schedulePosition();
  };
  const schedulePosition = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updatePosition);
  };
  const updatePosition = () => {
    if (!active || !active.element.isConnected) {
      hide();
      return schedulePersistentCandidate();
    }
    const refreshed = readCandidate(active.element, active.discovery);
    if (!refreshed) {
      hide();
      return schedulePersistentCandidate();
    }
    active = refreshed;
    const rect = active.element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) {
      hide();
      return schedulePersistentCandidate();
    }
    const toolRect = tools.getBoundingClientRect();
    const blockers = Array.from(document.querySelectorAll<HTMLElement>(hoverBlockerSelector))
      .filter((element) => element !== active?.element && !element.contains(active?.element ?? null) && !host.contains(element))
      .map((element) => element.getBoundingClientRect())
      .filter((candidate) => candidate.width > 0 && candidate.height > 0 &&
        candidate.bottom >= rect.top - 64 && candidate.top <= rect.bottom + 64 &&
        isBlockingHoverControl(rect, candidate));
    const position = chooseHoverToolbarPosition(rect, toolRect, {
      width: innerWidth,
      height: innerHeight
    }, blockers, true);
    if (!position) return hide();
    tools.style.top = `${position.top}px`;
    tools.style.left = `${position.left}px`;
    tools.classList.add("visible");
    primary.setAttribute("aria-label", captureAccessibleLabel(captureState));
  };
  const sendCapture = async (intent: HoverIntent) => {
    if (!active || captureState === "capturing") return;
    lastCaptureIntent = intent;
    lastCaptureAction = intent;
    const refreshed = readCandidate(active.element, active.discovery);
    if (!refreshed) return hide();
    const rect = refreshed.element.getBoundingClientRect();
    const targetToken = `vf-capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const requestId = crypto.randomUUID();
    activeCaptureRequestId = requestId;
    refreshed.element.dataset.visualforgeCaptureToken = targetToken;
    setCaptureButtonState("capturing");
    const terminalWait = waitForCaptureTerminal(requestId, CAPTURE_TIMEOUT_MS);
    try {
      const response = await runWithoutCaptureOverlay(
        (hidden) => tools.classList.toggle("capture-hidden", hidden),
        () => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
        () => chrome.runtime.sendMessage({
          type: "hover.capture",
          requestId,
          intent,
          sourceUrl: refreshed.sourceUrl,
          targetToken,
          currentSrc: refreshed.currentSrc,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            dpr: devicePixelRatio
          },
          viewport: { width: innerWidth, height: innerHeight },
          pageUrl: location.href,
          pageTitle: document.title
        })
      );
      if (activeCaptureRequestId !== requestId) return;
      const accepted = response as { ok?: boolean; completed?: boolean; error?: string } | undefined;
      if (accepted?.ok === false) {
        throw new Error(accepted.error || "网页图片捕获失败");
      }
      if (!accepted?.completed) await terminalWait.promise;
      if (activeCaptureRequestId !== requestId) return;
      setCaptureButtonState("success");
      window.setTimeout(() => {
        if (captureState === "success") resetCaptureButton();
      }, 2200);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "CAPTURE_TIMEOUT") {
        void chrome.runtime.sendMessage({ type: "hover.capture.cancel", requestId }).catch(() => undefined);
      }
      if (activeCaptureRequestId === requestId) {
        setCaptureButtonState("error", cause instanceof Error && cause.message === "CAPTURE_TIMEOUT"
          ? "捕获超时，重试"
          : "捕获失败，重试");
      }
    } finally {
      terminalWait.dispose();
      if (refreshed.element.dataset.visualforgeCaptureToken === targetToken) {
        delete refreshed.element.dataset.visualforgeCaptureToken;
      }
      if (activeCaptureRequestId === requestId && primary.dataset.captureState === "capturing") {
        setCaptureButtonState("error");
      }
    }
  };
  const sendAreaCapture = async () => {
    if (captureState === "capturing") return;
    lastCaptureAction = "area";
    setCaptureButtonState("capturing");
    primary.textContent = "正在打开…";
    try {
      const response = await chrome.runtime.sendMessage({ type: "hover.capture-area" });
      if ((response as { ok?: boolean } | undefined)?.ok === false) {
        throw new Error("框选模式打开失败");
      }
      resetCaptureButton();
      hide();
    } catch {
      setCaptureButtonState("error", "框选失败，请重试");
    }
  };

  primary.addEventListener("click", () => {
    if (captureState === "error") {
      if (lastCaptureAction === "area") {
        void sendAreaCapture();
        return;
      }
      void sendCapture(lastCaptureIntent);
      return;
    }
    void sendCapture("use-style");
  });
  more.addEventListener("click", () => {
    if (menu.classList.contains("open")) {
      closeMenu();
      return;
    }
    openMenu();
  });
  shadow.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key === "Escape" && menu.classList.contains("open")) {
      event.preventDefault();
      closeMenu();
      more.focus();
      return;
    }
    if (key === "Tab" && menu.classList.contains("open")) {
      window.setTimeout(closeMenu, 0);
      return;
    }
    if (!menu.classList.contains("open") || !["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(shadow.activeElement as HTMLButtonElement);
    const next = key === "Home" ? 0 : key === "End" ? items.length - 1 :
      key === "ArrowDown" ? (current + 1 + items.length) % items.length :
        (current - 1 + items.length) % items.length;
    items[next]?.focus();
  });
  more.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
    }
  });
  shadow.addEventListener("focusout", (event) => {
    if (!menu.classList.contains("open")) return;
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && (menu.contains(next) || next === more)) return;
    closeMenu();
  });
  const onPointerOver = (event: PointerEvent) => {
    const path = event.composedPath();
    if (isHoverOverlayEvent(path, host)) return;
    const element = path.find((item): item is HTMLElement => item instanceof HTMLElement && item !== host);
    const candidate = element ? readCandidate(element, "direct") : null;
    if (!candidate) return;
    if (candidate.key === active?.key) return;
    clearTimeout(revealTimer);
    active = candidate;
    revealTimer = window.setTimeout(schedulePosition, 280);
  };
  const onFocusIn = (event: FocusEvent) => {
    if (isHoverOverlayEvent(event.composedPath(), host)) return;
    const element = event.target instanceof HTMLElement ? event.target : null;
    const candidate = element ? readCandidate(element, "direct") : null;
    if (candidate) {
      active = candidate;
      schedulePosition();
    }
  };
  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!menu.classList.contains("open")) return;
    if (event.composedPath().includes(host)) return;
    closeMenu();
  };
  const onDisable = (message: unknown) => {
    if ((message as { type?: string })?.type !== "hover.disable") return;
    cancelAnimationFrame(frame);
    clearTimeout(revealTimer);
    clearTimeout(persistentTimer);
    mutationObserver.disconnect();
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    removeEventListener("scroll", onViewportChange, true);
    removeEventListener("resize", onViewportChange);
    chrome.runtime.onMessage.removeListener(onDisable);
    host.remove();
  };
  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  const onViewportChange = () => {
    schedulePosition();
    schedulePersistentCandidate();
  };
  addEventListener("scroll", onViewportChange, true);
  addEventListener("resize", onViewportChange);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener(onDisable);
  schedulePersistentCandidate();
}

function readCandidate(
  start: HTMLElement,
  discovery: HoverCandidateDiscovery
): ActiveCandidate | null {
  const element = findImageElement(start);
  if (!element) return null;
  const adapter = siteAdapterRulesForHost(location.hostname);
  if (adapter.excludeSelectors.some((selector) => element.closest(selector))) return null;
  const rect = element.getBoundingClientRect();
  const image = element instanceof HTMLImageElement ? element : null;
  const pictureSources = image
    ? Array.from(image.closest("picture")?.querySelectorAll("source") ?? [])
      .filter((source) => !source.media || matchMedia(source.media).matches)
      .flatMap((source) => [source.srcset, source.dataset.srcset].filter((value): value is string => Boolean(value)))
    : [];
  const semanticNodes = [element, element.parentElement, element.parentElement?.parentElement].filter(Boolean) as HTMLElement[];
  const className = semanticNodes.map((node) =>
    `${typeof node.className === "string" ? node.className : ""} ${node.getAttribute("aria-label") ?? ""} ${node.getAttribute("title") ?? ""} ${node.dataset.testId ?? ""}`
  ).join(" ");
  const matchesSiteSelector = adapter.id === "generic" || adapter.imageSelectors.some((selector) =>
    element.matches(selector) || Boolean(element.closest(selector))
  );
  const sourceUrl = resolveHoverImage({
    currentSrc: image?.currentSrc ?? "",
    src: image?.src ?? "",
    srcset: image?.srcset ?? "",
    pictureSources,
    lazySrcsets: [
      image?.dataset.srcset,
      element.getAttribute("data-lazy-srcset")
    ].filter((value): value is string => Boolean(value)),
    lazySources: [
      element.dataset.src,
      element.dataset.original,
      element.dataset.lazySrc,
      element.dataset.image
    ].filter((value): value is string => Boolean(value)),
    backgroundImage: getComputedStyle(element).backgroundImage
  });
  if (!sourceUrl || sourceUrl.startsWith("data:image/svg")) return null;
  if (!isEligibleHoverCandidate({
    width: rect.width,
    height: rect.height,
    naturalWidth: image?.naturalWidth ?? 0,
    naturalHeight: image?.naturalHeight ?? 0,
    role: `${element.getAttribute("role") ?? ""} ${image?.alt ?? ""}`,
    className,
    insideVideo: Boolean(element.closest("video, [class*='video-control'], [class*='player-control']")),
    insideLink: Boolean(element.closest("a")),
    siteAdapter: adapter.id,
    matchesSiteSelector
  }, discovery)) return null;
  let absoluteUrl: string;
  try {
    absoluteUrl = new URL(sourceUrl, document.baseURI).href;
  } catch {
    return null;
  }
  return {
    element,
    sourceUrl: absoluteUrl,
    currentSrc: image?.currentSrc || absoluteUrl,
    key: candidateKey(absoluteUrl, rect),
    label: image?.alt.trim() ?? "",
    discovery
  };
}

function findImageElement(start: HTMLElement): HTMLElement | null {
  const startBox = start.getBoundingClientRect();
  const startRect = {
    left: startBox.left,
    top: startBox.top,
    right: startBox.right,
    bottom: startBox.bottom,
    width: startBox.width,
    height: startBox.height
  };
  for (let element: HTMLElement | null = start; element; element = element.parentElement) {
    if (element instanceof HTMLImageElement) return element;
    if (getComputedStyle(element).backgroundImage.includes("url(")) return element;
    const nestedImages = Array.from(element.querySelectorAll("img, picture > img"))
      .filter((candidate): candidate is HTMLImageElement => candidate instanceof HTMLImageElement)
      .filter((candidate, index, items) => items.indexOf(candidate) === index)
      .filter((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && canBindNestedImageFromTarget(startRect, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        });
      });
    if (nestedImages.length !== 1) {
      if (nestedImages.length > 1) return null;
    } else {
      return nestedImages[0]!;
    }
    if (element === document.body) break;
  }
  return null;
}
