import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";

describe("Preference Evidence trace", () => {
  it("只返回同 dimension 和 field 的原始事件，不生成解释性证据", () => {
    const trace = (core as Record<string, unknown>).tracePreferenceEvidence;
    expect(trace).toBeTypeOf("function");
    if (typeof trace !== "function") return;
    const summary = {
      dimension: "lighting",
      field: "lighting.quality",
      label: "光质",
      value: "柔光",
      explanation: "光质倾向：柔光",
      confidence: 1,
      sampleCount: 2,
      lastUpdated: 2_000
    };
    const evidence = [
      {
        schemaVersion: "1.0.0",
        id: "evidence-1",
        projectId: "project-1",
        dimension: "lighting",
        field: "lighting.quality",
        label: "光质",
        before: "硬光",
        after: "柔光",
        source: "editor",
        createdAt: 1_000
      },
      {
        schemaVersion: "1.0.0",
        id: "other-field",
        projectId: "project-1",
        dimension: "lighting",
        field: "lighting.direction",
        label: "方向",
        before: "左侧",
        after: "右侧",
        source: "editor",
        createdAt: 2_000
      }
    ];
    expect(trace(summary, evidence)).toEqual([evidence[0]]);
  });
});
