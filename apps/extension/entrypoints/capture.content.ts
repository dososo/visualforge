export default defineContentScript({
  registration: "runtime",
  main() {
    startSelection();
  }
});

function startSelection() {
  if (document.getElementById("styleforge-capture-overlay")) return;
  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const overlay = document.createElement("div");
  overlay.id = "styleforge-capture-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "styleforge-capture-title");
  Object.assign(overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647", cursor: "crosshair",
    background: "rgba(0,0,0,.28)"
  });
  const guide = document.createElement("div");
  Object.assign(guide.style, {
    position: "fixed", left: "50%", top: "18px", transform: "translateX(-50%)",
    display: "flex", alignItems: "center", gap: "12px", padding: "7px 8px 7px 14px",
    maxWidth: "calc(100vw - 24px)", flexWrap: "wrap", justifyContent: "center",
    border: "1px solid #a1462e", borderRadius: "9px", background: "#f6eae4",
    boxShadow: "0 4px 16px rgba(31,27,23,.2)", color: "#1f1b17",
    font: "13px/1.4 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
    pointerEvents: "none"
  });
  const guideText = document.createElement("span");
  guideText.id = "styleforge-capture-title";
  guideText.textContent = "拖动框选网页区域 · Esc 取消";
  guideText.setAttribute("role", "status");
  const captureVisible = document.createElement("button");
  captureVisible.type = "button";
  captureVisible.textContent = "截取当前可见区域";
  Object.assign(captureVisible.style, {
    height: "40px", padding: "0 12px", border: "1px solid #713321", borderRadius: "6px",
    background: "#713321", color: "#fff", font: "600 13px -apple-system,sans-serif",
    cursor: "pointer", pointerEvents: "auto"
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  Object.assign(cancel.style, {
    height: "40px", padding: "0 12px", border: "1px solid #a1462e", borderRadius: "6px",
    background: "transparent", color: "#1f1b17", font: "600 13px -apple-system,sans-serif",
    cursor: "pointer", pointerEvents: "auto"
  });
  guide.append(guideText, captureVisible, cancel);
  const selection = document.createElement("div");
  Object.assign(selection.style, {
    position: "fixed", display: "none", border: "1px solid white",
    boxShadow: "0 0 0 9999px rgba(0,0,0,.28)", background: "transparent",
    pointerEvents: "none"
  });
  const label = document.createElement("span");
  Object.assign(label.style, {
    position: "absolute", right: "0", bottom: "-25px", padding: "3px 6px",
    borderRadius: "4px", background: "#191918", color: "#fff",
    font: "12px -apple-system, sans-serif", whiteSpace: "nowrap"
  });
  selection.append(label);
  overlay.append(selection, guide);
  document.documentElement.append(overlay);

  let startX = 0;
  let startY = 0;
  let active = false;
  const focusFrame = window.requestAnimationFrame(() => captureVisible.focus({ preventScroll: true }));
  const cleanup = (restoreFocus = true) => {
    window.cancelAnimationFrame(focusFrame);
    overlay.remove();
    window.removeEventListener("keydown", onKey);
    if (restoreFocus && previousFocus?.isConnected) previousFocus?.focus({ preventScroll: true });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cleanup();
      return;
    }
    if (event.key !== "Tab") return;
    const first = captureVisible;
    const last = cancel;
    if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };
  const sendCapture = async (rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    dpr: number;
  }) => {
    cleanup(false);
    await chrome.runtime.sendMessage({
      type: "capture.selection",
      rect,
      viewport: { width: innerWidth, height: innerHeight }
    });
  };
  captureVisible.addEventListener("click", () => void sendCapture({
    x: 0,
    y: 0,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio
  }));
  cancel.addEventListener("click", () => cleanup());
  window.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target !== overlay) return;
    active = true;
    startX = event.clientX;
    startY = event.clientY;
    guideText.textContent = "拖动框选网页区域 · Esc 取消";
    guideText.setAttribute("role", "status");
    selection.style.display = "block";
  });
  overlay.addEventListener("mousemove", (event) => {
    if (!active) return;
    const x = Math.min(startX, event.clientX);
    const y = Math.min(startY, event.clientY);
    const width = Math.abs(event.clientX - startX);
    const height = Math.abs(event.clientY - startY);
    Object.assign(selection.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    label.textContent = `${Math.round(width)} × ${Math.round(height)}`;
  });
  overlay.addEventListener("mouseup", async (event) => {
    if (!active) return;
    active = false;
    const rect = {
      x: Math.min(startX, event.clientX),
      y: Math.min(startY, event.clientY),
      width: Math.abs(event.clientX - startX),
      height: Math.abs(event.clientY - startY),
      dpr: devicePixelRatio
    };
    if (rect.width < 32 || rect.height < 32) {
      selection.style.display = "none";
      guideText.textContent = "框选区域太小，请重新拖动，至少 32 × 32 像素";
      guideText.setAttribute("role", "alert");
      return;
    }
    await sendCapture(rect);
  });
}
