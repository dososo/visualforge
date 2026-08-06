import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { visualDNASchema } from "./visual-dna.js";

export const DOMAIN_PROFILE_SCHEMA_VERSION = "1.0.0" as const;
export const domainSchema = z.enum([
  "portrait", "product", "poster", "illustration", "photography"
]);
export const domainCandidateSchema = z.object({
  domain: domainSchema,
  confidence: z.number().min(0).max(1)
}).strict();
export const domainClassificationSchema = z.object({
  domain: domainSchema,
  confidence: z.number().min(0).max(1),
  observedSignals: z.array(z.string().min(1)),
  secondCandidate: domainCandidateSchema.nullable().default(null)
}).strict();

const text = z.string().min(1).nullable();
const texts = z.array(z.string().min(1));
const common = {
  schemaVersion: z.literal(DOMAIN_PROFILE_SCHEMA_VERSION),
  subdomain: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  observedSignals: texts,
  routingState: z.enum(["confirmed", "uncertain", "user_overridden"]).default("confirmed"),
  secondCandidate: domainCandidateSchema.nullable().default(null),
  profileVersion: z.string().min(1),
  source: z.enum(["auto", "user_override", "migration"])
};

export const portraitDetailsSchema = z.object({
  personCount: z.number().int().nonnegative().nullable(),
  framing: text, pose: text, expression: text, wardrobe: text,
  hairAndMakeup: text, environment: text, lensFeel: text,
  depthOfField: text, lighting: text, skinToneRendering: text,
  captureTexture: text, subjectEnvironmentRelation: text
}).strict();

export const productDetailsSchema = z.object({
  form: text, keyStructures: texts, materials: texts, surfaceReflection: text,
  logoAndTextRegions: texts, cameraAngle: text, perspective: text,
  displayMethod: text, contactSurface: text, shadow: text,
  commercialLighting: text, background: text, props: texts, environmentScale: text
}).strict();

export const posterDetailsSchema = z.object({
  canvasRatio: text, grid: text, hierarchy: text, titleRole: text, bodyRole: text,
  typeCategory: text, typeScaleRelation: text, textBlockPositions: texts,
  imageBlockPositions: texts, whitespace: text, decorativeGraphics: texts,
  border: text, material: text, printEffect: text, safeArea: text,
  readingOrder: texts, readableText: z.string().min(1).nullable()
}).strict();

export const illustrationDetailsSchema = z.object({
  medium: text, lineArt: text, brushwork: text, colorBlocks: text,
  shadingMethod: text, characterDesign: text, shapeLanguage: text,
  perspective: text, color: text, backgroundComplexity: text,
  motion: text, renderingMethod: text, surfaceTexture: text
}).strict();

export const photographyDetailsSchema = z.object({
  subject: text, scene: text, moment: text, framing: text, cameraPosition: text,
  lensFeel: text, depthOfField: text, exposure: text, lighting: text, color: text,
  composition: text, environmentTexture: text, postProcessing: text
}).strict();

export const domainProfileSchema = z.discriminatedUnion("domain", [
  z.object({ ...common, domain: z.literal("portrait"), details: portraitDetailsSchema }).strict(),
  z.object({ ...common, domain: z.literal("product"), details: productDetailsSchema }).strict(),
  z.object({ ...common, domain: z.literal("poster"), details: posterDetailsSchema }).strict(),
  z.object({ ...common, domain: z.literal("illustration"), details: illustrationDetailsSchema }).strict(),
  z.object({ ...common, domain: z.literal("photography"), details: photographyDetailsSchema }).strict()
]);

export const domainAnalysisResultSchema = z.object({
  domainProfile: domainProfileSchema,
  visualDNA: visualDNASchema
}).strict();

function requireAllObjectProperties(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  const value = schema as Record<string, unknown>;
  if (value.properties && typeof value.properties === "object") {
    value.required = Object.keys(value.properties);
    for (const child of Object.values(value.properties)) requireAllObjectProperties(child);
  }
  if (Array.isArray(value.anyOf)) value.anyOf.forEach(requireAllObjectProperties);
  if (Array.isArray(value.oneOf)) value.oneOf.forEach(requireAllObjectProperties);
  if (value.items) requireAllObjectProperties(value.items);
  if (value.definitions && typeof value.definitions === "object") {
    Object.values(value.definitions).forEach(requireAllObjectProperties);
  }
  return schema;
}

export const domainProfileJsonSchema = requireAllObjectProperties(zodToJsonSchema(domainProfileSchema, {
  target: "jsonSchema7", $refStrategy: "none"
}));
export const domainClassificationJsonSchema = requireAllObjectProperties(zodToJsonSchema(domainClassificationSchema, {
  target: "jsonSchema7", $refStrategy: "none"
}));
export const domainAnalysisResultJsonSchema = requireAllObjectProperties(zodToJsonSchema(domainAnalysisResultSchema, {
  target: "jsonSchema7", $refStrategy: "none"
}));

export type Domain = z.infer<typeof domainSchema>;
export type DomainCandidate = z.infer<typeof domainCandidateSchema>;
export type DomainClassification = z.infer<typeof domainClassificationSchema>;
export type DomainProfile = z.infer<typeof domainProfileSchema>;
export type DomainAnalysisResult = z.infer<typeof domainAnalysisResultSchema>;
