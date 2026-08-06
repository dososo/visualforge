import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";

const summaries = [{
  dimension: "palette",
  field: "palette.saturation",
  label: "饱和度",
  value: "低",
  explanation: "饱和度倾向：低",
  confidence: 0.8,
  sampleCount: 5,
  lastUpdated: 5_000
}];

describe("Preference Suggestion", () => {
  it("只在显式应用时生成本次 Prompt 指令", () => {
    const resolve = (core as Record<string, unknown>).resolvePreferenceSuggestion;
    expect(resolve).toBeTypeOf("function");
    if (typeof resolve !== "function") return;
    expect(resolve(summaries, "ignored")).toBe("");
    expect(resolve(summaries, "applied")).toBe("用户已确认的视觉偏好：饱和度倾向：低。");
  });

  it("没有达到门槛的摘要时不产生建议", () => {
    const resolve = (core as Record<string, unknown>).resolvePreferenceSuggestion;
    expect(resolve).toBeTypeOf("function");
    if (typeof resolve !== "function") return;
    expect(resolve([], "applied")).toBe("");
  });
});
