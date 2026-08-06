import { z } from "zod";
import { domainAnalysisResultSchema } from "./domain-profile.js";

export const ANALYSIS_CACHE_SCHEMA_VERSION = "1.0.0" as const;

export const analysisCacheModeSchema = z.enum(["joint", "two-stage"]);

export const analysisCacheEntrySchema = z.object({
  schemaVersion: z.literal(ANALYSIS_CACHE_SCHEMA_VERSION),
  key: z.string().min(1),
  sourceImageHash: z.string().regex(/^[a-f0-9]{64}$/),
  analysisMode: analysisCacheModeSchema,
  analyzerVersion: z.string().min(1),
  result: domainAnalysisResultSchema,
  createdAt: z.number().int().nonnegative(),
  lastUsedAt: z.number().int().nonnegative()
}).strict().superRefine((entry, context) => {
  const expected = `${entry.sourceImageHash}:${entry.analysisMode}:${entry.analyzerVersion}`;
  if (entry.key !== expected) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["key"],
      message: "缓存键必须由图片哈希、分析模式和分析器版本组成"
    });
  }
  if (entry.lastUsedAt < entry.createdAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["lastUsedAt"],
      message: "最后使用时间不能早于创建时间"
    });
  }
});

export type AnalysisCacheMode = z.infer<typeof analysisCacheModeSchema>;
export type AnalysisCacheEntry = z.infer<typeof analysisCacheEntrySchema>;
