import { describe, expect, it } from "vitest";
import {
  buildDiversityRetryPrompt,
  createCreationSetPlan,
  detectPerceptualDuplicates,
  hammingDistance
} from "@styleforge/core";

describe("整组视觉差异契约", () => {
  it.each(["portrait", "product", "poster", "illustration", "photography"] as const)(
    "%s 四张计划每项声明至少两个允许变化维度",
    (domain) => {
      const plan = createCreationSetPlan(domain, 4);
      expect(plan.every((item) => (item.variationDimensions?.length ?? 0) >= 2)).toBe(true);
      expect(new Set(plan.map((item) => item.variationDimensions!.sort().join("|"))).size).toBe(4);
    }
  );

  it("使用感知哈希标记具体近重复图片", () => {
    expect(hammingDistance("ff00", "ff01")).toBe(1);
    expect(detectPerceptualDuplicates([
      { itemId: "one", hash: "ffffffffffffffff" },
      { itemId: "two", hash: "fffffffffffffffe" },
      { itemId: "three", hash: "0000000000000000" }
    ], 4)).toEqual([{ itemIds: ["one", "two"], distance: 1 }]);
  });

  it("按更大差异重试会强化缺失维度而不是重复原 Prompt", () => {
    const prompt = buildDiversityRetryPrompt("原提示词", ["camera_angle", "environment"], "与第 1 张近重复");
    expect(prompt).toContain("必须显著改变");
    expect(prompt).toContain("相机角度");
    expect(prompt).toContain("环境");
    expect(prompt).toContain("与第 1 张近重复");
    expect(prompt).not.toBe("原提示词");
  });
});
