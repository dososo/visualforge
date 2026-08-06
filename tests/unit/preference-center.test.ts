import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";

const summary = {
  dimension: "palette",
  field: "palette.saturation",
  label: "饱和度",
  value: "低",
  explanation: "饱和度倾向：低",
  confidence: 0.67,
  sampleCount: 3,
  lastUpdated: 3_000
};

const events = [
  {
    schemaVersion: "1.0.0",
    id: "center-1",
    projectId: "project-1",
    dimension: "palette",
    field: "palette.saturation",
    label: "饱和度",
    before: "高",
    after: "低",
    source: "editor",
    createdAt: 1_000
  },
  {
    schemaVersion: "1.0.0",
    id: "center-2",
    projectId: "project-2",
    dimension: "palette",
    field: "palette.saturation",
    label: "饱和度",
    before: "中",
    after: "低",
    source: "restore",
    createdAt: 3_000
  }
];

describe("Preference Center", () => {
  it("把摘要与真实来源计数组合成透明展示项", () => {
    const build = (core as Record<string, unknown>).buildPreferenceCenterItems;
    expect(build).toBeTypeOf("function");
    if (typeof build !== "function") return;
    const items = build([summary], events) as Array<{
      summary: typeof summary;
      evidence: typeof events;
      sourceCounts: Record<string, number>;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].summary).toEqual(summary);
    expect(items[0].evidence.map((event) => event.id)).toEqual(["center-2", "center-1"]);
    expect(items[0].sourceCounts).toEqual({ editor: 1, restore: 1 });
  });
});
