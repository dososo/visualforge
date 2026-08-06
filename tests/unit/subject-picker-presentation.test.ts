import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  prioritizeSubjectAssets,
  subjectPickerTypeGroups
} from "../../apps/extension/entrypoints/sidepanel/SubjectAssets";

describe("主体选择渐进披露", () => {
  it("按当前领域只突出一个推荐类型，其余类型保留在其他对象", () => {
    expect(subjectPickerTypeGroups("product")).toEqual({
      primary: ["product"],
      other: ["person", "character", "pet", "object"]
    });
    expect(subjectPickerTypeGroups()).toEqual({
      primary: ["person", "product"],
      other: ["character", "pet", "object"]
    });
  });

  it("最近使用优先显示领域匹配对象且不丢失角色和宠物", () => {
    const assets = [
      { id: "pet", type: "pet" },
      { id: "person", type: "person" },
      { id: "character", type: "character" }
    ] as never[];
    expect(prioritizeSubjectAssets(assets, "person").map((asset) => asset.id))
      .toEqual(["person", "pet", "character"]);
    expect(prioritizeSubjectAssets(assets).map((asset) => asset.id))
      .toEqual(["pet", "person", "character"]);
  });
});

describe("参考图分析渐进披露", () => {
  const source = readFileSync(
    new URL("../../apps/extension/entrypoints/sidepanel/StyleBreakdown.tsx", import.meta.url),
    "utf8"
  );

  it("首层使用普通用户语言且不展示置信度", () => {
    expect(source).toContain("这张图的创作方法");
    expect(source).toContain("可复用的创作提示词");
    expect(source).toContain("确认这个创作方向");
    expect(source).not.toContain("置信度");
  });

  it("专业分析和按最终主体筛选的风格能力仍通过次级入口保留", () => {
    expect(source).toContain("查看专业分析");
    expect(source).toContain("换个方向");
    expect(source).toContain("创作方向：保持参考图的感觉");
    expect(source).toContain("更多人物风格");
    expect(source).not.toContain("实验方向");
    expect(source).toContain("查看「{selectedStyle.name}」的 VisualForge 原创组合方法");
  });
});
