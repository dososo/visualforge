import { describe, expect, it } from "vitest";
import {
  domainProfileSchema,
  domainAnalysisResultSchema
} from "@styleforge/contracts";
import { dna } from "./contracts.test";

const portraitDetails = {
  personCount: 1,
  framing: "中景",
  pose: "站立回头",
  expression: "平静",
  wardrobe: "浅色衬衫",
  hairAndMakeup: "短发、自然妆面",
  environment: "室内",
  lensFeel: "标准镜头",
  depthOfField: "浅景深",
  lighting: "右侧柔光",
  skinToneRendering: "自然暖色",
  captureTexture: "数码细腻",
  subjectEnvironmentRelation: "人物与背景分离"
};

describe("DomainProfile contract", () => {
  it("保存自动识别的人像领域与可观察依据", () => {
    const profile = domainProfileSchema.parse({
      schemaVersion: "1.0.0",
      domain: "portrait",
      subdomain: "editorial",
      confidence: 0.88,
      observedSignals: ["画面中可见一名人物", "背景呈浅景深"],
      profileVersion: "portrait-v1",
      source: "auto",
      details: portraitDetails
    });
    expect(profile.domain).toBe("portrait");
    expect(profile.observedSignals).toHaveLength(2);
  });

  it("允许迁移数据保持低置信度未知而不伪造识别结果", () => {
    const profile = domainProfileSchema.parse({
      schemaVersion: "1.0.0",
      domain: "photography",
      subdomain: null,
      confidence: null,
      observedSignals: [],
      profileVersion: "migration-v1",
      source: "migration",
      details: {
        subject: null,
        scene: null,
        moment: null,
        framing: null,
        cameraPosition: null,
        lensFeel: null,
        depthOfField: null,
        exposure: null,
        lighting: null,
        color: null,
        composition: null,
        environmentTexture: null,
        postProcessing: null
      }
    });
    expect(profile.source).toBe("migration");
    expect(profile.confidence).toBeNull();
  });

  it("领域分析结果同时包含统一 Visual DNA", () => {
    const parsed = domainAnalysisResultSchema.parse({
      domainProfile: {
        schemaVersion: "1.0.0",
        domain: "portrait",
        subdomain: null,
        confidence: 0.8,
        observedSignals: ["可见人物面部"],
        profileVersion: "portrait-v1",
        source: "auto",
        details: portraitDetails
      },
      visualDNA: dna
    });
    expect(parsed.visualDNA.schemaVersion).toBe("1.1.0");
  });
});
