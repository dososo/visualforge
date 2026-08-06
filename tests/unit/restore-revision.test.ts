import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Visual DNA revision restore", () => {
  it("恢复旧内容时使用当前版本的下一个 revision", () => {
    const restore = (core as Record<string, unknown>).restoreVisualDNARevision;
    expect(restore).toBeTypeOf("function");
    if (typeof restore !== "function") return;

    const historical = { ...dna, lighting: { ...dna.lighting, quality: "柔光" } };
    const current = {
      ...dna,
      revision: 3,
      updatedAt: 3_000,
      lighting: { ...dna.lighting, quality: "硬光" }
    };
    const restored = restore(current, historical, 4_000) as typeof current;

    expect(restored.revision).toBe(4);
    expect(restored.updatedAt).toBe(4_000);
    expect(restored.lighting.quality).toBe("柔光");
    expect(restored.createdAt).toBe(current.createdAt);
  });
});
