import {
  creationSetSchema,
  generationEventSchema,
  migrateVisualDNA,
  preferenceEventSchema,
  preferenceSummaryDismissalSchema,
  subjectAssetSchema,
  taskRecordSchema
} from "@styleforge/contracts";
import type {
  CreationSet,
  GenerationEvent,
  PreferenceEvent,
  PreferenceSummaryDismissal,
  ProjectRecord,
  SubjectAsset,
  TaskRecord
} from "@styleforge/contracts";
import { z } from "zod";

export type IntegrityStore =
  | "creationSets"
  | "taskRecords"
  | "generationEvents"
  | "projects"
  | "subjectAssets"
  | "preferenceEvents"
  | "preferenceSummaryDismissals";

export interface DataIntegrityIssue {
  store: IntegrityStore;
  recordKey: string;
  code: "SCHEMA_INVALID";
  fields: string[];
  summary: string;
}

interface CriticalRecordMap {
  creationSets: CreationSet;
  taskRecords: TaskRecord;
  generationEvents: GenerationEvent;
  projects: ProjectRecord;
  subjectAssets: SubjectAsset;
  preferenceEvents: PreferenceEvent;
  preferenceSummaryDismissals: PreferenceSummaryDismissal;
}

const projectRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  mode: z.enum(["direct", "analyze", "edit"]),
  referenceAssetIds: z.array(z.string().min(1)),
  outputAssetIds: z.array(z.string().min(1)),
  userInstruction: z.string(),
  aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9", "9:16"]),
  count: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  visualDNA: z.unknown().optional(),
  provider: z.enum(["mock", "codex"]),
  favorite: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
}).passthrough().superRefine((project, context) => {
  if (project.visualDNA === undefined) return;
  try {
    migrateVisualDNA(project.visualDNA, {
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      sourceImageHash: null,
      analysisModel: project.provider === "codex" ? "codex-legacy-unknown" : "styleforge-mock"
    });
  } catch {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visualDNA"],
      message: "项目 Visual DNA 无法迁移"
    });
  }
});

const schemas = {
  creationSets: creationSetSchema,
  taskRecords: taskRecordSchema,
  generationEvents: generationEventSchema,
  projects: projectRecordSchema,
  subjectAssets: subjectAssetSchema,
  preferenceEvents: preferenceEventSchema,
  preferenceSummaryDismissals: preferenceSummaryDismissalSchema
} as const;

const keyFields: Record<IntegrityStore, "id" | "taskId"> = {
  creationSets: "id",
  taskRecords: "taskId",
  generationEvents: "id",
  projects: "id",
  subjectAssets: "id",
  preferenceEvents: "id",
  preferenceSummaryDismissals: "id"
};

function safeRecordKey(store: IntegrityStore, value: unknown, index: number) {
  if (!value || typeof value !== "object") return `未知记录-${index + 1}`;
  const candidate = (value as Record<string, unknown>)[keyFields[store]];
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 120 || /^data:/i.test(candidate)) {
    return `未知记录-${index + 1}`;
  }
  return candidate.replace(/[\u0000-\u001f\u007f]/g, "");
}

export function validateCriticalRecords<Store extends IntegrityStore>(
  store: Store,
  values: unknown[]
): { records: CriticalRecordMap[Store][]; issues: DataIntegrityIssue[] } {
  const records: CriticalRecordMap[Store][] = [];
  const issues: DataIntegrityIssue[] = [];
  values.forEach((value, index) => {
    const parsed = schemas[store].safeParse(value);
    if (parsed.success) {
      records.push(parsed.data as CriticalRecordMap[Store]);
      return;
    }
    issues.push({
      store,
      recordKey: safeRecordKey(store, value, index),
      code: "SCHEMA_INVALID",
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "record"))].slice(0, 12),
      summary: "记录结构不符合当前版本"
    });
  });
  return { records, issues };
}

export function createIntegrityDiagnostic(
  issues: DataIntegrityIssue[],
  options: { appVersion: string; generatedAt?: number }
) {
  const generatedAt = options.generatedAt ?? Date.now();
  return {
    schemaVersion: "1.0.0",
    kind: "visualforge-integrity-diagnostic",
    appVersion: options.appVersion,
    generatedAt,
    issueCount: issues.length,
    privacy: "不包含记录正文、提示词或图片字节",
    issues: issues.map((issue) => ({
      store: issue.store,
      recordKey: issue.recordKey,
      code: issue.code,
      fields: [...issue.fields],
      summary: issue.summary
    }))
  };
}
