import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  candidateKey,
  canBindNestedImageFromTarget,
  choosePersistentCaptureCandidateIndex,
  chooseHoverToolbarPosition,
  hoverBlockerSelector,
  isBlockingHoverControl,
  isEligibleHoverCandidate,
  isHoverOverlayEvent,
  permissionOriginForUrl,
  resolveHoverImage,
  runWithoutCaptureOverlay,
  siteAdapterRulesForHost,
  siteAdapterForHost
} from "../../apps/extension/lib/hover-capture";

const hoverContentSource = readFileSync(
  new URL("../../apps/extension/entrypoints/hover.content.ts", import.meta.url),
  "utf8"
);
const backgroundSource = readFileSync(
  new URL("../../apps/extension/entrypoints/background.ts", import.meta.url),
  "utf8"
);

describe("网页图片常驻捕获", () => {
  it("使用固定宽度、40px 触达高度和中性画廊配色的常驻工具条", () => {
    expect(hoverContentSource).toContain("width: 158px");
    expect(hoverContentSource).toContain("height: 40px");
    expect(hoverContentSource).toContain("rgba(255,253,249,.97)");
    expect(hoverContentSource).toContain("outline: 2px solid #245d91");
    expect(hoverContentSource).toContain("#20201e");
    expect(hoverContentSource).not.toContain("#f6eae4");
    expect(hoverContentSource).not.toContain("#a1462e");
  });

  it("更多菜单支持点击工具条之外的区域关闭", () => {
    expect(hoverContentSource).toContain("const onDocumentPointerDown");
    expect(hoverContentSource).toContain(
      'document.addEventListener("pointerdown", onDocumentPointerDown, true)'
    );
    expect(hoverContentSource).toContain(
      'document.removeEventListener("pointerdown", onDocumentPointerDown, true)'
    );
  });

  it("普通捕获失败后重试原动作，不偷偷切换为框选模式", () => {
    expect(hoverContentSource).toContain('let lastCaptureIntent: HoverIntent = "use-style"');
    expect(hoverContentSource).toContain("const sendAreaCapture");
    expect(hoverContentSource).toContain('type: "hover.capture-area"');
    expect(hoverContentSource).toContain('state === "error" ? captureErrorLabel : "VisualForge"');
    expect(hoverContentSource).toContain('setCaptureButtonState("error")');
    expect(hoverContentSource).toContain('if (captureState === "error")');
    expect(hoverContentSource).toContain("void sendCapture(lastCaptureIntent)");
    expect(hoverContentSource).not.toContain("if (captureFailed)");
    expect(hoverContentSource).not.toContain("}, 1600)");
  });

  it("框选失败后主按钮重试的仍是框选，不会误走普通图片捕获", () => {
    expect(hoverContentSource).toContain('type LastCaptureAction = HoverIntent | "area"');
    expect(hoverContentSource).toContain('let lastCaptureAction: LastCaptureAction = "use-style"');
    expect(hoverContentSource).toContain('lastCaptureAction = "area"');
    expect(hoverContentSource).toContain('if (lastCaptureAction === "area")');
    expect(hoverContentSource).toContain('void sendAreaCapture()');
  });

  it("捕获进度、成功、失败和超时均可播报，成功反馈至少保留两秒", () => {
    expect(hoverContentSource).toContain('status.setAttribute("role", "status")');
    expect(hoverContentSource).toContain('status.setAttribute("aria-live", "polite")');
    expect(hoverContentSource).toContain('status.setAttribute("aria-atomic", "true")');
    expect(hoverContentSource).toContain('primary.setAttribute("aria-busy", String(state === "capturing"))');
    expect(hoverContentSource).toContain('primary.setAttribute("aria-label", captureAccessibleLabel(state))');
    expect(hoverContentSource).toContain('status.textContent = captureStatusAnnouncement(state)');
    expect(hoverContentSource).toContain('}, 2200)');
    expect(hoverContentSource).not.toContain(
      'const showPersistentCandidate = () => {\n    if (captureState === "success") resetCaptureButton()'
    );
  });

  it("动态加载重新定位图片时不会提前抹掉失败或超时重试状态", () => {
    expect(hoverContentSource).not.toContain('if (captureState !== "capturing") resetCaptureButton()');
    expect(hoverContentSource).not.toContain(
      'const showPersistentCandidate = () => {\n    if (captureState === "success") resetCaptureButton()'
    );
  });

  it("后台先确认已接单，网页只在真实完成后显示已接收", () => {
    const acknowledgement = backgroundSource.indexOf("sendResponse({ ok: true, accepted: true })");
    const capture = backgroundSource.indexOf("void captureWebCandidate(sender.tab");
    expect(acknowledgement).toBeGreaterThan(0);
    expect(capture).toBeGreaterThan(acknowledgement);
    expect(hoverContentSource).toContain("await terminalWait.promise");
    expect(hoverContentSource).toContain('state === "success" ? "已接收"');
  });

  it("无需 Hover 就选择视口内最主要的合格图片显示常驻入口", () => {
    expect(choosePersistentCaptureCandidateIndex([
      { left: 208, top: 81, right: 517, bottom: 633, width: 309, height: 552 },
      { left: 1062, top: 81, right: 1328, bottom: 557, width: 266, height: 476 },
      { left: 40, top: 20, right: 88, bottom: 68, width: 48, height: 48 }
    ], { width: 1512, height: 672 })).toBe(0);
    expect(chooseHoverToolbarPosition(
      { left: 208, top: 81, right: 517, bottom: 633, width: 309, height: 552 },
      { width: 92, height: 34 },
      { width: 1512, height: 672 },
      [],
      true
    )).toEqual({ left: 413, top: 93 });
  });

  it("备用截图执行前隐藏 VisualForge 控件，完成或失败后恢复", async () => {
    const events: string[] = [];
    await expect(runWithoutCaptureOverlay(
      (hidden) => events.push(hidden ? "隐藏控件" : "恢复控件"),
      async () => { events.push("等待绘制"); },
      async () => { events.push("执行捕获"); return "完成"; }
    )).resolves.toBe("完成");
    expect(events).toEqual(["隐藏控件", "等待绘制", "执行捕获", "恢复控件"]);

    const failed: string[] = [];
    await expect(runWithoutCaptureOverlay(
      (hidden) => failed.push(hidden ? "隐藏控件" : "恢复控件"),
      async () => { failed.push("等待绘制"); },
      async () => { throw new Error("捕获失败"); }
    )).rejects.toThrow("捕获失败");
    expect(failed).toEqual(["隐藏控件", "等待绘制", "恢复控件"]);
  });

  it("按 currentSrc、srcset、懒加载与背景图顺序解析最佳图片", () => {
    expect(resolveHoverImage({
      currentSrc: "https://img.test/current.jpg",
      src: "thumb.jpg",
      srcset: "small.jpg 320w, large.jpg 1600w",
      lazySources: ["https://img.test/original.webp"],
      backgroundImage: "none"
    })).toBe("https://img.test/current.jpg");
    expect(resolveHoverImage({
      currentSrc: "",
      src: "",
      srcset: "small.jpg 320w, large.jpg 1600w",
      lazySources: [],
      backgroundImage: "none"
    })).toBe("large.jpg");
    expect(resolveHoverImage({
      currentSrc: "",
      src: "",
      srcset: "",
      lazySources: ["https://img.test/lazy.webp"],
      backgroundImage: "none"
    })).toBe("https://img.test/lazy.webp");
    expect(resolveHoverImage({
      currentSrc: "",
      src: "",
      srcset: "",
      lazySources: [],
      backgroundImage: "url(\"https://img.test/background.jpg\")"
    })).toBe("https://img.test/background.jpg");
  });

  it("解析 picture、懒加载 srcset 与 CSS image-set 的高分辨率图片", () => {
    expect(resolveHoverImage({
      currentSrc: "",
      src: "",
      srcset: "",
      pictureSources: ["mobile.webp 1x, desktop.webp 2x"],
      lazySrcsets: [],
      lazySources: [],
      backgroundImage: "none"
    })).toBe("desktop.webp");
    expect(resolveHoverImage({
      currentSrc: "",
      src: "",
      srcset: "",
      pictureSources: [],
      lazySrcsets: ["lazy-small.jpg 480w, lazy-large.jpg 1600w"],
      lazySources: [],
      backgroundImage: "none"
    })).toBe("lazy-large.jpg");
    expect(resolveHoverImage({
      currentSrc: "",
      src: "",
      srcset: "",
      pictureSources: [],
      lazySrcsets: [],
      lazySources: [],
      backgroundImage: "image-set(url(\"background-small.jpg\") 1x, url(\"background-large.jpg\") 2x)"
    })).toBe("background-large.jpg");
  });

  it("排除头像、图标、广告小图与视频控件，只接受足够大的内容图", () => {
    expect(isEligibleHoverCandidate({
      width: 420, height: 560, naturalWidth: 1200, naturalHeight: 1600,
      role: "", className: "pin-image", insideVideo: false, insideLink: true
    })).toBe(true);
    for (const className of [
      "avatar user-photo",
      "emoji",
      "ad-badge",
      "site-icon",
      "advertisement",
      "sponsored content",
      "promoted pin",
      "推广内容",
      "赞助内容"
    ]) {
      expect(isEligibleHoverCandidate({
        width: 420, height: 560, naturalWidth: 1200, naturalHeight: 1600,
        role: "", className, insideVideo: false, insideLink: true
      })).toBe(false);
    }
    expect(isEligibleHoverCandidate({
      width: 48, height: 48, naturalWidth: 96, naturalHeight: 96,
      role: "", className: "", insideVideo: false, insideLink: false
    })).toBe(false);
    expect(isEligibleHoverCandidate({
      width: 64, height: 64, naturalWidth: 1600, naturalHeight: 1600,
      role: "", className: "", insideVideo: false, insideLink: false
    })).toBe(false);
    expect(isEligibleHoverCandidate({
      width: 420, height: 560, naturalWidth: 1200, naturalHeight: 1600,
      role: "", className: "", insideVideo: true, insideLink: false
    })).toBe(false);
  });

  it("自动常驻必须使用图片自然尺寸排除被 CSS 放大的低清缩略图", () => {
    const upscaledThumbnail = {
      width: 420, height: 560, naturalWidth: 96, naturalHeight: 96,
      role: "", className: "content-image", insideVideo: false, insideLink: true,
      siteAdapter: "generic" as const,
      matchesSiteSelector: true
    };
    expect(isEligibleHoverCandidate(upscaledThumbnail, "persistent")).toBe(false);
    expect(isEligibleHoverCandidate(upscaledThumbnail, "direct")).toBe(false);
  });

  it("卡片文字与图片不重叠时，不从文字祖先反向误绑卡片图片", () => {
    expect(canBindNestedImageFromTarget(
      { left: 20, top: 240, right: 280, bottom: 280, width: 260, height: 40 },
      { left: 20, top: 20, right: 280, bottom: 220, width: 260, height: 200 }
    )).toBe(false);
    expect(canBindNestedImageFromTarget(
      { left: 40, top: 160, right: 180, bottom: 200, width: 140, height: 40 },
      { left: 20, top: 20, right: 280, bottom: 220, width: 260, height: 200 }
    )).toBe(true);
    expect(hoverContentSource).toContain("canBindNestedImageFromTarget(startRect, {");
  });

  it("已适配站点的自动常驻只接收命中主图选择器的候选", () => {
    const base = {
      width: 420, height: 560, naturalWidth: 1200, naturalHeight: 1600,
      role: "", className: "content-image", insideVideo: false, insideLink: true
    };
    expect(isEligibleHoverCandidate({
      ...base,
      siteAdapter: "pinterest",
      matchesSiteSelector: false
    }, "persistent")).toBe(false);
    expect(isEligibleHoverCandidate({
      ...base,
      siteAdapter: "pinterest",
      matchesSiteSelector: true
    }, "persistent")).toBe(true);
    expect(isEligibleHoverCandidate({
      ...base,
      siteAdapter: "pinterest",
      matchesSiteSelector: false
    }, "direct")).toBe(true);
  });

  it("用户直接悬停仍可选择没有 natural 尺寸的 CSS 背景图", () => {
    const cssBackground = {
      width: 420, height: 300, naturalWidth: 0, naturalHeight: 0,
      role: "", className: "hero-background", insideVideo: false, insideLink: false,
      siteAdapter: "generic" as const,
      matchesSiteSelector: true
    };
    expect(isEligibleHoverCandidate(cssBackground, "persistent")).toBe(false);
    expect(isEligibleHoverCandidate(cssBackground, "direct")).toBe(true);
    expect(hoverContentSource).toContain('readCandidate(element, "persistent")');
    expect(hoverContentSource).toContain('readCandidate(element, "direct")');
    expect(hoverContentSource).toContain("readCandidate(active.element, active.discovery)");
  });

  it("悬浮工具条优先放在图片外，空间不足时放在不遮挡站点控件的图片内部", () => {
    const image = { left: 220, top: 180, right: 620, bottom: 680, width: 400, height: 500 };
    const toolbar = { width: 150, height: 38 };
    const viewport = { width: 1000, height: 800 };
    expect(chooseHoverToolbarPosition(image, toolbar, viewport, [])).toEqual({
      left: 470,
      top: 136
    });
    expect(chooseHoverToolbarPosition(image, toolbar, viewport, [
      { left: 460, top: 128, right: 630, bottom: 178, width: 170, height: 50 }
    ])).toEqual({
      left: 220,
      top: 136
    });
    expect(chooseHoverToolbarPosition(
      { left: 20, top: 20, right: 320, bottom: 420, width: 300, height: 400 },
      toolbar,
      { width: 340, height: 440 },
      []
    )).toEqual({
      left: 95,
      top: 370
    });
    expect(chooseHoverToolbarPosition(
      { left: 4, top: 4, right: 996, bottom: 796, width: 992, height: 792 },
      toolbar,
      viewport,
      [
        { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 }
      ]
    )).toBeNull();
  });

  it("把固定页头中的搜索框纳入遮挡检测，避免按钮存在但被 Pinterest 顶栏盖住", () => {
    expect(hoverBlockerSelector).toContain("[role='combobox']");
    expect(chooseHoverToolbarPosition(
      { left: 208, top: 81, right: 517, bottom: 633, width: 309, height: 552 },
      { width: 78, height: 30 },
      { width: 1512, height: 672 },
      [{ left: 87, top: 0, right: 1387, bottom: 64, width: 1300, height: 64 }]
    )).toEqual({ left: 525, top: 81 });
  });

  it("忽略覆盖大部分主图的结构链接层，但继续避让真实的小型操作控件", () => {
    const image = { left: 566, top: 163, right: 946, bottom: 732, width: 380, height: 569 };
    expect(isBlockingHoverControl(image, {
      left: 30, top: 163, right: 1482, bottom: 732, width: 1452, height: 569
    })).toBe(false);
    expect(isBlockingHoverControl(image, {
      left: 850, top: 180, right: 930, bottom: 228, width: 80, height: 48
    })).toBe(true);
  });

  it.each([
    ["pinterest.com", "pinterest"],
    ["behance.net", "behance"],
    ["dribbble.com", "dribbble"],
    ["unsplash.com", "unsplash"],
    ["pexels.com", "pexels"],
    ["pixabay.com", "pixabay"],
    ["xiaohongshu.com", "xiaohongshu"],
    ["example.com", "generic"]
  ])("%s 使用 %s 适配器", (host, adapter) => {
    expect(siteAdapterForHost(host)).toBe(adapter);
  });

  it.each([
    ["pinterest.com", "pin"],
    ["behance.net", "project"],
    ["dribbble.com", "shot"],
    ["unsplash.com", "photo"],
    ["pexels.com", "article"],
    ["pixabay.com", "article"],
    ["xiaohongshu.com", "note"]
  ])("%s 适配器包含稳定主图提示与排除规则", (host, selectorHint) => {
    const rules = siteAdapterRulesForHost(host);
    expect(rules.imageSelectors.join(" ").toLowerCase()).toContain(selectorHint);
    expect(rules.excludeSelectors.join(" ")).toMatch(/avatar|icon|video|control/i);
  });

  it("站点授权只请求当前 origin", () => {
    expect(permissionOriginForUrl("https://www.pinterest.com/pin/123")).toBe("https://www.pinterest.com/*");
    expect(permissionOriginForUrl("chrome://settings")).toBeNull();
  });

  it("瀑布流复用同一节点但更换图片后会得到新的候选键", () => {
    expect(candidateKey("https://img.test/a.jpg", { x: 10, y: 20, width: 400, height: 300 }))
      .not.toBe(candidateKey("https://img.test/b.jpg", { x: 10, y: 20, width: 400, height: 300 }));
  });

  it("焦点进入 VisualForge 工具条时不会把当前图片改成页面中的第一张图", () => {
    const host = {} as EventTarget;
    expect(isHoverOverlayEvent([{} as EventTarget, host], host)).toBe(true);
    expect(isHoverOverlayEvent([{} as EventTarget], host)).toBe(false);
  });
});
