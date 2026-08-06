import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  analysisCacheEntrySchema,
  type AnalysisCacheEntry,
  type PerformanceTrace
} from "@styleforge/contracts";
import { createMigrationDomainProfile } from "@styleforge/core";
import visualDNA from "../../packages/contracts/examples/visual-dna-v1.example.json";
import * as db from "../../apps/extension/lib/db";

const trace: PerformanceTrace = {
  schemaVersion: "1.0.0",
  id: "trace-db-1",
  taskId: "task-db-1",
  projectId: "project-db-1",
  operation: "analysis",
  startedAt: 100,
  completedAt: 180,
  totalMs: 80,
  cacheHit: true,
  stages: {
    captureMs: null,
    normalizeMs: null,
    cacheLookupMs: 3,
    classifyMs: null,
    analyzeMs: null,
    compileMs: 2,
    codexStartupMs: null,
    queueMs: null,
    imagegenMs: null,
    resultTransferMs: null,
    persistenceMs: 4,
    qualityCheckMs: null
  }
};

const cache: AnalysisCacheEntry = analysisCacheEntrySchema.parse({
  schemaVersion: "1.0.0",
  key: `${"a".repeat(64)}:joint:domain-intelligence-v2`,
  sourceImageHash: "a".repeat(64),
  analysisMode: "joint",
  analyzerVersion: "domain-intelligence-v2",
  result: {
    domainProfile: createMigrationDomainProfile(),
    visualDNA
  },
  createdAt: 200,
  lastUsedAt: 200
});

describe("PerformanceTrace 与分析缓存 IndexedDB", () => {
  it("严格保存并按最新优先列出本地 PerformanceTrace", async () => {
    await db.savePerformanceTrace(trace);
    await db.savePerformanceTrace({
      ...trace,
      id: "trace-db-2",
      startedAt: 200,
      completedAt: 310,
      totalMs: 110
    });
    expect((await db.listPerformanceTraces()).map((item) => item.id).slice(0, 2))
      .toEqual(["trace-db-2", "trace-db-1"]);
    await expect(db.savePerformanceTrace({
      ...trace,
      id: "invalid-trace",
      totalMs: 81
    })).rejects.toThrow();
  });

  it("按完整版本键严格读写分析缓存", async () => {
    await db.putAnalysisCache(cache);
    expect(await db.getAnalysisCache(cache.key)).toEqual(cache);
    await expect(db.putAnalysisCache({
      ...cache,
      key: `${"a".repeat(64)}:joint:wrong`
    })).rejects.toThrow();
    expect(await db.getAnalysisCache(`${"a".repeat(64)}:two-stage:domain-intelligence-v2`))
      .toBeUndefined();
  });
});
