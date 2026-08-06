import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import type {
  CreationSet,
  GenerationEvent,
  PreferenceEvent,
  PreferenceSummaryDismissal,
  ProjectRecord,
  SubjectAsset,
  TaskRecord
} from "@styleforge/contracts";
import { createCreationSetPlan, createMigrationDomainProfile } from "@styleforge/core";
import * as db from "../../apps/extension/lib/db";
import { dna } from "./contracts.test";

const ids = {
  validSet: "integrity-valid-set",
  invalidSet: "integrity-invalid-set",
  validTask: "integrity-valid-task",
  invalidTask: "integrity-invalid-task",
  validEvent: "integrity-valid-event",
  invalidEvent: "integrity-invalid-event",
  invalidProject: "integrity-invalid-project",
  invalidSubject: "integrity-invalid-subject",
  invalidPreference: "integrity-invalid-preference",
  invalidDismissal: "integrity-invalid-dismissal"
} as const;

const validSet: CreationSet = {
  schemaVersion: "1.0.0",
  id: ids.validSet,
  projectId: "integrity-project",
  title: "可恢复套图",
  domainProfile: createMigrationDomainProfile(),
  requestedCount: 2,
  userIntent: "验证坏记录隔离",
  sharedVisualDNARevision: 1,
  sharedVisualDNASnapshot: dna,
  sharedReferenceSnapshots: [],
  subjectAssetSnapshots: [],
  sourceGenerationEventId: null,
  sharedInvariants: ["保留有效记录"],
  allowedVariations: ["机位"],
  status: "READY",
  completedCount: 0,
  failedCount: 0,
  createdAt: 1,
  updatedAt: 10,
  qualityReport: null,
  planItems: createCreationSetPlan("photography", 2)
};

const validTask: TaskRecord = {
  schemaVersion: "1.0.0",
  taskId: ids.validTask,
  projectId: "integrity-project",
  retryOfTaskId: null,
  generationEventId: null,
  generationEventIds: [],
  operation: "GENERATION",
  status: "FAILED",
  startedAt: 1,
  finishedAt: 2,
  retryCount: 0,
  error: { code: "TEST_FAILURE", message: "可重试任务", retryable: true },
  heartbeat: 2,
  input: {
    sourceAssetId: "integrity-source",
    visualDNA: null,
    prompt: "保留有效任务",
    parameters: {
      aspectRatio: "3:4",
      count: 1,
      userInstruction: "",
      providerParameters: {}
    },
    parentGenerationId: null
  }
};

const validEvent: GenerationEvent = {
  schemaVersion: "1.0.0",
  id: ids.validEvent,
  projectId: "integrity-project",
  generationManifestId: "integrity-manifest",
  parentGenerationId: null,
  sourceAssetId: "integrity-source",
  visualDNAId: "a".repeat(64),
  visualDNASchemaVersion: "1.1.0",
  dnaRevision: 1,
  prompt: "保留有效生成事件",
  promptCompilerVersion: "visual-prompt-v4",
  model: { provider: "mock", name: "styleforge-mock", version: "1" },
  parameters: {
    aspectRatio: "3:4",
    count: 1,
    userInstruction: "",
    providerParameters: {}
  },
  outputAssetId: "integrity-output",
  outputHash: "b".repeat(64),
  createdAt: 3
};

async function removeFixtures() {
  const database = await db.openVisualForgeDB();
  const transaction = database.transaction(
    [
      "creationSets", "taskRecords", "generationEvents", "tasks", "projects",
      "subjectAssets", "preferenceEvents", "preferenceSummaryDismissals"
    ],
    "readwrite"
  );
  await Promise.all([
    transaction.objectStore("creationSets").delete(ids.validSet),
    transaction.objectStore("creationSets").delete(ids.invalidSet),
    transaction.objectStore("taskRecords").delete(ids.validTask),
    transaction.objectStore("taskRecords").delete(ids.invalidTask),
    transaction.objectStore("generationEvents").delete(ids.validEvent),
    transaction.objectStore("generationEvents").delete(ids.invalidEvent),
    transaction.objectStore("projects").delete(ids.invalidProject),
    transaction.objectStore("subjectAssets").delete(ids.invalidSubject),
    transaction.objectStore("preferenceEvents").delete(ids.invalidPreference),
    transaction.objectStore("preferenceSummaryDismissals").delete(ids.invalidDismissal),
    transaction.objectStore("tasks").delete(ids.invalidTask),
    transaction.objectStore("projects").delete("integrity-project")
  ]);
  await transaction.done;
}

afterAll(removeFixtures);

describe("启动坏记录隔离", () => {
  it("逐条校验启动会读取的全部关键记录，保留有效记录且不自动删除坏记录", async () => {
    const inspect = (db as Record<string, unknown>).inspectStartupRecordIntegrity;
    expect(inspect).toBeTypeOf("function");
    if (typeof inspect !== "function") return;

    await removeFixtures();
    await db.saveCreationSet(validSet);
    await db.saveTaskRecord(validTask);
    await db.saveGenerationEvents([validEvent]);

    const database = await db.openVisualForgeDB();
    const transaction = database.transaction(
      [
        "creationSets", "taskRecords", "generationEvents", "tasks", "projects",
        "subjectAssets", "preferenceEvents", "preferenceSummaryDismissals"
      ],
      "readwrite"
    );
    await Promise.all([
      transaction.objectStore("creationSets").put({
        id: ids.invalidSet,
        projectId: "integrity-project",
        updatedAt: 11,
        schemaVersion: "broken",
        originalImage: new Blob(["secret-original-image-bytes"])
      } as never),
      transaction.objectStore("taskRecords").put({
        taskId: ids.invalidTask,
        projectId: "integrity-project",
        status: "FAILED",
        heartbeat: 4,
        schemaVersion: "broken",
        input: {}
      } as never),
      transaction.objectStore("generationEvents").put({
        id: ids.invalidEvent,
        projectId: "integrity-project",
        outputAssetId: "integrity-invalid-output",
        createdAt: 5,
        schemaVersion: "broken"
      } as never),
      transaction.objectStore("projects").put({
        id: ids.invalidProject,
        title: "损坏项目",
        mode: "direct",
        referenceAssetIds: null,
        outputAssetIds: null,
        userInstruction: "",
        aspectRatio: "3:4",
        count: 1,
        provider: "mock",
        favorite: false,
        createdAt: 1,
        updatedAt: 2
      } as never),
      transaction.objectStore("subjectAssets").put({
        schemaVersion: "1.0.0",
        id: ids.invalidSubject,
        name: "损坏人物卡",
        type: "person",
        imageIds: null,
        primaryImageId: "missing",
        qualityReport: null,
        createdAt: 1,
        updatedAt: 2
      } as never),
      transaction.objectStore("preferenceEvents").put({
        schemaVersion: "broken",
        id: ids.invalidPreference,
        projectId: "integrity-project",
        dimension: "composition",
        createdAt: 2
      } as never),
      transaction.objectStore("preferenceSummaryDismissals").put({
        schemaVersion: "broken",
        id: ids.invalidDismissal,
        dimension: "composition",
        field: "shotType",
        dismissedAt: 2
      } as never),
      transaction.objectStore("projects").put({
        id: "integrity-project",
        title: "完整性测试",
        mode: "direct",
        referenceAssetIds: ["integrity-source"],
        outputAssetIds: [],
        userInstruction: "",
        aspectRatio: "3:4",
        count: 1,
        provider: "mock",
        favorite: false,
        createdAt: 1,
        updatedAt: 1
      }),
      transaction.objectStore("tasks").put({
        id: ids.invalidTask,
        projectId: "integrity-project",
        status: "failed",
        stageLabel: "旧任务失败",
        retryCount: 0,
        createdAt: 1,
        updatedAt: 2,
        error: { code: "LEGACY_FAILED", message: "旧任务", retryable: true }
      })
    ]);
    await transaction.done;

    const result = await (inspect as () => Promise<{
      records: {
        creationSets: CreationSet[];
        taskRecords: TaskRecord[];
        generationEvents: GenerationEvent[];
        projects: ProjectRecord[];
        subjectAssets: SubjectAsset[];
        preferenceEvents: PreferenceEvent[];
        preferenceSummaryDismissals: PreferenceSummaryDismissal[];
      };
      issues: Array<{ store: string; recordKey: string }>;
    }>)();

    expect(result.records.creationSets.map((record) => record.id)).toContain(ids.validSet);
    expect(result.records.taskRecords.map((record) => record.taskId)).toContain(ids.validTask);
    expect(result.records.generationEvents.map((record) => record.id)).toContain(ids.validEvent);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ store: "creationSets", recordKey: ids.invalidSet }),
      expect.objectContaining({ store: "taskRecords", recordKey: ids.invalidTask }),
      expect.objectContaining({ store: "generationEvents", recordKey: ids.invalidEvent }),
      expect.objectContaining({ store: "projects", recordKey: ids.invalidProject }),
      expect.objectContaining({ store: "subjectAssets", recordKey: ids.invalidSubject }),
      expect.objectContaining({ store: "preferenceEvents", recordKey: ids.invalidPreference }),
      expect.objectContaining({ store: "preferenceSummaryDismissals", recordKey: ids.invalidDismissal })
    ]));
    expect(result.issues).toHaveLength(7);

    await expect(db.recoverInterruptedTaskRecords()).resolves.toBeDefined();
    await expect(db.listRetryableTaskRecords()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: ids.validTask })])
    );
    await expect(db.reconcileCreationSets()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.validSet })])
    );
    await expect(db.listGenerationEvents("integrity-project")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.validEvent })])
    );
    await expect(db.listProjects()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.invalidProject })])
    );
    await expect(db.listSubjectAssets()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.invalidSubject })])
    );
    await expect(db.listPreferenceEvents()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.invalidPreference })])
    );
    await expect(db.listPreferenceSummaryDismissals()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.invalidDismissal })])
    );

    expect(await database.get("creationSets", ids.invalidSet)).toBeDefined();
    expect(await database.get("taskRecords", ids.invalidTask)).toMatchObject({ schemaVersion: "broken" });
    expect(await database.get("generationEvents", ids.invalidEvent)).toBeDefined();
    expect(await database.get("projects", ids.invalidProject)).toBeDefined();
    expect(await database.get("subjectAssets", ids.invalidSubject)).toBeDefined();
    expect(await database.get("preferenceEvents", ids.invalidPreference)).toBeDefined();
    expect(await database.get("preferenceSummaryDismissals", ids.invalidDismissal)).toBeDefined();
  });

  it("诊断 JSON 只记录结构错误，不包含记录正文或图片字节", async () => {
    const buildDiagnostic = (db as Record<string, unknown>).createIntegrityDiagnostic;
    expect(buildDiagnostic).toBeTypeOf("function");
    if (typeof buildDiagnostic !== "function") return;

    const diagnostic = (buildDiagnostic as (
      issues: Array<Record<string, unknown>>,
      options: { appVersion: string; generatedAt: number }
    ) => unknown)([{
      store: "creationSets",
      recordKey: ids.invalidSet,
      code: "SCHEMA_INVALID",
      fields: ["schemaVersion", "planItems"],
      summary: "记录结构不符合当前版本"
    }], { appVersion: "0.5.1", generatedAt: 100 });
    const json = JSON.stringify(diagnostic);

    expect(json).toContain(ids.invalidSet);
    expect(json).toContain("creationSets");
    expect(json).not.toContain("secret-original-image-bytes");
    expect(json).not.toContain("originalImage");
    expect(json).not.toContain("data:image");
    expect(json).not.toContain("blob");
  });

  it("App 提供可见隔离提示、诊断下载、重试和设置清理入口", async () => {
    const source = await readFile(
      new URL("../../apps/extension/entrypoints/sidepanel/App.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("已隔离 {integrityIssues.length} 条异常记录");
    expect(source).toContain("下载诊断 JSON");
    expect(source).toContain("重新检查");
    expect(source).toContain("打开数据与隐私设置");
  });
});
