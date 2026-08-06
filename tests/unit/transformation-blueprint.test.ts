import { describe, expect, it } from "vitest";
import {
  compileSetItemPrompt,
  createCreativeDirection,
  createDirectedCreationSetPlan,
  createTransformationBlueprint
} from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Transformation Blueprint", () => {
  it("把参考方法拆成保持、替换、重建和避免四类可执行规则", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      userIntent: "改成海边婚礼"
    });
    const blueprint = createTransformationBlueprint({
      domain: "portrait",
      visualDNA: dna,
      creativeDirection: direction,
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "identity", subjectType: "person", subjectName: "林夏" }
      ]
    });

    expect(blueprint.preserve.join("；")).toContain(direction.cameraLanguage);
    expect(blueprint.preserve.join("；")).toContain(direction.lightingMethod);
    expect(blueprint.replace.join("；")).toContain("林夏");
    expect(blueprint.replace.join("；")).toContain("人物身份");
    expect(blueprint.recreate.join("；")).toContain("动作");
    expect(blueprint.recreate.join("；")).toContain("场景");
    expect(blueprint.avoid.join("；")).toContain("只替换背景");
    expect(blueprint.avoid.join("；")).toContain("参考图人物");
    expect(blueprint.avoid.join("；")).toContain("具体服装");
    expect(blueprint.avoid.join("；")).toContain("遮挡用户人物");
  });

  it("商品迁移明确保持商品结构并重建可见的使用因果", () => {
    const direction = createCreativeDirection({
      domain: "product",
      visualDNA: dna,
      userIntent: "高端家居广告"
    });
    const blueprint = createTransformationBlueprint({
      domain: "product",
      visualDNA: dna,
      creativeDirection: direction,
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "subject", subjectType: "product", subjectName: "A01 咖啡机" }
      ]
    });

    expect(blueprint.replace.join("；")).toContain("A01 咖啡机");
    expect(blueprint.replace.join("；")).toContain("关键结构");
    expect(blueprint.recreate.join("；")).toContain("使用行为");
    expect(blueprint.recreate.join("；")).toContain("可见结果");
    expect(blueprint.avoid.join("；")).toContain("错误品牌");
  });

  it("不把参考图的具体动作、背景或内容禁令误当成跨镜头保持项", () => {
    const visualDNA = {
      ...dna,
      constraints: {
        ...dna.constraints,
        avoid: [
          "改变为无人物参与的纯静物陈列",
          "添加画面中不存在的品牌名称",
          "隐藏关键产品结构"
        ]
      }
    };
    const direction = {
      ...createCreativeDirection({
        domain: "product",
        visualDNA,
        userIntent: ""
      }),
      subjectRelationship: "两只手分别触碰机顶并握持手柄，咖啡机占满画面",
      stylingMethod: "白色外壳、双手握持手柄、浅灰背景"
    };
    const blueprint = createTransformationBlueprint({
      domain: "product",
      visualDNA,
      creativeDirection: direction,
      references: [{ index: 1, role: "style" }, { index: 2, role: "subject", subjectType: "product" }]
    });

    expect(blueprint.preserve.join("；")).not.toContain("两只手");
    expect(blueprint.preserve.join("；")).not.toContain("浅灰背景");
    expect(blueprint.avoid.join("；")).not.toContain("无人物参与的纯静物陈列");
    expect(blueprint.avoid.join("；")).toContain("品牌名称");
    expect(blueprint.avoid.join("；")).toContain("隐藏关键产品结构");
  });

  it("最终 Prompt 同时编译 Reference Intelligence、迁移蓝图和当前镜头", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      userIntent: "雨夜电影肖像"
    });
    const item = createDirectedCreationSetPlan("portrait", 4, direction)[1]!;
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: {
        schemaVersion: "1.0.0",
        domain: "portrait",
        subdomain: null,
        confidence: 0.9,
        observedSignals: ["人物摄影"],
        routingState: "confirmed",
        secondCandidate: null,
        profileVersion: "portrait-v1",
        source: "auto",
        details: {
          personCount: 1, framing: null, pose: null, expression: null,
          wardrobe: null, hairAndMakeup: null, environment: null, lensFeel: null,
          depthOfField: null, lighting: null, skinToneRendering: null,
          captureTexture: null, subjectEnvironmentRelation: null
        }
      },
      planItem: item,
      userIntent: "雨夜电影肖像",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "identity", subjectType: "person", subjectName: "林夏" }
      ],
      sharedInvariants: ["林夏的人物身份"],
      allowedVariations: ["动作", "镜头"]
    });

    expect(prompt).toContain("Reference Intelligence");
    expect(prompt).toContain("Visual DNA（视觉语言）");
    expect(prompt).toContain("Creative Direction（创作方法）");
    expect(prompt).toContain("Transformation Blueprint（迁移蓝图）");
    expect(prompt).toContain("Preserve｜保持");
    expect(prompt).toContain("Replace｜替换");
    expect(prompt).toContain("Recreate｜重新创造");
    expect(prompt).toContain("Avoid｜避免");
    expect(prompt).toContain("Creative Shot Plan");
    expect(prompt).toContain(item.creativePlan.storyPurpose);
    expect(prompt).toContain("参考图的动作、表情、服装、饰品、道具、背景、构图、摄影指纹、气质、材质与后期默认都是保持项");
    expect(prompt).toContain("当前画面计划只覆盖它明确指定的动作、景别、机位或环境变化，其他维度继续保持参考图");
  });
});
