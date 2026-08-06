import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import { generationManifestSchema } from "@styleforge/contracts";
import * as core from "@styleforge/core";
import visualDNAExample from "../../packages/contracts/examples/visual-dna-v1.example.json";

describe("GenerationEvent", () => {
  it("校验单张输出的完整生成溯源", () => {
    const schema = (contracts as Record<string, unknown>).generationEventSchema as {
      parse: (input: unknown) => unknown;
      safeParse: (input: unknown) => { success: boolean };
    } | undefined;
    expect(schema).toBeDefined();
    if (!schema) return;

    const event = {
      schemaVersion: "1.0.0",
      id: "event-1",
      projectId: "project-1",
      generationManifestId: "manifest-1",
      parentGenerationId: null,
      sourceAssetId: "source-1",
      visualDNAId: "a".repeat(64),
      visualDNASchemaVersion: "1.0.0",
      dnaRevision: 2,
      prompt: "最终实际发送的 Prompt",
      promptCompilerVersion: "visual-prompt-v1",
      model: {
        provider: "codex",
        name: "imagegen",
        version: null
      },
      parameters: {
        aspectRatio: "4:3",
        count: 1,
        userInstruction: "生成商品摄影",
        providerParameters: {}
      },
      outputAssetId: "output-1",
      outputHash: "b".repeat(64),
      createdAt: 1000
    };

    expect(schema.parse(event)).toEqual(event);
    expect(schema.safeParse({ ...event, outputHash: "bad-hash" }).success).toBe(false);
    expect(schema.safeParse({ ...event, dnaRevision: 0 }).success).toBe(false);
  });

  it("从一次生成清单为每张输出创建可追溯事件", () => {
    const create = (core as Record<string, unknown>).createGenerationEvents;
    expect(create).toBeTypeOf("function");
    if (typeof create !== "function") return;

    const manifest = generationManifestSchema.parse({
      schemaVersion: "1.0.0",
      id: "manifest-2",
      projectId: "project-2",
      taskId: "task-2",
      createdAt: 100,
      completedAt: 200,
      source: {
        assetId: "source-2",
        hash: "a".repeat(64),
        mimeType: "image/png",
        file: { storage: "indexeddb", key: "source-2", name: "source.png" }
      },
      visualDNA: {
        schemaVersion: "1.1.0",
        revision: 3,
        hash: "b".repeat(64),
        snapshot: visualDNAExample
      },
      prompt: { compilerVersion: "visual-prompt-v2", text: "实际 Prompt" },
      model: { provider: "mock", name: "styleforge-mock", version: "1" },
      parameters: {
        aspectRatio: "4:3",
        count: 2,
        userInstruction: "",
        providerParameters: {}
      },
      outputs: [
        {
          assetId: "output-1",
          hash: "c".repeat(64),
          mimeType: "image/png",
          byteLength: 100,
          file: { storage: "indexeddb", key: "output-1", name: "one.png" }
        },
        {
          assetId: "output-2",
          hash: "d".repeat(64),
          mimeType: "image/png",
          byteLength: 100,
          file: { storage: "indexeddb", key: "output-2", name: "two.png" }
        }
      ]
    });

    const events = create(manifest, {
      ids: ["event-1", "event-2"],
      parentGenerationId: "parent-event"
    });
    expect(events).toHaveLength(2);
    expect(events.map((event: { outputAssetId: string }) => event.outputAssetId)).toEqual(["output-1", "output-2"]);
    expect(events.every((event: { parentGenerationId: string | null }) => event.parentGenerationId === "parent-event")).toBe(true);
    expect(events[0].visualDNAId).toBe(manifest.visualDNA.hash);
    expect(events[0].visualDNASchemaVersion).toBe("1.1.0");
  });
});
