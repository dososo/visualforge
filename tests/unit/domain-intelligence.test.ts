import { describe, expect, it } from "vitest";
import {
  DOMAIN_ANALYSIS_PROMPTS,
  createMigrationDomainProfile,
  normalizeAutoDomainProfile,
  overrideDomainProfile
} from "@styleforge/core";
import type { DomainProfile } from "@styleforge/contracts";

describe("领域识别与五领域分析模板", () => {
  for (const domain of ["portrait", "product", "poster", "illustration", "photography"] as const) {
    it(`高置信度 ${domain} 分类不会被错误改写`, () => {
      const base = overrideDomainProfile(createMigrationDomainProfile(), domain);
      const result = normalizeAutoDomainProfile({
        ...base,
        confidence: 0.91,
        source: "auto",
        observedSignals: [`${domain} 明确信号`]
      } as DomainProfile);
      expect(result.domain).toBe(domain);
      expect(result.source).toBe("auto");
      expect(result.confidence).toBe(0.91);
    });
  }

  it("提供五套不同且包含领域重点的分析模板", () => {
    expect(Object.keys(DOMAIN_ANALYSIS_PROMPTS).sort()).toEqual([
      "illustration", "photography", "portrait", "poster", "product"
    ]);
    expect(DOMAIN_ANALYSIS_PROMPTS.portrait).toContain("五官");
    expect(DOMAIN_ANALYSIS_PROMPTS.product).toContain("关键结构");
    expect(DOMAIN_ANALYSIS_PROMPTS.poster).toContain("信息层级");
    expect(DOMAIN_ANALYSIS_PROMPTS.illustration).toContain("线稿");
    expect(DOMAIN_ANALYSIS_PROMPTS.photography).toContain("事件或瞬间");
    expect(new Set(Object.values(DOMAIN_ANALYSIS_PROMPTS)).size).toBe(5);
  });

  it("低置信度自动识别保留候选领域并标记 uncertain", () => {
    const input = {
      schemaVersion: "1.0.0",
      domain: "poster",
      subdomain: null,
      confidence: 0.42,
      observedSignals: ["画面主体难以稳定分类"],
      profileVersion: "poster-v1",
      source: "auto",
      details: {
        canvasRatio: null, grid: null, hierarchy: null, titleRole: null,
        bodyRole: null, typeCategory: null, typeScaleRelation: null,
        textBlockPositions: [], imageBlockPositions: [], whitespace: null,
        decorativeGraphics: [], border: null, material: null, printEffect: null,
        safeArea: null, readingOrder: [], readableText: null
      }
    } satisfies DomainProfile;
    const result = normalizeAutoDomainProfile({
      ...input,
      routingState: "confirmed",
      secondCandidate: { domain: "illustration", confidence: 0.34 }
    } as DomainProfile);
    expect(result.domain).toBe("poster");
    expect(result.confidence).toBe(0.42);
    expect(result.routingState).toBe("uncertain");
    expect(result.secondCandidate).toEqual({ domain: "illustration", confidence: 0.34 });
    expect(result.observedSignals).toEqual(["画面主体难以稳定分类"]);
  });

  it("用户覆盖保留自动识别证据但不伪造来源", () => {
    const migrated = createMigrationDomainProfile();
    const overridden = overrideDomainProfile(migrated, "illustration");
    expect(overridden.domain).toBe("illustration");
    expect(overridden.source).toBe("user_override");
    expect(overridden.routingState).toBe("user_overridden");
    expect(overridden.confidence).toBeNull();
    expect(overridden.observedSignals).toEqual([]);
  });

  it("用户确认当前领域时保留真实分析详情", () => {
    const analyzed = {
      ...createMigrationDomainProfile(),
      details: {
        ...createMigrationDomainProfile().details,
        subject: "山间人物",
        lighting: "暖色侧逆光"
      }
    } as DomainProfile;
    const confirmed = overrideDomainProfile(analyzed, "photography");
    expect(confirmed.source).toBe("user_override");
    expect(confirmed.details).toMatchObject({
      subject: "山间人物",
      lighting: "暖色侧逆光"
    });
  });
});
