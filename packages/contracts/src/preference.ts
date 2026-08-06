import { z } from "zod";
import { visualDNAChangeDimensionSchema } from "./visual-dna-revision";

export const PREFERENCE_EVENT_SCHEMA_VERSION = "1.0.0" as const;

export const preferenceValueSchema = z.union([
  z.string(),
  z.number(),
  z.null(),
  z.array(z.string())
]);

export const preferenceEventSchema = z.object({
  schemaVersion: z.literal(PREFERENCE_EVENT_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string().min(1),
  dimension: visualDNAChangeDimensionSchema,
  field: z.string().min(1),
  label: z.string().min(1),
  before: preferenceValueSchema,
  after: preferenceValueSchema,
  source: z.enum(["editor", "lock", "restore"]),
  createdAt: z.number().int().nonnegative()
}).strict().superRefine((event, context) => {
  if (JSON.stringify(event.before) === JSON.stringify(event.after)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["after"],
      message: "Preference Event 必须记录真实变化"
    });
  }
  if (event.source === "lock" && !event.field.startsWith("locks.")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["field"],
      message: "Lock 事件必须指向 locks 字段"
    });
  }
});

export const userPreferenceSummarySchema = z.object({
  dimension: visualDNAChangeDimensionSchema,
  field: z.string().min(1),
  label: z.string().min(1),
  value: preferenceValueSchema,
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sampleCount: z.number().int().min(2),
  lastUpdated: z.number().int().nonnegative()
}).strict();

export const PREFERENCE_SUMMARY_DISMISSAL_SCHEMA_VERSION = "1.0.0" as const;

export const preferenceSummaryDismissalSchema = z.object({
  schemaVersion: z.literal(PREFERENCE_SUMMARY_DISMISSAL_SCHEMA_VERSION),
  id: z.string().min(1),
  dimension: visualDNAChangeDimensionSchema,
  field: z.string().min(1),
  dismissedThrough: z.number().int().nonnegative(),
  dismissedAt: z.number().int().nonnegative()
}).strict();

export type PreferenceValue = z.infer<typeof preferenceValueSchema>;
export type PreferenceEvent = z.infer<typeof preferenceEventSchema>;
export type PreferenceEventSource = PreferenceEvent["source"];
export type UserPreferenceSummary = z.infer<typeof userPreferenceSummarySchema>;
export type PreferenceSummaryDismissal = z.infer<typeof preferenceSummaryDismissalSchema>;
