import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);
const setSource = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/CreationSetView.tsx", import.meta.url),
  "utf8"
);
const hoverSource = readFileSync(
  new URL("../../apps/extension/entrypoints/hover.content.ts", import.meta.url),
  "utf8"
);

describe("全流程关键回归", () => {
  it("先验证 Retry 上下文，再创建并保存重试任务", () => {
    const body = appSource.slice(
      appSource.indexOf("async function retryTask"),
      appSource.indexOf("async function removeInterruptedTask")
    );
    expect(body.indexOf("getAsset(task.input.sourceAssetId)")).toBeLessThan(body.indexOf("createRetryTask("));
    expect(body.indexOf("getProject(task.projectId)")).toBeLessThan(body.indexOf("createRetryTask("));
  });

  it("已有作品优先打开结果，不被后来失败任务吞掉", () => {
    expect(appSource).toContain("if (retryableTask && !visibleOutputAssetIds.length)");
  });

  it("再生成沿用当前作品已确认的完整提示词", () => {
    expect(appSource).toContain("event?.prompt ?? currentProject.compiledPrompt ?? \"\"");
  });

  it("套图先展示画面计划再开始，且没有人工选择时不冒充最终版本", () => {
    expect(setSource.indexOf("set-plan-list")).toBeLessThan(setSource.indexOf("set-start"));
    expect(setSource).toContain("尚未选定最终版本");
    expect(setSource).toContain("set-single-final-action");
    expect(setSource).not.toContain('item.selectedOutputAssetId ? "你已选定" : "当前版本"');
    expect(setSource).not.toContain("查看完整镜头脚本");
  });

  it("套图查看器准确说明单张操作会重新生成", () => {
    expect(setSource).toContain("重新生成这一张");
    expect(setSource).not.toContain("修改这一张");
  });

  it("多图容器不再用第一个后代图片猜测目标", () => {
    expect(hoverSource).toContain("nestedImages.length !== 1");
    expect(hoverSource).not.toContain('element.querySelector("img, picture > img")');
  });
});
