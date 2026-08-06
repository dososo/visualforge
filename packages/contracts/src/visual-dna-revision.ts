import { z } from "zod";
import { visualDNASchema } from "./visual-dna";

export const VISUAL_DNA_REVISION_SCHEMA_VERSION = "1.0.0" as const;

export const visualDNAChangeDimensionSchema = z.enum([
  "identity",
  "subject",
  "composition",
  "camera",
  "lighting",
  "palette",
  "material",
  "texture",
  "mood",
  "style"
]);

export const visualDNARevisionChangeSchema = z.object({
  dimension: visualDNAChangeDimensionSchema,
  label: z.string().min(1),
  before: z.string().nullable(),
  after: z.string()
}).strict();

export const visualDNARevisionSchema = z.object({
  schemaVersion: z.literal(VISUAL_DNA_REVISION_SCHEMA_VERSION),
  id: z.string().min(1),
  projectId: z.string().min(1),
  revision: z.number().int().min(1),
  createdAt: z.number().int().nonnegative(),
  origin: z.enum(["analysis", "edit", "restore", "backfill"]),
  restoredFromRevision: z.number().int().min(1).nullable(),
  changes: z.array(visualDNARevisionChangeSchema),
  dna: visualDNASchema
}).strict().superRefine((record, context) => {
  if (record.dna.revision !== record.revision) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dna", "revision"],
      message: "DNA revision 必须与历史记录一致"
    });
  }
  if (record.origin === "restore" && record.restoredFromRevision === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["restoredFromRevision"],
      message: "恢复记录必须注明来源 revision"
    });
  }
});

export type VisualDNAChangeDimension = z.infer<typeof visualDNAChangeDimensionSchema>;
export type VisualDNARevisionChange = z.infer<typeof visualDNARevisionChangeSchema>;
export type VisualDNARevision = z.infer<typeof visualDNARevisionSchema>;
