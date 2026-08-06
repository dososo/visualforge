import { openDB, type DBSchema } from "idb";
import {
  VISUAL_DNA_SCHEMA_VERSION,
  generationEventSchema,
  generationManifestSchema,
  migrateVisualDNA,
  preferenceEventSchema,
  preferenceSummaryDismissalSchema,
  creationSetSchema,
  analysisCacheEntrySchema,
  performanceTraceSchema,
  subjectAssetSchema,
  taskRecordSchema,
  visualDNARevisionSchema
} from "@styleforge/contracts";
import {
  createGenerationEvents,
  createVisualDNARevision,
  deriveCreationSetStatus,
  interruptStaleTask,
  transitionTask
} from "@styleforge/core";
import type {
  AppSettings, AssetRecord, GenerationEvent, GenerationManifest, LegacyTaskRecord,
  PreferenceEvent, PreferenceSummaryDismissal, ProjectRecord, TaskRecord, UserPreferenceSummary,
  VisualDNARevision, SubjectAsset, CreationSet, AnalysisCacheEntry, PerformanceTrace
} from "@styleforge/contracts";
import {
  createIntegrityDiagnostic,
  validateCriticalRecords,
  type DataIntegrityIssue
} from "./data-integrity";
import { ensureBrowserStorageCapacity } from "./storage-budget";

export { createIntegrityDiagnostic };
export type { DataIntegrityIssue };

interface VisualForgeDB extends DBSchema {
  assets: {
    key: string;
    value: AssetRecord;
    indexes: { "by-created": number; "by-hash": string };
  };
  projects: {
    key: string;
    value: ProjectRecord;
    indexes: { "by-updated": number; "by-favorite": number };
  };
  tasks: {
    key: string;
    value: LegacyTaskRecord;
    indexes: { "by-updated": number; "by-status": LegacyTaskRecord["status"] };
  };
  taskRecords: {
    key: string;
    value: TaskRecord;
    indexes: { "by-project": string; "by-status": TaskRecord["status"]; "by-heartbeat": number };
  };
  generationManifests: {
    key: string;
    value: GenerationManifest;
    indexes: { "by-project": string; "by-created": number };
  };
  generationEvents: {
    key: string;
    value: GenerationEvent;
    indexes: { "by-project": string; "by-output-asset": string; "by-created": number };
  };
  visualDNARevisions: {
    key: string;
    value: VisualDNARevision;
    indexes: { "by-project": string; "by-project-revision": [string, number] };
  };
  preferenceEvents: {
    key: string;
    value: PreferenceEvent;
    indexes: { "by-created": number; "by-dimension": PreferenceEvent["dimension"]; "by-project": string };
  };
  preferenceSummaryDismissals: {
    key: string;
    value: PreferenceSummaryDismissal;
    indexes: { "by-dismissed": number };
  };
  subjectAssets: {
    key: string;
    value: SubjectAsset;
    indexes: { "by-updated": number; "by-type": SubjectAsset["type"] };
  };
  creationSets: {
    key: string;
    value: CreationSet;
    indexes: {
      "by-project": string;
      "by-updated": number;
      "by-status": CreationSet["status"];
    };
  };
  performanceTraces: {
    key: string;
    value: PerformanceTrace;
    indexes: {
      "by-started": number;
      "by-operation": PerformanceTrace["operation"];
    };
  };
  analysisCache: {
    key: string;
    value: AnalysisCacheEntry;
    indexes: {
      "by-last-used": number;
      "by-source": string;
    };
  };
  settings: { key: string; value: AppSettings };
}

export function openVisualForgeDB(name = "styleforge") {
  return openDB<VisualForgeDB>(name, 10, {
    upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const assets = db.createObjectStore("assets", { keyPath: "id" });
      assets.createIndex("by-created", "createdAt");
      assets.createIndex("by-hash", "hash");
      const projects = db.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("by-updated", "updatedAt");
      projects.createIndex("by-favorite", "favorite");
      const tasks = db.createObjectStore("tasks", { keyPath: "id" });
      tasks.createIndex("by-updated", "updatedAt");
      tasks.createIndex("by-status", "status");
      db.createObjectStore("settings");
    }
    if (oldVersion < 2) {
      const manifests = db.createObjectStore("generationManifests", { keyPath: "id" });
      manifests.createIndex("by-project", "projectId");
      manifests.createIndex("by-created", "createdAt");
    }
    if (oldVersion < 3) {
      const events = db.createObjectStore("generationEvents", { keyPath: "id" });
      events.createIndex("by-project", "projectId");
      events.createIndex("by-output-asset", "outputAssetId", { unique: true });
      events.createIndex("by-created", "createdAt");
    }
    if (oldVersion < 4) {
      const taskRecords = db.createObjectStore("taskRecords", { keyPath: "taskId" });
      taskRecords.createIndex("by-project", "projectId");
      taskRecords.createIndex("by-status", "status");
      taskRecords.createIndex("by-heartbeat", "heartbeat");
    }
    if (oldVersion < 5) {
      const revisions = db.createObjectStore("visualDNARevisions", { keyPath: "id" });
      revisions.createIndex("by-project", "projectId");
      revisions.createIndex("by-project-revision", ["projectId", "revision"], { unique: true });
    }
    if (oldVersion < 6) {
      const preferences = db.createObjectStore("preferenceEvents", { keyPath: "id" });
      preferences.createIndex("by-created", "createdAt");
      preferences.createIndex("by-dimension", "dimension");
      preferences.createIndex("by-project", "projectId");
    }
    if (oldVersion < 7) {
      const dismissals = db.createObjectStore("preferenceSummaryDismissals", { keyPath: "id" });
      dismissals.createIndex("by-dismissed", "dismissedAt");
    }
    if (oldVersion < 8) {
      const subjectAssets = db.createObjectStore("subjectAssets", { keyPath: "id" });
      subjectAssets.createIndex("by-updated", "updatedAt");
      subjectAssets.createIndex("by-type", "type");
    }
    if (oldVersion < 9) {
      const creationSets = db.createObjectStore("creationSets", { keyPath: "id" });
      creationSets.createIndex("by-project", "projectId");
      creationSets.createIndex("by-updated", "updatedAt");
      creationSets.createIndex("by-status", "status");
    }
    if (oldVersion < 10) {
      const performanceTraces = db.createObjectStore("performanceTraces", { keyPath: "id" });
      performanceTraces.createIndex("by-started", "startedAt");
      performanceTraces.createIndex("by-operation", "operation");
      const analysisCache = db.createObjectStore("analysisCache", { keyPath: "key" });
      analysisCache.createIndex("by-last-used", "lastUsedAt");
      analysisCache.createIndex("by-source", "sourceImageHash");
    }
    }
  });
}

const dbPromise = openVisualForgeDB();

function migrateLegacyCreationSetQualityEvidence(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.planItems)) return value;
  let changed = false;
  const planItems = record.planItems.map((rawItem) => {
    if (!rawItem || typeof rawItem !== "object") return rawItem;
    const item = rawItem as Record<string, unknown>;
    const selection = item.finalSelection;
    if (!selection || typeof selection !== "object") return rawItem;
    const finalSelection = selection as Record<string, unknown>;
    if (finalSelection.criticDisposition !== "checked") return rawItem;
    const reports = [item.qualityReport, record.qualityReport].filter((report) =>
      report && typeof report === "object") as Array<Record<string, unknown>>;
    const hasEvidence = typeof finalSelection.criticReportId === "string"
      && typeof finalSelection.criticCheckedAt === "number"
      && finalSelection.criticReportId === `${record.id}:${finalSelection.criticCheckedAt}`
      && finalSelection.assetId === item.outputAssetId
      && reports.some((report) => report.checkedAt === finalSelection.criticCheckedAt
        && Array.isArray(report.checkedItemIds)
        && report.checkedItemIds.includes(item.id));
    if (hasEvidence) return rawItem;
    changed = true;
    return {
      ...item,
      finalSelection: {
        ...finalSelection,
        criticDisposition: "skipped",
        criticReportId: null,
        criticCheckedAt: null
      }
    };
  });
  return changed ? { ...record, planItems } : value;
}

export async function inspectStartupRecordIntegrity() {
  const db = await dbPromise;
  const [
    storedCreationSets,
    storedTaskRecords,
    storedGenerationEvents,
    storedProjects,
    storedSubjectAssets,
    storedPreferenceEvents,
    storedPreferenceSummaryDismissals
  ] = await Promise.all([
    db.getAll("creationSets"),
    db.getAll("taskRecords"),
    db.getAll("generationEvents"),
    db.getAll("projects"),
    db.getAll("subjectAssets"),
    db.getAll("preferenceEvents"),
    db.getAll("preferenceSummaryDismissals")
  ]);
  const creationSets = validateCriticalRecords(
    "creationSets",
    storedCreationSets.map(migrateLegacyCreationSetQualityEvidence)
  );
  const taskRecords = validateCriticalRecords("taskRecords", storedTaskRecords);
  const generationEvents = validateCriticalRecords("generationEvents", storedGenerationEvents);
  const projects = validateCriticalRecords("projects", storedProjects);
  const subjectAssets = validateCriticalRecords("subjectAssets", storedSubjectAssets);
  const preferenceEvents = validateCriticalRecords("preferenceEvents", storedPreferenceEvents);
  const preferenceSummaryDismissals = validateCriticalRecords(
    "preferenceSummaryDismissals",
    storedPreferenceSummaryDismissals
  );
  return {
    records: {
      creationSets: creationSets.records,
      taskRecords: taskRecords.records,
      generationEvents: generationEvents.records,
      projects: projects.records,
      subjectAssets: subjectAssets.records,
      preferenceEvents: preferenceEvents.records,
      preferenceSummaryDismissals: preferenceSummaryDismissals.records
    },
    issues: [
      ...creationSets.issues,
      ...taskRecords.issues,
      ...generationEvents.issues,
      ...projects.issues,
      ...subjectAssets.issues,
      ...preferenceEvents.issues,
      ...preferenceSummaryDismissals.issues
    ] satisfies DataIntegrityIssue[]
  };
}

export const defaultSettings: AppSettings = {
  defaultAspectRatio: "3:4",
  defaultCount: 1,
  saveSourceUrl: true,
  hoverCaptureEnabled: true,
  lastRoute: "create"
};

export async function saveAsset(asset: AssetRecord) {
  const [saved] = await saveAssets([asset]);
  return saved!;
}

export async function saveAssets(assets: AssetRecord[]) {
  if (!assets.length) return [];
  await ensureBrowserStorageCapacity(assets.reduce((total, asset) =>
    total + Math.max(asset.byteLength, asset.blob.size) + asset.thumbnailBlob.size, 0));
  const db = await dbPromise;
  const tx = db.transaction("assets", "readwrite");
  const saved: AssetRecord[] = [];
  try {
    for (const asset of assets) {
      const duplicate = await tx.store.index("by-hash").get(asset.hash);
      if (duplicate && duplicate.role !== "output" && duplicate.role === asset.role) {
        const refreshed = { ...duplicate, source: asset.source, createdAt: asset.createdAt };
        await tx.store.put(refreshed);
        saved.push(refreshed);
      } else {
        await tx.store.put(asset);
        saved.push(asset);
      }
    }
    await tx.done;
    return saved;
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      // 原始写入失败可能已经自动中止事务。
    }
    await tx.done.catch(() => undefined);
    throw cause;
  }
}

export async function saveGenerationBundle(bundle: {
  assets: AssetRecord[];
  manifest: GenerationManifest;
  events: GenerationEvent[];
  project: ProjectRecord;
  task?: TaskRecord;
}) {
  const manifest = generationManifestSchema.parse(bundle.manifest);
  const events = bundle.events.map((event) => generationEventSchema.parse(event));
  const task = bundle.task ? taskRecordSchema.parse(bundle.task) : undefined;
  const outputIds = new Set(manifest.outputs.map((output) => output.assetId));
  const assetsById = new Map(bundle.assets.map((asset) => [asset.id, asset]));
  const outputsById = new Map(manifest.outputs.map((output) => [output.assetId, output]));
  const eventIds = new Set(events.map((event) => event.id));
  const eventOutputIds = new Set(events.map((event) => event.outputAssetId));
  const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (manifest.projectId !== bundle.project.id ||
    Boolean(manifest.setId) !== Boolean(manifest.planItemId) ||
    events.some((event) => event.projectId !== bundle.project.id) ||
    (task && task.projectId !== bundle.project.id) ||
    (task && task.taskId !== manifest.taskId) ||
    events.length !== manifest.outputs.length ||
    eventIds.size !== events.length ||
    eventOutputIds.size !== events.length ||
    events.some((event) => event.generationManifestId !== manifest.id || !outputIds.has(event.outputAssetId)) ||
    events.some((event) => {
      const output = outputsById.get(event.outputAssetId);
      return !output || event.outputHash !== output.hash ||
        event.sourceAssetId !== manifest.source.assetId ||
        event.visualDNAId !== manifest.visualDNA.hash ||
        event.visualDNASchemaVersion !== manifest.visualDNA.schemaVersion ||
        event.dnaRevision !== manifest.visualDNA.revision ||
        event.prompt !== manifest.prompt.text ||
        event.promptCompilerVersion !== manifest.prompt.compilerVersion ||
        event.setId !== manifest.setId || event.planItemId !== manifest.planItemId ||
        !sameJson(event.model, manifest.model) || !sameJson(event.parameters, manifest.parameters);
    }) ||
    (task && events.some((event) => !task.generationEventIds.includes(event.id))) ||
    (task && (task.input.setId !== manifest.setId || task.input.planItemId !== manifest.planItemId)) ||
    bundle.assets.some((asset) => asset.role !== "output") ||
    bundle.assets.length !== outputIds.size ||
    bundle.assets.some((asset) => !outputIds.has(asset.id)) ||
    manifest.outputs.some((output) => {
      const asset = assetsById.get(output.assetId);
      return !asset || asset.hash !== output.hash || asset.mimeType !== output.mimeType ||
        asset.byteLength !== output.byteLength;
    })) {
    throw new Error("生成结果、记录与项目不一致，未写入本地作品。");
  }
  await ensureBrowserStorageCapacity(bundle.assets.reduce((total, asset) =>
    total + Math.max(asset.byteLength, asset.blob.size) + asset.thumbnailBlob.size, 0));
  const db = await dbPromise;
  const tx = db.transaction(
    ["assets", "generationManifests", "generationEvents", "projects", "taskRecords", "creationSets"],
    "readwrite"
  );
  try {
    const projectStore = tx.objectStore("projects");
    const current = await projectStore.get(bundle.project.id);
    if (!current) throw new Error("项目已删除或不存在，生成结果未写入本地作品。");
    if (manifest.setId) {
      const creationSet = await tx.objectStore("creationSets").get(manifest.setId);
      if (!creationSet || creationSet.projectId !== manifest.projectId ||
        !creationSet.planItems.some((item) => item.id === manifest.planItemId)) {
        throw new Error("套图已删除或当前画面不存在，生成结果未写入本地作品。");
      }
    }
    const assetStore = tx.objectStore("assets");
    for (const asset of bundle.assets) await assetStore.put(asset);
    await tx.objectStore("generationManifests").put(manifest);
    const eventStore = tx.objectStore("generationEvents");
    for (const event of events) await eventStore.put(event);
    const project: ProjectRecord = {
      ...current,
      outputAssetIds: [...new Set([
        ...current.outputAssetIds,
        ...bundle.project.outputAssetIds,
        ...bundle.assets.map((asset) => asset.id)
      ])],
      updatedAt: Math.max(current.updatedAt, bundle.project.updatedAt)
    };
    await projectStore.put(project);
    if (task) await tx.objectStore("taskRecords").put(task);
    await tx.done;
    return { assets: bundle.assets, manifest, events, project, task };
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      // 原始写入失败可能已经自动中止事务。
    }
    await tx.done.catch(() => undefined);
    throw cause;
  }
}

export async function getAsset(id: string) {
  return (await dbPromise).get("assets", id);
}

export async function saveSubjectAsset(subjectAsset: SubjectAsset) {
  const parsed = subjectAssetSchema.parse(subjectAsset);
  const db = await dbPromise;
  const images = await Promise.all(parsed.imageIds.map((id) => db.get("assets", id)));
  if (images.some((image) => !image)) throw new Error("主体资产引用的图片不存在");
  await db.put("subjectAssets", parsed);
  return parsed;
}

export async function getSubjectAsset(id: string) {
  return (await dbPromise).get("subjectAssets", id);
}

export async function listSubjectAssets() {
  const stored = (await (await dbPromise).getAllFromIndex("subjectAssets", "by-updated")).reverse();
  return validateCriticalRecords("subjectAssets", stored).records;
}

export async function deleteSubjectAsset(id: string) {
  await (await dbPromise).delete("subjectAssets", id);
}

export async function savePerformanceTrace(trace: PerformanceTrace) {
  const parsed = performanceTraceSchema.parse(trace);
  await (await dbPromise).put("performanceTraces", parsed);
  return parsed;
}

export async function listPerformanceTraces() {
  const records = await (await dbPromise).getAllFromIndex("performanceTraces", "by-started");
  return records.map((record) => performanceTraceSchema.parse(record)).reverse();
}

export async function putAnalysisCache(entry: AnalysisCacheEntry) {
  const parsed = analysisCacheEntrySchema.parse(entry);
  await (await dbPromise).put("analysisCache", parsed);
  return parsed;
}

export async function getAnalysisCache(key: string) {
  const value = await (await dbPromise).get("analysisCache", key);
  return value ? analysisCacheEntrySchema.parse(value) : undefined;
}

export async function saveCreationSet(creationSet: CreationSet) {
  const parsed = creationSetSchema.parse(creationSet);
  await (await dbPromise).put("creationSets", parsed);
  return parsed;
}

export async function updateCreationSet(
  id: string,
  transform: (current: CreationSet) => CreationSet
) {
  const db = await dbPromise;
  const tx = db.transaction("creationSets", "readwrite");
  try {
    const stored = await tx.store.get(id);
    if (!stored) {
      await tx.done;
      return undefined;
    }
    const current = creationSetSchema.parse(migrateLegacyCreationSetQualityEvidence(stored));
    const next = creationSetSchema.parse(transform(current));
    if (next.id !== id) throw new Error("套图原子更新不得修改记录标识。");
    await tx.store.put(next);
    await tx.done;
    return next;
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      // 原始写入失败可能已经自动中止事务。
    }
    await tx.done.catch(() => undefined);
    throw cause;
  }
}

export async function getCreationSet(id: string) {
  const db = await dbPromise;
  const value = await db.get("creationSets", id);
  if (!value) return value;
  const migrated = migrateLegacyCreationSetQualityEvidence(value);
  const parsed = creationSetSchema.safeParse(migrated);
  if (!parsed.success) return undefined;
  if (migrated !== value) await db.put("creationSets", parsed.data);
  return parsed.data;
}

export async function listCreationSets(projectId?: string) {
  const db = await dbPromise;
  const stored = projectId
    ? await db.getAllFromIndex("creationSets", "by-project", projectId)
    : await db.getAllFromIndex("creationSets", "by-updated");
  const records = validateCriticalRecords(
    "creationSets",
    stored.map(migrateLegacyCreationSetQualityEvidence)
  ).records;
  return records
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export async function deleteCreationSet(id: string) {
  await (await dbPromise).delete("creationSets", id);
}

export async function deleteCreationSetWithWorks(id: string) {
  const db = await dbPromise;
  const tx = db.transaction([
    "creationSets", "projects", "assets", "generationManifests",
    "generationEvents", "taskRecords"
  ], "readwrite");
  const creationSet = await tx.objectStore("creationSets").get(id);
  if (!creationSet) {
    await tx.done;
    return;
  }
  const [project, manifests, events, tasks] = await Promise.all([
    tx.objectStore("projects").get(creationSet.projectId),
    tx.objectStore("generationManifests").index("by-project").getAll(creationSet.projectId),
    tx.objectStore("generationEvents").index("by-project").getAll(creationSet.projectId),
    tx.objectStore("taskRecords").index("by-project").getAll(creationSet.projectId)
  ]);
  const setManifests = manifests.filter((manifest) => manifest.setId === id);
  const setEvents = events.filter((event) => event.setId === id);
  const outputIds = new Set([
    ...creationSet.planItems.flatMap((item) => [
      ...(item.outputAssetId ? [item.outputAssetId] : []),
      ...item.outputCandidates.map((candidate) => candidate.outputAssetId)
    ]),
    ...setManifests.flatMap((manifest) => manifest.outputs.map((output) => output.assetId)),
    ...setEvents.map((event) => event.outputAssetId)
  ]);
  await tx.objectStore("creationSets").delete(id);
  await Promise.all([...outputIds].map((assetId) => tx.objectStore("assets").delete(assetId)));
  await Promise.all(setManifests
    .map((manifest) => tx.objectStore("generationManifests").delete(manifest.id)));
  await Promise.all(setEvents
    .map((event) => tx.objectStore("generationEvents").delete(event.id)));
  await Promise.all(tasks.filter((task) => task.input.setId === id)
    .map((task) => tx.objectStore("taskRecords").delete(task.taskId)));
  if (project) {
    await tx.objectStore("projects").put({
      ...project,
      outputAssetIds: project.outputAssetIds.filter((assetId) => !outputIds.has(assetId)),
      updatedAt: Date.now()
    });
  }
  await tx.done;
}

export async function reconcileCreationSets() {
  const db = await dbPromise;
  const tx = db.transaction(["creationSets", "taskRecords", "generationEvents"], "readwrite");
  const [storedSets, storedTasks, storedEvents] = await Promise.all([
    tx.objectStore("creationSets").getAll(),
    tx.objectStore("taskRecords").getAll(),
    tx.objectStore("generationEvents").getAll()
  ]);
  const sets = validateCriticalRecords(
    "creationSets",
    storedSets.map(migrateLegacyCreationSetQualityEvidence)
  ).records;
  const tasks = validateCriticalRecords("taskRecords", storedTasks).records;
  const events = validateCriticalRecords("generationEvents", storedEvents).records;
  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const reconciledAt = Date.now();
  const reconciled = sets.map((set) => {
    const planItems = set.planItems.map((item) => {
      if (item.status === "COMPLETED") return item.qualityStatus === "checking" ? {
        ...item,
        qualityStatus: "unavailable" as const,
        qualityMessage: "图片已生成，但质量检查在上次关闭前没有完成，可稍后重试检查。",
        error: {
          code: "QUALITY_CHECK_UNAVAILABLE",
          message: "图片已生成，但质量检查在上次关闭前没有完成，可稍后重试检查。",
          retryable: true
        }
      } : item;
      const task = item.taskId ? taskById.get(item.taskId) : undefined;
      if (task?.status === "COMPLETED" && task.generationEventId) {
        const event = eventById.get(task.generationEventId);
        if (event) return {
          ...item,
          status: "COMPLETED" as const,
          generationEventId: event.id,
          outputAssetId: event.outputAssetId,
          qualityStatus: item.qualityStatus === "checking" ? "unavailable" as const : item.qualityStatus,
          qualityMessage: item.qualityStatus === "checking"
            ? "图片已生成，但质量检查在上次关闭前没有完成，可稍后重试检查。"
            : item.qualityMessage,
          error: item.qualityStatus === "checking" ? {
            code: "QUALITY_CHECK_UNAVAILABLE",
            message: "图片已生成，但质量检查在上次关闭前没有完成，可稍后重试检查。",
            retryable: true
          } : null
        };
      }
      if (task?.status === "FAILED") {
        return {
          ...item,
          status: "FAILED" as const,
          error: task.error ?? {
            code: "GENERATION_FAILED",
            message: "此画面没有生成完成，可以重试。",
            retryable: true
          }
        };
      }
      if (task?.status === "CANCELLED") {
        return { ...item, status: "CANCELLED" as const, error: null };
      }
      const staleTask = task ? interruptStaleTask(task, reconciledAt) : undefined;
      const shouldInterrupt = task?.status === "INTERRUPTED"
        || (item.status === "GENERATING" && (!task || staleTask?.status === "INTERRUPTED"));
      if (shouldInterrupt) {
        return {
          ...item,
          status: "INTERRUPTED" as const,
          error: {
            code: "INTERRUPTED",
            message: "此画面在扩展关闭或连接中断时停止，可以继续生成。",
            retryable: true
          }
        };
      }
      return item;
    });
    const progress = deriveCreationSetStatus(planItems);
    return creationSetSchema.parse({
      ...set,
      ...progress,
      planItems,
      updatedAt: planItems.some((item, index) => item !== set.planItems[index])
        ? Date.now()
        : set.updatedAt
    });
  });
  const creationSetStore = tx.objectStore("creationSets");
  await Promise.all(reconciled.map((set) => creationSetStore.put(set)));
  await tx.done;
  return reconciled.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function saveProject(project: ProjectRecord) {
  await (await dbPromise).put("projects", project);
}

export async function updateProject(
  id: string,
  transform: (current: ProjectRecord) => ProjectRecord
) {
  const db = await dbPromise;
  const tx = db.transaction("projects", "readwrite");
  try {
    const current = await tx.store.get(id);
    if (!current) {
      await tx.done;
      return undefined;
    }
    const next = transform(current);
    if (next.id !== id) throw new Error("项目原子更新不得修改记录标识。");
    await tx.store.put(next);
    await tx.done;
    return next;
  } catch (cause) {
    try {
      tx.abort();
    } catch {
      // 原始写入失败可能已经自动中止事务。
    }
    await tx.done.catch(() => undefined);
    throw cause;
  }
}

export async function saveProjectRevision(
  project: ProjectRecord,
  revision: VisualDNARevision,
  preferenceEvents: PreferenceEvent[] = []
) {
  const parsed = visualDNARevisionSchema.parse(revision);
  if (parsed.projectId !== project.id || parsed.revision !== project.visualDNA?.revision) {
    throw new Error("项目当前 DNA 必须与待保存 revision 一致");
  }
  const db = await dbPromise;
  const tx = db.transaction(["projects", "visualDNARevisions", "preferenceEvents"], "readwrite");
  const projectStore = tx.objectStore("projects");
  const current = await projectStore.get(project.id);
  if (!current) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw new Error("项目已删除或不存在，无法保存 Visual DNA 版本。");
  }
  const updated: ProjectRecord = {
    ...current,
    selectedSubjectAssetId: project.selectedSubjectAssetId,
    domainProfile: project.domainProfile,
    referenceAssetIds: project.referenceAssetIds,
    referenceSnapshots: project.referenceSnapshots,
    visualDNA: project.visualDNA,
    compiledPrompt: project.compiledPrompt,
    updatedAt: Math.max(current.updatedAt, project.updatedAt)
  };
  await tx.objectStore("visualDNARevisions").add(parsed);
  await Promise.all(preferenceEvents.map((event) =>
    tx.objectStore("preferenceEvents").add(preferenceEventSchema.parse(event))));
  await projectStore.put(updated);
  await tx.done;
  return updated;
}

export async function getProject(id: string) {
  const db = await dbPromise;
  const project = await db.get("projects", id);
  if (!project?.visualDNA) return project;
  const reference = await db.get("assets", project.referenceAssetIds[0] ?? "");
  const visualDNA = migrateVisualDNA(project.visualDNA, {
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    sourceImageHash: reference?.hash ?? null,
    analysisModel: project.provider === "codex" ? "codex-legacy-unknown" : "styleforge-mock"
  });
  if ((project.visualDNA as { schemaVersion?: string }).schemaVersion !== visualDNA.schemaVersion) {
    const migrated = { ...project, visualDNA };
    await db.put("projects", migrated);
    return migrated;
  }
  return project;
}

export async function listProjects() {
  const db = await dbPromise;
  const projects = validateCriticalRecords(
    "projects",
    (await db.getAllFromIndex("projects", "by-updated")).reverse()
  ).records;
  return Promise.all(projects.map(async (project) => {
    if (!project.visualDNA || (project.visualDNA as { schemaVersion?: string }).schemaVersion === VISUAL_DNA_SCHEMA_VERSION) return project;
    const reference = await db.get("assets", project.referenceAssetIds[0] ?? "");
    const migrated = {
      ...project,
      visualDNA: migrateVisualDNA(project.visualDNA, {
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        sourceImageHash: reference?.hash ?? null,
        analysisModel: project.provider === "codex" ? "codex-legacy-unknown" : "styleforge-mock"
      })
    };
    await db.put("projects", migrated);
    return migrated;
  }));
}

export async function deleteProject(id: string) {
  const db = await dbPromise;
  const project = await db.get("projects", id);
  if (!project) return;
  const tx = db.transaction(["projects", "tasks", "taskRecords", "assets", "generationManifests", "generationEvents", "visualDNARevisions", "preferenceEvents", "creationSets"], "readwrite");
  await tx.objectStore("projects").delete(id);
  const tasks = await tx.objectStore("tasks").index("by-updated").getAll();
  const taskRecords = await tx.objectStore("taskRecords").index("by-project").getAll(id);
  const manifests = await tx.objectStore("generationManifests").index("by-project").getAll(id);
  const events = await tx.objectStore("generationEvents").index("by-project").getAll(id);
  const revisions = await tx.objectStore("visualDNARevisions").index("by-project").getAll(id);
  const preferenceEvents = await tx.objectStore("preferenceEvents").index("by-project").getAll(id);
  const creationSets = await tx.objectStore("creationSets").index("by-project").getAll(id);
  await Promise.all(tasks.filter((task) => task.projectId === id).map((task) => tx.objectStore("tasks").delete(task.id)));
  await Promise.all(taskRecords.map((task) => tx.objectStore("taskRecords").delete(task.taskId)));
  await Promise.all(manifests.map((manifest) => tx.objectStore("generationManifests").delete(manifest.id)));
  await Promise.all(events.map((event) => tx.objectStore("generationEvents").delete(event.id)));
  await Promise.all(revisions.map((revision) => tx.objectStore("visualDNARevisions").delete(revision.id)));
  await Promise.all(preferenceEvents.map((event) => tx.objectStore("preferenceEvents").delete(event.id)));
  await Promise.all(creationSets.map((set) => tx.objectStore("creationSets").delete(set.id)));
  const outputAssetIds = new Set([
    ...project.outputAssetIds,
    ...manifests.flatMap((manifest) => manifest.outputs.map((output) => output.assetId))
  ]);
  await Promise.all([...outputAssetIds].map((assetId) => tx.objectStore("assets").delete(assetId)));
  await tx.done;
}

export async function deleteStandaloneProjectWorks(id: string) {
  const db = await dbPromise;
  const [project, creationSets] = await Promise.all([
    db.get("projects", id),
    db.getAllFromIndex("creationSets", "by-project", id)
  ]);
  if (!project) return;
  if (!creationSets.length) {
    await deleteProject(id);
    return;
  }
  const setOutputIds = new Set(creationSets.flatMap((creationSet) =>
    creationSet.planItems.flatMap((item) => [
      ...(item.outputAssetId ? [item.outputAssetId] : []),
      ...item.outputCandidates.map((candidate) => candidate.outputAssetId)
    ])));
  const standaloneOutputIds = new Set(project.outputAssetIds.filter((assetId) =>
    !setOutputIds.has(assetId)));
  const tx = db.transaction([
    "projects", "assets", "generationManifests", "generationEvents", "taskRecords"
  ], "readwrite");
  const [manifests, events, tasks] = await Promise.all([
    tx.objectStore("generationManifests").index("by-project").getAll(id),
    tx.objectStore("generationEvents").index("by-project").getAll(id),
    tx.objectStore("taskRecords").index("by-project").getAll(id)
  ]);
  const standaloneEvents = events.filter((event) =>
    !event.setId && standaloneOutputIds.has(event.outputAssetId));
  const standaloneEventIds = new Set(standaloneEvents.map((event) => event.id));
  await Promise.all([...standaloneOutputIds].map((assetId) =>
    tx.objectStore("assets").delete(assetId)));
  await Promise.all(manifests.filter((manifest) => !manifest.setId &&
    manifest.outputs.some((output) => standaloneOutputIds.has(output.assetId)))
    .map((manifest) => tx.objectStore("generationManifests").delete(manifest.id)));
  await Promise.all(standaloneEvents.map((event) =>
    tx.objectStore("generationEvents").delete(event.id)));
  await Promise.all(tasks.filter((task) =>
    task.operation === "GENERATION" &&
    !task.input.setId &&
    task.generationEventIds.some((eventId) => standaloneEventIds.has(eventId)))
    .map((task) => tx.objectStore("taskRecords").delete(task.taskId)));
  await tx.objectStore("projects").put({
    ...project,
    outputAssetIds: project.outputAssetIds.filter((assetId) => setOutputIds.has(assetId)),
    updatedAt: Date.now()
  });
  await tx.done;
}

export async function saveTaskRecord(task: TaskRecord) {
  await (await dbPromise).put("taskRecords", taskRecordSchema.parse(task));
}

export async function refreshTaskHeartbeat(taskId: string, now = Date.now()) {
  const db = await dbPromise;
  const tx = db.transaction("taskRecords", "readwrite");
  const task = await tx.store.get(taskId);
  if (!task || !["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(task.status)) {
    await tx.done;
    return false;
  }
  await tx.store.put(taskRecordSchema.parse({ ...task, heartbeat: now }));
  await tx.done;
  return true;
}

function migrateTaskRecordVisualDNA(task: TaskRecord): TaskRecord {
  if (!task.input.visualDNA) return task;
  if (task.input.visualDNA.schemaVersion === VISUAL_DNA_SCHEMA_VERSION) return task;
  const visualDNA = migrateVisualDNA(task.input.visualDNA);
  return visualDNA === task.input.visualDNA
    ? task
    : { ...task, input: { ...task.input, visualDNA } };
}

export async function getTaskRecord(taskId: string) {
  const db = await dbPromise;
  const stored = await db.get("taskRecords", taskId);
  if (!stored) return stored;
  const parsed = taskRecordSchema.safeParse(stored);
  if (!parsed.success) return undefined;
  const migrated = migrateTaskRecordVisualDNA(parsed.data);
  if (migrated !== parsed.data) await db.put("taskRecords", migrated);
  return migrated;
}

export async function deleteTaskRecord(taskId: string) {
  await (await dbPromise).delete("taskRecords", taskId);
}

export async function listInterruptedTaskRecords() {
  const db = await dbPromise;
  const [storedInterrupted, storedAll] = await Promise.all([
    db.getAllFromIndex("taskRecords", "by-status", "INTERRUPTED"),
    db.getAll("taskRecords")
  ]);
  const interrupted = validateCriticalRecords("taskRecords", storedInterrupted).records;
  const all = validateCriticalRecords("taskRecords", storedAll).records;
  const retriedTaskIds = new Set(all.flatMap((task) =>
    task.retryOfTaskId ? [task.retryOfTaskId] : []));
  return interrupted.filter((task) => !retriedTaskIds.has(task.taskId));
}

export async function listRetryableTaskRecords() {
  const db = await dbPromise;
  const stored = await db.getAll("taskRecords");
  const all = validateCriticalRecords("taskRecords", stored).records;
  const retriedTaskIds = new Set(all.flatMap((task) =>
    task.retryOfTaskId ? [task.retryOfTaskId] : []));
  return all
    .filter((task) => ["FAILED", "INTERRUPTED"].includes(task.status))
    .filter((task) => task.error?.retryable !== false)
    .filter((task) => !retriedTaskIds.has(task.taskId))
    .sort((left, right) => right.heartbeat - left.heartbeat);
}

export async function saveGenerationManifest(manifest: GenerationManifest) {
  await (await dbPromise).put("generationManifests", generationManifestSchema.parse(manifest));
}

export async function getGenerationManifest(id: string) {
  const db = await dbPromise;
  const value = await db.get("generationManifests", id);
  return value ? generationManifestSchema.parse(value) : value;
}

export async function listGenerationManifests(projectId: string) {
  return (await (await dbPromise).getAllFromIndex("generationManifests", "by-project", projectId))
    .map((value) => generationManifestSchema.parse(value));
}

export async function saveGenerationEvents(events: GenerationEvent[]) {
  const db = await dbPromise;
  const tx = db.transaction("generationEvents", "readwrite");
  await Promise.all(events.map((event) => tx.store.put(generationEventSchema.parse(event))));
  await tx.done;
}

export async function listGenerationEvents(projectId: string) {
  const db = await dbPromise;
  const stored = await db.getAllFromIndex("generationEvents", "by-project", projectId);
  let events = validateCriticalRecords("generationEvents", stored).records;
  if (!events.length && !stored.length) {
    const manifests = await db.getAllFromIndex("generationManifests", "by-project", projectId);
    const migrated = manifests.flatMap((manifest) => createGenerationEvents(manifest, {
      ids: manifest.outputs.map((output) => `legacy:${manifest.id}:${output.assetId}`),
      parentGenerationId: null
    }));
    if (migrated.length) {
      await saveGenerationEvents(migrated);
      events = migrated;
    }
  }
  return events.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export async function getGenerationEventByOutputAssetId(outputAssetId: string) {
  const db = await dbPromise;
  const existing = await db.getFromIndex("generationEvents", "by-output-asset", outputAssetId);
  if (existing) return existing;
  const manifests = await db.getAll("generationManifests");
  const manifest = manifests.find((item) => item.outputs.some((output) => output.assetId === outputAssetId));
  if (!manifest) return undefined;
  await listGenerationEvents(manifest.projectId);
  return db.getFromIndex("generationEvents", "by-output-asset", outputAssetId);
}

export async function getLatestGenerationEvent(projectId: string) {
  const events = await listGenerationEvents(projectId);
  return events.at(-1);
}

export async function saveVisualDNARevision(revision: VisualDNARevision) {
  await (await dbPromise).add("visualDNARevisions", visualDNARevisionSchema.parse(revision));
}

export async function listVisualDNARevisions(projectId: string) {
  const records = await (await dbPromise).getAllFromIndex("visualDNARevisions", "by-project", projectId);
  return records.sort((left, right) => left.revision - right.revision);
}

export async function ensureVisualDNARevisions(project: ProjectRecord) {
  if (!project.visualDNA) return [];
  const db = await dbPromise;
  const [existing, manifests] = await Promise.all([
    db.getAllFromIndex("visualDNARevisions", "by-project", project.id),
    db.getAllFromIndex("generationManifests", "by-project", project.id)
  ]);
  const recordsByRevision = new Map(existing.map((record) => [record.revision, record]));
  const candidates = new Map<number, { dna: ProjectRecord["visualDNA"]; createdAt: number }>();
  for (const manifest of manifests) {
    candidates.set(manifest.visualDNA.revision, {
      dna: manifest.visualDNA.snapshot,
      createdAt: manifest.completedAt
    });
  }
  candidates.set(project.visualDNA.revision, {
    dna: project.visualDNA,
    createdAt: project.visualDNA.updatedAt
  });
  const additions: VisualDNARevision[] = [];
  for (const [revision, candidate] of [...candidates.entries()].sort(([left], [right]) => left - right)) {
    if (!candidate.dna || recordsByRevision.has(revision)) continue;
    const previous = recordsByRevision.get(revision - 1);
    const record = createVisualDNARevision({
      id: `backfill:${project.id}:${revision}`,
      projectId: project.id,
      dna: candidate.dna,
      previousDNA: previous?.dna ?? null,
      origin: revision === 1 ? "analysis" : "backfill",
      createdAt: candidate.createdAt
    });
    recordsByRevision.set(revision, record);
    additions.push(record);
  }
  if (additions.length) {
    const tx = db.transaction("visualDNARevisions", "readwrite");
    await Promise.all(additions.map((record) => tx.store.add(record)));
    await tx.done;
  }
  return [...recordsByRevision.values()].sort((left, right) => left.revision - right.revision);
}

export async function listPreferenceEvents() {
  return validateCriticalRecords(
    "preferenceEvents",
    await (await dbPromise).getAllFromIndex("preferenceEvents", "by-created")
  ).records
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export async function savePreferenceEvents(events: PreferenceEvent[]) {
  const db = await dbPromise;
  const tx = db.transaction("preferenceEvents", "readwrite");
  await Promise.all(events.map((event) => tx.store.add(preferenceEventSchema.parse(event))));
  await tx.done;
}

function preferenceSummaryDismissal(
  summary: UserPreferenceSummary,
  dismissedAt: number
): PreferenceSummaryDismissal {
  return preferenceSummaryDismissalSchema.parse({
    schemaVersion: "1.0.0",
    id: `${summary.dimension}:${summary.field}`,
    dimension: summary.dimension,
    field: summary.field,
    dismissedThrough: summary.lastUpdated,
    dismissedAt
  });
}

export async function dismissPreferenceSummary(
  summary: UserPreferenceSummary,
  dismissedAt: number
) {
  await (await dbPromise).put(
    "preferenceSummaryDismissals",
    preferenceSummaryDismissal(summary, dismissedAt)
  );
}

export async function dismissPreferenceSummaries(
  summaries: UserPreferenceSummary[],
  dismissedAt: number
) {
  const db = await dbPromise;
  const tx = db.transaction("preferenceSummaryDismissals", "readwrite");
  await Promise.all(summaries.map((summary) =>
    tx.store.put(preferenceSummaryDismissal(summary, dismissedAt))));
  await tx.done;
}

export async function listPreferenceSummaryDismissals() {
  return validateCriticalRecords(
    "preferenceSummaryDismissals",
    await (await dbPromise).getAll("preferenceSummaryDismissals")
  ).records;
}

export async function getSettings() {
  const stored = await (await dbPromise).get("settings", "app");
  return { ...defaultSettings, ...(stored ?? {}) };
}

export async function saveSettings(settings: AppSettings) {
  await (await dbPromise).put("settings", settings, "app");
}

const legacyStatusMap: Record<LegacyTaskRecord["status"], TaskRecord["status"]> = {
  created: "CREATED",
  analyzing: "ANALYZING",
  ready: "READY",
  queued: "GENERATING",
  rendering: "GENERATING",
  saving: "GENERATING",
  completed: "COMPLETED",
  failed: "FAILED",
  cancelled: "CANCELLED"
};

async function migrateLegacyTaskRecords() {
  const db = await dbPromise;
  const [legacyTasks, existingTasks, projects, manifests, events] = await Promise.all([
    db.getAll("tasks"),
    db.getAll("taskRecords"),
    db.getAll("projects"),
    db.getAll("generationManifests"),
    db.getAll("generationEvents")
  ]);
  const validEvents = validateCriticalRecords("generationEvents", events).records;
  const existingIds = new Set(existingTasks.map((task) => task.taskId));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const migrated: TaskRecord[] = [];
  for (const legacy of legacyTasks) {
    if (existingIds.has(legacy.id)) continue;
    const project = projectById.get(legacy.projectId);
    const sourceAssetId = project?.referenceAssetIds[0];
    if (!project || !sourceAssetId) continue;
    const manifest = manifests.find((item) => item.taskId === legacy.id);
    const generationEventIds = manifest
      ? validEvents.filter((event) => event.generationManifestId === manifest.id).map((event) => event.id)
      : [];
    const status = legacyStatusMap[legacy.status];
    const isAnalysis = ["created", "analyzing", "ready"].includes(legacy.status);
    const candidate = taskRecordSchema.safeParse({
      schemaVersion: "1.0.0",
      taskId: legacy.id,
      projectId: legacy.projectId,
      retryOfTaskId: null,
      generationEventId: generationEventIds[0] ?? null,
      generationEventIds,
      operation: isAnalysis ? "ANALYSIS" : "GENERATION",
      status,
      startedAt: legacy.createdAt,
      finishedAt: ["READY", "COMPLETED", "FAILED", "CANCELLED"].includes(status) ? legacy.updatedAt : null,
      retryCount: legacy.retryCount,
      error: legacy.error ?? null,
      heartbeat: legacy.updatedAt,
      input: {
        sourceAssetId,
        visualDNA: project.visualDNA
          ? migrateVisualDNA(project.visualDNA, {
              createdAt: project.createdAt,
              updatedAt: project.updatedAt
            })
          : null,
        prompt: isAnalysis ? null : project.compiledPrompt ?? null,
        parameters: {
          aspectRatio: project.aspectRatio,
          count: project.count,
          userInstruction: project.userInstruction,
          providerParameters: {}
        },
        parentGenerationId: null
      }
    });
    if (candidate.success) migrated.push(candidate.data);
  }
  if (migrated.length) {
    const tx = db.transaction("taskRecords", "readwrite");
    await Promise.all(migrated.map((task) => tx.store.put(task)));
    await tx.done;
  }
}

export async function recoverInterruptedTaskRecords(activeLockNames?: ReadonlySet<string>) {
  await migrateLegacyTaskRecords();
  const db = await dbPromise;
  const tx = db.transaction("taskRecords", "readwrite");
  const stored = await tx.store.getAll();
  const valid = validateCriticalRecords("taskRecords", stored).records;
  const all = valid.map(migrateTaskRecordVisualDNA);
  const storedById = new Map(valid.map((task) => [task.taskId, task]));
  const now = Date.now();
  const recovered = all.map((task) => {
    const staleRecovery = interruptStaleTask(task, now);
    const activeGeneration = task.operation === "GENERATION" &&
      ["CREATED", "UPLOADING", "GENERATING", "RETRYING"].includes(task.status);
    if (!activeLockNames || !activeGeneration) {
      return staleRecovery;
    }
    const setId = task.input.setId;
    const expectedLock = setId
      ? `visualforge:creation-set:${setId}`
      : `visualforge:project:${task.projectId}`;
    if (activeLockNames.has(expectedLock)) return task;
    if (staleRecovery !== task) return staleRecovery;
    return transitionTask(task, "INTERRUPTED", now, {
      code: "INTERRUPTED",
      message: "没有活动窗口继续处理此任务，已恢复为可重试状态。",
      retryable: true
    });
  })
    .filter((task) => task !== storedById.get(task.taskId));
  await Promise.all(recovered.map((task) => tx.store.put(task)));
  await tx.done;
  return recovered;
}

export async function clearAllData() {
  const db = await dbPromise;
  const tx = db.transaction(["assets", "projects", "tasks", "taskRecords", "generationManifests", "generationEvents", "visualDNARevisions", "preferenceEvents", "preferenceSummaryDismissals", "subjectAssets", "creationSets", "performanceTraces", "analysisCache", "settings"], "readwrite");
  await Promise.all([
    tx.objectStore("assets").clear(),
    tx.objectStore("projects").clear(),
    tx.objectStore("tasks").clear(),
    tx.objectStore("taskRecords").clear(),
    tx.objectStore("generationManifests").clear(),
    tx.objectStore("generationEvents").clear(),
    tx.objectStore("visualDNARevisions").clear(),
    tx.objectStore("preferenceEvents").clear(),
    tx.objectStore("preferenceSummaryDismissals").clear(),
    tx.objectStore("subjectAssets").clear(),
    tx.objectStore("creationSets").clear(),
    tx.objectStore("performanceTraces").clear(),
    tx.objectStore("analysisCache").clear(),
    tx.objectStore("settings").clear()
  ]);
  await tx.done;
}

export async function clearAllBrowserData(
  options: {
    localStorage?: Pick<typeof chrome.storage.local, "clear">;
    sessionStorage?: Pick<typeof chrome.storage.session, "clear">;
    clearTransientState?: () => Promise<void>;
  } = {}
) {
  const localStorage = options.localStorage ?? chrome.storage.local;
  const sessionStorage = options.sessionStorage ?? chrome.storage.session;
  const clearTransientState = options.clearTransientState ?? (async () => {
    const response = await chrome.runtime.sendMessage({ type: "privacy.clear-transient" }) as { ok?: boolean } | undefined;
    if (!response?.ok) throw new Error("无法清理后台捕获状态");
  });
  await Promise.all([
    clearAllData(),
    localStorage.clear(),
    sessionStorage.clear(),
    clearTransientState()
  ]);
  return { indexedDB: "cleared", localStorage: "cleared", sessionStorage: "cleared", transientState: "cleared" } as const;
}

export function summarizeDataClearResult(result: {
  browser: "cleared" | "failed";
  host: "cleared" | "failed" | "skipped";
}) {
  if (result.browser === "cleared" && result.host === "cleared") {
    return { complete: true, message: "浏览器与本地连接数据已清空" };
  }
  if (result.browser === "cleared" && result.host === "failed") {
    return { complete: false, message: "浏览器数据已清空；本地连接数据未清空，请重新连接后重试" };
  }
  if (result.browser === "cleared") {
    return { complete: false, message: "浏览器数据已清空；测试预览未连接本地组件" };
  }
  if (result.host === "cleared") {
    return { complete: false, message: "本地连接数据已清空；浏览器数据未完全清空，请重试" };
  }
  return { complete: false, message: "浏览器与本地连接数据均未完全清空，请重试" };
}
