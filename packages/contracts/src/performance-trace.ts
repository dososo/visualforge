import { z } from "zod";

export const PERFORMANCE_TRACE_SCHEMA_VERSION = "1.0.0" as const;

const duration = z.number().nonnegative().nullable();
export const performanceTraceStagesSchema = z.object({
  captureMs: duration,
  normalizeMs: duration,
  cacheLookupMs: duration,
  classifyMs: duration,
  analyzeMs: duration,
  compileMs: duration,
  codexStartupMs: duration,
  queueMs: duration,
  imagegenMs: duration,
  resultTransferMs: duration,
  persistenceMs: duration,
  qualityCheckMs: duration,
  referenceUploadMs: duration.optional(),
  skillDiscoveryMs: duration.optional(),
  generationTurnMs: duration.optional(),
  outputRegistrationMs: duration.optional(),
  outputReadMs: duration.optional()
}).strict();

export const performanceTraceSchema = z.object({
  schemaVersion: z.literal(PERFORMANCE_TRACE_SCHEMA_VERSION),
  id: z.string().min(1),
  taskId: z.string().min(1).nullable(),
  projectId: z.string().min(1).nullable(),
  operation: z.enum(["analysis", "generation", "creation_set", "identity_board", "style_proof"]),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative(),
  totalMs: z.number().nonnegative(),
  cacheHit: z.boolean(),
  stages: performanceTraceStagesSchema
}).strict().superRefine((trace, context) => {
  if (trace.completedAt < trace.startedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["completedAt"], message: "完成时间不能早于开始时间" });
  }
  if (trace.totalMs !== trace.completedAt - trace.startedAt) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["totalMs"], message: "总耗时必须由时间戳计算" });
  }
});

export type PerformanceTrace = z.infer<typeof performanceTraceSchema>;
export type PerformanceTraceStages = z.infer<typeof performanceTraceStagesSchema>;
