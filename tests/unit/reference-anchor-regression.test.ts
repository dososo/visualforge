import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  creationSetSchema,
  generationReferenceRoleSchema,
  setQualityIssueSchema,
  type CreationSet
} from "@styleforge/contracts";
import {
  compileSetItemPrompt,
  createCreativeDirection,
  createDirectedCreationSetPlan,
  createMigrationDomainProfile,
  isPortraitBlockingQualityIssue
} from "@styleforge/core";
import { createGridLayout } from "../../apps/extension/lib/grid-layout";
import { dna } from "./contracts.test";

function portraitSet(): CreationSet {
  const direction = createCreativeDirection({
    domain: "portrait",
    visualDNA: dna,
    domainProfile: undefined,
    userIntent: "把参考图中的人物换成我，保持原画面"
  });
  const planItems = createDirectedCreationSetPlan("portrait", 3, direction);
  return {
    schemaVersion: "1.0.0",
    id: "reference-anchor-set",
    projectId: "reference-anchor-project",
    title: "参考锚定套图",
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
    requestedCount: 3,
    deliveryMode: "both",
    gridLayout: null,
    userIntent: "把参考图中的人物换成我，保持原画面",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    transformationBlueprintSnapshot: null,
    signatureStyleSelection: null,
    sharedInvariants: ["参考图画面"],
    allowedVariations: ["相邻时刻"],
    status: "READY",
    completedCount: 0,
    failedCount: 0,
    createdAt: 1,
    updatedAt: 1,
    qualityReport: null,
    planItems
  };
}

describe("参考画面锚定与宫格输出 RED", () => {
  it("首张严格复刻参考画面，后续只允许相邻时刻的有限变化", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "把参考图中的人物换成我"
    });
    const plan = createDirectedCreationSetPlan("portrait", 3, direction);

    expect(plan[0]?.role).toBe("reference-anchor");
    expect(plan[0]?.promptDelta).toContain("严格保持参考画面的动作、表情、服装、道具、背景、构图、光影、色彩、材质和后期");
    for (const item of plan.slice(1)) {
      expect(item.variationDimensions.length).toBeLessThanOrEqual(2);
      expect(item.promptDelta).toContain("同一拍摄现场的相邻时刻");
      expect(item.promptDelta).toContain("服装、妆发、场景、时间、天气、主光、曝光、色彩和后期保持不变");
    }
  });

  it("套图 Prompt 使用参考画面编辑语义且不得要求新造服装、背景或动作", () => {
    const direction = createCreativeDirection({
      domain: "portrait",
      visualDNA: dna,
      domainProfile: undefined,
      userIntent: "把参考图中的人物换成我"
    });
    const first = createDirectedCreationSetPlan("portrait", 3, direction)[0]!;
    const prompt = compileSetItemPrompt({
      visualDNA: dna,
      domainProfile: { ...createMigrationDomainProfile(), domain: "portrait" },
      planItem: first,
      userIntent: "把参考图中的人物换成我",
      aspectRatio: "3:4",
      references: [
        { index: 1, role: "identity", imagePurpose: "face", subjectType: "person", subjectName: "我的人物" },
        { index: 2, role: "style_layout" }
      ],
      sharedInvariants: ["参考画面完整锚点", "同一人物"],
      allowedVariations: ["只替换人物身份"]
    });

    expect(prompt).toContain("编辑现有图像");
    expect(prompt).not.toContain("创建一张新的原创图像");
    expect(prompt).toContain("参考画面是最高优先级的视觉事实");
    for (const forbidden of [
      "新的无标识", "不复用具体背景", "不得原样保留参考图固定机位",
      "不复用具体主体位置", "不复用参考图具体动作", "允许姿势、服装和背景变化"
    ]) expect(prompt).not.toContain(forbidden);
  });

  it("参考动作、表情、服装、构图、光影和套图连续性问题均为阻断质量门", () => {
    const issueTypes = [
      "reference_pose_mismatch",
      "reference_expression_mismatch",
      "wardrobe_continuity_drift",
      "reference_composition_mismatch",
      "reference_lighting_mismatch",
      "set_continuity_mismatch"
    ] as const;
    for (const type of issueTypes) {
      const parsed = setQualityIssueSchema.safeParse({
        type,
        severity: "warning",
        itemIds: ["item-1"],
        message: "与待复刻画面不一致",
        suggestion: "只修复当前偏差"
      });
      expect(parsed.success, type).toBe(true);
      expect(isPortraitBlockingQualityIssue(type), type).toBe(true);
    }
  });

  it("定向修复拥有独立 edit_base 引用角色，不与待复刻画面或宫格裁切混名", () => {
    expect(generationReferenceRoleSchema.safeParse("edit_base").success).toBe(true);
  });

  it("CreationSet 向后兼容地分开输入宫格布局和最终组合布局", () => {
    const set = portraitSet();
    const sourceGridLayout = createGridLayout(3, 3);
    const compositeLayout = createGridLayout(3, 1);
    const result = creationSetSchema.safeParse({
      ...set,
      sourceGridLayout,
      compositeLayout
    });
    expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues, null, 2)).toBe(true);
    if (!result.success) return;
    expect(result.data.sourceGridLayout).toEqual(sourceGridLayout);
    expect(result.data.compositeLayout).toEqual(compositeLayout);
  });

  it("普通套图也可组合预览，且结果页先展示单张、再展示最终宫格", async () => {
    const view = await readFile(new URL(
      "../../apps/extension/entrypoints/sidepanel/CreationSetView.tsx",
      import.meta.url
    ), "utf8");
    const preview = view.slice(
      view.indexOf("function useGridCompositePreview"),
      view.indexOf("function ReferenceThumbnail")
    );
    expect(preview).toContain("resolveCompositeLayout(creationSet)");
    const resultsBranch = view.slice(view.indexOf("{planning ? ("), view.indexOf("{viewerIndex !== null"));
    expect(resultsBranch.indexOf('className="creation-set-grid"'))
      .toBeLessThan(resultsBranch.indexOf("<GridCompositeResult"));
    expect(view).toContain("最终宫格");
  });

  it("套图创建使用 style_layout，定向 Retry 把失败候选作为 edit_base 输入", async () => {
    const app = await readFile(new URL(
      "../../apps/extension/entrypoints/sidepanel/App.tsx",
      import.meta.url
    ), "utf8");
    expect(app).toContain('currentReferenceSnapshots(source, selectedSubject, "style_layout")');
    expect(app).not.toContain('currentReferenceSnapshots(source, selectedSubject, "style")');
    expect(app).toContain("retryDirective.sourceOutputAssetId");
    expect(app).toContain('role: "edit_base"');
  });

  it("Native Host 按参考画面保真维度评审，并识别 edit_base 为只修缺陷的候选", async () => {
    const host = await readFile(new URL(
      "../../apps/native-host/src/codex-client.ts",
      import.meta.url
    ), "utf8");
    for (const value of [
      "reference_pose_mismatch", "reference_expression_mismatch", "wardrobe_continuity_drift",
      "reference_composition_mismatch", "reference_lighting_mismatch", "set_continuity_mismatch"
    ]) expect(host).toContain(value);
    expect(host).toContain('reference.role === "edit_base"');
    expect(host).toContain("只修复明确缺陷，其他像素关系和参考锚点保持不变");
  });
});
