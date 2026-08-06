import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);
const creationSetView = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/CreationSetView.tsx", import.meta.url),
  "utf8"
);
const background = readFileSync(
  new URL("../../apps/extension/entrypoints/background.ts", import.meta.url),
  "utf8"
);
const manifest = readFileSync(
  new URL("../../apps/extension/wxt.config.ts", import.meta.url),
  "utf8"
);

describe("作品管理与网页捕获产品契约", () => {
  it("未完成任务、单图与套图都提供直接删除，单图以重命名替代收藏", () => {
    expect(app).toContain('aria-label="删除未完成创作"');
    expect(app).toContain('aria-label="修改作品名称"');
    expect(creationSetView).toContain('aria-label="删除套图"');
    expect(app).not.toContain('aria-label={project.favorite ? "取消收藏" : "收藏"}');
    expect(creationSetView).toContain("set-status-badge");
  });

  it("套图从规划页开始即可修改名称并持久化", () => {
    expect(creationSetView).toContain('gridName ? "修改宫格作品名称" : "修改套图名称"');
    expect(creationSetView).toContain('gridName ? "宫格作品名称" : "套图名称"');
    expect(creationSetView).toContain("onTitleChange");
    expect(app).toContain("title: nextTitle");
  });

  it("宫格先回到换成我的，未选择主体时用可跳过提醒阻止首次直接生成", () => {
    expect(app).toContain("prepareDetectedGridCreation");
    expect(app).toContain("换成我的再复刻");
    expect(app).toContain("排版已准备 · 共");
    expect(app).toContain("尚未选择人物或商品");
    expect(app).toContain("不替换，继续生成");
    expect(app).toContain("先选择人物或商品");
  });

  it("逐格裁切后立即进入基础规划，并在后台用一次批量分析增强真实逐格语义", () => {
    expect(app).toContain('className="grid-planning-progress"');
    expect(app).toContain("完成后会直接进入本页的套图规划");
    expect(app).toContain("gridPlanningProgress");
    expect(app).toContain("无需等待远程逐格分析");
    expect(app).toContain("analyzeGridNative(");
    expect(app).toContain("void refineGridSemanticsInBackground");
    expect(app).toMatch(/gridSemanticStatus:[\s\S]{0,120}"refining"/);
    expect(app).toContain('source: "codex"');
  });

  it("套图生成中立即展示当前单张大图并区分生成与质量检查", () => {
    expect(creationSetView).toContain("当前单张结果");
    expect(creationSetView).toContain("已生成，正在检查");
    expect(creationSetView).toContain('className="set-current-result"');
    expect(creationSetView).toContain("查看全部单张");
  });

  it("单图多候选补齐失败时保留已经返回的候选并进入可重试结果页", () => {
    expect(app).toContain("NativeGenerationIncompleteError");
    expect(app).toContain("partialOutputs");
    expect(app).toContain("张候选已保留");
    expect(app).toContain('setStage("complete")');
    expect(app).toContain("requestedCount: parameters.count");
    expect(app).toContain("receivedCount: generated.length");
    expect(app).toContain("missingCount: outcome.missing");
    expect(app).toContain("count: outcome.missing as 1 | 2 | 3 | 4");
  });

  it("多候选和人物照片使用批量原子保存，质量建议不形成落盘门禁", () => {
    expect(app).toContain("saveAssets");
    const subjectDraft = app.slice(
      app.indexOf("async function saveSubjectDraft"),
      app.indexOf("async function updateIdentityBoardSubject")
    );
    expect(subjectDraft).not.toContain('return { saved: false, report }');
    expect(subjectDraft.indexOf("await saveAssets")).toBeGreaterThan(-1);
    expect(subjectDraft.indexOf("await saveSubjectAsset"))
      .toBeLessThan(subjectDraft.indexOf("void checkSubjectQualityNative"));
    expect(subjectDraft).toContain("照片版本未变化");
    expect(app).toContain("saveGenerationBundle");
  });

  it("套图只突出当前主操作并把次要动作收进一个更多操作入口", () => {
    expect(creationSetView).toContain('className="set-primary-actions"');
    expect(creationSetView).toContain('className="set-more-actions"');
    expect(creationSetView).toContain("更多操作");
    expect(creationSetView).toContain("创作依据与调整");
    expect(creationSetView).not.toContain('<summary>查看迁移方法</summary>');
    expect(creationSetView).not.toContain('<summary>调整这一组</summary>');
  });

  it("取消后的套图可继续，部分完成可导出，规划页不提供会破坏数量门禁的移除按钮", () => {
    expect(creationSetView).toContain('creationSet.status === "INTERRUPTED" || creationSet.status === "CANCELLED"');
    expect(creationSetView).toContain("partialSelectionProgress.ready");
    expect(creationSetView).not.toContain("移除这一张");
    expect(app).not.toContain("onRemovePlanItem=");
  });

  it("宫格边界调整提供实时叠线预览和 2/3/6/12 排列切换", () => {
    expect(app).toContain("GridBoundaryPreview");
    expect(app).toContain("可见裁切范围");
    expect(app).toContain("gridLayoutAlternatives");
    expect(app).toContain("切换排列");
  });

  it("套图通知区分完整、部分、取消和失败，并只展示未读项", () => {
    expect(app).toContain('status: "completed" | "partial" | "cancelled" | "failed"');
    expect(app).toContain("notification.unread &&");
    expect(app).toContain("部分完成");
    expect(app).toContain("已停止");
  });

  it("从 Side Panel 发起框选时不再次调用 sidePanel.open", () => {
    expect(background).toContain("beginAreaCapture(tab, false)");
  });

  it("扩展 Manifest 显式接入多尺寸 VisualForge 图标", () => {
    expect(manifest).toContain('icons: {');
    expect(manifest).toContain('"128": "icon/128.png"');
  });
});
