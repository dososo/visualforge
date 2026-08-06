import { describe, expect, it } from "vitest";
import {
  normalizeSetQualityIssues,
  normalizeSetQualityIssueType,
  setQualityReportJsonSchema,
  setQualityIssueSchema
} from "@styleforge/contracts";
import { buildTargetedRetryPrompt, validateSetQualityReportItems } from "@styleforge/core";
import * as coreModule from "@styleforge/core";

const issueTypes = [
  "identity_drift",
  "emotion_flat",
  "pose_repeat",
  "composition_repeat",
  "style_mismatch",
  "geometry_drift",
  "structure_mismatch",
  "material_inconsistency",
  "label_drift",
  "text_layout_drift",
  "logo_position_drift",
  "duplicate_angle",
  "advertising_weakness"
] as const;

describe("Visual Critic", () => {
  it("向 Codex 提供的严格输出 Schema 要求每个问题对象返回全部字段", () => {
    const schema = setQualityReportJsonSchema as {
      properties?: {
        issues?: {
          items?: {
            properties?: Record<string, unknown>;
            required?: string[];
          };
        };
      };
    };
    const issue = schema.properties?.issues?.items;
    expect(issue?.required?.sort()).toEqual(Object.keys(issue?.properties ?? {}).sort());
  });

  it("接受人像与商品的十类精确问题，不再强迫模型使用泛化类别", () => {
    for (const type of issueTypes) {
      expect(setQualityIssueSchema.parse({
        type,
        severity: "warning",
        itemIds: ["shot-2"],
        message: "可观察问题",
        suggestion: "只重试问题单张"
      }).type).toBe(type);
    }
  });

  it("为评审问题保留具体维度、影响、重试重点和必须保持项", () => {
    const issue = setQualityIssueSchema.parse({
      type: "pose_repeat",
      dimension: "pose_diversity",
      severity: "warning",
      itemIds: ["shot-2"],
      message: "第 2 张与第 1 张重复站姿",
      impact: "套图缺少动作推进，故事停在同一时刻。",
      retryFocus: "改为动作发生中的重心转移和手部任务。",
      preserve: ["人物身份", "雨夜硬闪", "服装"],
      suggestion: "只重试第 2 张"
    });
    expect(issue.dimension).toBe("pose_diversity");
    expect(issue.impact).toContain("故事");
    expect(issue.retryFocus).toContain("重心");
    expect(issue.preserve).toEqual(["人物身份", "雨夜硬闪", "服装"]);
  });

  it("人物情绪问题只强化表情、姿态与光线，同时锁定身份和其他镜头", () => {
    const prompt = buildTargetedRetryPrompt(
      "原始镜头计划",
      "emotion_flat",
      "表情过于中性",
      "portrait",
      {
        impact: "情绪曲线没有形成高潮。",
        retryFocus: "强化眼神和动作中的身体重心。",
        preserve: ["人物身份", "服装", "雨夜硬闪"]
      }
    );
    expect(prompt).toContain("表情");
    expect(prompt).toContain("姿态");
    expect(prompt).toContain("光线");
    expect(prompt).toContain("人物身份");
    expect(prompt).toContain("只重试当前单张");
    expect(prompt).toContain("问题影响：情绪曲线没有形成高潮");
    expect(prompt).toContain("只强化：强化眼神和动作中的身体重心");
    expect(prompt).toContain("必须保持：人物身份、服装、雨夜硬闪");
  });

  it("商品结构问题锁定几何、比例、按钮、接口和关键结构", () => {
    const prompt = buildTargetedRetryPrompt(
      "原始镜头计划",
      "structure_mismatch",
      "瓶盖结构漂移",
      "product"
    );
    for (const field of ["几何", "比例", "按钮", "接口", "关键结构"]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("只重试当前单张");
  });

  it("把旧版质量类型确定性收敛到领域专用词表", () => {
    expect(normalizeSetQualityIssueType("portrait", {
      type: "structural_error",
      message: "人物左腿缺失，身体与摩托车遮挡关系不成立",
      suggestion: "重建双腿与车辆的接触关系"
    })).toBe("structural_error");
    expect(normalizeSetQualityIssueType("portrait", {
      type: "plan_mismatch",
      message: "人物手指融合且右脚缺失",
      suggestion: "修复人体结构"
    })).toBe("structural_error");
    expect(normalizeSetQualityIssueType("portrait", {
      type: "plan_mismatch",
      message: "缺少完整环境与景别差异",
      suggestion: "改变空间关系"
    })).toBe("composition_repeat");
    expect(normalizeSetQualityIssueType("product", {
      type: "plan_mismatch",
      message: "没有表达广告目的",
      suggestion: "加强产品价值"
    })).toBe("advertising_weakness");
    expect(normalizeSetQualityIssueType("product", {
      type: "near_duplicate",
      message: "相机角度与上一张重复",
      suggestion: "改成俯拍"
    })).toBe("duplicate_angle");
    expect(normalizeSetQualityIssueType("portrait", {
      type: "plan_mismatch",
      message: "情绪维度没有形成清楚递进",
      suggestion: "调整情绪，但不要改变人物身份"
    })).toBe("emotion_flat");
    expect(normalizeSetQualityIssueType("portrait", {
      type: "plan_mismatch",
      message: "服装配色直接复制参考，缺少独立造型",
      suggestion: "保持动作和机位"
    })).toBe("style_mismatch");
    expect(normalizeSetQualityIssues("portrait", [
      {
        type: "emotion_flat",
        severity: "warning",
        itemIds: ["shot-3"],
        message: "表情平",
        suggestion: "强化眼神"
      },
      {
        type: "plan_mismatch",
        severity: "warning",
        itemIds: ["shot-3"],
        message: "情绪没有形成递进",
        suggestion: "只调整第三张情绪"
      }
    ])).toEqual([
      expect.objectContaining({
        type: "emotion_flat",
        itemIds: ["shot-3"],
        message: expect.stringContaining("情绪没有形成递进")
      })
    ]);
    expect(normalizeSetQualityIssueType("product", {
      type: "plan_mismatch",
      message: "当前仍接近 Hero 陈列，缺少独立品牌目的与环境关系",
      suggestion: "保持产品材质，重建品牌世界"
    })).toBe("advertising_weakness");
    expect(normalizeSetQualityIssueType("product", {
      type: "plan_mismatch",
      message: "未执行俯视机位，仍是正面中近景构图",
      suggestion: "保持商品比例，改为顶视"
    })).toBe("duplicate_angle");
  });

  it("人像结构错误定向重试只修复身体和遮挡并保持身份", () => {
    const prompt = buildTargetedRetryPrompt(
      "原始摩托车人像镜头",
      "structural_error",
      "左腿缺失，车体遮挡关系不成立",
      "portrait",
      {
        retryFocus: "恢复两条腿各自连续的髋膝踝脚链路",
        preserve: ["人物身份", "脸型与五官", "原始光线"]
      }
    );
    expect(prompt).toContain("人体结构");
    expect(prompt).toContain("遮挡");
    expect(prompt).toContain("髋、膝、踝和脚");
    expect(prompt).toContain("整条腿完全藏在车体后");
    expect(prompt).toContain("人物身份必须保持不变");
    expect(prompt).not.toContain("按钮、接口、开合件");
  });

  it("商品标签、文字版式和 Logo 位置分别触发定向修复", () => {
    expect(normalizeSetQualityIssueType("product", {
      type: "plan_mismatch",
      message: "瓶身标签区域向右漂移",
      suggestion: "恢复标签安全区"
    })).toBe("label_drift");
    expect(normalizeSetQualityIssueType("product", {
      type: "plan_mismatch",
      message: "包装文字层级和版式错乱",
      suggestion: "保持文字块相对位置"
    })).toBe("text_layout_drift");
    expect(normalizeSetQualityIssueType("product", {
      type: "plan_mismatch",
      message: "Logo 位置偏离瓶盖中轴",
      suggestion: "恢复标志位置"
    })).toBe("logo_position_drift");
    expect(buildTargetedRetryPrompt(
      "商品原始提示词",
      "label_drift",
      "标签区域漂移",
      "product"
    )).toContain("标签区域");
  });

  it("拒绝不属于实际送检作品的编号和无问题依据的重试建议", () => {
    const report = {
      schemaVersion: "1.0.0" as const,
      checkedAt: 100,
      model: "critic",
      summary: "检查完成",
      checkedItemIds: ["shot-1"],
      issues: [{
        type: "emotion_flat" as const,
        severity: "warning" as const,
        itemIds: ["shot-1"],
        message: "情绪不足",
        suggestion: null
      }],
      suggestedRetryItemIds: ["shot-1"]
    };
    expect(validateSetQualityReportItems(report, ["shot-1"])).toBe(report);
    expect(() => validateSetQualityReportItems({
      ...report,
      suggestedRetryItemIds: ["hallucinated-shot"]
    }, ["shot-1"])).toThrow("不属于本次作品组");
    expect(() => validateSetQualityReportItems({
      ...report,
      issues: [],
      suggestedRetryItemIds: ["shot-1"]
    }, ["shot-1"])).toThrow("缺少对应问题");
  });

  it("合并空建议时不会把 null 写进用户可见文本", () => {
    const [issue] = normalizeSetQualityIssues("portrait", [{
      type: "emotion_flat",
      severity: "notice",
      itemIds: ["shot-3"],
      message: "表情平",
      suggestion: null
    }, {
      type: "emotion_flat",
      severity: "warning",
      itemIds: ["shot-3"],
      message: "眼神没有形成高潮",
      suggestion: "加强眼神"
    }]);
    expect(issue?.suggestion).toBe("加强眼神");
    expect(issue?.suggestion).not.toContain("null");
  });

  it("把脸、体型、动作与表情拆成独立硬质量门", () => {
    for (const type of ["identity_drift", "body_proportion_drift", "pose_anomaly", "expression_anomaly"] as const) {
      expect(setQualityIssueSchema.safeParse({
        type,
        dimension: type === "body_proportion_drift" ? "body_proportion" : null,
        severity: "warning",
        itemIds: ["shot-1"],
        message: "人物质量失败",
        impact: "不能进入候选",
        retryFocus: "只修复失败维度",
        preserve: ["其他已通过维度"],
        suggestion: "定向重试"
      }).success).toBe(true);
    }
    const isBlocking = (coreModule as unknown as {
      isPortraitBlockingQualityIssue?: (type: string) => boolean;
    }).isPortraitBlockingQualityIssue;
    expect(typeof isBlocking).toBe("function");
    for (const type of [
      "identity_drift", "body_proportion_drift", "structural_error", "pose_anomaly", "expression_anomaly"
    ]) expect(isBlocking?.(type)).toBe(true);
    expect(isBlocking?.("pose_repeat")).toBe(false);
  });

  it("按体型、异常动作和怪表情分别生成定向修复，第二次动作失败降级安全姿态", () => {
    const bodyPrompt = buildTargetedRetryPrompt(
      "原始人物镜头", "body_proportion_drift", "腿身比和肩胯轮廓漂移", "portrait"
    );
    expect(bodyPrompt).toContain("全身体型参考");
    expect(bodyPrompt).toContain("肩宽、腰胯轮廓、腿身比");

    const posePrompt = buildTargetedRetryPrompt(
      "原始人物镜头", "pose_anomaly", "右手从左腋下穿过并撑伞", "portrait", undefined, 2
    );
    expect(posePrompt).toContain("同侧持物");
    expect(posePrompt).toContain("安全姿态");
    expect(posePrompt).toContain("不得跨越身体中线");

    const expressionPrompt = buildTargetedRetryPrompt(
      "原始人物镜头", "expression_anomaly", "未要求的挤眼和夸张张嘴", "portrait"
    );
    expect(expressionPrompt).toContain("自然闭嘴");
    expect(expressionPrompt).toContain("眼睛对称可读");
  });
});
