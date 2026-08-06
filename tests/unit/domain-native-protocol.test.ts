import { describe, expect, it } from "vitest";
import { nativeRequestSchema, nativeResponseSchema } from "@styleforge/contracts";
import {
  buildSignatureStyleCriticContext,
  createCreationSetPlan,
  createMigrationDomainProfile,
  createSignatureStyleSelection,
  getSignatureStyle
} from "@styleforge/core";
import { dna } from "./contracts.test";

describe("领域分析与整组质量 Native Protocol", () => {
  const creativePlan = createCreationSetPlan("portrait", 4)[0]!.creativePlan;
  const qualityContext = {
    domain: "portrait",
    references: [{ assetId: "reference-style", role: "style" }],
    sharedInvariants: ["同一女性人物身份"]
  };
  it("接收独立领域分析请求", () => {
    expect(nativeRequestSchema.parse({
      protocolVersion: 1,
      requestId: "request-domain",
      type: "domain.analysis.start",
      payload: { taskId: "task-domain", assetId: "asset-domain" }
    }).type).toBe("domain.analysis.start");
  });

  it("接收最多 12 张整组质量检查请求", () => {
    expect(nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality",
      type: "creation-set.quality.check",
      payload: {
        taskId: "task-quality",
        setId: "set-quality",
        ...qualityContext,
        items: Array.from({ length: 9 }, (_, index) => ({
          itemId: `item-${index + 1}`,
          assetId: `asset-${index + 1}`,
          planTitle: `计划 ${index + 1}`,
          creativePlan
        }))
      }
    }).success).toBe(true);
    expect(nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality-four",
      type: "creation-set.quality.check",
      payload: {
        taskId: "task-quality-four",
        setId: "set-quality",
        ...qualityContext,
        items: Array.from({ length: 4 }, (_, index) => ({
          itemId: `item-${index + 1}`,
          assetId: `asset-${index + 1}`,
          planTitle: `计划 ${index + 1}`,
          creativePlan
        }))
      }
    }).success).toBe(true);
    expect(nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality-twelve",
      type: "creation-set.quality.check",
      payload: {
        taskId: "task-quality-twelve",
        setId: "set-quality",
        ...qualityContext,
        items: Array.from({ length: 12 }, (_, index) => ({
          itemId: `item-${index + 1}`,
          assetId: `asset-${index + 1}`,
          planTitle: `计划 ${index + 1}`,
          creativePlan
        }))
      }
    }).success).toBe(true);
    expect(nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality-thirteen",
      type: "creation-set.quality.check",
      payload: {
        taskId: "task-quality-thirteen",
        setId: "set-quality",
        ...qualityContext,
        items: Array.from({ length: 13 }, (_, index) => ({
          itemId: `item-${index + 1}`,
          assetId: `asset-${index + 1}`,
          planTitle: `计划 ${index + 1}`,
          creativePlan
        }))
      }
    }).success).toBe(false);
  });

  it("接收 CreationSet 实际使用的 setId:planId 计划项标识", () => {
    expect(nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality-colon",
      type: "creation-set.quality.check",
      payload: {
        taskId: "task-quality-colon",
        setId: "set-quality",
        ...qualityContext,
        items: Array.from({ length: 4 }, (_, index) => ({
          itemId: `265cb520-f013-465e-ac47-1012505e5a8d:portrait-${index + 1}`,
          assetId: `asset-${index + 1}`,
          planTitle: `计划 ${index + 1}`,
          creativePlan
        }))
      }
    }).success).toBe(true);
  });

  it("把所选风格的专属门禁传给摄影总监", () => {
    const style = getSignatureStyle("lacquer-moon-void")!;
    const signatureStyle = buildSignatureStyleCriticContext(
      createSignatureStyleSelection(style, "blend", "验证专属门禁", 1)
    );
    expect(nativeRequestSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality-signature",
      type: "creation-set.quality.check",
      payload: {
        taskId: "task-quality-signature",
        setId: "set-quality",
        ...qualityContext,
        signatureStyle,
        items: [{
          itemId: "item-signature",
          assetId: "asset-signature",
          planTitle: "漆月留白 Hero",
          creativePlan
        }]
      }
    }).success).toBe(true);
  });

  it("质量报告只接受建议，不接受分数或通过结论", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-quality",
      ok: true,
      data: {
        schemaVersion: "1.0.0",
        checkedAt: 1,
        model: "codex",
        summary: "建议人工复核第二张",
        checkedItemIds: ["item-1", "item-2", "item-3", "item-4"],
        issues: [],
        suggestedRetryItemIds: [],
        score: 96,
        approved: true
      }
    }).success).toBe(false);
  });

  it("协议响应可返回 DomainProfile 与统一 Visual DNA", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-domain",
      ok: true,
      data: {
        domainProfile: createMigrationDomainProfile(),
        visualDNA: dna
      }
    }).success).toBe(true);
  });
});
