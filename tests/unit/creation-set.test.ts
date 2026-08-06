import { describe, expect, it } from "vitest";
import {
  cancelCreationSet,
  createCreationSetPlan,
  deriveCreationSetStatus,
  retryFailedSetItems,
  resumeCreationSet
} from "@styleforge/core";
import type { CreationSet } from "@styleforge/contracts";
import { dna } from "./contracts.test";

const profile = (domain: CreationSet["domainProfile"]["domain"]) => ({
  schemaVersion: "1.0.0" as const,
  domain,
  subdomain: null,
  confidence: 0.9,
  observedSignals: ["测试依据"],
  profileVersion: `${domain}-v1`,
  source: "auto" as const,
  details: domain === "photography"
    ? {
        subject: "主体", scene: "场景", moment: "瞬间", framing: "中景",
        cameraPosition: "平视", lensFeel: "标准", depthOfField: "浅",
        exposure: "正常", lighting: "柔光", color: "自然", composition: "居中",
        environmentTexture: "细腻", postProcessing: "自然"
      }
    : {}
}) as CreationSet["domainProfile"];

function setFixture(planItems: CreationSet["planItems"]): CreationSet {
  return {
    schemaVersion: "1.0.0",
    id: "set-1",
    projectId: "project-1",
    title: "测试组",
    domainProfile: profile("photography"),
    requestedCount: planItems.length as 4 | 6 | 9 | 12,
    userIntent: "形成完整叙事",
    sharedVisualDNARevision: 1,
    sharedVisualDNASnapshot: dna,
    sharedReferenceSnapshots: [],
    subjectAssetSnapshots: [],
    sourceGenerationEventId: null,
    status: "GENERATING",
    completedCount: 0,
    failedCount: 0,
    createdAt: 1,
    updatedAt: 1,
    qualityReport: null,
    planItems
  };
}

describe("CreationSet 领域计划器", () => {
  for (const domain of ["portrait", "product", "poster", "illustration", "photography"] as const) {
    for (const count of [4, 6, 9] as const) {
      it(`${domain} 生成 ${count} 个不重复且可理解的计划`, () => {
        const items = createCreationSetPlan(domain, count);
        expect(items).toHaveLength(count);
        expect(new Set(items.map((item) => item.role)).size).toBe(count);
        expect(items.every((item) => item.userFacingTitle && item.promptDelta)).toBe(true);
        expect(items.every((item) => item.lockedDimensions.includes(domain === "portrait" ? "identity" : "style"))).toBe(true);
      });
    }
  }

  it("商品可创建 12 个职责明确且不重复的广告镜头", () => {
    const items = createCreationSetPlan("product", 12);
    expect(items).toHaveLength(12);
    expect(new Set(items.map((item) => item.role)).size).toBe(12);
  });

  it("取消整组保留完成项并取消未开始项", () => {
    const items = createCreationSetPlan("photography", 4).map((item, index) => ({
      ...item,
      status: index === 0 ? "COMPLETED" as const : index === 1 ? "GENERATING" as const : "PENDING" as const,
      outputAssetId: index === 0 ? "output-1" : null
    }));
    const cancelled = cancelCreationSet(setFixture(items), 20);
    expect(cancelled.planItems[0].status).toBe("COMPLETED");
    expect(cancelled.planItems.slice(1).every((item) => item.status === "CANCELLED")).toBe(true);
    expect(cancelled.completedCount).toBe(1);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("恢复时只恢复未完成项，不从零创建", () => {
    const items = createCreationSetPlan("photography", 4).map((item, index) => ({
      ...item,
      status: index === 0 ? "COMPLETED" as const : index === 1 ? "INTERRUPTED" as const : "CANCELLED" as const,
      outputAssetId: index === 0 ? "output-1" : null
    }));
    const resumed = resumeCreationSet(setFixture(items), 30);
    expect(resumed.planItems[0].status).toBe("COMPLETED");
    expect(resumed.planItems.slice(1).every((item) => item.status === "PENDING")).toBe(true);
  });

  it("单项重试只重置失败项并保留已完成输出", () => {
    const items = createCreationSetPlan("photography", 4).map((item, index) => ({
      ...item,
      status: index === 0 ? "COMPLETED" as const : index === 1 ? "FAILED" as const : "PENDING" as const,
      outputAssetId: index === 0 ? "output-1" : null
    }));
    const retried = retryFailedSetItems(setFixture(items), 40);
    expect(retried.planItems[0].outputAssetId).toBe("output-1");
    expect(retried.planItems[1].status).toBe("PENDING");
  });

  it("部分成功不会被判定为整组失败", () => {
    const items = createCreationSetPlan("photography", 4).map((item, index) => ({
      ...item,
      status: index < 2 ? "COMPLETED" as const : "FAILED" as const,
      outputAssetId: index < 2 ? `output-${index}` : null
    }));
    expect(deriveCreationSetStatus(items)).toEqual({
      status: "PARTIAL",
      completedCount: 2,
      failedCount: 2
    });
  });
});
