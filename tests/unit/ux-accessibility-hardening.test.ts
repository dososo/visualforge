import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("主体更换可达性", () => {
  const source = readSource(
    "../../apps/extension/entrypoints/sidepanel/SubjectAssets.tsx"
  );

  it("已选主体的更换按钮控制同一个候选面板，并在面板关闭后恢复焦点", () => {
    expect(source).toContain('aria-controls="subject-picker-options"');
    expect(source).toContain('id="subject-picker-options"');
    expect(source).toContain('event.key !== "Escape"');
    expect(source).toContain('querySelector<HTMLButtonElement>("button")?.focus()');
    expect(source).toContain("pickerTriggerRef.current?.focus()");
    expect(source).not.toContain("if (selected) {");
  });
});

describe("网页框选键盘路径", () => {
  const source = readSource(
    "../../apps/extension/entrypoints/capture.content.ts"
  );

  it("框选层具备模态语义、初始焦点、焦点圈定和焦点恢复", () => {
    expect(source).toContain('overlay.setAttribute("role", "dialog")');
    expect(source).toContain('overlay.setAttribute("aria-modal", "true")');
    expect(source).toContain("captureVisible.focus");
    expect(source).toMatch(/event\.key\s*[!=]==?\s*"Tab"/);
    expect(source).toContain("previousFocus?.focus");
  });

  it("不使用鼠标也能截取当前可见区域", () => {
    expect(source).toContain('captureVisible.textContent = "截取当前可见区域"');
    expect(source).toContain('captureVisible.addEventListener("click"');
    expect(source).toMatch(/x:\s*0,[\s\S]*y:\s*0,[\s\S]*width:\s*innerWidth,[\s\S]*height:\s*innerHeight/);
  });
});

describe("风格类别筛选语义", () => {
  const source = readSource(
    "../../apps/extension/entrypoints/sidepanel/StyleBreakdown.tsx"
  );

  it("类别是筛选按钮而非不完整的 tabs", () => {
    expect(source).toContain('aria-label="按风格类别筛选"');
    expect(source).toContain('aria-pressed={activeCategory === category}');
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('role="tab"');
  });
});

describe("套图查看器读屏反馈", () => {
  const source = readSource(
    "../../apps/extension/entrypoints/sidepanel/CreationSetView.tsx"
  );

  it("翻页后播报当前位置与动态标题", () => {
    expect(source).toContain('aria-labelledby="set-viewer-title"');
    expect(source).toContain('aria-live="polite"');
    expect(source).toContain("正在查看第 ${position} / ${total} 张：${title}");
  });
});
