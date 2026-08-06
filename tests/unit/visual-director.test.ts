import { describe, expect, it } from "vitest";
import {
  compileSetItemPrompt,
  createCreativeDirection,
  createDirectedCreationSetPlan
} from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Visual Director Intelligence", () => {
  it("只从参考分析提炼六个隐藏导演维度，不让用户要求改写参考方法", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: {
        ...dna,
        mood: { ...dna.mood, emotionalTone: "孤独但克制", atmosphere: "雨后城市" },
        camera: { ...dna.camera, lens: "35mm 纪实镜头" },
        subject: { ...dna.subject, environment: "夜间街道" }
      },
      domainProfile: {
        schemaVersion: "1.0.0",
        domain: "portrait",
        subdomain: null,
        confidence: 0.9,
        observedSignals: ["人物与夜间街道形成关系"],
        routingState: "confirmed",
        secondCandidate: null,
        profileVersion: "portrait-v1",
        source: "auto",
        details: {
          personCount: 1, framing: "环境中景", pose: "行走", expression: "克制",
          wardrobe: "深色外套", hairAndMakeup: null, environment: "夜间街道",
          lensFeel: "35mm 纪实", depthOfField: "环境清晰", lighting: "路灯侧光",
          skinToneRendering: null, captureTexture: "轻颗粒",
          subjectEnvironmentRelation: "人物被城市空间包围"
        }
      },
      userIntent: "改成阳光海边婚礼"
    });
    expect(direction.visualStory).toContain("行走");
    expect(direction.visualStory).not.toContain("海边婚礼");
    expect(direction.visualTheme).toContain("克制");
    expect(direction.subjectState).toContain("行走");
    expect(direction.subjectRelationship).toBeTruthy();
    expect(direction.cameraLanguage).toContain("35mm");
    expect(direction.emotionalTone).toContain("孤独");
    expect(direction.environmentalContext).toContain("夜间街道");
    expect(direction.commercialIntent).toBeTruthy();
    expect(direction.creativePurpose).toBeTruthy();
    expect(direction.referenceAnchors).toContain("路灯侧光");
  });

  it("人像四张以参考锚点开场并在同一拍摄现场有限推进", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "日系街头故事"
    });
    const shots = createDirectedCreationSetPlan("portrait", 4, direction);
    expect(shots.map((shot) => shot.role)).toEqual([
      "reference-anchor", "environment-story", "emotional-close-up", "dynamic-moment"
    ]);
    expect(shots[0]?.variationDimensions).toEqual([]);
    expect(shots[0]?.promptDelta).toContain("严格保持参考画面");
    expect(shots.slice(1).every((shot) => shot.variationDimensions.length <= 2)).toBe(true);
    expect(shots.slice(1).every((shot) => shot.promptDelta.includes("同一拍摄现场的相邻时刻"))).toBe(true);
    for (const shot of shots) {
      expect(shot.creativePlan).toEqual(expect.objectContaining({
        concept: expect.any(String),
        narrativeContext: expect.any(String),
        storyPurpose: expect.any(String),
        subjectState: expect.any(String),
        cameraLanguage: expect.any(String),
        cameraHeight: expect.any(String),
        horizontalAngle: expect.any(String),
        pitchAngle: expect.any(String),
        shotScale: expect.any(String),
        lens: expect.any(String),
        perspective: expect.any(String),
        composition: expect.any(String),
        pose: expect.any(String),
        actionPhase: expect.any(String),
        gaze: expect.any(String),
        gesture: expect.any(String),
        emotion: expect.any(String),
        timeSense: expect.any(String),
        weatherSense: expect.any(String),
        lightDirection: expect.any(String),
        lightQuality: expect.any(String),
        shadowStrategy: expect.any(String),
        colorSystem: expect.any(String),
        lighting: expect.any(String),
        environment: expect.any(String),
        atmosphere: expect.any(String),
        material: expect.any(String),
        postProcessing: expect.any(String),
        shotResponsibility: expect.any(String)
      }));
      for (const field of [
        "故事目的", "主体状态", "环境", "镜头", "机位", "构图", "姿态", "手势",
        "情绪", "光线", "服装", "氛围"
      ]) expect(shot.promptDelta).toContain(`${field}：`);
      expect(shot.promptDelta).toContain("参考方法依据：");
      expect(shot.promptDelta).toContain(direction.cameraLanguage);
      expect(shot.promptDelta).not.toContain(`参考依据：${direction.referenceAnchors.join("；")}`);
      expect(shot.promptDelta).toContain("画面验收条件：");
      expect(shot.creativePlan.actionPhase).toBeTruthy();
      expect(shot.creativePlan.actionPhase).not.toMatch(/重新设计|另一个场景/);
    }
    expect(shots.every((shot) => shot.creativePlan.postProcessing.includes("保持参考画面"))).toBe(true);
  });

  it("人像十二宫格始终产生十二个可被逐格语义覆盖的计划项", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "按参考宫格重建"
    });
    const shots = createDirectedCreationSetPlan("portrait", 12, direction);
    expect(shots).toHaveLength(12);
    expect(new Set(shots.map((shot) => shot.id)).size).toBe(12);
    expect(shots.map((shot) => shot.order)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it.each(["poster", "illustration", "photography"] as const)("%s 十二宫格不会被模板长度截短", (domain) => {
    const direction = createCreativeDirection({
      domain,
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "按参考宫格重建"
    });
    const shots = createDirectedCreationSetPlan(domain, 12, direction);
    expect(shots).toHaveLength(12);
    expect(new Set(shots.map((shot) => shot.role)).size).toBe(12);
  });

  it("商品十二张计划覆盖完整品牌广告职责", () => {
    const direction = createCreativeDirection({
      domain: "product",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "无品牌香水广告"
    });
    const shots = createDirectedCreationSetPlan("product", 12, direction);
    expect(shots.map((shot) => shot.role)).toEqual([
      "reference-anchor",
      "brand-identity",
      "structural-view",
      "monumental-hero",
      "top-view-composition",
      "material-detail",
      "functional-detail",
      "human-relationship",
      "brand-mood",
      "dynamic-moment",
      "experimental-shot",
      "minimal-closing"
    ]);
    expect(shots[9]?.promptDelta).toContain("与商品功能一致的液体、喷雾、开合、倾倒或运动中间帧");
    expect(shots[9]?.promptDelta).not.toContain("人物必须处于");
    expect(shots[0]?.creativePlan.shotResponsibility).toContain("参考锚点");
    expect(shots.slice(1).every((shot) => shot.creativePlan.shotResponsibility.includes("相邻时刻"))).toBe(true);
  });

  it("商品四张形成广告创意而不是四次换背景", () => {
    const direction = createCreativeDirection({
      domain: "product",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "高端家居咖啡机广告"
    });
    const shots = createDirectedCreationSetPlan("product", 4, direction);
    expect(shots.map((shot) => shot.role)).toEqual([
      "reference-anchor", "lifestyle-scene", "usage-scene", "material-detail"
    ]);
    expect(shots.some((shot) => shot.promptDelta.includes("材质重点："))).toBe(true);
    expect(shots.every((shot) => shot.promptDelta.includes("广告情绪："))).toBe(true);
    expect(shots[0]!.promptDelta).toContain("锚定规则：严格保持参考画面");
    expect(shots.slice(1).every((shot) => shot.promptDelta.includes("服装、妆发、场景、时间、天气、主光、曝光、色彩和后期保持不变"))).toBe(true);
    expect(shots[1]!.promptDelta).toContain("可识别的真实生活空间");
    expect(shots[2]!.promptDelta).toContain("具体操作行为和可见结果");
    expect(shots[3]!.promptDelta).toContain("不得完整展示整台产品");
  });

  it("整组 Prompt 明确执行导演意图并禁止只换背景", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "电影环境肖像"
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
      userIntent: "电影环境肖像",
      aspectRatio: "3:4",
      references: [{ index: 1, role: "style_layout" }, { index: 2, role: "identity", subjectType: "person" }],
      sharedInvariants: ["人物身份"],
      allowedVariations: ["镜头", "动作"]
    });
    expect(prompt).toContain("参考画面是最高优先级的视觉事实");
    expect(prompt).toContain("先保持画面，再替换用户明确指定的主体");
    expect(prompt).toContain("故事目的：");
    expect(prompt).toContain("镜头：");
    expect(prompt).toContain("手势：");
    expect(prompt).toContain("动作阶段：");
    expect(prompt).toContain("相机高度：");
    expect(prompt).toContain("阴影策略：");
    expect(prompt).toContain("材质真实性：");
    expect(prompt).toContain("当前画面计划只覆盖它明确指定的");
    expect(prompt).toContain("其他维度继续保持参考图");
    expect(prompt).not.toContain("保持参考图动作强度");
    expect(item.promptDelta).toContain("同一拍摄现场的相邻时刻");
    expect(item.promptDelta).toContain("保持参考画面空间与构图骨架");
    expect(item.promptDelta).toContain("人物与世界形成明确关系");
  });

  it("Creative Shot Plan 保留参考画面可见服装与商品关系，但不把它当人物身份", () => {
    const portraitDirection = {
      ...createCreativeDirection({
        domain: "portrait",
        visualDNA: dna,
        userIntent: ""
      }),
      subjectState: "戴墨镜低头站立，五官被遮挡",
      stylingMethod: "黑色印花套装、帽子和墨镜",
      referenceAnchors: ["黑色印花套装、帽子和墨镜", "戴墨镜低头站立"]
    };
    const portrait = createDirectedCreationSetPlan("portrait", 4, portraitDirection);
    expect(portrait[0]!.promptDelta).toContain("锚定规则：严格保持参考画面");
    expect(portrait.every((item) => item.creativePlan.material.includes("保持参考画面"))).toBe(true);

    const productDirection = {
      ...createCreativeDirection({
        domain: "product",
        visualDNA: dna,
        userIntent: ""
      }),
      subjectState: "两只手操作白色咖啡机",
      subjectRelationship: "双手握持手柄，机器占满画面",
      stylingMethod: "白色外壳与黑色手柄",
      referenceAnchors: ["两只手操作白色咖啡机"]
    };
    const product = createDirectedCreationSetPlan("product", 4, productDirection);
    expect(product[0]!.promptDelta).toContain("严格保持参考画面");
    expect(product.slice(1).every((item) => item.promptDelta.includes("场景、时间、天气、主光、曝光、色彩和后期保持不变"))).toBe(true);
  });
});
