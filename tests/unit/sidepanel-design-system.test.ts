import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/style.css", import.meta.url),
  "utf8"
);
const app = readFileSync(
  new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
  "utf8"
);

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex.match(/[\da-f]{2}/gi)?.map((channel) => parseInt(channel, 16) / 255) ?? [];
    const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe("Side Panel 视觉基线", () => {
  it("使用统一的 4px 基础间距、线条、圆角与动效 Token", () => {
    for (const declaration of [
      "--space-1: 4px",
      "--space-2: 8px",
      "--space-3: 12px",
      "--space-4: 16px",
      "--space-5: 24px",
      "--space-6: 32px",
      "--line-hairline: 1px",
      "--line-emphasis: 2px",
      "--radius-sm: 8px",
      "--radius-md: 12px",
      "--radius-lg: 16px",
      "--motion-fast: 120ms",
      "--motion-base: 180ms",
      "--motion-slow: 220ms"
    ]) {
      expect(css).toContain(declaration);
    }
  });

  it("品牌行动色与信息、成功、警告、危险状态色彼此分离", () => {
    const values = ["#2b4355", "#245d91", "#2f624a", "#7a4b00", "#9c2f3b"];
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(css).toContain(value);
    expect(css).not.toContain("#a1462e");
    expect(css).not.toContain("#315f52");
  });

  it("关键导航和固定操作区复用线条与间距 Token", () => {
    expect(css).toMatch(/nav button::after[^}]*height: var\(--line-emphasis\)/);
    expect(css).toMatch(/header[^}]*border-bottom: var\(--line-hairline\)/);
    expect(css).toMatch(/footer[^}]*padding: var\(--space-3\) var\(--space-4\) var\(--space-4\)/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("分析、风格与结果操作显式重置浏览器默认按钮并保持可触达尺寸", () => {
    expect(css).toMatch(/button[^{]*\{[^}]*appearance:\s*none/s);
    expect(css).toMatch(/\.breakdown-actions button[^{]*\{[^}]*min-height:\s*40px/s);
    expect(css).toMatch(/\.signature-style-grid\s*>\s*button[^{]*\{[^}]*border:\s*1px solid var\(--border\)/s);
    expect(css).toMatch(/\.toast:not\(button\)[^{]*\{[^}]*pointer-events:\s*none/s);
  });

  it("Toast 避开首屏标题，360px 风格库改为单列并统一单选控件", () => {
    expect(css).toMatch(/\.toast\s*\{[^}]*top:\s*auto;[^}]*bottom:\s*24px/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*\.signature-style-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    expect(css).toMatch(/\.signature-style-options input\[type="radio"\][\s\S]*appearance:\s*none/s);
  });

  it("辅助文字达到正常文本 AA 对比度且紧凑删除按钮仍有 24px 触达区", () => {
    expect(css).toContain("--text-tertiary: #6a6b67");
    expect(css).toMatch(/\.dna-chips button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px/s);
  });

  it("套图交付方式不继承 40px 固定按钮并与生成操作保持纵向间距", () => {
    expect(css).toMatch(/\.delivery-options\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(css).toMatch(/\.delivery-options button\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/s);
    expect(css).toMatch(/\.delivery-options button:last-child\s*\{[^}]*grid-column:\s*1 \/ -1/s);
    expect(css).toMatch(/\.create-primary\s*\{[^}]*margin-top:\s*var\(--space-5\)/s);
  });

  it("未选交互边界达到 3:1 基线且长中文 Toast 不会被强制成单行", () => {
    const borderStrong = css.match(/--border-strong:\s*#([\da-f]{6})/i)?.[1] ?? "";
    const surface = css.match(/--surface:\s*#([\da-f]{6})/i)?.[1] ?? "";
    const canvas = css.match(/--canvas:\s*#([\da-f]{6})/i)?.[1] ?? "";
    expect(contrastRatio(borderStrong, surface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(borderStrong, canvas)).toBeGreaterThanOrEqual(3);
    expect(css).toMatch(/fieldset button\s*\{[^}]*border:\s*1px solid var\(--border-strong\)/s);
    expect(css).toMatch(/\.creation-options button\s*\{[^}]*border:\s*var\(--line-hairline\) solid var\(--border-strong\)/s);
    expect(css).not.toMatch(/\.toast\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.toast\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/s);
  });

  it("Windows 高对比度模式仍显示键盘焦点与当前选择", () => {
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*:focus-visible[^{]*\{[^}]*outline:\s*2px solid Highlight/s);
    expect(css).toMatch(/@media \(forced-colors: active\)[\s\S]*button\[aria-pressed="true"\][^{]*\{[^}]*border:\s*2px solid Highlight/s);
  });

  it("200% 缩放不强制页面最小宽度，窄屏恢复操作允许换行", () => {
    expect(css).not.toMatch(/html, body, #root\s*\{[^}]*min-width:\s*320px/s);
    expect(css).toMatch(/\.recovery-task\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.recovery-task\s*>\s*span\s*\{[^}]*min-width:\s*0/s);
  });

  it("生成规格暴露程序化选中状态，计时不会每秒重复播报", () => {
    expect(app).toContain('aria-pressed={creationForm === "single"}');
    expect(app).toContain("aria-pressed={ratio === option}");
    expect(app).toContain("aria-pressed={requestedSetCount === value}");
    expect(app).toContain("aria-pressed={deliveryMode === \"both\"}");
    expect(app).toContain('<time aria-hidden="true">');
    expect(app).not.toContain('className="progress-state" role="status" aria-live="polite" aria-atomic="true"');
  });

  it("主导航与作品分类标签具备可定位面板和键盘焦点语义", () => {
    expect(app).toContain('aria-controls={subjectEditor && route === "create" ? "subject-editor-panel" : "create-panel"}');
    expect(app).toContain('aria-controls={subjectEditor && route === "library" ? "subject-editor-panel" : "library-panel"}');
    expect(app).toContain('id="create-panel" role="tabpanel"');
    expect(app).toContain('id="library-panel" role="tabpanel"');
    expect(app).toContain('data-library-kind="works"');
    expect(app).toContain('tabIndex={libraryKind === "works" ? 0 : -1}');
  });
});
