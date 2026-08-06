import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeCaptureRect } from "../../apps/extension/lib/capture";

const captureContentSource = readFileSync(
  new URL("../../apps/extension/entrypoints/capture.content.ts", import.meta.url),
  "utf8"
);

describe("框选截图", () => {
  it("顶部明确说明拖动框选与 Esc 取消，并提供可点击的取消按钮", () => {
    expect(captureContentSource).toContain("拖动框选网页区域");
    expect(captureContentSource).toContain("Esc 取消");
    expect(captureContentSource).toContain('cancel.textContent = "取消"');
    expect(captureContentSource).toMatch(/cancel\.addEventListener\("click",\s*\(\)\s*=>\s*cleanup\(\)\)/);
  });

  it("小于 32px 时保留框选层并给出明确的重试提示", () => {
    expect(captureContentSource).toContain("框选区域太小");
    expect(captureContentSource).toContain("至少 32 × 32 像素");
    expect(captureContentSource).toMatch(
      /if \(rect\.width < 32 \|\| rect\.height < 32\)[\s\S]*?return;/
    );
  });

  it("把选择区域限制在可见视口内并保留 DPR", () => {
    expect(normalizeCaptureRect(
      { x: -10, y: 20, width: 300, height: 200, dpr: 2 },
      { width: 240, height: 180 }
    )).toEqual({ x: 0, y: 20, width: 240, height: 160, dpr: 2 });
  });

  it("拒绝小于最小尺寸的选择", () => {
    expect(() => normalizeCaptureRect(
      { x: 10, y: 10, width: 20, height: 20, dpr: 1 },
      { width: 800, height: 600 }
    )).toThrow(/32/);
  });
});
