import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const TRANSFORMATION_BLUEPRINT_SCHEMA_VERSION = "1.0.0" as const;

const rules = z.array(z.string().min(1)).min(1).max(12);

export const transformationBlueprintSchema = z.object({
  schemaVersion: z.literal(TRANSFORMATION_BLUEPRINT_SCHEMA_VERSION),
  preserve: rules,
  replace: rules,
  recreate: rules,
  avoid: rules
}).strict();

export const transformationBlueprintJsonSchema = zodToJsonSchema(transformationBlueprintSchema, {
  target: "jsonSchema7",
  $refStrategy: "none"
});

export type TransformationBlueprint = z.infer<typeof transformationBlueprintSchema>;
