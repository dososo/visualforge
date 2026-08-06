import { describe, expect, it } from "vitest";
import { compilePrompt } from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Reference Role Compiler", () => {
  it("分别编译风格、人物、主体和构图约束", () => {
    const prompt = compilePrompt({
      visualDNA: dna,
      userInstruction: "换到厨房场景",
      aspectRatio: "4:3",
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "identity", subjectType: "person", subjectName: "小林" },
        { index: 3, role: "subject", subjectType: "product", subjectName: "咖啡机" },
        { index: 1, role: "composition" }
      ]
    });
    expect(prompt).toContain("图 1：风格参考");
    expect(prompt).toContain("图 2：人物身份参考");
    expect(prompt).toContain("小林");
    expect(prompt).toContain("五官比例、年龄感和主要外观");
    expect(prompt).toContain("图 3：主体参考");
    expect(prompt).toContain("咖啡机");
    expect(prompt).toContain("严格保持产品外形、比例、材质和关键结构");
    expect(prompt).toContain("Logo 和文字只在模型能力允许时尽量保留");
    expect(prompt).toContain("图 1：构图参考");
    expect(prompt).toContain("风格图中的人物不是身份来源");
    expect(prompt).toContain("禁止继承其脸、体型、肤色、年龄、发型、服装和动作");
    expect(prompt).toContain("不得生成网页界面、浮层按钮、菜单或白色信息框");
  });

  it("纯风格参考不把参考图具体主体和布局写入必须保持", () => {
    const styleDNA = {
      ...dna,
      invariants: ["中央大型圆顶拱形"],
      constraints: { ...dna.constraints, preserve: ["底部独立水平横条"] }
    };
    const prompt = compilePrompt({
      visualDNA: styleDNA,
      userInstruction: "保持同一人物，创作自然光写真",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "identity", subjectType: "person", subjectName: "小林" }
      ]
    });
    const mustPreserve = prompt.slice(prompt.indexOf("必须保持："), prompt.indexOf("采用以下视觉语言："));
    expect(mustPreserve).not.toContain("圆顶拱形");
    expect(mustPreserve).not.toContain("水平横条");
    expect(mustPreserve).toContain("风格关键词");
    expect(prompt).toContain("根据新主体重建构图");
  });

  it("待复刻画面模板默认保持具体画面，只替换用户主体", () => {
    const prompt = compilePrompt({
      visualDNA: dna,
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "identity", subjectType: "person", subjectName: "小林", imagePurpose: "face" },
        { index: 2, role: "style_layout" }
      ]
    });

    expect(prompt).toContain("图 2：待复刻画面模板");
    expect(prompt).toContain("具体景别、机位、主体位置、画面元素、背景、道具");
    expect(prompt).toContain("仅替换为用户指定主体");
    expect(prompt).not.toContain("创作内容不同的新作品");
    expect(prompt).not.toContain("根据新主体重建构图");
    expect(prompt).not.toContain("不复用具体背景");
    expect(prompt).not.toContain("重新创造场景");
  });

  it("未选择替换主体时保持待复刻图的原主体，不凭空换人换商品", () => {
    const prompt = compilePrompt({
      visualDNA: dna,
      aspectRatio: "3:4",
      references: [{ index: 1, role: "style_layout" }]
    });
    expect(prompt).toContain("未指定替换主体，保持参考图核心主体");
    expect(prompt).not.toContain("将参考图具体主体替换为用户指定的新主体");
  });

  it("优先编译已确认的商品身份锁约束", () => {
    const prompt = compilePrompt({
      visualDNA: dna,
      aspectRatio: "4:3",
      references: [{
        index: 2,
        role: "subject",
        subjectType: "product",
        subjectName: "咖啡机",
        subjectConstraints: [
          "必须保持商品完整外形、长宽厚比例、轮廓和朝向关系",
          "必须保持按钮、接口和组件的位置与形状"
        ]
      }]
    });
    expect(prompt).toContain("必须保持商品完整外形、长宽厚比例、轮廓和朝向关系");
    expect(prompt).toContain("必须保持按钮、接口和组件的位置与形状");
    expect(prompt).not.toContain("尽量保持产品外形");
  });
});
