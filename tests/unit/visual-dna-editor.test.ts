import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Visual DNA Editor", () => {
  it("一次保存把多个字段作为一个新修订提交", () => {
    const revise = (core as Record<string, unknown>).reviseVisualDNA;
    expect(revise).toBeTypeOf("function");
    if (typeof revise !== "function") return;
    const next = revise(dna, {
      subject: { ...dna.subject, description: "银色咖啡机" },
      lighting: { ...dna.lighting, contrast: "中等反差" }
    }, 2_000);
    expect(next.revision).toBe(dna.revision + 1);
    expect(next.updatedAt).toBe(2_000);
    expect(next.createdAt).toBe(dna.createdAt);
    expect(next.subject.description).toBe("银色咖啡机");
    expect(next.lighting.contrast).toBe("中等反差");
    expect(dna.subject.description).toBe("单一商品");
  });
});
