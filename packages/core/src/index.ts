import {
  GENERATION_EVENT_SCHEMA_VERSION,
  GENERATION_MANIFEST_SCHEMA_VERSION,
  generationEventSchema,
  generationManifestSchema,
  taskRecordSchema,
  visualDNASchema,
  type AspectRatio,
  type GenerationEvent,
  type GenerationManifest,
  type GenerationReferenceSnapshot,
  type GridCellAnalysis,
  type CreationSet,
  type CreativeShotPlan,
  type CreationSetPlanItem,
  type CreationSetStatus,
  type SetQualityIssue,
  type SetQualityReport,
  type SignatureStyleSelection,
  type Domain,
  type DomainProfile,
  type SubjectAsset,
  type SubjectAssetType,
  type TaskError,
  type TaskRecord,
  type TaskStatus,
  transformationBlueprintSchema,
  type TransformationBlueprint,
  type VisualDNA,
  type VisualDNAChangeDimension,
  type VisualDNARevision,
  type PreferenceEvent,
  type PreferenceSummaryDismissal,
  type PreferenceValue,
  type UserPreferenceSummary,
  performanceTraceSchema,
  type PerformanceTrace,
  type PerformanceTraceStages
} from "@styleforge/contracts";
export {
  applySignatureStyleToCreationPlan,
  applySignatureStyleToPrompt,
  buildSignatureStyleCriticContext,
  createSignatureStyleSelection,
  getSignatureStyle,
  listSignatureStyles,
  recommendSignatureStyles,
  signatureStyleLibrary
} from "./signature-style-library";
export type { SignatureStyleRecommendation } from "./signature-style-library";
import {
  PREFERENCE_EVENT_SCHEMA_VERSION,
  preferenceEventSchema,
  userPreferenceSummarySchema,
  VISUAL_DNA_REVISION_SCHEMA_VERSION,
  visualDNARevisionSchema
} from "@styleforge/contracts";

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  CREATED: ["UPLOADING", "CANCELLED", "INTERRUPTED"],
  UPLOADING: ["ANALYZING", "GENERATING", "FAILED", "CANCELLED", "INTERRUPTED"],
  ANALYZING: ["READY", "FAILED", "CANCELLED", "INTERRUPTED"],
  READY: ["GENERATING", "CANCELLED", "INTERRUPTED"],
  GENERATING: ["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"],
  COMPLETED: [],
  FAILED: ["RETRYING"],
  CANCELLED: ["RETRYING"],
  INTERRUPTED: ["RETRYING"],
  RETRYING: ["UPLOADING", "CANCELLED", "INTERRUPTED"]
};

const FINISHED_STATUSES = new Set<TaskStatus>(["READY", "COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const ACTIVE_STATUSES = new Set<TaskStatus>(["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"]);
export const TASK_STALE_AFTER_MS = 2 * 60 * 1000;

export function transitionTask(
  task: TaskRecord,
  status: TaskStatus,
  now: number,
  error: TaskError | null = null
): TaskRecord {
  if (!TASK_TRANSITIONS[task.status].includes(status)) {
    throw new Error(`不允许从 ${task.status} 转换到 ${status}`);
  }
  return taskRecordSchema.parse({
    ...task,
    status,
    startedAt: task.startedAt ?? now,
    finishedAt: FINISHED_STATUSES.has(status) ? now : null,
    error,
    heartbeat: now
  });
}

export function createRetryTask(task: TaskRecord, taskId: string, now: number): TaskRecord {
  if (!["FAILED", "CANCELLED", "INTERRUPTED"].includes(task.status)) {
    throw new Error(`状态 ${task.status} 不能重试`);
  }
  return taskRecordSchema.parse({
    ...task,
    taskId,
    retryOfTaskId: task.taskId,
    generationEventId: null,
    generationEventIds: [],
    status: "RETRYING",
    startedAt: null,
    finishedAt: null,
    retryCount: task.retryCount + 1,
    error: null,
    heartbeat: now
  });
}

export function interruptStaleTask(task: TaskRecord, now: number): TaskRecord {
  if (!ACTIVE_STATUSES.has(task.status)) return task;
  if (now - task.heartbeat <= TASK_STALE_AFTER_MS) return task;
  return taskRecordSchema.parse({
    ...task,
    status: "INTERRUPTED",
    finishedAt: now,
    error: {
      code: "INTERRUPTED",
      message: "任务在应用关闭或连接中断时停止，可以继续尝试。",
      retryable: true
    },
    heartbeat: now
  });
}

export const PROMPT_COMPILER_VERSION = "visual-prompt-v6" as const;

export function reviseVisualDNA(
  visualDNA: VisualDNA,
  patch: Partial<VisualDNA>,
  now: number
): VisualDNA {
  return visualDNASchema.parse({
    ...visualDNA,
    ...patch,
    schemaVersion: visualDNA.schemaVersion,
    revision: visualDNA.revision + 1,
    createdAt: visualDNA.createdAt,
    updatedAt: now
  });
}

const revisionDimensions: Array<{
  dimension: VisualDNAChangeDimension;
  label: string;
  summarize: (dna: VisualDNA) => string;
}> = [
  {
    dimension: "identity",
    label: "身份",
    summarize: (dna) => [
      dna.identity.description,
      dna.identity.distinctiveFeatures.join(" · "),
      dna.locks.identity === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "subject",
    label: "主体",
    summarize: (dna) => [
      dna.subject.description,
      dna.subject.action,
      dna.subject.environment,
      dna.locks.subject === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "composition",
    label: "构图",
    summarize: (dna) => [
      dna.composition.shotType,
      dna.composition.subjectPlacement,
      dna.composition.negativeSpace,
      dna.composition.depth,
      dna.locks.composition === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "camera",
    label: "镜头",
    summarize: (dna) => [
      dna.camera.angle,
      dna.camera.lens,
      dna.camera.focalLength,
      dna.camera.depthOfField,
      dna.locks.camera === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "lighting",
    label: "光线",
    summarize: (dna) => [
      dna.lighting.source,
      dna.lighting.direction,
      dna.lighting.quality,
      dna.lighting.contrast,
      dna.locks.lighting === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "palette",
    label: "色彩",
    summarize: (dna) => [
      dna.palette.dominantColors.join("、"),
      dna.palette.temperature,
      dna.palette.saturation,
      dna.locks.palette === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "material",
    label: "材质",
    summarize: (dna) => [
      dna.material.types.join("、"),
      dna.material.finish,
      dna.material.reflectivity,
      dna.locks.material === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "texture",
    label: "纹理",
    summarize: (dna) => [
      dna.texture.medium,
      dna.texture.grain,
      dna.texture.sharpness,
      dna.locks.texture === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "mood",
    label: "情绪",
    summarize: (dna) => [
      dna.mood.keywords.join("、"),
      dna.mood.emotionalTone,
      dna.mood.atmosphere
    ].filter(Boolean).join(" · ")
  },
  {
    dimension: "style",
    label: "风格",
    summarize: (dna) => [
      dna.style.keywords.join("、"),
      dna.style.medium,
      dna.locks.style === "locked" ? "已锁" : "可变"
    ].filter(Boolean).join(" · ")
  }
];

export function summarizeVisualDNAChanges(previousDNA: VisualDNA, dna: VisualDNA) {
  return revisionDimensions.flatMap(({ dimension, label, summarize }) => {
    const before = summarize(previousDNA);
    const after = summarize(dna);
    return before === after ? [] : [{ dimension, label, before, after }];
  });
}

export function createVisualDNARevision(input: {
  id: string;
  projectId: string;
  dna: VisualDNA;
  previousDNA: VisualDNA | null;
  origin: VisualDNARevision["origin"];
  restoredFromRevision?: number | null;
  createdAt: number;
}): VisualDNARevision {
  return visualDNARevisionSchema.parse({
    schemaVersion: VISUAL_DNA_REVISION_SCHEMA_VERSION,
    id: input.id,
    projectId: input.projectId,
    revision: input.dna.revision,
    createdAt: input.createdAt,
    origin: input.origin,
    restoredFromRevision: input.restoredFromRevision ?? null,
    changes: input.previousDNA ? summarizeVisualDNAChanges(input.previousDNA, input.dna) : [],
    dna: input.dna
  });
}

export function restoreVisualDNARevision(
  current: VisualDNA,
  historical: VisualDNA,
  now: number
): VisualDNA {
  return reviseVisualDNA(current, historical, now);
}

const preferenceDimensions: VisualDNAChangeDimension[] = [
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
];

const preferenceFieldLabels: Record<string, string> = {
  description: "描述",
  distinctiveFeatures: "显著特征",
  preserve: "保持项",
  count: "数量",
  action: "动作",
  environment: "环境",
  shotType: "景别",
  subjectPlacement: "主体位置",
  negativeSpace: "留白",
  depth: "空间层次",
  aspectRatioHint: "比例提示",
  angle: "机位角度",
  lens: "镜头",
  focalLength: "焦距",
  distance: "拍摄距离",
  depthOfField: "景深",
  perspective: "透视",
  source: "光源",
  direction: "方向",
  quality: "光质",
  contrast: "反差",
  highlightBehavior: "高光表现",
  shadowBehavior: "阴影表现",
  dominantColors: "主色",
  accentColors: "点缀色",
  saturation: "饱和度",
  temperature: "色温",
  types: "材质类型",
  finish: "表面处理",
  reflectivity: "反射程度",
  translucency: "透光程度",
  medium: "媒介",
  grain: "颗粒",
  sharpness: "清晰度",
  surfaceDetail: "表面细节",
  keywords: "关键词",
  emotionalTone: "情绪基调",
  atmosphere: "氛围",
  lock: "锁定状态"
};

function toPreferenceValue(value: unknown): PreferenceValue {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "number" || typeof value === "string" || value === null) return value;
  return String(value);
}

function samePreferenceValue(left: PreferenceValue, right: PreferenceValue) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createPreferenceEvents(input: {
  actionId: string;
  projectId: string;
  before: VisualDNA;
  after: VisualDNA;
  source: "editor" | "restore";
  createdAt: number;
}): PreferenceEvent[] {
  const events: PreferenceEvent[] = [];
  const add = (
    dimension: VisualDNAChangeDimension,
    field: string,
    label: string,
    before: PreferenceValue,
    after: PreferenceValue,
    source: PreferenceEvent["source"]
  ) => {
    if (samePreferenceValue(before, after)) return;
    events.push(preferenceEventSchema.parse({
      schemaVersion: PREFERENCE_EVENT_SCHEMA_VERSION,
      id: `${input.actionId}:${events.length}`,
      projectId: input.projectId,
      dimension,
      field,
      label,
      before,
      after,
      source,
      createdAt: input.createdAt
    }));
  };

  for (const dimension of preferenceDimensions) {
    const beforeGroup = input.before[dimension] as unknown as Record<string, unknown>;
    const afterGroup = input.after[dimension] as unknown as Record<string, unknown>;
    for (const field of Object.keys(beforeGroup)) {
      add(
        dimension,
        `${dimension}.${field}`,
        preferenceFieldLabels[field] ?? field,
        toPreferenceValue(beforeGroup[field]),
        toPreferenceValue(afterGroup[field]),
        input.source
      );
    }
    if (dimension === "mood") continue;
    add(
      dimension,
      `locks.${dimension}`,
      preferenceFieldLabels.lock ?? "锁定状态",
      input.before.locks[dimension],
      input.after.locks[dimension],
      input.source === "restore" ? "restore" : "lock"
    );
  }
  return events;
}

export function displayPreferenceValue(value: PreferenceValue) {
  if (value === null) return "未设置";
  return Array.isArray(value) ? value.join(" · ") : String(value);
}

export function aggregatePreferenceEvents(events: PreferenceEvent[]): UserPreferenceSummary[] {
  const groups = new Map<string, PreferenceEvent[]>();
  for (const rawEvent of events) {
    const event = preferenceEventSchema.parse(rawEvent);
    const key = `${event.dimension}:${event.field}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const summaries: UserPreferenceSummary[] = [];
  for (const fieldEvents of groups.values()) {
    if (fieldEvents.length < 2) continue;
    const counts = new Map<string, { value: PreferenceValue; count: number }>();
    for (const event of fieldEvents) {
      const key = JSON.stringify(event.after);
      const existing = counts.get(key);
      counts.set(key, { value: event.after, count: (existing?.count ?? 0) + 1 });
    }
    const ranked = [...counts.values()].sort((left, right) => right.count - left.count);
    const top = ranked[0];
    const sample = fieldEvents[0];
    if (!top || !sample || top.count < 2 || top.count === ranked[1]?.count) continue;
    const latest = Math.max(...fieldEvents.map((event) => event.createdAt));
    const value = top.value;
    summaries.push(userPreferenceSummarySchema.parse({
      dimension: sample.dimension,
      field: sample.field,
      label: sample.label,
      value,
      explanation: `${sample.label}倾向：${displayPreferenceValue(value)}`,
      confidence: Math.round((top.count / fieldEvents.length) * 100) / 100,
      sampleCount: fieldEvents.length,
      lastUpdated: latest
    }));
  }
  return summaries.sort((left, right) => right.lastUpdated - left.lastUpdated);
}

export function resolvePreferenceSuggestion(
  summaries: UserPreferenceSummary[],
  decision: "applied" | "ignored"
) {
  if (decision !== "applied" || !summaries.length) return "";
  return `用户已确认的视觉偏好：${summaries.map((summary) => summary.explanation).join("；")}。`;
}

export function tracePreferenceEvidence(
  summary: UserPreferenceSummary,
  events: PreferenceEvent[]
) {
  return events
    .filter((event) => event.dimension === summary.dimension && event.field === summary.field)
    .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
}

export function buildPreferenceCenterItems(
  summaries: UserPreferenceSummary[],
  events: PreferenceEvent[]
) {
  return summaries.map((summary) => {
    const evidence = tracePreferenceEvidence(summary, events);
    const sourceCounts = evidence.reduce<Partial<Record<PreferenceEvent["source"], number>>>(
      (counts, event) => ({
        ...counts,
        [event.source]: (counts[event.source] ?? 0) + 1
      }),
      {}
    );
    return { summary, evidence, sourceCounts };
  });
}

export function filterDismissedPreferenceSummaries(
  summaries: UserPreferenceSummary[],
  dismissals: PreferenceSummaryDismissal[]
) {
  return summaries.filter((summary) => {
    const dismissal = dismissals.find((item) =>
      item.dimension === summary.dimension && item.field === summary.field);
    return !dismissal || summary.lastUpdated > dismissal.dismissedThrough;
  });
}

export function createGenerationEvents(
  manifest: GenerationManifest,
  input: { ids: string[]; parentGenerationId: string | null }
): GenerationEvent[] {
  if (input.ids.length !== manifest.outputs.length) {
    throw new Error("GenerationEvent ID 数量必须与输出数量一致");
  }
  const lockedFields = Object.entries(manifest.visualDNA.snapshot.locks)
    .filter(([, state]) => state === "locked")
    .map(([field]) => field);
  return manifest.outputs.map((output, index) => generationEventSchema.parse({
    schemaVersion: GENERATION_EVENT_SCHEMA_VERSION,
    id: input.ids[index],
    projectId: manifest.projectId,
    generationManifestId: manifest.id,
    ...(manifest.setId ? { setId: manifest.setId } : {}),
    ...(manifest.planItemId ? { planItemId: manifest.planItemId } : {}),
    ...(manifest.domainProfile ? { domainProfile: manifest.domainProfile } : {}),
    ...(manifest.signatureStyleSelection !== undefined
      ? { signatureStyleSelection: manifest.signatureStyleSelection }
      : {}),
    parentGenerationId: input.parentGenerationId,
    sourceAssetId: manifest.source.assetId,
    ...(manifest.references ? { references: manifest.references } : {}),
    ...(lockedFields.length ? { lockedFields } : {}),
    visualDNAId: manifest.visualDNA.hash,
    visualDNASchemaVersion: manifest.visualDNA.schemaVersion,
    dnaRevision: manifest.visualDNA.revision,
    prompt: manifest.prompt.text,
    promptCompilerVersion: manifest.prompt.compilerVersion,
    model: manifest.model,
    parameters: manifest.parameters,
    outputAssetId: output.assetId,
    outputHash: output.hash,
    createdAt: manifest.completedAt
  }));
}

interface ManifestAssetInput {
  assetId: string;
  hash: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
}

export interface CreateGenerationManifestInput {
  id: string;
  projectId: string;
  taskId: string;
  setId?: string;
  planItemId?: string;
  domainProfile?: DomainProfile;
  signatureStyleSelection?: SignatureStyleSelection | null;
  createdAt: number;
  completedAt: number;
  source: ManifestAssetInput;
  references?: GenerationReferenceSnapshot[];
  visualDNA: VisualDNA;
  prompt: string;
  model: {
    provider: "codex" | "mock";
    name: string;
    version: string | null;
  };
  parameters: {
    aspectRatio: AspectRatio;
    count: 1 | 2 | 3 | 4;
    userInstruction: string;
    providerParameters: Record<string, string | number | boolean | null>;
  };
  outputs: Array<ManifestAssetInput & { byteLength: number }>;
}

function canonicalJSONStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSONStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJSONStringify(item)}`).join(",")}}`;
}

export async function createGenerationManifest(input: CreateGenerationManifestInput): Promise<GenerationManifest> {
  const dnaHash = await sha256Hex(new TextEncoder().encode(canonicalJSONStringify(input.visualDNA)));
  const receivedCount = input.outputs.length;
  const missingCount = input.parameters.count - receivedCount;
  return generationManifestSchema.parse({
    schemaVersion: GENERATION_MANIFEST_SCHEMA_VERSION,
    id: input.id,
    projectId: input.projectId,
    taskId: input.taskId,
    ...(input.setId ? { setId: input.setId } : {}),
    ...(input.planItemId ? { planItemId: input.planItemId } : {}),
    ...(input.domainProfile ? { domainProfile: input.domainProfile } : {}),
    ...(input.signatureStyleSelection !== undefined
      ? { signatureStyleSelection: input.signatureStyleSelection }
      : {}),
    createdAt: input.createdAt,
    completedAt: input.completedAt,
    source: {
      assetId: input.source.assetId,
      hash: input.source.hash,
      mimeType: input.source.mimeType,
      file: { storage: "indexeddb", key: input.source.assetId, name: input.source.fileName }
    },
    ...(input.references ? { references: input.references } : {}),
    visualDNA: {
      schemaVersion: input.visualDNA.schemaVersion,
      revision: input.visualDNA.revision,
      hash: dnaHash,
      snapshot: input.visualDNA
    },
    prompt: {
      compilerVersion: PROMPT_COMPILER_VERSION,
      text: input.prompt
    },
    model: input.model,
    parameters: {
      ...input.parameters,
      providerParameters: {
        ...input.parameters.providerParameters,
        requestedCount: input.parameters.count,
        receivedCount,
        missingCount,
        partialGeneration: missingCount > 0
      }
    },
    outputs: input.outputs.map((output) => ({
      assetId: output.assetId,
      hash: output.hash,
      mimeType: output.mimeType,
      byteLength: output.byteLength,
      file: { storage: "indexeddb", key: output.assetId, name: output.fileName }
    }))
  });
}

export interface CompileInput {
  visualDNA: VisualDNA;
  domainProfile?: DomainProfile;
  creativeDirection?: CreativeDirection;
  transformationBlueprint?: TransformationBlueprint;
  userInstruction?: string;
  aspectRatio: AspectRatio;
  references: Array<{
    index: number;
    role: "style_layout" | "style" | "subject" | "identity" | "composition" | "color" | "edit_base";
    subjectType?: SubjectAssetType;
    subjectName?: string;
    subjectConstraints?: string[];
    imagePurpose?: "face" | "full_body";
  }>;
  editMode?: boolean;
}

export const DOMAIN_ANALYSIS_PROMPTS: Record<Domain, string> = {
  portrait: "人像摄影分析：观察人物数量、景别、姿态、表情、服装、发型与妆容、五官、环境、镜头感、景深、光线方向与软硬、肤色、胶片或数码质感，以及人物与环境关系。",
  product: "商品视觉分析：观察产品外形、关键结构、材质、表面反射、Logo 和文字区域、相机角度、透视、陈列方式、接触面、阴影、商业照明、背景、道具与环境比例。",
  poster: "海报设计分析：观察画布比例、网格、信息层级、标题与正文角色、字体类别与字号关系、图文区块、留白、装饰图形、边框、材质、印刷效果、安全区域和阅读顺序；不可读文字必须为 null。",
  illustration: "插画与动漫分析：观察媒介、线稿、笔触、色块、阴影方式、角色造型、形状语言、透视、色彩、背景复杂度、动态、渲染方式及纸张或数字材质。",
  photography: "通用摄影分析：观察主体、场景、事件或瞬间、景别、机位、镜头感、景深、曝光、光线、色彩、构图、环境质感与后期风格。"
};

export const DOMAIN_LABELS: Record<Domain, string> = {
  portrait: "人像摄影",
  product: "商品视觉",
  poster: "海报设计",
  illustration: "插画／动漫",
  photography: "通用摄影"
};

function emptyDomainDetails(domain: Domain): DomainProfile["details"] {
  const fields: Record<Domain, Record<string, unknown>> = {
    portrait: {
      personCount: null, framing: null, pose: null, expression: null, wardrobe: null,
      hairAndMakeup: null, environment: null, lensFeel: null, depthOfField: null,
      lighting: null, skinToneRendering: null, captureTexture: null,
      subjectEnvironmentRelation: null
    },
    product: {
      form: null, keyStructures: [], materials: [], surfaceReflection: null,
      logoAndTextRegions: [], cameraAngle: null, perspective: null, displayMethod: null,
      contactSurface: null, shadow: null, commercialLighting: null, background: null,
      props: [], environmentScale: null
    },
    poster: {
      canvasRatio: null, grid: null, hierarchy: null, titleRole: null, bodyRole: null,
      typeCategory: null, typeScaleRelation: null, textBlockPositions: [],
      imageBlockPositions: [], whitespace: null, decorativeGraphics: [], border: null,
      material: null, printEffect: null, safeArea: null, readingOrder: [], readableText: null
    },
    illustration: {
      medium: null, lineArt: null, brushwork: null, colorBlocks: null,
      shadingMethod: null, characterDesign: null, shapeLanguage: null,
      perspective: null, color: null, backgroundComplexity: null, motion: null,
      renderingMethod: null, surfaceTexture: null
    },
    photography: {
      subject: null, scene: null, moment: null, framing: null, cameraPosition: null,
      lensFeel: null, depthOfField: null, exposure: null, lighting: null, color: null,
      composition: null, environmentTexture: null, postProcessing: null
    }
  };
  return fields[domain] as DomainProfile["details"];
}

export function createMigrationDomainProfile(): DomainProfile {
  return {
    schemaVersion: "1.0.0",
    domain: "photography",
    subdomain: null,
    confidence: null,
    observedSignals: [],
    routingState: "uncertain",
    secondCandidate: null,
    profileVersion: "migration-v1",
    source: "migration",
    details: emptyDomainDetails("photography")
  } as DomainProfile;
}

export function normalizeAutoDomainProfile(profile: DomainProfile): DomainProfile {
  return {
    ...profile,
    routingState: profile.source === "auto" && profile.confidence !== null && profile.confidence < 0.65
      ? "uncertain"
      : profile.routingState ?? "confirmed",
    secondCandidate: profile.secondCandidate ?? null
  } as DomainProfile;
}

export function overrideDomainProfile(profile: DomainProfile, domain: Domain): DomainProfile {
  return {
    ...profile,
    domain,
    profileVersion: `${domain}-override-v1`,
    source: "user_override",
    routingState: "user_overridden",
    details: profile.domain === domain ? profile.details : emptyDomainDetails(domain)
  } as DomainProfile;
}

const setPlan = (
  role: string,
  title: string,
  shotType: string,
  composition: string,
  camera: string,
  poseOrAction: string,
  expression: string,
  scene: string,
  lightingVariation: string
) => ({ role, title, shotType, composition, camera, poseOrAction, expression, scene, lightingVariation });

const SET_PLANS: Record<Domain, ReturnType<typeof setPlan>[]> = {
  portrait: [
    setPlan("environment-establishing", "环境全身", "全身", "人物与环境共同建立", "平视广角", "自然站立", "平静", "完整环境", "主光"),
    setPlan("medium-portrait", "中景回头", "中景", "人物居中偏侧", "标准镜头", "回头", "自然", "同一环境", "侧向柔光"),
    setPlan("close-portrait", "近景正面", "近景", "面部为视觉中心", "中长焦", "正面静止", "克制", "背景虚化", "柔和正面光"),
    setPlan("profile-motion", "侧面动态", "中全景", "动势构图", "侧面跟拍", "行走或转身", "自然", "同一环境侧向区域", "轮廓光"),
    setPlan("emotion-closeup", "情绪特写", "特写", "紧凑面部构图", "长焦", "轻微低头", "明确情绪", "极简背景", "低对比柔光"),
    setPlan("wardrobe-detail", "服装细节", "局部", "服装与手部细节", "近摄", "整理服装", "不强调", "同一环境", "材质侧光"),
    setPlan("dynamic-candid", "动态抓拍", "中景", "非对称瞬间", "跟拍", "自然动作", "抓拍", "同一环境", "环境混合光"),
    setPlan("identity-detail", "人物细节", "近景", "五官与关键特征", "近摄", "轻微侧转", "平静", "简化背景", "均匀柔光"),
    setPlan("alternate-framing", "替代构图", "中全景", "前景遮挡层次", "低机位", "停步回望", "自然", "同一环境另一位置", "逆光"),
    setPlan("back-turn", "背影回头", "中全景", "人物背向镜头并向空间边缘移动", "侧后方眼平", "刚刚回头", "重新接近", "路径或门口", "侧逆光"),
    setPlan("occluded-peek", "遮挡窥视", "中近景", "前景遮挡形成观察距离", "略高位偏轴", "正在穿过遮挡", "轻微失控", "有前景层次的空间", "切割光"),
    setPlan("extreme-closeup", "极近特写", "极近特写", "眼神与局部皮肤占据画面", "眼平近摄", "动作刚刚停下", "再次平静", "极简背景", "柔和贴面光")
  ],
  product: [
    setPlan("hero", "主视觉 Hero", "主视觉", "产品居中主导", "平视标准", "静态陈列", "不适用", "商业场景", "塑形主光"),
    setPlan("three-quarter", "三分之四角度", "三分之四", "展示体积", "略高机位", "旋转展示", "不适用", "同一商业场景", "侧后轮廓光"),
    setPlan("use-context", "真实使用场景", "环境中景", "产品与使用者关系", "标准镜头", "使用状态", "不适用", "真实使用环境", "环境商业光"),
    setPlan("structure-detail", "结构细节", "细节", "关键结构局部", "微距", "突出接口与结构", "不适用", "简化背景", "细节侧光"),
    setPlan("front", "正面结构", "正面", "对称构图", "正面平视", "静态陈列", "不适用", "纯净背景", "均匀商业光"),
    setPlan("side-top", "侧面或顶视", "侧面顶视", "几何陈列", "高机位", "完整侧面", "不适用", "接触面清晰", "顶部柔光"),
    setPlan("material-detail", "材质细节", "微距", "表面材质占主导", "微距", "突出反射与纹理", "不适用", "抽象背景", "掠射光"),
    setPlan("scale-relation", "尺度关系", "环境全景", "产品与环境比例", "广角", "环境陈列", "不适用", "完整空间", "空间光"),
    setPlan("components", "组件商业构图", "组合", "主件与组件层次", "俯视", "组件展开", "不适用", "商业台面", "均匀顶光"),
    setPlan("monumental", "纪念碑式强化", "低机位主视觉", "产品形成建筑般体量", "低机位仰视", "稳定陈列", "不适用", "极简尺度空间", "硬质轮廓光"),
    setPlan("dynamic", "动态瞬间", "高速近景", "液体、粉末或运动痕迹形成动势", "斜向近摄", "产品处于正在发生的瞬间", "不适用", "受控动态空间", "冻结动作光"),
    setPlan("minimal-closing", "极简收尾", "极简静物", "产品与留白形成系列句点", "平视或轻俯", "安静陈列", "不适用", "纯净承托面", "柔和收束光")
  ],
  poster: [
    setPlan("primary-layout", "主版式", "完整画布", "核心网格", "正视", "主信息建立", "不适用", "完整画布", "平面视觉"),
    setPlan("type-led", "字体主导版式", "完整画布", "标题主导", "正视", "文字区块变化", "不适用", "完整画布", "平面视觉"),
    setPlan("image-led", "图像主导版式", "完整画布", "图像主导", "正视", "图像区块变化", "不适用", "完整画布", "平面视觉"),
    setPlan("grid-variation", "网格变化版式", "完整画布", "替代网格", "正视", "改变信息节奏", "不适用", "完整画布", "平面视觉"),
    setPlan("crop-detail", "局部裁切", "局部延展", "大胆裁切", "正视", "放大核心元素", "不适用", "局部画布", "平面视觉"),
    setPlan("color-variation", "色彩变化", "完整画布", "同网格新色彩重心", "正视", "调整色彩比例", "不适用", "完整画布", "平面视觉"),
    setPlan("horizontal-extension", "横向延展", "横向", "横向重排", "正视", "延展系列", "不适用", "横向画布", "平面视觉"),
    setPlan("vertical-extension", "竖向延展", "竖向", "竖向重排", "正视", "延展系列", "不适用", "竖向画布", "平面视觉"),
    setPlan("companion-poster", "系列副海报", "完整画布", "同系统新层级", "正视", "替换主次关系", "不适用", "系列画布", "平面视觉")
  ],
  illustration: [
    setPlan("scene-establishing", "建立场景", "全景", "环境建立", "广角视角", "主体进入场景", "平静", "完整世界", "环境主光"),
    setPlan("full-character", "完整角色", "全身", "角色完整展示", "平视", "标志性姿态", "中性", "同一场景", "角色塑形光"),
    setPlan("medium-action", "中景动作", "中景", "动作构图", "动态视角", "明确动作", "专注", "同一场景", "动势光"),
    setPlan("emotion-close", "情绪近景", "近景", "表情主导", "近距离", "轻微动作", "强情绪", "简化背景", "情绪光"),
    setPlan("profile", "侧面角色", "中景", "轮廓展示", "侧视", "侧面停驻", "克制", "同一场景", "轮廓光"),
    setPlan("dynamic-angle", "动态视角", "中全景", "强透视", "仰视或俯视", "高速动作", "紧张", "同一世界", "高对比光"),
    setPlan("quiet-moment", "安静时刻", "中景", "留白构图", "平视", "静坐或停留", "平和", "安静角落", "柔光"),
    setPlan("world-detail", "场景细节", "细节", "世界观细节", "近摄", "展示道具", "不强调", "场景局部", "材质光"),
    setPlan("key-art", "主视觉 Key Art", "主视觉", "角色与世界高潮构图", "英雄视角", "标志动作", "坚定", "完整世界", "戏剧光")
  ],
  photography: [
    setPlan("environment", "环境建立", "全景", "空间关系", "广角", "主体处于环境", "自然", "完整场景", "环境光"),
    setPlan("subject", "主体画面", "中全景", "主体主导", "标准镜头", "自然状态", "自然", "主要场景", "主光"),
    setPlan("medium", "中景瞬间", "中景", "事件关系", "平视", "进行中的动作", "自然", "同一场景", "侧光"),
    setPlan("detail", "细节画面", "细节", "局部重点", "近摄", "捕捉细节", "不强调", "场景局部", "细节光"),
    setPlan("alternate-angle", "替代机位", "中景", "非对称构图", "高或低机位", "同一事件", "自然", "同一场景", "替代方向光"),
    setPlan("decisive-moment", "动态瞬间", "中景", "瞬间动势", "跟拍", "动态事件", "抓拍", "同一场景", "自然光"),
    setPlan("spatial-relation", "空间关系", "远景", "多层空间", "广角", "主体穿行", "自然", "完整空间", "纵深光"),
    setPlan("atmosphere", "氛围镜头", "空镜或远景", "氛围留白", "固定机位", "环境变化", "不强调", "场景氛围", "低对比光"),
    setPlan("closing", "收束镜头", "中远景", "视觉收束", "后撤视角", "离开或停驻", "平静", "场景末段", "暮光")
  ]
};

export function createCreationSetPlan(domain: Domain, count: 2 | 3 | 4 | 6 | 9 | 12): CreationSetPlanItem[] {
  const lockedDimensions = domain === "portrait"
    ? ["identity", "style", "palette", "material"] as const
    : domain === "product"
      ? ["subject", "style", "palette", "material"] as const
      : ["style", "palette", "material"] as const;
  const variationPairs = [
    ["shot_scale", "camera_angle"],
    ["composition", "orientation"],
    ["environment", "visual_emphasis"],
    ["pose_action", "negative_space"],
    ["shot_scale", "environment"],
    ["lighting", "visual_emphasis"],
    ["camera_angle", "pose_action"],
    ["composition", "negative_space"],
    ["orientation", "lighting"],
    ["camera_angle", "visual_emphasis"],
    ["pose_action", "lighting"],
    ["negative_space", "visual_emphasis"]
  ] as const;
  const templates = SET_PLANS[domain];
  return Array.from({ length: count }, (_, index) => {
    const item = templates[index % templates.length]!;
    const cycle = Math.floor(index / templates.length);
    return ({
    id: `${domain}-${index + 1}`,
    order: index + 1,
    role: cycle === 0 ? item.role : `${item.role}-variation-${cycle + 1}`,
    userFacingTitle: cycle === 0 ? item.title : `${item.title} · 变化 ${cycle + 1}`,
    shotType: item.shotType,
    composition: item.composition,
    camera: item.camera,
    poseOrAction: item.poseOrAction,
    expression: item.expression,
    scene: item.scene,
    lightingVariation: item.lightingVariation,
    creativePlan: {
      concept: `${item.title}围绕参考图方法建立独立视觉概念`,
      narrativeContext: `${item.scene}中的${item.poseOrAction}`,
      storyPurpose: `${item.title}承担当前系列中的独立视觉目的`,
      subjectState: `${item.poseOrAction}；${item.expression}`,
      cameraLanguage: item.camera,
      cameraHeight: item.camera,
      horizontalAngle: item.camera,
      pitchAngle: item.camera,
      shotScale: item.shotType,
      lens: item.camera,
      perspective: "保持主体比例可信并服从当前机位",
      composition: item.composition,
      pose: item.poseOrAction,
      actionPhase: `正在${item.poseOrAction}的动作中间帧`,
      gaze: domain === "portrait" ? "视线服从当前叙事关系" : "不适用",
      gesture: item.poseOrAction,
      emotion: item.expression,
      timeSense: "与同组视觉世界一致",
      weatherSense: "与同组视觉世界一致",
      lightDirection: item.lightingVariation,
      lightQuality: item.lightingVariation,
      shadowStrategy: "保留可信接触阴影和空间层次",
      colorSystem: "沿用参考图色彩关系，不复制具体物件颜色",
      lighting: item.lightingVariation,
      environment: item.scene,
      atmosphere: item.expression,
      material: "保持参考图材质表现方法",
      postProcessing: "统一参考图的颗粒、锐度、反差与色彩收口",
      shotResponsibility: `${item.title}在整套中不可由其他镜头替代`
    },
    gridCellReference: null,
    gridCellAnalysis: null,
    promptDelta: `${item.title}：${item.shotType}，${item.composition}，${item.camera}，${item.poseOrAction}，${item.scene}，${item.lightingVariation}`,
    variationDimensions: [...variationPairs[index]!],
    finalPrompt: null,
    lockedDimensions: [...lockedDimensions],
    status: "PENDING",
    taskId: null,
    retryOfTaskId: null,
    generationEventId: null,
    outputAssetId: null,
    outputCandidates: [],
    selectedOutputAssetId: null,
    qualityStatus: "not_checked",
    qualityMessage: null,
    retryDirective: null,
    error: null
    });
  });
}

export interface CreativeDirection {
  visualTheme: string;
  visualStory: string;
  subjectState: string;
  subjectRelationship: string;
  cameraLanguage: string;
  emotionalTone: string;
  environmentalContext: string;
  commercialIntent: string;
  creativePurpose: string;
  lightingMethod: string;
  stylingMethod: string;
  referenceAnchors: string[];
}

export function createCreativeDirection(input: {
  domain: Domain;
  visualDNA: VisualDNA;
  domainProfile?: DomainProfile;
  userIntent: string;
}): CreativeDirection {
  const { domain, visualDNA: d } = input;
  const profile = input.domainProfile;
  const portrait = profile?.domain === "portrait" ? profile.details : undefined;
  const product = profile?.domain === "product" ? profile.details : undefined;
  const action = portrait?.pose ?? d.subject.action ?? "主体处于可观察的静态关系中";
  const environment = portrait?.environment ?? product?.background ??
    d.subject.environment ?? d.mood.atmosphere;
  const relationship = portrait?.subjectEnvironmentRelation ??
    (product ? `${product.displayMethod ?? "产品陈列"}；产品与环境尺度为${product.environmentScale ?? "按参考图关系"}` : null) ??
    `${d.subject.description}与${environment}形成关系`;
  const camera = portrait?.lensFeel ?? product?.cameraAngle ??
    `${d.camera.lens}，${d.camera.angle}，${d.composition.shotType}`;
  const lighting = portrait?.lighting ?? product?.commercialLighting ??
    `${d.lighting.direction}，${d.lighting.quality}，${d.lighting.contrast}`;
  const styling = portrait?.wardrobe ??
    (product ? `${product.materials?.join("、") || d.material.types.join("、")}；${product.displayMethod ?? "参考图陈列方式"}` : null) ??
    `${d.material.types.join("、")}与${d.style.medium}`;
  const commercial = product
    ? `参考图通过${product.displayMethod ?? d.composition.subjectPlacement}、${lighting}和${styling}建立商品价值`
    : `参考图通过${d.composition.shotType}、${action}、${lighting}和${d.mood.emotionalTone}建立摄影表达`;
  const anchors = [action, environment, relationship, camera, lighting, styling, d.mood.emotionalTone]
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
  return {
    visualTheme: `${d.style.keywords.join("、")}；${d.style.medium}；${d.mood.keywords.join("、")}`,
    visualStory: `参考图通过“${action}”以及${relationship}形成视觉事件`,
    subjectState: `${action}；${portrait?.expression ?? d.mood.emotionalTone}`,
    subjectRelationship: relationship,
    cameraLanguage: camera,
    emotionalTone: `${d.mood.emotionalTone}；${d.mood.atmosphere}`,
    environmentalContext: environment,
    commercialIntent: commercial,
    creativePurpose: domain === "product"
      ? "迁移参考图的广告说服方法到用户商品"
      : "迁移参考图的摄影叙事方法到用户人物",
    lightingMethod: lighting,
    stylingMethod: styling,
    referenceAnchors: anchors
  };
}

export function createTransformationBlueprint(input: {
  domain: Domain;
  visualDNA: VisualDNA;
  creativeDirection: CreativeDirection;
  references: CompileInput["references"];
}): TransformationBlueprint {
  const { creativeDirection: direction, visualDNA } = input;
  const contentSpecificConstraint = /(无人物|静物|多人|动作|姿态|场景|背景|机位|构图|服装|饰品|道具|视线|手势|陈列)/;
  const identity = input.references.find((reference) => reference.role === "identity");
  const subject = input.references.find((reference) => reference.role === "subject");
  const replacement = identity ?? subject;
  const replacementName = replacement?.subjectName
    ? `“${replacement.subjectName}”`
    : "用户提供的主体";
  const replicatesReferenceFrame = input.references.some((reference) => reference.role === "style_layout");
  const replace = identity
    ? [
        `把参考图人物身份替换为${replacementName}，保持用户人物的年龄感、脸型、五官关系和主要外观`,
        "原参考人物的身份、服装标识和可识别个人特征不得进入新作品"
      ]
    : subject
      ? [
          `把参考图商品或主体替换为${replacementName}，保持用户主体的完整外形、关键结构、材质和接口`,
          "原参考商品的品牌元素、Logo、文字和独有结构不得进入新作品"
        ]
      : replicatesReferenceFrame
        ? ["未指定替换主体，保持参考图核心主体，不凭空换人、换商品或改变主体类别"]
        : ["将参考图具体主体替换为用户指定的新主体，不复制原主体身份或品牌"];
  const recreate = replicatesReferenceFrame
    ? !replacement
      ? [
          "保持参考图核心主体与全部画面关系，只修复生成过程中的边缘、遮挡、接触和结构瑕疵",
          "不得把参考图主体改成另一个人物、商品或类别"
        ]
      : input.domain === "product"
      ? [
          "只重建被用户商品替换的主体区域、接触边缘与真实阴影，其他画面元素保持参考图关系",
          "商品与手部、道具、承托面和环境的接触必须符合参考画面的物理关系"
        ]
      : [
          "只重建被用户人物替换的身份区域、身体边缘、遮挡和接触阴影，其他画面元素保持参考图关系",
          "动作、手势和表情跟随参考画面，但人体关节链、左右侧、承重和遮挡必须自然可信"
        ]
    : input.domain === "product"
      ? [
          "按照每张 Creative Shot Plan 重新创造场景、道具和空间关系，不复用参考图具体背景或手部位置",
          "重新创造清楚的使用行为和可见结果，让产品、动作与结果形成因果",
          `重新创造每张广告的独立目的，同时只迁移${direction.commercialIntent}的说服方法`
        ]
      : [
          "按照每张 Creative Shot Plan 重新创造人物动作、手势和姿态，不复用参考人物的具体姿势",
          "重新创造场景和故事瞬间，只迁移参考图的空间组织与情绪强度，不复用具体背景",
          `重新创造镜头间的情绪推进，同时只迁移${direction.visualStory}的叙事方法`
        ];
  const domainAvoid = replicatesReferenceFrame
    ? !replacement
      ? [
          "擅自增删参考画面的核心主体、背景、道具、服装或承托面",
          "凭空替换人物、商品、物体类别、动作、视线或主体位置"
        ]
      : input.domain === "portrait"
      ? [
          "擅自改变参考画面的服装造型、道具、动作、表情、视线、背景或主体位置",
          "让参考画面人物的脸、体型、年龄感、肤色、发型或稳定身份特征覆盖用户人物"
        ]
      : [
          "擅自增删参考画面的背景、道具、手部、承托面、文案留白或主体位置",
          "让参考商品的外形、按钮、接口、Logo、文字或独有结构覆盖用户商品"
        ]
    : input.domain === "portrait"
    ? [
        "复制参考人物的具体服装、图案、帽子、墨镜、饰品或造型",
        "用参考人物的帽子、墨镜、头发或手势遮挡用户人物的五官与身份特征"
      ]
    : [
        "把参考商品的外壳、按钮、接口或结构带到用户商品",
        "除使用镜头外重复参考图的具体手部位置和操作动作"
      ];
  return transformationBlueprintSchema.parse({
    schemaVersion: "1.0.0",
    preserve: replicatesReferenceFrame
      ? [
          `待复刻画面：保持具体景别、机位、主体位置、比例、留白、前中后景层次与构图关系`,
          `画面元素：保持参考图可见的背景、道具、服装或承托面、装饰元素及其数量和相互位置`,
          `摄影语言：${direction.cameraLanguage}`,
          `光影与色彩：${direction.lightingMethod}；${visualDNA.palette.dominantColors.join("、")}；${visualDNA.mood.atmosphere}`,
          `材质与气质：${visualDNA.material.finish}、${visualDNA.texture.surfaceDetail}、${visualDNA.texture.medium}；${direction.emotionalTone}`
        ]
      : [
          `摄影语言：${direction.cameraLanguage}`,
          `光影逻辑：${direction.lightingMethod}`,
          `构图逻辑：${visualDNA.composition.shotType}、${visualDNA.composition.negativeSpace}、${visualDNA.composition.depth}的视觉层级；只保留关系方法，不保留具体位置、动作或背景`,
          `材质表现方法：${visualDNA.material.finish}、${visualDNA.texture.surfaceDetail}、${visualDNA.texture.medium}；不保留参考人物服装或参考商品具体材质`,
          `情绪方向：${direction.emotionalTone}`
        ],
    replace,
    recreate,
    avoid: [
      ...domainAvoid,
      "错误复制参考图人物或其可识别身份",
      "带入错误品牌、Logo、可读文字或商品结构",
      "只替换背景而没有重建动作、场景、故事或使用关系",
      "丢失参考图最核心的摄影、光影、构图、材质与情绪方法",
      ...visualDNA.constraints.avoid.filter((value) => !contentSpecificConstraint.test(value))
    ].filter((value, index, values) => value.trim() && values.indexOf(value) === index).slice(0, 12)
  });
}

type DirectedShot = {
  role: string;
  title: string;
  storyPurpose: string;
  environment: string;
  lens: string;
  angle: string;
  composition: string;
  pose: string;
  gesture: string;
  emotion: string;
  lighting: string;
  wardrobe: string;
  atmosphere: string;
  shotType: string;
  variationDimensions: CreationSetPlanItem["variationDimensions"];
  materialFocus?: string;
  advertisingMood?: string;
  valueQuestion?: "它是什么" | "它好在哪里" | "它如何被使用" | "拥有什么感觉";
};

const SHOT_VISUAL_ACCEPTANCE: Record<string, string> = {
  "hero-identity": "必须以清楚可辨的脸型、五官、年龄感和发型建立人物，构图具有主视觉力量；不得用远景或遮挡脸部",
  "environment-story": "必须出现可识别的完整环境和人物全身或大半身，人物与世界形成明确关系；不得只生成居中肖像",
  "emotional-close-up": "必须是面部和眼神占主导的近景，并以表情、手势或方向性光线呈现明确情绪高潮",
  "dynamic-moment": "人物必须处于清楚可辨的行走、转身、取物或互动动作中，动作、衣物和环境共同产生生命感；不得静止摆拍",
  "story-opening": "必须出现可识别的完整环境和人物全身或大半身，环境承担主要画面面积；不得只生成居中肖像",
  "story-action": "人物必须处于清楚可辨的行走、转身、取物或互动动作中，采用侧面或斜向观看；不得正面静止凝视",
  "story-emotion": "必须是面部和眼神占主导的近景，并以手势或方向性光线呈现明确情绪；不得重复全身构图",
  "story-closing": "人物必须背向或侧后方离开、回望或走向空间边界，人物占比低于环境；不得正面静止站立",
  "story-detail": "必须是手、物件和服装材质的局部特写，不以完整人物为主",
  "story-relationship": "必须清楚建立人物与完整空间的尺度关系，使用高位或低位而非固定平视",
  "story-candid": "人物不得看镜头，必须处于未摆拍的连续动作中",
  "story-profile": "必须呈现纯侧面轮廓并在视线方向保留明显空间",
  "story-keyframe": "人物、决定性动作、环境与动机光必须同时清楚可见",
  "story-back-turn": "必须从侧后方看见人物刚刚回头或即将离开，动作停留在中间帧；不得正面站桩",
  "story-occluded": "必须以门框、玻璃、植物或人群形成真实前景遮挡和窥视关系；不得用抽象蒙版代替",
  "story-extreme-closeup": "必须是眼神、皮肤与局部五官主导的极近特写，同时保持人物身份自然可信",
  "advertising-hero": "必须完整展示产品轮廓与关键结构，采用三分之四或明确英雄机位并保留广告留白",
  "lifestyle-scene": "必须出现可识别的真实生活空间、承托面和至少一种使用线索，产品占画面不超过一半；孤立无缝棚拍背景视为失败",
  "usage-scene": "必须出现不遮挡关键结构的具体操作行为和可见结果，产品、动作与结果形成清楚因果；静态陈列视为失败",
  "material-detail": "必须以微距或紧凑裁切呈现材质、接缝、按键或接口，不得完整展示整台产品",
  "functional-detail": "必须清楚展示一项功能、接口或开合结构及其工作方式，不得退化为普通材质特写",
  "brand-mood": "必须以环境、色彩、光线和留白建立独立品牌世界，不得重复 Hero 的产品陈列",
  "experimental-shot": "必须以非常规机位、反射、折射、运动或尺度关系形成系列记忆点，同时保持产品结构可信",
  "advertising-support-1": "必须以不同于 Hero 的结构关系补充产品信息，不得重复正面全机位",
  "advertising-support-2": "必须以尺度或组件关系补充广告信息，不得重复正面全机位",
  "advertising-support-3": "必须以新的机位或光线证据补充广告信息，不得重复正面全机位",
  "advertising-support-4": "必须以新的视觉重点补充广告信息，不得重复正面全机位",
  "advertising-support-5": "必须形成系列收束，不得重复正面全机位"
};

const PORTRAIT_DIRECTED_SHOTS: DirectedShot[] = [
  {
    role: "hero-identity", title: "人物建立 · 核心主视觉", storyPurpose: "以清楚身份和决定性气质建立这一组的核心人物",
    environment: "与参考方法一致但重新创造的简洁核心场景", lens: "50–85mm 人像镜头",
    angle: "眼平或轻微低机位英雄视角", composition: "人物清楚主导画面，同时保留少量环境线索",
    pose: "稳定站立并以轻微身体转向建立气质", gesture: "手部自然放松且不遮挡面部",
    emotion: "明确、自信、身份可信", lighting: "方向性主光塑造脸型和眼神，环境光维持参考氛围",
    wardrobe: "新的无标识完整造型，与参考图只共享层次和触感方法", atmosphere: "具有封面感、可信、不像证件照",
    shotType: "身份主视觉", variationDimensions: ["composition", "lighting", "visual_emphasis"]
  },
  {
    role: "environment-story", title: "人物与世界 · 环境叙事", storyPurpose: "交代人物所处世界以及人物与环境的关系",
    environment: "完整环境与可识别的时间、天气和空间线索", lens: "28–35mm 广角纪实镜头",
    angle: "平视或轻微低机位", composition: "人物处于环境层次中，保留叙事留白",
    pose: "沿直线路径自然行走或双脚稳定停步", gesture: "双手各自自然放松；如需持物，只允许同侧单手持握",
    emotion: "克制、观察", lighting: "环境主光与人物轮廓光共同建立时间感",
    wardrobe: "完整展示服装轮廓并与环境色彩形成关系", atmosphere: "真实、可进入、有故事尚未发生的期待",
    shotType: "环境全身", variationDimensions: ["shot_scale", "environment", "negative_space"]
  },
  {
    role: "emotional-close-up", title: "情绪高潮 · 近景特写", storyPurpose: "揭示人物当下的明确情绪并保持身份可信",
    environment: "与前两张同一世界的安静局部，背景只保留必要线索", lens: "75–105mm 中长焦肖像镜头",
    angle: "眼平近距离或轻微侧面", composition: "面部、眼神和手势形成三角关系",
    pose: "双肩自然、头部轻微侧转的稳定停顿", gesture: "双手离开面部并自然放松，不遮挡五官",
    emotion: "明确但不过度表演", lighting: "有方向的柔光塑造眼神和面部层次",
    wardrobe: "保留系列服装连续性，突出领口或面料细节", atmosphere: "安静、亲密、具有心理距离",
    shotType: "情绪近景", variationDimensions: ["shot_scale", "visual_emphasis", "lighting"]
  },
  {
    role: "dynamic-moment", title: "动作生命感 · 动态瞬间", storyPurpose: "用明确动作和身体能量让摄影故事真正发生",
    environment: "环境中的路径、门口、街角或具有方向性的区域", lens: "35–50mm 标准纪实镜头",
    angle: "侧面跟拍或斜向机位", composition: "对角线、前景和动作方向共同形成张力",
    pose: "沿单一方向自然行走，躯干与头部朝向一致", gesture: "双臂自然摆动，不持物、不交叉、不跨越身体中线",
    emotion: "专注、正在经历", lighting: "侧逆光或混合环境光强化运动轮廓",
    wardrobe: "服装随动作产生真实褶皱和动态", atmosphere: "偶然捕捉、节奏明确、生活正在发生",
    shotType: "动态中景", variationDimensions: ["pose_action", "camera_angle", "composition"]
  },
  {
    role: "story-detail", title: "叙事细节 · 手与物件", storyPurpose: "用细节补足人物经历和环境信息",
    environment: "故事物件所在的局部空间", lens: "85–120mm 近摄镜头", angle: "手部高度近摄",
    composition: "同侧单手、物件与服装材质形成紧凑层次", pose: "一只手稳定停在物件旁", gesture: "仅用同侧单手轻触物件，另一只手不入镜",
    emotion: "不直接表演", lighting: "掠射光突出材质", wardrobe: "突出袖口和面料",
    atmosphere: "触觉真实、叙事含蓄", shotType: "细节特写",
    variationDimensions: ["visual_emphasis", "pose_action", "lighting"]
  },
  {
    role: "story-relationship", title: "空间关系 · 人与环境", storyPurpose: "强化人物与空间的尺度和关系",
    environment: "具有前中后景的完整空间", lens: "24–35mm 广角镜头", angle: "高位或低位建立空间",
    composition: "多层景深与框景，但人物四肢轮廓保持清楚", pose: "双脚稳定站立并观察空间", gesture: "双手自然放松，不触碰或穿过环境物件",
    emotion: "沉浸", lighting: "空间纵深光", wardrobe: "轮廓清楚",
    atmosphere: "空间感强、环境参与叙事", shotType: "空间全景",
    variationDimensions: ["environment", "camera_angle", "composition"]
  },
  {
    role: "story-candid", title: "非表演瞬间 · 抓拍", storyPurpose: "提供真实生活感和偶然性",
    environment: "人群边缘或自然活动区域", lens: "35mm 抓拍镜头", angle: "略偏离视线的观察机位",
    composition: "不完全居中，前景只经过画面边缘且不遮挡人体", pose: "单一步伐的自然行走关键帧", gesture: "双臂自然下垂或轻微摆动",
    emotion: "放松、未看镜头", lighting: "现有光", wardrobe: "自然动态",
    atmosphere: "不完美但可信", shotType: "抓拍中景",
    variationDimensions: ["pose_action", "composition", "orientation"]
  },
  {
    role: "story-profile", title: "侧面停顿 · 轮廓", storyPurpose: "改变观看关系并突出人物轮廓",
    environment: "简化但保留时间线索的背景", lens: "50–85mm 镜头", angle: "纯侧面",
    composition: "视线方向保留空间", pose: "静止侧身", gesture: "手部放松",
    emotion: "内省", lighting: "轮廓光与低对比补光", wardrobe: "突出肩颈轮廓",
    atmosphere: "克制、图形化", shotType: "侧面中近景",
    variationDimensions: ["camera_angle", "negative_space", "lighting"]
  },
  {
    role: "story-keyframe", title: "故事主视觉 · 决定性瞬间", storyPurpose: "汇总人物、动作、环境和光线成为系列封面",
    environment: "最能代表故事的核心空间", lens: "35–50mm 电影镜头", angle: "具有主观性的英雄机位",
    composition: "人物、环境和动机光形成完整主视觉", pose: "双脚稳定、肩胯方向一致的主视觉站姿", gesture: "双手自然分开并完整可见",
    emotion: "故事最强情绪", lighting: "戏剧性动机光", wardrobe: "完整造型",
    atmosphere: "可作为摄影故事封面", shotType: "主视觉",
    variationDimensions: ["composition", "pose_action", "lighting"]
  },
  {
    role: "story-back-turn", title: "侧身停顿 · 离场瞬间", storyPurpose: "用侧身停顿和离场方向改变观看关系",
    environment: "通向画面边界的路径、门口或街角", lens: "35–50mm 纪实镜头", angle: "侧后方眼平机位",
    composition: "人物侧向镜头并朝空间边界停步，视线方向保留留白", pose: "双脚稳定停步，头肩与躯干保持同向",
    gesture: "双手自然放松，不整理衣摆、不触碰门框", emotion: "重新接近、欲言又止",
    lighting: "侧逆光分离轮廓并保留面部细节", wardrobe: "服装随步伐产生真实褶皱",
    atmosphere: "离场、回望、故事未完", shotType: "侧后方中全景",
    variationDimensions: ["orientation", "pose_action", "negative_space"]
  },
  {
    role: "story-occluded", title: "遮挡窥视 · 观察距离", storyPurpose: "以前景遮挡建立私密观察距离和轻微不确定感",
    environment: "具有门框、玻璃、植物或人群边缘的真实空间", lens: "50–85mm 中长焦", angle: "略高位偏轴观察机位",
    composition: "前景只框住画面边缘，不遮挡面部、躯干和四肢关节", pose: "人物在无遮挡区域稳定站立",
    gesture: "双手完整可见并自然放松，不拨开帘子、植物或门边", emotion: "克制、被偶然看见",
    lighting: "切割光穿过遮挡并落在眼神或手势上", wardrobe: "局部可见并保持系列连续性",
    atmosphere: "窥视、偶然、紧张一瞬", shotType: "遮挡中近景",
    variationDimensions: ["composition", "visual_emphasis", "lighting"]
  },
  {
    role: "story-extreme-closeup", title: "极近特写 · 再次平静", storyPurpose: "以最小距离收束人物情绪并重新确认身份",
    environment: "只保留同一世界的色彩和光线痕迹", lens: "100–135mm 近摄肖像镜头", angle: "眼平极近距离",
    composition: "眼神、皮肤纹理和局部五官占据画面", pose: "头颈自然连接并轻微呼吸",
    gesture: "双手不入镜，不触碰面部或领口", emotion: "再次平静、余韵仍在",
    lighting: "柔和贴面光保留真实皮肤纹理与眼神高光", wardrobe: "只保留少量领口材质线索",
    atmosphere: "安静收束、真实亲密", shotType: "极近特写",
    variationDimensions: ["shot_scale", "visual_emphasis", "lighting"]
  }
];

const PRODUCT_DIRECTED_SHOTS: DirectedShot[] = [
  {
    role: "advertising-hero", title: "广告主视觉 · Hero", storyPurpose: "建立产品地位和第一眼价值",
    environment: "品牌化主视觉空间与明确承托关系", lens: "70–100mm 商业产品镜头", angle: "略低或平视三分之四",
    composition: "产品主导、轮廓完整、留出广告文案空间", pose: "稳定陈列", gesture: "不适用",
    emotion: "自信、精确", lighting: "主光塑形、轮廓光分离、受控反射", wardrobe: "不适用",
    atmosphere: "高级、克制、具有发布感", materialFocus: "完整外形、关键结构和主材质",
    advertisingMood: "旗舰发布广告", shotType: "Hero 主视觉",
    variationDimensions: ["camera_angle", "composition", "negative_space"]
  },
  {
    role: "lifestyle-scene", title: "生活方式 · 场景关系", storyPurpose: "让用户理解产品属于怎样的生活",
    environment: "真实、可使用、有生活痕迹但不杂乱的完整空间", lens: "35–50mm 环境商业镜头",
    angle: "自然视线高度", composition: "产品与空间形成尺度关系，保留环境叙事",
    pose: "置于真实生活位置", gesture: "通过道具或人物局部暗示使用",
    emotion: "舒适、向往", lighting: "自然环境光加轻量商业补光", wardrobe: "不适用",
    atmosphere: "可信生活方式、非棚拍换背景", materialFocus: "材质与周围家居材质形成对比",
    advertisingMood: "生活方式广告", shotType: "环境中景",
    variationDimensions: ["environment", "shot_scale", "composition"]
  },
  {
    role: "usage-scene", title: "真实使用 · 功能瞬间", storyPurpose: "用明确行为证明产品如何工作",
    environment: "符合产品功能的真实操作位置", lens: "45–65mm 近距离叙事镜头",
    angle: "操作侧前方机位", composition: "产品、操作动作和结果形成因果关系",
    pose: "产品处于真实工作状态", gesture: "手部执行具体操作但不遮挡关键结构",
    emotion: "直观、可信", lighting: "功能区域和操作界面有明确重点光", wardrobe: "不适用",
    atmosphere: "正在发生、功能可信、具有使用欲望", materialFocus: "操作界面、接口和工作状态",
    advertisingMood: "功能演示广告", shotType: "使用场景",
    variationDimensions: ["pose_action", "visual_emphasis", "camera_angle"]
  },
  {
    role: "material-detail", title: "材质证据 · 结构特写", storyPurpose: "用可触摸的细节证明做工和品质",
    environment: "极简局部环境，只保留承托与尺度线索", lens: "90–120mm 微距产品镜头",
    angle: "掠过表面的侧向近摄", composition: "材质、接口或关键结构占据视觉中心",
    pose: "静态细节展示", gesture: "不适用", emotion: "精密、可信",
    lighting: "掠射光控制高光边缘并呈现真实纹理", wardrobe: "不适用",
    atmosphere: "触觉、精密、工艺感", materialFocus: "表面纹理、接缝、按键、接口和结构精度",
    advertisingMood: "工艺证明广告", shotType: "微距特写",
    variationDimensions: ["shot_scale", "visual_emphasis", "lighting"]
  },
  {
    role: "functional-detail", title: "功能细节 · 工作方式", storyPurpose: "用清楚结构关系解释一项关键功能",
    environment: "只保留功能发生所必需的承托面和尺度线索", lens: "70–100mm 结构近摄镜头",
    angle: "对准关键接口或开合关系的斜侧机位", composition: "功能部件、连接关系和结果占据视觉中心",
    pose: "关键部件处于可理解的工作或开合状态", gesture: "必要时用手指或无品牌工具指示功能，不遮挡结构",
    emotion: "清楚、可靠", lighting: "重点光揭示结构层级与接口边缘", wardrobe: "不适用",
    atmosphere: "理性、精确、易理解", materialFocus: "功能部件、接口和机械关系",
    advertisingMood: "功能证明广告", shotType: "功能近景",
    variationDimensions: ["visual_emphasis", "pose_action", "camera_angle"]
  },
  {
    role: "brand-mood", title: "品牌情绪 · 世界观", storyPurpose: "让产品进入可辨识、可向往的品牌世界",
    environment: "由参考方法重建的品牌化空间、色彩和材质关系", lens: "40–70mm 品牌叙事镜头",
    angle: "具有观察感的偏轴机位", composition: "产品、环境和留白共同传达品牌立场",
    pose: "产品与环境形成稳定但非 Hero 式关系", gesture: "不适用",
    emotion: "向往、有个性", lighting: "环境动机光与品牌色彩共同塑造氛围", wardrobe: "不适用",
    atmosphere: "完整品牌世界、不是装饰背景", materialFocus: "产品材质与环境材质的价值对照",
    advertisingMood: "品牌形象广告", shotType: "品牌氛围",
    variationDimensions: ["environment", "lighting", "negative_space"]
  },
  {
    role: "experimental-shot", title: "实验镜头 · 记忆点", storyPurpose: "用一个非常规视觉事件建立系列记忆点",
    environment: "允许反射、折射、尺度错位或运动痕迹的受控实验空间", lens: "24–90mm 按创意选择的实验镜头",
    angle: "明显区别于其他镜头的俯视、仰视或极端近摄", composition: "以单一强视觉机制组织画面，同时保持产品可辨认",
    pose: "产品结构保持真实，视觉关系可以大胆", gesture: "不适用",
    emotion: "惊喜、鲜明", lighting: "用硬光、彩色反射或动态光形成记忆点", wardrobe: "不适用",
    atmosphere: "大胆但受控、具有传播性", materialFocus: "关键轮廓和材质不得因实验效果而丢失",
    advertisingMood: "创意传播广告", shotType: "实验主视觉",
    variationDimensions: ["camera_angle", "composition", "lighting"]
  },
  ...SET_PLANS.product.slice(7).map((item, index): DirectedShot => ({
    role: `advertising-support-${index + 1}`, title: item.title,
    storyPurpose: "补充广告系列中的结构、尺度或组件信息", environment: item.scene,
    lens: item.camera, angle: item.camera, composition: item.composition,
    pose: item.poseOrAction, gesture: "不适用", emotion: "清晰、可信",
    lighting: item.lightingVariation, wardrobe: "不适用", atmosphere: "统一商业视觉",
    materialFocus: "关键结构与材质", advertisingMood: "系列辅助广告",
    shotType: item.shotType,
    variationDimensions: ["composition", "visual_emphasis"]
  }))
];

const PRODUCT_TWELVE_DIRECTED_SHOTS: DirectedShot[] = [
  {
    ...PRODUCT_DIRECTED_SHOTS[0]!, role: "advertising-hero", title: "广告主视觉 · 它是什么",
    storyPurpose: "完整、清楚地回答它是什么，并建立第一眼产品地位", valueQuestion: "它是什么"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[0]!, role: "brand-identity", title: "品牌识别 · 视觉签名",
    storyPurpose: "用品牌色彩、轮廓和留白建立可记忆的视觉签名", composition: "产品轮廓、品牌色块和广告留白共同建立识别",
    angle: "平视三分之四品牌识别机位", valueQuestion: "它是什么"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[4]!, role: "structural-view", title: "结构补充 · 形体关系",
    storyPurpose: "从不同观看方向补充外形、比例和关键组件关系", shotType: "结构三分之四",
    angle: "与 Hero 相反方向的三分之四机位", valueQuestion: "它好在哪里"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[0]!, role: "monumental-hero", title: "纪念碑式强化 · 体量",
    storyPurpose: "以低机位和尺度关系强化产品的体量、稳定与价值", angle: "明确低机位仰拍",
    composition: "产品像建筑般主导画面并与承托面形成清楚尺度", atmosphere: "纪念碑式、稳固、不可替代",
    valueQuestion: "它是什么"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[4]!, role: "top-view-composition", title: "顶视组合 · 使用体系",
    storyPurpose: "以顶视关系解释产品、配件与使用顺序", angle: "垂直顶视",
    composition: "产品、配件和留白形成有方向的组合关系", pose: "组件按真实使用关系展开",
    valueQuestion: "它好在哪里"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[3]!, role: "material-detail", title: "材质微距 · 品质证据",
    storyPurpose: "以真实反射、透明关系和边缘高光证明材质品质", valueQuestion: "它好在哪里"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[4]!, role: "functional-detail", title: "功能细节 · 工作方式",
    storyPurpose: "清楚解释一项关键功能、接口或开合关系", valueQuestion: "它好在哪里"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[1]!, role: "human-relationship", title: "人与商品 · 拥有体验",
    storyPurpose: "通过手、身体局部与真实空间回答拥有它是什么感觉", gesture: "手正在接近、拿起或使用产品且不遮挡结构",
    valueQuestion: "它如何被使用"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[5]!, role: "brand-mood", title: "品牌情境 · 世界观",
    storyPurpose: "让产品进入完整、可向往的品牌情境", valueQuestion: "拥有什么感觉"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[2]!, role: "dynamic-moment", title: "动态瞬间 · 正在发生",
    storyPurpose: "用液体、喷雾、开合或运动痕迹证明产品正在工作", pose: "产品处于正在发生的动作中间帧",
    valueQuestion: "它如何被使用"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[6]!, role: "experimental-shot", title: "实验构图 · 系列记忆点",
    storyPurpose: "用受控反射、折射或尺度错位建立传播记忆点", valueQuestion: "拥有什么感觉"
  },
  {
    ...PRODUCT_DIRECTED_SHOTS[5]!, role: "minimal-closing", title: "极简收尾 · 系列句点",
    storyPurpose: "用最少元素收束系列并留下拥有后的平静感", environment: "纯净承托面，只保留品牌世界的一个色彩或材质线索",
    composition: "产品与大面积留白形成安静句点", lighting: "柔和收束光与真实接触阴影",
    valueQuestion: "拥有什么感觉"
  }
];

const PORTRAIT_EMOTIONAL_ARC = [
  "疏离", "观察", "接近", "松弛", "轻微失控", "重新建立距离",
  "偶然放松", "内省", "情绪峰值", "欲言又止", "被看见", "再次平静"
] as const;

export function orderGenerationReferences(
  references: GenerationReferenceSnapshot[],
  domain: Domain
): GenerationReferenceSnapshot[] {
  if (domain !== "portrait" || !references.some((reference) => reference.role === "identity")) {
    return [...references];
  }
  const originalIdentityReferences = references.filter((reference) =>
    reference.role === "identity" && reference.sourceKind !== "identity_board");
  const primaryImageId = originalIdentityReferences.find((reference) =>
    reference.subjectAsset?.primaryImageId)?.subjectAsset?.primaryImageId;
  const identityPurpose = (reference: GenerationReferenceSnapshot) =>
    reference.subjectAsset?.imagePurposes?.[reference.assetId];
  const purposePriority = (reference: GenerationReferenceSnapshot) =>
    identityPurpose(reference) === "face" ? 0
      : identityPurpose(reference) === "full_body" ? 1 : 2;
  const orderedIdentity = originalIdentityReferences.map((reference, index) => ({ reference, index }))
    .sort((left, right) =>
      Number(right.reference.assetId === primaryImageId) - Number(left.reference.assetId === primaryImageId)
      || purposePriority(left.reference) - purposePriority(right.reference)
      || left.index - right.index)
    .map(({ reference }) => reference);
  const primaryIdentity = orderedIdentity[0];
  const visualTemplate = references.find((reference) => reference.role === "style_layout")
    ?? references.find((reference) => reference.role === "style");
  const remainingIdentity = orderedIdentity.slice(1);
  const remainingReferences = references.filter((reference) =>
    reference.role !== "identity"
    && reference !== visualTemplate
    && reference.assetId !== visualTemplate?.assetId);
  return [primaryIdentity, visualTemplate, ...remainingIdentity, ...remainingReferences]
    .filter((reference): reference is GenerationReferenceSnapshot => Boolean(reference));
}

export function orderPersonImageIdsByEvidence(
  subject: Pick<SubjectAsset, "type" | "imageIds" | "primaryImageId" | "imagePurposes" | "qualityReport">
): string[] {
  if (subject.type !== "person" || !subject.qualityReport) {
    return [subject.primaryImageId, ...subject.imageIds.filter((id) => id !== subject.primaryImageId)];
  }
  const reportById = new Map(subject.qualityReport.images.map((image) => [image.assetId, image]));
  const statusScore = { pass: 3, warning: 0, unconfirmed: -1, fail: -4 } as const;
  const commonChecks = ["multiplePeople", "resolution", "underexposed", "overexposed"] as const;
  const faceChecks = ["faceDetected", "facialOcclusion", "extremeProfile", "frontalInformation"] as const;
  const score = (id: string) => {
    const report = reportById.get(id);
    if (!report) return 0;
    const keys = subject.imagePurposes?.[id] === "full_body"
      ? commonChecks
      : [...commonChecks, ...faceChecks];
    const advisoryPenalty = keys.some((key) => !report.checks[key].canContinue) ? -100 : 0;
    return advisoryPenalty + keys.reduce((total, key) => total + statusScore[report.checks[key].status], 0);
  };
  return subject.imageIds.map((id, index) => ({ id, index }))
    .sort((left, right) => Number(right.id === subject.primaryImageId) - Number(left.id === subject.primaryImageId)
      || score(right.id) - score(left.id)
      || left.index - right.index)
    .map(({ id }) => id);
}

function cameraScript(shot: DirectedShot) {
  const cameraHeight = /低机位|仰/.test(shot.angle)
    ? "低于主体视觉中心"
    : /高位|俯|顶视/.test(shot.angle)
      ? "高于主体视觉中心"
      : "与人物眼睛或商品视觉中心接近";
  const pitchAngle = /仰/.test(shot.angle)
    ? "明确向上仰拍"
    : /俯|顶视/.test(shot.angle)
      ? "明确向下俯拍"
      : "保持接近水平，仅按空间关系轻微俯仰";
  const perspective = /24|28|35|广角/.test(shot.lens)
    ? "保留可见空间纵深，但不得拉伸人物五官或商品几何"
    : /100|105|120|135|微距|近摄/.test(shot.lens)
      ? "压缩空间并保持局部比例、边缘和结构真实"
      : "自然透视，主体比例与空间尺度可信";
  return { cameraHeight, pitchAngle, perspective };
}

function expandedCreativePlan(
  domain: Domain,
  shot: DirectedShot,
  direction: CreativeDirection,
  index: number
): CreativeShotPlan {
  const camera = cameraScript(shot);
  const emotion = domain === "portrait"
    ? `${PORTRAIT_EMOTIONAL_ARC[index] ?? "再次平静"}；${shot.emotion}`
    : shot.emotion;
  const material = domain === "portrait"
    ? `皮肤保留真实纹理、自然高光与肤色层次；保持待复刻画面中可见的服装款式、颜色、图案、饰品、妆发和面料关系；${direction.stylingMethod}`
    : `以用户商品自身材质为对象，只迁移参考图的反射与触感表现方法；${shot.materialFocus ?? "保持结构真实"}`;
  return {
    concept: direction.visualTheme,
    narrativeContext: `${direction.visualStory}；当前发生在${shot.environment}`,
    storyPurpose: shot.storyPurpose,
    subjectState: domain === "portrait"
      ? `保持用户人物身份清楚可辨；当前镜头执行${shot.pose}并表现${emotion}`
      : `保持用户商品外形与关键结构；当前镜头执行${shot.pose}并承担${shot.storyPurpose}`,
    cameraLanguage: direction.cameraLanguage,
    cameraHeight: camera.cameraHeight,
    horizontalAngle: shot.angle,
    pitchAngle: camera.pitchAngle,
    shotScale: shot.shotType,
    lens: shot.lens,
    perspective: camera.perspective,
    composition: shot.composition,
    pose: shot.pose,
    actionPhase: domain === "portrait"
      ? `使用关节链清楚、重心稳定、低遮挡的动作关键帧：${shot.pose}；无法保证结构时优先自然站立或自然行走`
      : `产品处于可理解的正在发生状态：${shot.pose}`,
    gaze: domain === "portrait"
      ? (/close|extreme|hero/.test(shot.role) ? "视线与当前情绪关系清楚，但不强制直视镜头" : "视线服从环境、动作或画外关系")
      : "不适用；观看关系由商品朝向和使用动作建立",
    gesture: shot.gesture,
    emotion,
    timeSense: `与${direction.environmentalContext}的时间线索一致，并在当前镜头中可见`,
    weatherSense: `只在参考图已有依据时延续空气、天气或室内环境感，不凭空添加奇观`,
    lightDirection: shot.lighting,
    lightQuality: `${direction.lightingMethod}；当前镜头执行${shot.lighting}`,
    shadowStrategy: "保留真实接触阴影、遮挡阴影和空间层次，禁止漂浮、重复或无来源阴影",
    colorSystem: `迁移${direction.visualTheme}的色彩关系，按用户主体重建，不复制参考物件的具体颜色`,
    lighting: shot.lighting,
    environment: shot.environment,
    atmosphere: shot.atmosphere,
    material,
    postProcessing: "全组统一颗粒、锐度、反差、色彩映射与肤色／商品色管理，禁止每张使用不同滤镜",
    shotResponsibility: `${shot.storyPurpose}${shot.valueQuestion ? `；本镜头回答“${shot.valueQuestion}”` : "；在整套中承担不可替代的叙事职责"}`
  };
}

export function createDirectedCreationSetPlan(
  domain: Domain,
  count: 2 | 3 | 4 | 6 | 9 | 12,
  direction: CreativeDirection
): CreationSetPlanItem[] {
  if (domain !== "portrait" && domain !== "product") {
    return createCreationSetPlan(domain, count).map((item, index) => {
      const anchor = index === 0;
      return ({
      ...item,
      role: anchor ? "reference-anchor" : item.role,
      userFacingTitle: anchor ? "参考锚定 · 原画面复刻" : item.userFacingTitle,
      creativePlan: {
        concept: direction.visualTheme,
        narrativeContext: anchor ? `严格复刻参考画面的同一时刻；${direction.visualStory}` : `参考画面同一现场的相邻时刻；${direction.visualStory}`,
        storyPurpose: anchor ? "建立参考画面锚点，只替换用户指定主体" : `${item.userFacingTitle}只承担一个相邻变化`,
        subjectState: anchor ? `${direction.subjectState}；严格跟随参考画面` : `${direction.subjectState}；只执行当前相邻时刻的轻微变化`,
        cameraLanguage: direction.cameraLanguage,
        cameraHeight: "保持参考画面相机高度",
        horizontalAngle: anchor ? "保持参考画面水平角度" : `以参考画面为基准，仅执行${item.camera}的轻微邻接变化`,
        pitchAngle: "保持参考画面俯仰与透视关系",
        shotScale: anchor ? "保持参考画面景别" : item.shotType,
        lens: item.camera,
        perspective: "保持参考画面的主体比例与空间尺度",
        composition: anchor ? "严格保持参考画面主体位置、占画比例、留白和空间层次" : "保持参考画面构图骨架，只作当前计划声明的轻微变化",
        pose: anchor ? "保持参考画面的主体状态、动作或陈列关系" : `在参考状态基础上完成相邻时刻：${item.poseOrAction}`,
        actionPhase: anchor ? "保持参考画面的动作阶段与接触关系" : `同一动作或事件的相邻时刻：${item.poseOrAction}`,
        gaze: anchor ? "保持参考画面视线与观看关系" : "保持参考情绪，只作轻微观看关系变化",
        gesture: anchor ? "保持参考画面的互动、持物和接触关系" : "只作一个低幅度相邻变化",
        emotion: direction.emotionalTone,
        timeSense: direction.environmentalContext,
        weatherSense: direction.environmentalContext,
        lightDirection: direction.lightingMethod,
        lightQuality: direction.lightingMethod,
        shadowStrategy: "保留真实接触阴影和空间层次",
        colorSystem: direction.visualTheme,
        lighting: direction.lightingMethod,
        environment: direction.environmentalContext,
        atmosphere: direction.emotionalTone,
        material: direction.stylingMethod,
        postProcessing: "保持参考画面的颗粒、锐度、反差、色彩映射和后期质感",
        shotResponsibility: anchor ? "作为整组参考锚点，除用户指定主体外不主动改变画面" : "作为同一现场相邻时刻，只承担一个明确变化"
      },
      gridCellReference: null,
      gridCellAnalysis: null,
      promptDelta: [
        `故事目的：${anchor ? "建立参考画面锚点，只替换用户指定主体" : `${item.userFacingTitle}只承担一个相邻变化`}`,
        `主体状态：${direction.subjectState}；${anchor ? "严格跟随参考画面" : "只执行相邻时刻的轻微变化"}`,
        `环境：${direction.environmentalContext}；保持同一场景、时间、天气和空间关系`,
        `镜头：${direction.cameraLanguage}`,
        `机位：${anchor ? "保持参考画面机位" : `以参考机位为基准，仅作${item.camera}的轻微变化`}`,
        `构图：${anchor ? "严格保持参考画面主体位置、占画比例、留白和空间层次" : "保持参考画面构图骨架，只作当前计划声明的轻微变化"}`,
        `姿态：${anchor ? "保持参考画面的动作或陈列关系" : `在参考状态基础上完成相邻时刻：${item.poseOrAction}`}`,
        `手势：${anchor ? "保持参考画面的互动与接触关系" : "只作一个低幅度相邻变化"}`,
        `情绪：${direction.emotionalTone}`,
        `光线：${direction.lightingMethod}；主光、曝光、高光和阴影关系保持不变`,
        `材质：保持参考画面的可见材质、文字层级和后期关系；${direction.stylingMethod}`,
        `氛围：${direction.emotionalTone}`,
        anchor
          ? "锚定规则：严格保持参考画面的主体关系、动作或陈列、背景、构图、光影、色彩、材质、文字层级和后期；只替换用户明确指定的主体"
          : "连续性规则：这是同一现场的相邻时刻；场景、时间、天气、主光、曝光、色彩、材质、文字层级和后期保持不变；只执行当前计划声明的最多两个变化维度"
      ].join("\n"),
      variationDimensions: anchor ? [] : item.variationDimensions.slice(0, 2)
    });
    });
  }
  const templates = domain === "portrait"
    ? PORTRAIT_DIRECTED_SHOTS
    : count === 12
      ? PRODUCT_TWELVE_DIRECTED_SHOTS
      : PRODUCT_DIRECTED_SHOTS;
  const lockedDimensions = domain === "portrait"
    ? ["identity", "style", "palette", "material"] as const
    : ["subject", "style", "palette", "material"] as const;
  return templates.slice(0, count).map((shot, index) => {
    const anchor = index === 0;
    const expanded = expandedCreativePlan(domain, shot, direction, index);
    const creativePlan: CreativeShotPlan = {
      ...expanded,
      concept: direction.visualTheme,
      narrativeContext: anchor
        ? `严格复刻参考画面的同一时刻；${direction.visualStory}`
        : `参考画面同一拍摄现场的相邻时刻；${direction.visualStory}`,
      storyPurpose: anchor
        ? "建立参考画面锚点，只替换用户指定主体"
        : `在同一拍摄现场补充一个相邻时刻；${shot.storyPurpose}`,
      subjectState: anchor
        ? `${direction.subjectState}；动作、表情和视线严格跟随参考画面`
        : `${direction.subjectState}；只执行当前相邻时刻的一个轻微变化`,
      cameraLanguage: direction.cameraLanguage,
      cameraHeight: "保持参考画面相机高度",
      horizontalAngle: anchor ? "保持参考画面水平角度" : `以参考角度为基准，仅执行${shot.angle}的轻微邻接变化`,
      pitchAngle: "保持参考画面俯仰与透视关系",
      shotScale: anchor ? "保持参考画面景别" : shot.shotType,
      lens: direction.cameraLanguage,
      perspective: "保持参考画面的自然透视、主体比例和空间尺度",
      composition: anchor ? "严格保持参考画面主体位置、占画比例、留白和空间层次" : "保持参考画面空间与构图骨架，只作当前计划声明的轻微变化",
      pose: anchor ? direction.subjectState : `在参考动作基础上完成一个相邻时刻：${shot.pose}`,
      actionPhase: anchor ? "保持参考画面的动作阶段、左右手职责、道具关系和身体重心" : `同一动作前后相邻时刻，单一低遮挡变化：${shot.pose}`,
      gaze: anchor ? "保持参考画面的视线方向" : "保持参考情绪和人物关系，只作轻微视线变化",
      gesture: anchor ? "保持参考画面的手势、持物侧和接触关系" : `保持同侧单手与低遮挡，仅作${shot.gesture}的轻微变化`,
      emotion: anchor ? direction.emotionalTone : `保持参考情绪，只作轻微变化；${shot.emotion}`,
      timeSense: direction.environmentalContext,
      weatherSense: direction.environmentalContext,
      lightDirection: direction.lightingMethod,
      lightQuality: direction.lightingMethod,
      shadowStrategy: "保持参考画面的主光方向、光质、曝光、高光和接触阴影",
      colorSystem: direction.visualTheme,
      lighting: direction.lightingMethod,
      environment: direction.environmentalContext,
      atmosphere: direction.emotionalTone,
      material: domain === "portrait"
        ? `保持参考画面的服装、妆发、饰品和材质；${direction.stylingMethod}`
        : `保持用户商品结构和参考画面的材质呈现；${direction.stylingMethod}`,
      postProcessing: "保持参考画面的颗粒、锐度、反差、色彩映射和后期质感，全组不得更换滤镜",
      shotResponsibility: anchor
        ? "作为整组参考锚点，除用户指定主体外不主动改变画面"
        : "作为同一拍摄现场的相邻时刻，只承担一个明确变化"
    };
    const visualAcceptance = domain === "product" && shot.role === "dynamic-moment"
      ? "必须展示与商品功能一致的液体、喷雾、开合、倾倒或运动中间帧，商品结构与工作结果清楚可辨；不得退化为静态陈列"
      : SHOT_VISUAL_ACCEPTANCE[shot.role] ?? "当前故事或广告目的必须在画面中清楚可见，不得只替换背景";
    return ({
    id: `${domain}-${index + 1}`,
    order: index + 1,
    role: anchor ? "reference-anchor" : shot.role,
    userFacingTitle: anchor ? "参考锚定 · 原画面复刻" : shot.title,
    shotType: creativePlan.shotScale,
    composition: creativePlan.composition,
    camera: creativePlan.cameraLanguage,
    poseOrAction: `${creativePlan.pose}；${creativePlan.gesture}`,
    expression: creativePlan.emotion,
    scene: creativePlan.environment,
    lightingVariation: creativePlan.lighting,
    creativePlan,
    gridCellReference: null,
    gridCellAnalysis: null,
    promptDelta: [
      `故事目的：${creativePlan.storyPurpose}`,
      `主体状态：${creativePlan.subjectState}`,
      `环境：${direction.environmentalContext}；保持同一场景、时间、天气和空间关系`,
      `镜头：${creativePlan.cameraLanguage}`,
      `机位：${creativePlan.horizontalAngle}；${creativePlan.pitchAngle}`,
      `构图：${creativePlan.composition}`,
      `姿态：${creativePlan.pose}`,
      `动作阶段：${creativePlan.actionPhase}`,
      `视线：${creativePlan.gaze}`,
      `手势：${creativePlan.gesture}`,
      `情绪：${creativePlan.emotion}`,
      `光线：${direction.lightingMethod}；主光、曝光、高光和阴影关系保持不变`,
      domain === "portrait"
        ? `服装：保持参考画面可见的款式、颜色、图案、帽子、墨镜、饰品、妆发和面料关系；${direction.stylingMethod}`
        : `材质方法：保持用户商品外形与结构，并保持参考画面的反射、承托和触感关系；${direction.stylingMethod}`,
      `氛围：${direction.emotionalTone}`,
      ...(shot.materialFocus ? [`材质重点：以${direction.stylingMethod}为依据；${shot.materialFocus}`] : []),
      ...(shot.advertisingMood ? [`广告情绪：${direction.commercialIntent}`] : []),
      `画面验收条件：${visualAcceptance}`,
      `参考方法依据：${direction.cameraLanguage}；${direction.lightingMethod}；${direction.emotionalTone}`,
      `系列导演意图：${direction.creativePurpose}；${direction.commercialIntent}`,
      anchor
        ? "锚定规则：严格保持参考画面的动作、表情、服装、道具、背景、构图、光影、色彩、材质和后期；只替换用户明确指定的主体"
        : "连续性规则：这是同一拍摄现场的相邻时刻；服装、妆发、场景、时间、天气、主光、曝光、色彩和后期保持不变；只执行当前计划声明的最多两个变化维度"
    ].join("\n"),
    variationDimensions: anchor ? [] : shot.variationDimensions.slice(0, 2),
    finalPrompt: null,
    lockedDimensions: [...lockedDimensions],
    status: "PENDING",
    taskId: null,
    retryOfTaskId: null,
    generationEventId: null,
    outputAssetId: null,
    outputCandidates: [],
    selectedOutputAssetId: null,
    qualityStatus: "not_checked",
    qualityMessage: null,
    retryDirective: null,
    error: null
    });
  });
}

export function applyGridCellAnalysisToPlanItem(
  item: CreationSetPlanItem,
  analysis: GridCellAnalysis,
  reference: GenerationReferenceSnapshot
): CreationSetPlanItem {
  const portraitItem = item.lockedDimensions.includes("identity") || item.id.startsWith("portrait-");
  const riskyAction = /背后|腋下|跨过|跨越|横跨|反手|交叉.*臂|扭腰|大幅.*回头|同时.*(?:转身|回头|持物)/.test(analysis.action);
  const safeAction = portraitItem && riskyAction
    ? "安全姿态：身体自然侧向站立，道具由同侧单手自然持握，另一只手放松；肩—肘—腕与髋—膝—踝链路清楚，保持低遮挡和稳定重心"
    : analysis.action;
  const safeAnalysis = { ...analysis, action: safeAction };
  const actionPhase = `保持参考宫格第 ${analysis.index + 1} 格可观察的动作职责，并使用稳定动作关键帧：${safeAction}`;
  return {
    ...item,
    shotType: analysis.shotScale,
    composition: analysis.composition,
    poseOrAction: safeAction,
    expression: analysis.emotion,
    gridCellReference: reference,
    gridCellAnalysis: safeAnalysis,
    creativePlan: {
      ...item.creativePlan,
      shotScale: analysis.shotScale,
      composition: analysis.composition,
      pose: safeAction,
      actionPhase,
      gesture: safeAction,
      emotion: analysis.emotion
    },
    promptDelta: [
      `参考宫格第 ${analysis.index + 1} 格`,
      `景别：${analysis.shotScale}`,
      `构图：${analysis.composition}`,
      `动作：${safeAction}`,
      `情绪：${analysis.emotion}`,
      "严格保持该格的景别、构图、动作、表情、服装或承托关系、背景、光影、色彩、材质和后期；只把人物身份或商品主体替换为用户提供的主体"
    ].join("\n")
  };
}

const EMPTY_TRACE_STAGES: PerformanceTraceStages = {
  captureMs: null, normalizeMs: null, cacheLookupMs: null, classifyMs: null,
  analyzeMs: null, compileMs: null, codexStartupMs: null, queueMs: null,
  imagegenMs: null, resultTransferMs: null, persistenceMs: null, qualityCheckMs: null,
  referenceUploadMs: null, skillDiscoveryMs: null, generationTurnMs: null,
  outputRegistrationMs: null, outputReadMs: null
};

export function createPerformanceTrace(input: {
  id: string;
  taskId?: string | null;
  projectId?: string | null;
  operation: PerformanceTrace["operation"];
  startedAt: number;
  completedAt: number;
  cacheHit?: boolean;
  stages?: Partial<PerformanceTraceStages>;
}): PerformanceTrace {
  return performanceTraceSchema.parse({
    schemaVersion: "1.0.0",
    id: input.id,
    taskId: input.taskId ?? null,
    projectId: input.projectId ?? null,
    operation: input.operation,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    totalMs: input.completedAt - input.startedAt,
    cacheHit: input.cacheHit ?? false,
    stages: { ...EMPTY_TRACE_STAGES, ...input.stages }
  });
}

export function summarizePerformanceTraces(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  if (!sorted.length) return { sampleCount: 0, p50: null, p90: null, p95: null, fastest: null, slowest: null };
  const percentile = (value: number) => sorted[Math.ceil(sorted.length * value) - 1];
  return {
    sampleCount: sorted.length,
    p50: percentile(0.5),
    p90: percentile(0.9),
    p95: percentile(0.95),
    fastest: sorted[0],
    slowest: sorted[sorted.length - 1]
  };
}

export function analysisCacheKey(hash: string, mode: "joint" | "two-stage", analyzerVersion: string): string {
  return `${hash}:${mode}:${analyzerVersion}`;
}

export function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) throw new Error("感知哈希长度必须一致");
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let bits = Number.parseInt(left[index]!, 16) ^ Number.parseInt(right[index]!, 16);
    while (bits) {
      distance += bits & 1;
      bits >>>= 1;
    }
  }
  return distance;
}

export function detectPerceptualDuplicates(
  items: Array<{ itemId: string; hash: string }>,
  threshold = 4
): Array<{ itemIds: [string, string]; distance: number }> {
  const duplicates: Array<{ itemIds: [string, string]; distance: number }> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const leftItem = items[left]!;
      const rightItem = items[right]!;
      const distance = hammingDistance(leftItem.hash, rightItem.hash);
      if (distance <= threshold) duplicates.push({ itemIds: [leftItem.itemId, rightItem.itemId], distance });
    }
  }
  return duplicates;
}

const DIVERSITY_LABELS: Record<string, string> = {
  shot_scale: "景别", camera_angle: "相机角度", composition: "构图",
  pose_action: "姿态或动作", environment: "环境", lighting: "光线",
  orientation: "画面方向", negative_space: "留白", visual_emphasis: "视觉重点"
};

export function buildDiversityRetryPrompt(originalPrompt: string, dimensions: string[], reason: string): string {
  const labels = dimensions.map((dimension) => DIVERSITY_LABELS[dimension] ?? dimension).join("、");
  return `${originalPrompt}

差异重试：${reason}。必须显著改变${labels}，至少形成两个可见差异；保持原始人物或主体、视觉风格与原始参考图不变，不要只做轻微裁切或微小角度变化。`;
}

const TARGETED_RETRY_DIRECTIVES: Partial<Record<SetQualityIssue["type"], string>> = {
  identity_drift: "只对照面部身份参考锁定人物身份：脸型、五官比例、年龄感、发际线、发型和稳定可识别特征必须一致；不得用动作、妆容或光线变化重塑人脸",
  body_proportion_drift: "只对照全身体型参考锁定肩宽、腰胯轮廓、腿身比、四肢粗细、站姿重心和整体体态；不得为追求镜头效果擅自增高、瘦身、加长双腿或改变身材",
  pose_anomaly: "只保留一个主要动作，明确左右侧与道具所在侧；手臂必须形成可信的肩—肘—腕链路并同侧持物，不得跨越身体中线、从对侧腋下穿过、反关节、穿模或让双手承担冲突任务",
  expression_anomaly: "恢复自然闭嘴、眼睛对称可读、眉眼与嘴角协调的自然表情；不得擅自挤眼、歪嘴、夸张张嘴、过度挑眉或用怪表情改变人物身份",
  reference_pose_mismatch: "对照待复刻画面恢复相同动作阶段、身体朝向、左右手职责、持物侧、遮挡和接触关系，只修复人体结构导致的不可信部分",
  reference_expression_mismatch: "对照待复刻画面恢复相同视线、嘴部状态、眉眼关系和情绪强度，不得把自然表情重设计为另一种表演",
  wardrobe_continuity_drift: "恢复待复刻画面和同组已经通过画面中的同一服装款式、颜色、图案、帽子、饰品、妆发与面料关系",
  reference_composition_mismatch: "恢复待复刻画面的景别、机位、主体占画比例、位置、留白、前中后景和道具空间关系",
  reference_lighting_mismatch: "恢复待复刻画面的主光方向、光质、曝光、高光、阴影、饱和度、色温、反差、景深与后期质感",
  set_continuity_mismatch: "恢复同一服装、妆发、场景、时间、天气、主光、曝光、色彩、材质和后期，只保留当前镜头声明的相邻变化",
  emotion_flat: "强化当前故事需要的明确表情、姿态和光线，让情绪可以从画面直接读出",
  pose_repeat: "改变姿态、手势和身体方向，形成新的动作事件，不得复用其他镜头的站姿",
  composition_repeat: "改变景别、主体位置、前后景与留白关系，建立独立构图职责",
  style_mismatch: "锁定参考图的摄影语言、色彩、光质、材质与后期质感",
  style_inconsistency: "锁定参考图的摄影语言、色彩、光质、材质与后期质感",
  geometry_drift: "锁定商品几何、外形比例、轮廓、厚度和各组件相对位置",
  structure_mismatch: "锁定商品几何与比例，以及按钮、接口、开合件和关键结构的数量、位置、形状",
  structural_error: "锁定商品几何与比例，以及按钮、接口、开合件和关键结构的数量、位置、形状",
  material_inconsistency: "锁定商品真实材质、透明度、表面处理、反射方式和颜色",
  label_drift: "只修复标签区域、边界、比例和相对位置；保持商品外形、材质、光线与构图不变",
  text_layout_drift: "只修复文字块、字距、行距、阅读顺序和信息层级；不要虚构不可确认的可读文字",
  logo_position_drift: "只修复 Logo 的位置、比例、方向和安全区；保持商品结构、材质与品牌色不变",
  duplicate_angle: "使用与其他成图明显不同的镜头景别、相机角度和观看方向",
  near_duplicate: "使用与其他成图明显不同的镜头景别、相机角度、动作和构图",
  advertising_weakness: "强化当前广告目的、品牌感、光影重点、环境关系与商品价值证据",
  plan_mismatch: "严格执行当前 Creative Shot Plan 中的故事目的、动作、景别、机位和光线"
};

export function buildTargetedRetryPrompt(
  originalPrompt: string,
  issueType: SetQualityIssue["type"],
  reason: string,
  domain: Domain,
  guidance?: Pick<SetQualityIssue, "impact" | "retryFocus" | "preserve">,
  attempt = 1
): string {
  const directive = issueType === "structural_error" && domain === "portrait"
    ? "只修复人体结构和遮挡关系：恢复数量正确、自然连接的四肢；全身或人与载具互动时，让两条腿各自的髋、膝、踝和脚链路清楚可信，不得让整条腿完全藏在车体后而没有脚、踝、膝、独立轮廓或接触点，并修复手部、穿模与融合；不得借修复改变人物身份、脸型、五官、年龄感、发型、服装、光线和构图"
    : TARGETED_RETRY_DIRECTIVES[issueType] ??
    (domain === "portrait"
      ? "锁定人物身份和参考摄影方法，只修复当前可观察问题"
      : "锁定商品外形、结构和参考广告方法，只修复当前可观察问题");
  const safeFallback = domain === "portrait" && attempt >= 2 &&
    (issueType === "pose_anomaly" || issueType === "structural_error")
    ? "第二次动作修复必须降级为安全姿态：自然站立或自然行走，只保留同侧单手持物，另一只手自然放松；双脚和重心清楚，降低遮挡，不得交叉手臂，不得跨越身体中线。"
    : "";
  return `${originalPrompt}

Visual Critic 定向重试：${reason}。
${guidance?.impact ? `问题影响：${guidance.impact}。` : ""}
${guidance?.retryFocus ? `只强化：${guidance.retryFocus}。` : ""}
${guidance?.preserve?.length ? `必须保持：${guidance.preserve.join("、")}。` : ""}
修复要求：${directive}。
${safeFallback}
${domain === "portrait" ? "人物身份必须保持不变。" : "商品身份与关键结构必须保持不变。"}
只重试当前单张；把当前失败候选作为 edit_base 修复底图，但不使用同组其他生成结果作为参考；继续使用原始参考图、主体资产、Visual DNA 和 Transformation Blueprint。`;
}

const PORTRAIT_BLOCKING_QUALITY_ISSUES = new Set<SetQualityIssue["type"]>([
  "identity_drift", "body_proportion_drift", "structural_error", "pose_anomaly", "expression_anomaly",
  "reference_pose_mismatch", "reference_expression_mismatch", "wardrobe_continuity_drift",
  "reference_composition_mismatch", "reference_lighting_mismatch", "set_continuity_mismatch"
]);

export function isPortraitBlockingQualityIssue(type: SetQualityIssue["type"] | string) {
  return PORTRAIT_BLOCKING_QUALITY_ISSUES.has(type as SetQualityIssue["type"]);
}

export function validateSetQualityReportItems(
  report: SetQualityReport,
  expectedItemIds: string[]
) {
  const expected = new Set(expectedItemIds);
  const checked = new Set(report.checkedItemIds);
  if (checked.size !== expected.size || [...expected].some((id) => !checked.has(id))) {
    throw new Error("Visual Critic 返回的已检查作品与实际送检作品不一致");
  }
  const referenced = [
    ...report.issues.flatMap((issue) => issue.itemIds),
    ...report.suggestedRetryItemIds
  ];
  if (referenced.some((id) => !expected.has(id))) {
    throw new Error("Visual Critic 返回了不属于本次作品组的编号");
  }
  if (report.suggestedRetryItemIds.some((id) =>
    !report.issues.some((issue) => issue.itemIds.includes(id)))) {
    throw new Error("Visual Critic 建议重试的作品缺少对应问题");
  }
  return report;
}

export function prepareTargetedRetry(
  creationSet: CreationSet,
  itemId: string,
  issue: SetQualityIssue,
  updatedAt: number
): CreationSet {
  if (!issue.itemIds.includes(itemId)) throw new Error("当前问题不属于所选作品");
  const planItems = creationSet.planItems.map((item) => {
    if (item.id !== itemId) return item;
    if (!item.outputAssetId || !item.generationEventId || !item.taskId) {
      throw new Error("当前作品缺少可追溯的成功输出，不能定向重试");
    }
    const existingCandidates = item.outputCandidates.some((candidate) =>
      candidate.outputAssetId === item.outputAssetId)
      ? item.outputCandidates
      : [...item.outputCandidates, {
          outputAssetId: item.outputAssetId,
          generationEventId: item.generationEventId,
          taskId: item.taskId,
          createdAt: updatedAt,
          source: item.retryDirective ? "targeted_retry" as const : "initial" as const,
          issueType: item.retryDirective?.issueType ?? null
        }];
    return {
      ...item,
      status: "PENDING" as const,
      retryOfTaskId: item.taskId,
      taskId: null,
      generationEventId: null,
      outputAssetId: null,
      finalPrompt: null,
      qualityReport: null,
      qualityStatus: "not_checked" as const,
      qualityMessage: null,
      outputCandidates: existingCandidates,
      selectedOutputAssetId: item.selectedOutputAssetId ?? existingCandidates[0]!.outputAssetId,
      finalSelection: item.finalSelection?.criticDisposition === "checked" ? {
        ...item.finalSelection,
        criticDisposition: "skipped" as const,
        criticReportId: null,
        criticCheckedAt: null
      } : item.finalSelection,
      retryDirective: {
        reportCheckedAt: item.qualityReport?.checkedAt ?? creationSet.qualityReport?.checkedAt ?? updatedAt,
        issueType: issue.type,
        dimension: issue.dimension ?? null,
        reason: [issue.message, issue.suggestion].filter(Boolean).join("；"),
        impact: issue.impact ?? null,
        retryFocus: issue.retryFocus ?? issue.suggestion,
        preserve: issue.preserve ?? creationSet.sharedInvariants,
        sourceOutputAssetId: item.outputAssetId,
        sourceGenerationEventId: item.generationEventId
      },
      error: null
    };
  });
  return {
    ...updateCreationSet(creationSet, planItems, updatedAt),
    qualityReport: null
  };
}

export function prepareCreationSetItemRetry(
  creationSet: CreationSet,
  itemId: string,
  updatedAt: number
): CreationSet {
  let found = false;
  const planItems = creationSet.planItems.map((item) => {
    if (item.id !== itemId) return item;
    found = true;
    return {
      ...item,
      status: "PENDING" as const,
      retryOfTaskId: item.taskId,
      taskId: null,
      generationEventId: null,
      outputAssetId: null,
      finalPrompt: null,
      qualityStatus: "not_checked" as const,
      qualityMessage: null,
      qualityReport: null,
      finalSelection: item.finalSelection?.criticDisposition === "checked" ? {
        ...item.finalSelection,
        criticDisposition: "skipped" as const,
        criticReportId: null,
        criticCheckedAt: null
      } : item.finalSelection,
      retryDirective: null,
      error: null
    };
  });
  if (!found) throw new Error("没有找到要重试的画面。");
  return {
    ...updateCreationSet(creationSet, planItems, updatedAt),
    qualityReport: null,
    status: "READY"
  };
}

export function deriveCreationSetStatus(items: CreationSetPlanItem[]): {
  status: CreationSetStatus;
  completedCount: number;
  failedCount: number;
} {
  const completedCount = items.filter((item) => item.status === "COMPLETED").length;
  const failedCount = items.filter((item) => item.status === "FAILED").length;
  let status: CreationSetStatus = "READY";
  if (completedCount === items.length) status = "COMPLETED";
  else if (completedCount > 0 && failedCount > 0 && completedCount + failedCount === items.length) status = "PARTIAL";
  else if (failedCount === items.length) status = "FAILED";
  else if (items.some((item) => item.status === "GENERATING")) status = "GENERATING";
  else if (items.some((item) => item.status === "INTERRUPTED")) status = "INTERRUPTED";
  else if (items.every((item) => ["COMPLETED", "CANCELLED"].includes(item.status))) status = "CANCELLED";
  else if (completedCount > 0 && items.every((item) => ["COMPLETED", "FAILED", "CANCELLED"].includes(item.status))) status = "PARTIAL";
  return { status, completedCount, failedCount };
}

export function finalizeCreationSetOutput(
  creationSet: CreationSet,
  input: {
    itemId: string;
    outputAssetId: string;
    outputSha256: string;
    byteLength: number;
    criticDisposition: "checked" | "skipped";
    criticReportId: string | null;
    criticCheckedAt: number | null;
    selectedAt: number;
  },
  updatedAt: number
): CreationSet {
  const item = creationSet.planItems.find((candidate) => candidate.id === input.itemId);
  if (!item) throw new Error("没有找到要选定的画面。");
  let outputCandidates = item.outputCandidates;
  if (!outputCandidates.some((candidate) => candidate.outputAssetId === input.outputAssetId) &&
      item.outputAssetId === input.outputAssetId && item.generationEventId && item.taskId) {
    outputCandidates = [...outputCandidates, {
      outputAssetId: input.outputAssetId,
      outputSha256: input.outputSha256,
      byteLength: input.byteLength,
      generationEventId: item.generationEventId,
      taskId: item.taskId,
      createdAt: updatedAt,
      source: item.retryDirective ? "targeted_retry" as const : "initial" as const,
      issueType: item.retryDirective?.issueType ?? null
    }];
  }
  const selectedCandidate = outputCandidates.find((candidate) =>
    candidate.outputAssetId === input.outputAssetId);
  if (!selectedCandidate) throw new Error("最终选择必须属于当前镜头。");
  const planItems = creationSet.planItems.map((candidate) => candidate.id === input.itemId ? {
    ...candidate,
    status: "COMPLETED" as const,
    taskId: selectedCandidate.taskId,
    generationEventId: selectedCandidate.generationEventId,
    outputAssetId: selectedCandidate.outputAssetId,
    outputCandidates: outputCandidates.map((entry) => entry.outputAssetId === input.outputAssetId ? {
      ...entry,
      outputSha256: input.outputSha256,
      byteLength: input.byteLength
    } : entry),
    selectedOutputAssetId: input.outputAssetId,
    finalSelection: {
      assetId: input.outputAssetId,
      outputSha256: input.outputSha256,
      byteLength: input.byteLength,
      generationEventId: selectedCandidate.generationEventId,
      criticDisposition: input.criticDisposition,
      criticReportId: input.criticReportId,
      criticCheckedAt: input.criticCheckedAt,
      selectedAt: input.selectedAt
    },
    retryDirective: null,
    error: null
  } : candidate);
  return updateCreationSet(creationSet, planItems, updatedAt);
}

function updateCreationSet(set: CreationSet, planItems: CreationSetPlanItem[], updatedAt: number): CreationSet {
  return { ...set, ...deriveCreationSetStatus(planItems), planItems, updatedAt };
}

export function cancelCreationSet(set: CreationSet, updatedAt: number): CreationSet {
  return updateCreationSet(set, set.planItems.map((item) =>
    item.status === "COMPLETED" ? item : { ...item, status: "CANCELLED", error: null }), updatedAt);
}

export function resumeCreationSet(set: CreationSet, updatedAt: number): CreationSet {
  return updateCreationSet(set, set.planItems.map((item) =>
    item.status === "COMPLETED" ? item : {
      ...item, status: "PENDING", taskId: null, retryOfTaskId: item.taskId,
      generationEventId: null,
      outputAssetId: null, error: null
    }), updatedAt);
}

export function retryFailedSetItems(set: CreationSet, updatedAt: number): CreationSet {
  return updateCreationSet(set, set.planItems.map((item) =>
    item.status === "FAILED" ? {
      ...item, status: "PENDING", taskId: null, retryOfTaskId: item.taskId,
      generationEventId: null,
      outputAssetId: null, error: null
    } : item), updatedAt);
}

const DOMAIN_GENERATION_RULES: Record<Domain, string> = {
  portrait: "人物身份和年龄感固定；通过真实景别、姿态、表情和镜头变化形成同一人物的一套照片。",
  product: "产品外形、关键结构和材质固定；用商业机位、陈列、光线与细节重点形成一组商品视觉。",
  poster: "保持同一网格逻辑、字体角色、图文层级和印刷质感；每张必须形成真实版式变化，不伪造不可读文字。",
  illustration: "保持角色造型、线稿、笔触、色块和渲染方式；通过场景、动作、视角与情绪形成系列。",
  photography: "保持同一事件、环境质感、色彩和后期语言；通过机位、景别、瞬间与细节形成摄影叙事。"
};

export function buildMaterialTruthRules(visualDNA: VisualDNA): string {
  const observed = visualDNA.material.types.join("、") || "参考图中可观察的真实材质";
  const rules = [
    `只表现已由用户主体或参考分析支持的材质：${observed}`,
    `反射强度：${visualDNA.material.reflectivity}；透明关系：${visualDNA.material.translucency}`,
    `高光边缘：${visualDNA.lighting.highlightBehavior}；阴影：${visualDNA.lighting.shadowBehavior}，接触阴影必须与承托面一致`
  ];
  const text = `${observed} ${visualDNA.material.finish} ${visualDNA.texture.surfaceDetail}`;
  if (/玻璃|水晶|透明/.test(text)) rules.push("玻璃必须同时出现真实厚度、折射、边缘高光和背后物体位移，禁止泛塑料");
  if (/金属|银|钢|铝|铜|金/.test(text)) rules.push("金属必须反射周围环境并保留受控明暗过渡，禁止均匀灰色塑料质感");
  if (/液体|水|香水|油/.test(text)) rules.push("液体必须符合容器边界、液面高度、重力和透光关系，不得穿透或漂浮");
  if (/织物|布|丝|棉|羊毛|皮革/.test(text)) rules.push("织物必须有符合材质的纤维、褶皱尺度和受力方向");
  if (/石|大理石|陶瓷/.test(text)) rules.push("石材或陶瓷必须有可信纹理尺度、边缘和重量感");
  if (/木/.test(text)) rules.push("木材纹理必须沿结构方向连续，接缝与边缘不得随机断裂");
  if (/皮肤|人物|人像/.test(`${visualDNA.domain} ${visualDNA.subject.description}`)) {
    rules.push("皮肤必须保留自然毛孔、肤色层次和局部高光，禁止蜡质磨皮");
  }
  return rules.join("；");
}

function buildProductCategoryRules(references: CompileInput["references"]): string {
  const text = references
    .filter((reference) => reference.role === "subject")
    .flatMap((reference) => [reference.subjectName ?? "", ...(reference.subjectConstraints ?? [])])
    .join(" ");
  if (/香水|护肤|精华|酒瓶|瓶装/.test(text)) {
    return "品类规则：玻璃边缘、透明液体、标签、瓶盖或喷头必须可信；优先侧后方或逆光表现水、雾、花或烟与容器的真实关系。";
  }
  if (/腕表|手表|首饰|项链|戒指|耳环/.test(text)) {
    return "品类规则：表盘或首饰主体、表冠、刻度和金属渐变必须可信；用佩戴关系和轮廓光证明尺度与工艺。";
  }
  if (/耳机|手机|相机|电脑|电子|音箱/.test(text)) {
    return "品类规则：三分之四外形、屏幕或功能面、侧面厚度、接口和手部操作必须保持结构一致。";
  }
  if (/鞋|包|皮具|配件/.test(text)) {
    return "品类规则：轮廓、顶部与内部结构、材质和穿戴关系必须可信；用行走以及与建筑或家具的尺度关系表达使用感。";
  }
  return "";
}

export function compileSetItemPrompt(input: CompileInput & {
  domainProfile: DomainProfile;
  planItem: CreationSetPlanItem;
  userIntent: string;
  sharedInvariants: string[];
  allowedVariations: string[];
}): string {
  const referenceAnchored = input.references.some((reference) => reference.role === "style_layout");
  const repairBased = input.references.some((reference) => reference.role === "edit_base");
  const direction = input.creativeDirection ?? createCreativeDirection({
    domain: input.domainProfile.domain,
    visualDNA: input.visualDNA,
    domainProfile: input.domainProfile,
    userIntent: input.userIntent
  });
  const blueprint = input.transformationBlueprint ?? createTransformationBlueprint({
    domain: input.domainProfile.domain,
    visualDNA: input.visualDNA,
    creativeDirection: direction,
    references: input.references
  });
  const actionText = [
    input.planItem.creativePlan.pose,
    input.planItem.creativePlan.actionPhase,
    input.planItem.creativePlan.gesture,
    input.planItem.gridCellAnalysis?.action ?? ""
  ].join("；");
  const riskyCrossBodyAction = /跨过|跨越|对侧|腋下.*穿|穿过.*腋下|横跨.*胸|反手.*持|交叉.*持/.test(actionText);
  const portraitActionContract = input.domainProfile.domain === "portrait"
    ? `\n人物动作安全约束（高于动作原文）：
- 每张只允许一个主要动作，每只手只执行一个动作；先明确左手、右手和道具分别位于身体哪一侧
- 手臂必须有连续可解释的肩—肘—腕链路；持物手与道具保持同侧，不得跨越身体中线或从对侧腋下穿过
- 双脚必须有可信承重或迈步关系；不同时叠加大幅扭腰、反向转头、交叉双臂和持物
- 表情默认自然闭嘴或轻微放松；除非当前镜头明确要求，不挤眼、不夸张挑眉、不张大嘴
${riskyCrossBodyAction
  ? "- 高风险动作已降级：忽略跨身、对侧腋下或反手持物描述，改为道具同侧单手自然持握，另一只手放松，身体保持自然重心"
  : "- 当前动作仍须按同侧、单任务、低遮挡原则执行；若无法同时满足，优先简化动作而不是扭曲人体"}\n`
    : "";
  const portraitNegativeControl = input.domainProfile.domain === "portrait"
    ? `\n负向控制（禁止出现）：
- 多余手臂、多余手指、缺失肢体、融合肢体、重复手脚
- 手臂从背后伸出、对侧腋下穿臂、跨越身体中线持物、反关节、身体穿模
- 左右手职责冲突、肩—肘—腕断裂、髋—膝—踝断裂、双脚悬空或重心不可解释
- 仅作摄影方法参考的 style 图不得提供人物脸、体型、肤色、年龄或发型；style_layout 的服装、动作和表情仍须保持，但其中原人物身份不得覆盖用户人物
- 未要求的挤眼、歪嘴、夸张张嘴、过度挑眉和不对称怪表情
负向控制只作为辅助；正向执行低遮挡、同侧单手、稳定动作关键帧，并以用户面部／全身体型参考为最高优先级。\n`
    : "";
  const referenceFingerprint = `\n参考图摄影指纹（整组硬约束）：
- 构图与主体占画：${input.visualDNA.composition.shotType}；${input.visualDNA.composition.subjectPlacement}；留白 ${input.visualDNA.composition.negativeSpace}
- 光线方向与软硬：${input.visualDNA.lighting.direction}；${input.visualDNA.lighting.quality}；阴影 ${input.visualDNA.lighting.shadowBehavior}
- 曝光与高光：反差 ${input.visualDNA.lighting.contrast}；高光 ${input.visualDNA.lighting.highlightBehavior}
- 饱和度与反差：${input.visualDNA.palette.saturation}；${input.visualDNA.palette.contrast}；色温 ${input.visualDNA.palette.temperature}
- 景深与镜头感：${input.visualDNA.camera.depthOfField}；${input.visualDNA.camera.lens}；${input.visualDNA.camera.perspective}
- 材质与后期质感：${input.visualDNA.texture.medium}；颗粒 ${input.visualDNA.texture.grain}；锐度 ${input.visualDNA.texture.sharpness}；表面 ${input.visualDNA.texture.surfaceDetail}
镜头变化不得把参考图改成通用写真模板；仅允许变化当前画面计划明确指定的景别、机位或动作，未指定维度继续服从上述摄影指纹。\n`;
  const portraitProportionContract = input.domainProfile.domain === "portrait"
    ? `\n人物比例硬约束：
- 头身关系：保持用户全身体型参考的自然头身比例，头部不得因近距离透视被异常放大
- 躯干长度：保持肩—腰—胯的真实纵向距离，不得压缩胸腹或形成大头小身
- 腿身比与腿部长度：保持用户参考中的腰线、膝位、脚踝和腿身比，不得缩短大腿、小腿或整体身高观感
- 透视畸变：全身或中远景使用自然透视，避免过近广角；头、躯干、四肢必须处于同一可信空间尺度
- 禁止大头小身、躯干缩短、腿部缩短、肩胯失衡和脚部被无故裁切；无法兼顾动作时优先简化动作，不牺牲比例\n`
    : "";
  const base = compilePrompt({
    ...input,
    creativeDirection: direction,
    transformationBlueprint: blueprint,
    userInstruction: input.userIntent,
    editMode: input.editMode ?? (referenceAnchored || repairBased)
  });
  const shot = input.planItem.creativePlan;
  return `${base}

领域规则：${input.domainProfile.domain}
${DOMAIN_GENERATION_RULES[input.domainProfile.domain]}

${referenceAnchored
  ? "参考画面是最高优先级的视觉事实：先保持画面，再替换用户明确指定的主体；Creative Shot Plan 只允许覆盖它明确声明的最多两个变化维度。"
  : "创意导演层：只迁移参考图已经呈现的创作方法；用户要求只能指定主体替换和允许变化。"}
内容边界：参考图的动作、表情、服装、饰品、道具、背景、构图、摄影指纹、气质、材质与后期默认都是保持项；未被当前计划明确声明的维度不得变化。
${referenceFingerprint}

Creative Shot Plan（当前画面计划）：
- concept｜核心概念：${shot.concept}
- narrativeContext｜叙事情境：${shot.narrativeContext}
- storyPurpose｜故事目的：${shot.storyPurpose}
- subjectState｜主体状态：${shot.subjectState}
- cameraLanguage｜摄影语言：${shot.cameraLanguage}
- cameraHeight｜相机高度：${shot.cameraHeight}
- horizontalAngle｜水平角度：${shot.horizontalAngle}
- pitchAngle｜俯仰角度：${shot.pitchAngle}
- shotScale｜景别：${shot.shotScale}
- lens｜镜头：${shot.lens}
- perspective｜透视倾向：${shot.perspective}
- composition｜构图：${shot.composition}
- pose｜姿态／陈列：${shot.pose}
- actionPhase｜动作阶段：${shot.actionPhase}
- gaze｜视线：${shot.gaze}
- gesture｜动作／使用关系：${shot.gesture}
- emotion｜情绪／广告感受：${shot.emotion}
- timeSense｜时间感：${shot.timeSense}
- weatherSense｜天气感：${shot.weatherSense}
- lightDirection｜光线方向：${shot.lightDirection}
- lightQuality｜光质：${shot.lightQuality}
- shadowStrategy｜阴影策略：${shot.shadowStrategy}
- colorSystem｜色彩体系：${shot.colorSystem}
- lighting｜光线：${shot.lighting}
- environment｜环境：${shot.environment}
- atmosphere｜氛围：${shot.atmosphere}
- material｜材质：${shot.material}
- postProcessing｜后期统一：${shot.postProcessing}
- shotResponsibility｜镜头职责：${shot.shotResponsibility}
${portraitActionContract}
${portraitNegativeControl}
${portraitProportionContract}

${input.planItem.gridCellAnalysis ? `参考格逐格语义分析（当前画面唯一依据）：
- 景别：${input.planItem.gridCellAnalysis.shotScale}
- 构图：${input.planItem.gridCellAnalysis.composition}
- 动作：${input.planItem.gridCellAnalysis.action}
- 情绪：${input.planItem.gridCellAnalysis.emotion}
保持这一格可观察的景别、构图、动作、情绪、光影、色彩、材质和空间关系；仅排除参考人物身份或被用户主体明确替换的商品身份。` : ""}

材质真实性：${buildMaterialTruthRules(input.visualDNA)}
${input.domainProfile.domain === "product" ? buildProductCategoryRules(input.references) : ""}

全组不可变锚点：${input.sharedInvariants.join("；") || "核心风格、人物或主体、色彩与材质"}。
允许变化：${input.allowedVariations.join("；") || "镜头、构图、姿态、表情、局部场景与细节重点"}。
当前画面计划：${input.planItem.promptDelta}。

每一张都重新使用原始参考图、同一 Visual DNA revision 和同一共享锁定规则，独立生成。${repairBased
  ? "当前定向修复同时使用 edit_base 失败候选，只修复明确缺陷；不得把它当作新的风格来源。"
  : "首次生成不使用其他生成结果作为参考。"}

执行优先级：人物身份／商品结构等全组锚点始终不可变；参考图摄影指纹是整组视觉基线；当前画面计划只覆盖它明确指定的动作、景别、机位或环境变化，其他维度继续保持参考图。计划要求的变化必须清楚可见，但不得把参考图泛化成通用写真或通用广告模板。商品的生活方式或使用镜头可加入实现计划所必需的人物局部、操作动作和无品牌道具，但不得添加新品牌、可读文字或改变产品关键结构。`;
}

const roleText = {
  style_layout: "待复刻画面模板，保持画面风格、构图、气质和可见元素，只替换用户指定主体",
  style: "风格参考，提取和保持视觉语言，不复制具体人物或商品",
  subject: "主体／商品参考，保持外形、结构、材质和主要颜色；进一步保持主体外形、结构、材质和关键特征，允许背景、光线和构图变化",
  identity: "人物身份参考，只负责保持同一个人的身份、年龄感、脸型、眼睛、眉形、鼻子、嘴唇、五官比例与相对位置、发型和稳定识别特征；动作、表情、服装、背景和构图服从待复刻画面，不得用待复刻画面中的原人物身份覆盖用户人物",
  composition: "构图参考，保持空间布局、主体位置和镜头关系，不强制复制人物身份",
  color: "色彩参考，只使用其色彩关系",
  edit_base: "定向修复底图，只修复明确缺陷，其他像素关系和参考锚点保持不变"
} as const;

const subjectConstraintText: Record<SubjectAssetType, string> = {
  person: "保持人物身份、五官比例、年龄感和主要外观；具体保持脸型、眼睛、眉形、鼻子、嘴唇、五官相对位置、发型和稳定识别特征；动作、表情、服装、背景和构图服从待复刻画面",
  product: "严格保持产品外形、比例、材质和关键结构；Logo 和文字只在模型能力允许时尽量保留，不保证绝对一致；环境、承托和构图服从待复刻画面",
  object: "保持物体外形、结构、材质和关键特征",
  character: "保持角色的轮廓、面部特征、服装标识和主要设定",
  pet: "保持宠物的品种特征、毛色、脸部花纹和体型"
};

export function compilePrompt(input: CompileInput): string {
  const d = input.visualDNA;
  const hasIdentityReference = input.references.some((reference) => reference.role === "identity");
  const hasSubjectReference = input.references.some((reference) => reference.role === "subject");
  const hasReplacementReference = hasIdentityReference || hasSubjectReference;
  const replicatesReferenceFrame = input.references.some((reference) => reference.role === "style_layout");
  const inferredDomain = input.domainProfile?.domain ??
    (input.references.some((reference) => reference.role === "identity") ? "portrait"
      : input.references.some((reference) => reference.role === "subject") ? "product"
        : "photography");
  const creativeDirection = input.creativeDirection ?? createCreativeDirection({
    domain: inferredDomain,
    visualDNA: d,
    domainProfile: input.domainProfile,
    userIntent: input.userInstruction ?? ""
  });
  const transformationBlueprint = input.transformationBlueprint ?? createTransformationBlueprint({
    domain: inferredDomain,
    visualDNA: d,
    creativeDirection,
    references: input.references
  });
  const preservesReferenceLayout = input.references.some((ref) =>
    ref.role === "style_layout" || ref.role === "composition");
  const refs = input.references.map((ref) => {
    const named = ref.subjectName ? `“${ref.subjectName}”` : "";
    const subjectConstraint = ref.subjectConstraints?.length
      ? ref.subjectConstraints.join("；")
      : ref.subjectType
        ? subjectConstraintText[ref.subjectType]
        : "";
    const constraint = subjectConstraint ? `；${named}${subjectConstraint}` : "";
    const roleDescription = ref.role === "identity" && ref.imagePurpose === "face"
      ? "面部身份参考，只负责同一个人的脸型、下颌线、眼距、五官相对位置、年龄感、发型和稳定识别特征；不得承担身材、动作或构图职责"
      : ref.role === "identity" && ref.imagePurpose === "full_body"
        ? "全身体型参考，只负责同一个人的身高观感、肩宽、腰胯轮廓、腿身比、四肢粗细、整体体态和双脚接地；不得改变面部身份"
        : ref.role === "style"
          ? "风格参考，只负责摄影、光线、色彩、材质和后期方法；风格图中的人物不是身份来源，禁止继承其脸、体型、肤色、年龄、发型、服装和动作"
        : ref.role === "style_layout"
          ? `待复刻画面模板，负责保持具体景别、机位、主体位置、画面元素、背景、道具、服装或承托面、动作表情、光影、色彩、材质、气质与后期；${hasReplacementReference ? "只把原主体身份或商品替换为用户主体" : "未指定替换主体，保持参考图核心主体"}`
          : ref.role === "composition"
            ? "构图参考，只负责景别、主体关系、留白和空间层次；图中人物不是身份来源，禁止继承其脸、体型、肤色、年龄和发型"
            : ref.role === "edit_base"
              ? "定向修复底图，只修复 Critic 已指出的明确缺陷；其他人物身份、服装、动作、构图、光影、色彩、材质和像素关系保持不变"
              : ref.role === "subject" && ref.subjectType
                ? "主体参考，只负责保持主体外形、结构、材质和关键特征；背景、光线和构图服从待复刻画面"
                : roleText[ref.role];
    return `图 ${ref.index}：${roleDescription}${constraint}。`;
  }).join("\n");
  const preserve = (preservesReferenceLayout
    ? [...d.invariants, ...d.constraints.preserve]
    : [
        `风格关键词：${d.style.keywords.join("、")}`,
        `色彩关系：${d.palette.temperature}、${d.palette.saturation}`,
        `光线质感：${d.lighting.quality}、${d.lighting.contrast}`,
        `媒介质感：${d.style.medium}、${d.texture.medium}`
      ]).join("；") || "保持参考图的视觉语言";
  const avoid = d.constraints.avoid.join("；") || "文字、Logo 和无关物件";
  const instruction = input.userInstruction?.trim() || (replicatesReferenceFrame
    ? hasReplacementReference
      ? "以待复刻画面为模板，保持画面风格、构图、气质和可见元素，仅替换为用户指定主体。"
      : "以待复刻画面为模板，保持参考图核心主体、画面风格、构图、气质和可见元素。"
    : "沿用视觉语言，创作内容不同的新作品。");
  const lockRules = [
    d.locks.identity === "locked"
      ? hasIdentityReference
        ? "身份：严格以人物身份参考图为最高可信来源，保持脸型、眼睛、眉形、鼻子、嘴唇、五官相对位置、年龄感、发型和稳定识别特征；不得沿用风格参考图中的人物身份"
        : `身份：${d.identity.description}`
      : null,
    d.locks.subject === "locked" ? `主体：${d.subject.description}` : null,
    d.locks.composition === "locked"
      ? `构图：${d.composition.shotType}，${d.composition.subjectPlacement}，${d.composition.negativeSpace}`
      : null,
    d.locks.camera === "locked"
      ? `镜头：${d.camera.angle}，${d.camera.lens}，${d.camera.focalLength}`
      : null,
    d.locks.lighting === "locked"
      ? `光线：${d.lighting.source}，${d.lighting.direction}，${d.lighting.quality}`
      : null,
    d.locks.palette === "locked"
      ? `色彩：${d.palette.dominantColors.join("、")}，${d.palette.temperature}，${d.palette.saturation}`
      : null,
    d.locks.material === "locked"
      ? `材质：${d.material.types.join("、")}，${d.material.finish}`
      : null,
    d.locks.texture === "locked"
      ? `纹理：${d.texture.medium}，${d.texture.grain}，${d.texture.surfaceDetail}`
      : null,
    d.locks.style === "locked"
      ? `风格：${d.style.keywords.join("、")}，${d.style.medium}`
      : null
  ].filter((rule): rule is string => Boolean(rule));
  const lockBlock = lockRules.length
    ? `\n\n锁定视觉字段（必须保持）：\n${lockRules.map((rule) => `- ${rule}`).join("\n")}`
    : "";
  const domainBlock = input.domainProfile
    ? `领域规则：${input.domainProfile.domain}\n${DOMAIN_GENERATION_RULES[input.domainProfile.domain]}\n\n`
    : "";
  const portraitIntegrityBlock = inferredDomain === "portrait"
    ? `人体结构与遮挡：
- 只对画面实际包含的身体范围负责，允许合理出画；凡是画面中出现的身体部位，都必须保持自然、完整、数量正确且关节连接可信
- 全身、站立、跨坐或人与载具互动时，两条腿各自的髋、膝、踝、脚结构必须连续可解释；即使被衣物、车体或前景遮挡，也要用可见关节、脚部、轮廓或明确接触点交代遮挡关系。不得让整条腿完全消失在车体后、只靠观看者猜测其存在；参考图清楚展示双腿时必须保持双腿可读性
- 双手、手臂与道具／车把的接触必须可信，人物与车辆、座椅、地面不得穿模、悬空或错误融合
- 禁止缺失、融合、多余肢体，禁止错误关节、重复手脚和无法解释的身体截断

`
    : "";
  const compositionLanguage = replicatesReferenceFrame
    ? `严格对齐待复刻画面的具体景别、${d.camera.angle}、${d.camera.lens}、${d.composition.subjectPlacement}、主体比例、留白和空间层次；不得因生成或替换主体而重做构图或擅自增删画面元素`
    : preservesReferenceLayout
      ? `${d.composition.shotType}，${d.camera.angle}，${d.camera.lens}，${d.composition.subjectPlacement}`
    : `借鉴${d.camera.angle}、${d.camera.lens}、${d.composition.negativeSpace}和${d.composition.depth}的视觉感受；根据新主体重建构图，不复制参考图的具体形状、主体位置或内容`;
  const list = (values: string[]) => values.map((value) => `- ${value}`).join("\n");
  return `${domainBlock}${portraitIntegrityBlock}${input.editMode ? "编辑现有图像" : "创建一张新的原创图像"}，输出比例为 ${input.aspectRatio}。

参考图职责：
${refs}

Reference Intelligence：

Visual DNA（视觉语言）：
- 构图与相机：${compositionLanguage}
- 光线：${d.lighting.direction}，${d.lighting.quality}，${d.lighting.contrast}
- 色彩：${d.palette.dominantColors.join("、")}，${d.palette.temperature}，${d.palette.saturation}
- 材质与媒介：${d.texture.medium}，${d.material.types.join("、")}，${d.texture.surfaceDetail}
- 氛围：${d.mood.keywords.join("、")}，${d.mood.atmosphere}

Creative Direction（创作方法）：
- 视觉事件：${creativeDirection.visualStory}
- 主体状态：${creativeDirection.subjectState}
- 主体关系：${creativeDirection.subjectRelationship}
- 摄影语言：${creativeDirection.cameraLanguage}
- 光影方法：${creativeDirection.lightingMethod}
- 情绪方向：${creativeDirection.emotionalTone}
- 创作目的：${creativeDirection.commercialIntent}

Transformation Blueprint（迁移蓝图）：
Preserve｜保持：
${list(transformationBlueprint.preserve)}
Replace｜替换：
${list(transformationBlueprint.replace)}
Recreate｜重新创造：
${list(transformationBlueprint.recreate)}
Avoid｜避免：
${list(transformationBlueprint.avoid)}

必须保持：${preserve}。${lockBlock}

采用以下视觉语言：
- 构图与相机：${compositionLanguage}
- 光线：${d.lighting.direction}，${d.lighting.quality}，${d.lighting.contrast}
- 色彩：${d.palette.dominantColors.join("、")}，${d.palette.temperature}，${d.palette.saturation}
- 材质与媒介：${d.texture.medium}，${d.material.types.join("、")}，${d.texture.surfaceDetail}
- 氛围：${d.mood.keywords.join("、")}，${d.mood.atmosphere}

用户要求：${instruction}

避免：${avoid}。不要机械复制参考图中的具体人物、品牌标识或受保护文字。不得生成网页界面、浮层按钮、菜单或白色信息框，除非用户明确要求创作界面设计。`;
}

export const analyzePrompt = `你是一名视觉分析师和图像生成提示词编译器。只根据输入参考图提取可复用、可观察的视觉规则。必须具体记录：主体占画比例、主体位置与留白、画面层次；光线方向、光线软硬、明暗比、高光与阴影边界；主色、饱和度、色温与反差；景深、近似镜头感与透视；颗粒、锐度、皮肤／材质细节和后期质感；动作阶段、表情和画面气质。不得用高级、氛围感、电影感等抽象词替代这些可观察事实。分别分析主体、构图、光线、色彩、材质、不变量、变量与禁止项。使用清晰具体的中文。镜头类型、焦段、光圈、器材、透视成因或情绪如果不能从像素直接确认，必须标注“视觉推测”或“近似镜头感”，不得写成确定事实。输出必须符合 Visual DNA JSON Schema。`;

export function chunkBytes(bytes: Uint8Array, chunkSize = 384 * 1024) {
  if (chunkSize < 1) throw new Error("chunkSize 必须大于 0");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return chunks;
}

export function assembleChunks(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export async function sha256Hex(bytes: Uint8Array) {
  const source = new Uint8Array(bytes);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", source.buffer)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
