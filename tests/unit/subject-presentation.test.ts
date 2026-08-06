import { describe, expect, test } from "vitest";
import {
  subjectTypeLabels,
  subjectTypeOrder,
  subjectTypePresentation
} from "../../apps/extension/entrypoints/sidepanel/subject-presentation";

describe("主体类型用户侧文案", () => {
  test("五种类型各自拥有完整且不混用商品的创建文案", () => {
    expect(subjectTypeOrder).toEqual(["person", "product", "character", "pet", "object"]);
    expect(subjectTypeLabels).toEqual({
      person: "人物",
      product: "商品",
      character: "角色",
      pet: "宠物",
      object: "物件"
    });
    expect(subjectTypePresentation.character).toMatchObject({
      createTitle: "添加我的角色",
      editTitle: "编辑角色",
      namePlaceholder: "例如：星野",
      mediaLabel: "角色图片"
    });
    expect(subjectTypePresentation.pet).toMatchObject({
      createTitle: "添加我的宠物",
      editTitle: "编辑宠物",
      namePlaceholder: "例如：豆包",
      mediaLabel: "宠物照片"
    });
  });

  test("每种类型都有独立的创建、编辑、媒体和创作输入提示", () => {
    for (const type of subjectTypeOrder) {
      const copy = subjectTypePresentation[type];
      expect(copy.createTitle).toContain(copy.label);
      expect(copy.editTitle).toContain(copy.label);
      expect(copy.mediaLabel).toContain(copy.label);
      expect(copy.addMediaLabel).toContain(copy.label);
      expect(copy.instructionPlaceholder.length).toBeGreaterThan(18);
    }
    expect(new Set(subjectTypeOrder.map((type) => subjectTypePresentation[type].instructionPlaceholder)).size)
      .toBe(subjectTypeOrder.length);
  });
});
