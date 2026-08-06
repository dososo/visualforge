import { describe, expect, it } from "vitest";
import { analyzePrompt, compileSetItemPrompt, createCreationSetPlan } from "@styleforge/core";
import * as coreModule from "@styleforge/core";
import {
  normalizeSetQualityIssueType,
  type CreationSetPlanItem,
  type DomainProfile,
  type GenerationReferenceSnapshot
} from "@styleforge/contracts";
import { dna } from "./contracts.test";

function minimalProfile(domain: DomainProfile["domain"]): DomainProfile {
  return {
    schemaVersion: "1.0.0",
    domain,
    subdomain: null,
    confidence: 0.9,
    observedSignals: ["可观察依据"],
    profileVersion: `${domain}-v1`,
    source: "auto",
    details: {} as never
  };
}

describe("visual-prompt-v6 参考锚定与防漂移", () => {
  for (const domain of ["portrait", "product", "poster", "illustration", "photography"] as const) {
    it(`为 ${domain} 编译独立领域规则`, () => {
      const item = createCreationSetPlan(domain, 4)[0];
      const prompt = compileSetItemPrompt({
        visualDNA: dna,
        domainProfile: minimalProfile(domain),
        planItem: item,
        userIntent: "形成统一但有变化的一组",
        aspectRatio: "4:3",
        references: [
          { index: 1, role: "style" },
          { index: 2, role: "identity", subjectType: "person", subjectName: "小林" }
        ],
        sharedInvariants: ["人物身份", "核心风格"],
        allowedVariations: ["机位", "姿态"]
      });
      expect(prompt).toContain(`领域规则：${domain}`);
      expect(prompt).toContain(item.promptDelta);
      expect(prompt).toContain("全组不可变锚点");
      expect(prompt).toContain("每一张都重新使用原始参考图");
      expect(prompt).not.toContain("上一张输出");
    });
  }

  it("把香水品类的真实材质和结构方法写入商品镜头", () => {
    const item = createCreationSetPlan("product", 4)[0]!;
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("product"),
      planItem: item,
      userIntent: "高端广告",
      aspectRatio: "4:3",
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "subject", subjectType: "product", subjectName: "无品牌香水" }
      ],
      sharedInvariants: ["瓶体结构"],
      allowedVariations: ["机位"]
    });
    expect(prompt).toContain("玻璃边缘");
    expect(prompt).toContain("透明液体");
    expect(prompt).toContain("瓶盖或喷头");
    expect(prompt).toContain("侧后方或逆光");
  });

  it("把当前参考格的构图、景别、动作和情绪持久写入计划与 Prompt", () => {
    const applyGridCellAnalysis = (coreModule as unknown as {
      applyGridCellAnalysisToPlanItem?: (
        item: CreationSetPlanItem,
        analysis: {
          index: number;
          composition: string;
          shotScale: string;
          action: string;
          emotion: string;
        },
        reference: GenerationReferenceSnapshot
      ) => CreationSetPlanItem;
    }).applyGridCellAnalysisToPlanItem;
    expect(typeof applyGridCellAnalysis).toBe("function");
    const reference = {
      assetId: "cell-asset-1",
      hash: "a".repeat(64),
      mimeType: "image/png",
      role: "composition",
      sourceKind: "original",
      subjectAsset: null
    } as GenerationReferenceSnapshot;
    const item = applyGridCellAnalysis!(createCreationSetPlan("portrait", 4)[0]!, {
      index: 0,
      composition: "左侧人物与右侧负空间形成斜向张力",
      shotScale: "半身中景",
      action: "人物回身抬手，动作停在中间帧",
      emotion: "警觉但克制"
    }, reference);
    const enriched = item as CreationSetPlanItem & {
      gridCellReference: GenerationReferenceSnapshot | null;
      gridCellAnalysis: { composition: string } | null;
    };
    expect(enriched.gridCellReference?.assetId).toBe("cell-asset-1");
    expect(enriched.gridCellAnalysis?.composition).toContain("斜向张力");
    expect(item.creativePlan.shotScale).toBe("半身中景");
    expect(item.creativePlan.actionPhase).toContain("回身抬手");
    expect(item.creativePlan.emotion).toBe("警觉但克制");
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("portrait"),
      planItem: item,
      userIntent: "使用我的人物重演参考格的视觉职责",
      aspectRatio: "4:3",
      references: [{ index: 1, role: "composition" }, { index: 2, role: "identity" }],
      sharedInvariants: ["人物身份"],
      allowedVariations: ["服装"]
    });
    expect(prompt).toContain("参考格逐格语义分析");
    for (const value of ["左侧人物与右侧负空间形成斜向张力", "半身中景", "人物回身抬手", "警觉但克制"]) {
      expect(prompt).toContain(value);
    }
  });

  it("把面部与全身参考分成不同职责，并给人物镜头加入单动作关节链", () => {
    const item = createCreationSetPlan("portrait", 4)[1]!;
    const riskyItem = {
      ...item,
      creativePlan: {
        ...item.creativePlan,
        pose: "身体向左转，右臂跨过胸前",
        gesture: "右手从左侧腋下穿过并撑伞",
        actionPhase: "跨身取伞的中间帧"
      }
    };
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("portrait"),
      planItem: riskyItem,
      userIntent: "雨中人物写真",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "style" },
        { index: 2, role: "identity", subjectType: "person", subjectName: "小林", imagePurpose: "face" },
        { index: 3, role: "identity", subjectType: "person", subjectName: "小林", imagePurpose: "full_body" }
      ],
      sharedInvariants: ["人物身份", "体型轮廓"],
      allowedVariations: ["机位"]
    });

    expect(prompt).toContain("图 2：面部身份参考");
    expect(prompt).toContain("图 3：全身体型参考");
    expect(prompt).toContain("肩宽、腰胯轮廓、腿身比");
    expect(prompt).toContain("每只手只执行一个动作");
    expect(prompt).toContain("肩—肘—腕");
    expect(prompt).toContain("不得跨越身体中线或从对侧腋下穿过");
    expect(prompt).toContain("高风险动作已降级");
  });

  it("选择我的人物后优先身份参考并隔离风格图中的人物形象", () => {
    const orderGenerationReferences = (coreModule as unknown as {
      orderGenerationReferences?: (
        references: GenerationReferenceSnapshot[],
        domain: DomainProfile["domain"]
      ) => GenerationReferenceSnapshot[];
    }).orderGenerationReferences;
    expect(typeof orderGenerationReferences).toBe("function");
    const references = [
      { assetId: "style", role: "style", subjectAsset: null },
      { assetId: "composition", role: "composition", subjectAsset: null },
      { assetId: "body", role: "identity", subjectAsset: { imagePurposes: { body: "full_body" } } },
      { assetId: "face", role: "identity", subjectAsset: { imagePurposes: { face: "face" } } }
    ] as unknown as GenerationReferenceSnapshot[];
    const ordered = orderGenerationReferences!(references, "portrait");
    expect(ordered.map((reference) => reference.assetId)).toEqual([
      "face", "style", "body", "composition"
    ]);

    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("portrait"),
      planItem: createCreationSetPlan("portrait", 4)[0]!,
      userIntent: "使用我的人物",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "identity", imagePurpose: "face", subjectType: "person", subjectName: "小林" },
        { index: 2, role: "identity", imagePurpose: "full_body", subjectType: "person", subjectName: "小林" },
        { index: 3, role: "style" },
        { index: 4, role: "composition" }
      ],
      sharedInvariants: ["人物身份", "体型轮廓"],
      allowedVariations: ["机位"]
    });
    expect(prompt).toContain("图 1：面部身份参考");
    expect(prompt).toContain("图 2：全身体型参考");
    expect(prompt).toContain("风格图中的人物不是身份来源");
    for (const forbidden of ["脸", "体型", "肤色", "年龄", "发型", "服装", "动作"]) {
      expect(prompt).toMatch(new RegExp(`风格图[\\s\\S]{0,180}${forbidden}`));
    }
  });

  it("人物生成使用全部原始身份照片，以身份主照片和待复刻画面组成首要锚点", () => {
    const orderGenerationReferences = (coreModule as unknown as {
      orderGenerationReferences: (
        references: GenerationReferenceSnapshot[],
        domain: DomainProfile["domain"]
      ) => GenerationReferenceSnapshot[];
    }).orderGenerationReferences;
    const subject = {
      primaryImageId: "face-primary",
      imagePurposes: {
        "face-primary": "face", "face-2": "face", "face-3": "face", "face-4": "face", body: "full_body"
      }
    };
    const references = [
      { assetId: "template", role: "style_layout", sourceKind: "original", subjectAsset: null },
      ...["face-4", "face-2", "face-primary", "face-3", "body"].map((assetId) => ({
        assetId, role: "identity", sourceKind: "original", subjectAsset: subject
      })),
      { assetId: "board", role: "identity", sourceKind: "identity_board", subjectAsset: subject }
    ] as unknown as GenerationReferenceSnapshot[];

    expect(orderGenerationReferences(references, "portrait").map((item) => item.assetId)).toEqual([
      "face-primary", "template", "face-4", "face-2", "face-3", "body"
    ]);
  });

  it("把危险逐格动作降级为低遮挡关键帧并写出明确负向控制", () => {
    const applyGridCellAnalysis = (coreModule as unknown as {
      applyGridCellAnalysisToPlanItem: (
        item: CreationSetPlanItem,
        analysis: { index: number; composition: string; shotScale: string; action: string; emotion: string },
        reference: GenerationReferenceSnapshot
      ) => CreationSetPlanItem;
    }).applyGridCellAnalysisToPlanItem;
    const item = applyGridCellAnalysis(createCreationSetPlan("portrait", 4)[0]!, {
      index: 0,
      composition: "雨中半身构图",
      shotScale: "半身中景",
      action: "右臂从背后伸出并穿过左腋下撑伞，同时回头扭腰",
      emotion: "克制"
    }, {
      assetId: "cell", hash: "b".repeat(64), mimeType: "image/png", role: "composition",
      sourceKind: "original", subjectAsset: null
    });
    expect(item.gridCellAnalysis?.action).toContain("安全姿态");
    expect(item.gridCellAnalysis?.action).not.toMatch(/背后|腋下|扭腰/);
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("portrait"),
      planItem: item,
      userIntent: "雨中写真",
      aspectRatio: "3:4",
      references: [{ index: 1, role: "identity", imagePurpose: "face" }, { index: 2, role: "style" }],
      sharedInvariants: ["人物身份"],
      allowedVariations: ["机位"]
    });
    expect(prompt).toContain("负向控制（禁止出现）");
    for (const forbidden of ["多余手臂", "手臂从背后伸出", "对侧腋下穿臂", "反关节", "身体穿模"]) {
      expect(prompt).toContain(forbidden);
    }
    expect(prompt).toContain("稳定动作关键帧");
    expect(prompt).not.toContain("不得摆拍或站桩");
  });

  it("拍一套时把参考图摄影指纹设为整组硬约束而不是泛化风格", () => {
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("portrait"),
      planItem: createCreationSetPlan("portrait", 3)[1]!,
      userIntent: "按参考图拍一套",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "identity", imagePurpose: "face", subjectType: "person", subjectName: "小林" },
        { index: 2, role: "style_layout" },
        { index: 3, role: "identity", imagePurpose: "full_body", subjectType: "person", subjectName: "小林" }
      ],
      sharedInvariants: ["人物身份", "参考图摄影指纹"],
      allowedVariations: ["景别", "动作"]
    });

    expect(prompt).toContain("参考图摄影指纹（整组硬约束）");
    for (const anchor of ["光线方向与软硬", "曝光与高光", "饱和度与反差", "景深与镜头感", "材质与后期质感"]) {
      expect(prompt).toContain(anchor);
    }
    expect(prompt).toContain("镜头变化不得把参考图改成通用写真模板");
    expect(prompt).not.toContain("参考图的具体动作、服装、饰品、道具和背景都不是保持项");
  });

  it("全身人物把头身、躯干、腿部和透视作为独立硬约束", () => {
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: minimalProfile("portrait"),
      planItem: createCreationSetPlan("portrait", 3)[1]!,
      userIntent: "自然全身写真",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "identity", imagePurpose: "face", subjectType: "person", subjectName: "小林" },
        { index: 2, role: "style_layout" },
        { index: 3, role: "identity", imagePurpose: "full_body", subjectType: "person", subjectName: "小林" }
      ],
      sharedInvariants: ["人物身份", "体型轮廓"],
      allowedVariations: ["景别"]
    });

    expect(prompt).toContain("人物比例硬约束");
    for (const value of ["头身关系", "躯干长度", "腿身比", "腿部长度", "透视畸变"]) {
      expect(prompt).toContain(value);
    }
    expect(prompt).toContain("禁止大头小身、躯干缩短、腿部缩短");
  });

  it("参考图理解必须提取可观察摄影指纹而不是只给抽象风格词", () => {
    for (const detail of ["主体占画比例", "光线方向", "光线软硬", "高光", "饱和度", "反差", "景深", "颗粒", "锐度", "后期"]) {
      expect(analyzePrompt).toContain(detail);
    }
    expect(analyzePrompt).toContain("不得用高级、氛围感、电影感");
  });

  it("质量检查把大头小身、短躯干和短腿归入人物比例漂移", () => {
    expect(normalizeSetQualityIssueType("portrait", {
      type: "style_mismatch",
      message: "第 2 张头大身小，躯干过短且腿部长度不足",
      suggestion: "恢复自然头身关系"
    })).toBe("body_proportion_drift");
  });
});
