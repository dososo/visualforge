import { describe, expect, it } from "vitest";
import {
  analysisCacheKey,
  createPerformanceTrace,
  summarizePerformanceTraces
} from "@styleforge/core";
import { performanceTraceSchema } from "@styleforge/contracts";

describe("本地性能追踪与分析缓存", () => {
  it("记录真实阶段耗时并由时间戳计算 totalMs", () => {
    const trace = createPerformanceTrace({
      id: "trace-1",
      taskId: "task-1",
      projectId: "project-1",
      operation: "generation",
      startedAt: 100,
      completedAt: 460,
      stages: {
        captureMs: 20,
        analyzeMs: 120,
        imagegenMs: 180,
        persistenceMs: 40,
        referenceUploadMs: 8,
        codexStartupMs: 12,
        skillDiscoveryMs: 4,
        generationTurnMs: 140,
        outputRegistrationMs: 3,
        outputReadMs: 2,
        resultTransferMs: 11
      }
    });
    expect(performanceTraceSchema.parse(trace).totalMs).toBe(360);
    expect(trace.stages.compileMs).toBeNull();
    expect(trace.stages.generationTurnMs).toBe(140);
  });

  it("计算本地 P50/P90/P95、最快和最慢，不上传样本", () => {
    const summary = summarizePerformanceTraces([100, 200, 300, 400, 500]);
    expect(summary).toEqual({
      sampleCount: 5,
      p50: 300,
      p90: 500,
      p95: 500,
      fastest: 100,
      slowest: 500
    });
  });

  it("分析缓存键由图片哈希、分析模式和版本确定", () => {
    expect(analysisCacheKey("a".repeat(64), "joint", "v1"))
      .toBe(`${"a".repeat(64)}:joint:v1`);
    expect(analysisCacheKey("a".repeat(64), "two-stage", "v1"))
      .not.toBe(analysisCacheKey("a".repeat(64), "joint", "v1"));
  });
});
