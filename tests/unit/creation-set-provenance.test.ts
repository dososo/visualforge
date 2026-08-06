import { describe, expect, it } from "vitest";
import {
  generationManifestSchema,
  taskRecordSchema
} from "@styleforge/contracts";
import {
  createGenerationEvents,
  createMigrationDomainProfile,
  createRetryTask
} from "@styleforge/core";
import { dna } from "./contracts.test";

const domainProfile = createMigrationDomainProfile();

describe("CreationSet Provenance", () => {
  it("Manifest 到 Event 保留领域、组和计划项快照", () => {
    const manifest = generationManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-set",
      projectId: "project-set",
      taskId: "task-set",
      setId: "set-1",
      planItemId: "item-1",
      domainProfile,
      createdAt: 1,
      completedAt: 2,
      source: {
        assetId: "source",
        hash: "a".repeat(64),
        mimeType: "image/png",
        file: { storage: "indexeddb", key: "source", name: "source.png" }
      },
      visualDNA: {
        schemaVersion: "1.1.0",
        revision: 1,
        hash: "b".repeat(64),
        snapshot: dna
      },
      prompt: { compilerVersion: "visual-prompt-v4", text: "计划项最终 Prompt" },
      model: { provider: "codex", name: "imagegen", version: null },
      parameters: {
        aspectRatio: "4:3",
        count: 1,
        userInstruction: "生成一组",
        providerParameters: {}
      },
      outputs: [{
        assetId: "output",
        hash: "c".repeat(64),
        mimeType: "image/png",
        byteLength: 100,
        file: { storage: "indexeddb", key: "output", name: "output.png" }
      }]
    });
    const [event] = createGenerationEvents(manifest, {
      ids: ["event-set"],
      parentGenerationId: null
    });
    expect(event).toMatchObject({
      setId: "set-1",
      planItemId: "item-1",
      domainProfile,
      prompt: "计划项最终 Prompt"
    });
  });

  it("Task 重试保持相同组、计划项、领域和原始参考快照", () => {
    const task = taskRecordSchema.parse({
      schemaVersion: "1.0.0",
      taskId: "task-1",
      projectId: "project-1",
      retryOfTaskId: null,
      generationEventId: null,
      generationEventIds: [],
      operation: "GENERATION",
      status: "FAILED",
      startedAt: 1,
      finishedAt: 2,
      retryCount: 0,
      error: { code: "FAILED", message: "失败", retryable: true },
      heartbeat: 2,
      input: {
        sourceAssetId: "source",
        references: [],
        visualDNA: dna,
        prompt: "冻结的最终 Prompt",
        parameters: {
          aspectRatio: "4:3",
          count: 1,
          userInstruction: "生成一组",
          providerParameters: {}
        },
        parentGenerationId: null,
        setId: "set-1",
        planItemId: "item-1",
        domainProfile
      }
    });
    const retry = createRetryTask(task, "task-2", 3);
    expect(retry.input).toEqual(task.input);
  });
});
