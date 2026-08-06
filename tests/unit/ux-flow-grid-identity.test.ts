import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hoverSource = readFileSync(
  new URL("../../apps/extension/entrypoints/hover.content.ts", import.meta.url),
  "utf8"
);
const backgroundSource = readFileSync(
  new URL("../../apps/extension/entrypoints/background.ts", import.meta.url),
  "utf8"
);
const appSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);
const styleSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/StyleBreakdown.tsx", import.meta.url),
  "utf8"
);
const setViewSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/CreationSetView.tsx", import.meta.url),
  "utf8"
);
const runnerSource = readFileSync(
  new URL("../../apps/extension/lib/creation-set-runner.ts", import.meta.url),
  "utf8"
);
const appCss = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/style.css", import.meta.url),
  "utf8"
);

describe("UX Flow、宫格与人物质量门", () => {
  it("Hover 成功后重现恢复空闲状态", () => {
    expect(hoverSource).toContain('type CaptureButtonState = "idle" | "capturing" | "success" | "error"');
    expect(hoverSource).toContain("CAPTURE_TIMEOUT_MS = 45_000");
    expect(hoverSource).toContain("resetCaptureButton");
  });

  it("旧任务完成不覆盖当前浏览上下文", () => {
    expect(appSource).toContain("shouldRevealCompletedTask");
    expect(appSource).toContain("persistTaskNotification");
    expect(appSource).not.toMatch(/setCurrentProject\(savedProject\);\s*setOutputs\(savedOutputs\);\s*setStage\("complete"\);/);
  });

  it("真实套图质量检查保存结果但不抢回已离开的上下文", () => {
    expect(appSource).toContain("persistActiveCreationSet(next: CreationSet, reveal = true)");
    expect(appSource).toContain("if (reveal) {");
    expect(appSource).toContain("activeCreationSetIdRef.current = saved.id");
    expect(appSource).toContain("setActiveCreationSet(saved)");
    expect(appSource).toContain("loadCreationSetOutputs(creationSet, reveal)");
    expect(appSource).toContain("activeCreationSetIdRef.current === creationSet.id");
    expect(appSource).toContain("routeRef.current = next");
    expect(appSource).toContain("currentProjectIdRef.current = id");
    expect(appSource).toContain("activeCreationSetIdRef.current = creationSet.id");
  });

  it("Hover 取消会按 requestId 清除竞态写入", () => {
    expect(backgroundSource).toContain("...(requestId ? { requestId } : {})");
    expect(backgroundSource).toContain("stored.pendingWebImage?.requestId === requestId");
    expect(backgroundSource).toContain('chrome.storage.local.remove("pendingWebImage")');
  });

  it("套图单图在组内查看且关闭恢复上下文", () => {
    expect(setViewSource).toContain("setViewerIndex");
    expect(setViewSource).toContain("上一张");
    expect(setViewSource).toContain("下一张");
    expect(appSource).not.toContain("setActiveCreationSet(undefined);\n                  setCurrentProject(project);");
  });

  it("套图查看器完整管理初始焦点、焦点循环与关闭后的触发点", () => {
    expect(setViewSource).toContain('event.key === "Tab"');
    expect(setViewSource).toContain("closeButtonRef.current?.focus()");
    expect(setViewSource).toContain("viewerTrigger.current = trigger");
    expect(setViewSource).toContain("trigger?.focus()");
  });

  it("方向按最终主体而非参考图筛选", () => {
    expect(styleSource).toContain("subjectType");
    expect(styleSource).toContain("创作方向：保持参考图的感觉");
    expect(styleSource).toContain("更多人物风格");
    expect(styleSource).not.toContain("实验方向");
    expect(appSource).toContain('pet: "photography"');
    expect(appSource).toContain('character: "illustration"');
    expect(appSource).toContain('object: "product"');
  });

  it("生成规格无需展开更多选项", () => {
    for (const label of ["作品形式", "单张作品", "图片比例", "生成画面数", "最终保存什么", "两种都保存（推荐）"]) {
      expect(appSource).toContain(label);
    }
    expect(appSource).not.toMatch(/<details className="advanced"><summary>更多选项[\s\S]*比例/);
  });

  it("二宫格被识别后默认复刻两格，并用结果语言说明交付选项", () => {
    expect(appSource).toContain('2: "二宫格"');
    expect(appSource).toContain("复刻这张");
    expect(appSource).toContain("只要 {requestedSetCount} 张独立图");
    expect(appSource).toContain("只要一张{gridLayoutName(requestedSetCount)}成图");
    expect(appSource).toContain("[2, 3, 4, 6, 9, 12]");
  });

  it("规划页先确认已选画面数，不把另一组数字按钮伪装成下一步", () => {
    expect(setViewSource).toContain("已确定 {creationSet.requestedCount} 个画面");
    expect(setViewSource).toContain("<summary>修改画面数</summary>");
    expect(setViewSource).toContain("aria-pressed={creationSet.requestedCount === count}");
  });

  it("作品形式长文案不会塞进固定方块，宫格复刻只保留相关决策", () => {
    expect(appSource).toContain('className="creation-form-options" role="group"');
    expect(appCss).toMatch(/\.creation-form-options button\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;/s);
    expect(appCss).toMatch(/\.creation-form-options \.option-label\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/s);
    expect(appSource).toContain("gridCreationPrepared && detectedGrid ?");
    expect(appSource).toContain("复刻设置");
    expect(appSource).toContain("只保存一张");
    expect(appSource).toContain("成图＋{detectedGrid.count} 张独立图");
  });

  it("所有支持宫格共享清楚的复刻命名、规划动作与交付主按钮", () => {
    for (const [count, name] of [[2, "二宫格"], [3, "三宫格"], [4, "四宫格"], [6, "六宫格"], [9, "九宫格"], [12, "十二宫格"]] as const) {
      expect(appSource).toContain(`${count}: "${name}"`);
    }
    expect(appSource).toContain("· 复刻${gridLayoutName(gridLayout.count)}");
    expect(setViewSource).toContain("开始逐格生成");
    expect(setViewSource).toContain("导出宫格 PNG");
    expect(setViewSource).toContain("导出全部文件");
    expect(setViewSource).toContain("查看全部单格");
  });

  it("全插件主操作使用结果语言，避免检查、继续和再生成含义重叠", () => {
    expect(appSource).toContain("在网页图片上使用 VisualForge");
    expect(appSource).toContain("调整这张作品");
    expect(appSource).toContain("再生成一个版本");
    expect(appSource).toContain("单张默认生成");
    expect(appSource).toContain("换成我的再复刻");
    expect(appSource).toContain("作为单张创作");
    expect(appSource).not.toContain("反推提示词已保存，接下来选择要换成谁或什么");
    expect(appSource).not.toContain("宫格排版已保留；可以先选择人物或商品");
  });

  it("三宫格被识别并建立三个独立画面", () => {
    expect(appSource).toContain("检测到这是一组三宫格作品");
    expect(appSource).toContain("直接按三宫格复刻");
    expect(appSource).toContain("调整画面边界");
    expect(appSource).toContain("pendingGridLayoutRef.current?.count ?? requestedSetCount");
  });

  it("身份或结构问题只形成质量建议，不触发隐式重生或伪生成失败", () => {
    expect(runnerSource).toContain("qualityCheck");
    expect(runnerSource).not.toContain("maxTargetedRetries");
    expect(runnerSource).not.toContain('status: "FAILED" as const');
  });
});
