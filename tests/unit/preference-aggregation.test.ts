import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";

const event = (id: string, after: string, createdAt: number) => ({
  schemaVersion: "1.0.0",
  id,
  projectId: "project-1",
  dimension: "palette",
  field: "palette.saturation",
  label: "饱和度",
  before: "中等",
  after,
  source: "editor",
  createdAt
});

describe("Preference aggregation", () => {
  it("只有重复事实形成趋势，并给出样本数、置信度和更新时间", () => {
    const aggregate = (core as Record<string, unknown>).aggregatePreferenceEvents;
    expect(aggregate).toBeTypeOf("function");
    if (typeof aggregate !== "function") return;

    const summaries = aggregate([
      event("event-1", "低", 1_000),
      event("event-2", "高", 2_000),
      event("event-3", "低", 3_000)
    ]) as Array<Record<string, unknown>>;

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      dimension: "palette",
      field: "palette.saturation",
      label: "饱和度",
      value: "低",
      explanation: "饱和度倾向：低",
      confidence: 0.67,
      sampleCount: 3,
      lastUpdated: 3_000
    });
  });

  it("单一样本或并列结果不生成无法解释的标签", () => {
    const aggregate = (core as Record<string, unknown>).aggregatePreferenceEvents;
    expect(aggregate).toBeTypeOf("function");
    if (typeof aggregate !== "function") return;
    expect(aggregate([event("single", "低", 1_000)])).toEqual([]);
    expect(aggregate([event("tie-1", "低", 1_000), event("tie-2", "高", 2_000)])).toEqual([]);
  });
});
