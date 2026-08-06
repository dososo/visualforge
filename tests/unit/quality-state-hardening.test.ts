import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gridCellAnalysisSchema } from "@styleforge/contracts";

const app = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);
const sidepanelEntry = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/main.tsx", import.meta.url),
  "utf8"
);

describe("质量状态、逐格语义与启动恢复收口", () => {
  it("旧逐格记录迁移为 baseline，新分析可显式标记 codex 来源", () => {
    const baseline = gridCellAnalysisSchema.parse({
      index: 0,
      composition: "居中",
      shotScale: "中景",
      action: "自然站立",
      emotion: "平静"
    });
    expect(baseline.source).toBe("baseline");
    expect(gridCellAnalysisSchema.parse({ ...baseline, source: "codex" }).source).toBe("codex");
  });

  it("单张人物检查不暗中追加生成，定向修复必须由用户触发", () => {
    expect(app).not.toContain("qualityRetryCount < 1 ? qualityRetryCount + 1 : 0");
    expect(app).not.toContain("automaticRetry");
    expect(app).toContain("是否生成修复版由你决定");
    expect(app).toContain("重新优化这一版");
  });

  it("启动恢复异常有 catch/finally、可重试页面，不会永久停在旋转图标", () => {
    expect(app).toContain("hydrationError");
    expect(app).toContain("retryHydration");
    expect(app).toContain("本地数据恢复未完成");
    expect(app).toContain("finally");
  });

  it("首次同意状态读取失败也进入可重试恢复页", () => {
    expect(sidepanelEntry).toContain("consentLoadError");
    expect(sidepanelEntry).toContain("retryConsentLoad");
    expect(sidepanelEntry).toContain("无法读取本地设置");
    expect(sidepanelEntry).toContain(".catch(");
  });
});
