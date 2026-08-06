import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import { createGenerationEvents, createGenerationManifest } from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Generation Manifest", () => {
  it("校验从输入到 IndexedDB 输出文件的完整追溯链", () => {
    const schema = (contracts as Record<string, unknown>).generationManifestSchema as {
      parse: (input: unknown) => unknown;
      safeParse: (input: unknown) => { success: boolean };
    } | undefined;
    expect(schema).toBeDefined();

    const manifest = {
      schemaVersion: "1.0.0",
      id: "manifest-1",
      projectId: "project-1",
      taskId: "task-1",
      createdAt: 1000,
      completedAt: 2000,
      source: {
        assetId: "source-1",
        hash: "a".repeat(64),
        mimeType: "image/png",
        file: { storage: "indexeddb", key: "source-1", name: "source.png" }
      },
      visualDNA: {
        schemaVersion: "1.1.0",
        revision: 1,
        hash: "b".repeat(64),
        snapshot: dna
      },
      prompt: {
        compilerVersion: "visual-prompt-v2",
        text: "最终实际发送的提示词"
      },
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
      outputs: [{
        assetId: "output-1",
        hash: "c".repeat(64),
        mimeType: "image/png",
        byteLength: 1024,
        file: { storage: "indexeddb", key: "output-1", name: "styleforge-output-1.png" }
      }]
    };

    expect(schema?.parse(manifest)).toEqual(manifest);
    expect(schema?.safeParse({
      ...manifest,
      outputs: [{ ...manifest.outputs[0], hash: "not-a-hash" }]
    }).success).toBe(false);
    expect(schema?.safeParse({
      ...manifest,
      parameters: { ...manifest.parameters, count: 2 }
    }).success).toBe(false);

    expect(schema?.safeParse({
      ...manifest,
      parameters: {
        ...manifest.parameters,
        count: 4,
        providerParameters: {
          requestedCount: 4,
          receivedCount: 1,
          missingCount: 3,
          partialGeneration: true
        }
      }
    }).success).toBe(true);

    expect(schema?.safeParse({
      ...manifest,
      parameters: {
        ...manifest.parameters,
        count: 4,
        providerParameters: {
          requestedCount: 4,
          receivedCount: 2,
          missingCount: 2,
          partialGeneration: true
        }
      }
    }).success).toBe(false);

    expect(schema?.safeParse({
      ...manifest,
      parameters: { ...manifest.parameters, count: 1 },
      outputs: [
        manifest.outputs[0],
        {
          ...manifest.outputs[0],
          assetId: "unexpected-output-2",
          file: {
            ...manifest.outputs[0].file,
            key: "unexpected-output-2",
            name: "unexpected-output-2.png"
          }
        }
      ]
    }).success).toBe(false);

    const partialOutputs = [1, 2, 3].map((index) => ({
      ...manifest.outputs[0],
      assetId: `partial-output-${index}`,
      file: {
        ...manifest.outputs[0].file,
        key: `partial-output-${index}`,
        name: `partial-output-${index}.png`
      }
    }));
    expect(schema?.safeParse({
      ...manifest,
      parameters: { ...manifest.parameters, count: 3 },
      outputs: partialOutputs
    }).success).toBe(true);
  });

  it("部分生成保留原始请求数量，并把实际收到与缺失数量写入 Manifest 和 Event", async () => {
    const manifest = await createGenerationManifest({
      id: "manifest-partial",
      projectId: "project-partial",
      taskId: "task-partial",
      createdAt: 1000,
      completedAt: 2000,
      source: {
        assetId: "source-partial",
        hash: "a".repeat(64),
        mimeType: "image/png",
        fileName: "source.png"
      },
      visualDNA: dna,
      prompt: "生成四张，但本次只返回一张",
      model: { provider: "codex", name: "imagegen", version: null },
      parameters: {
        aspectRatio: "4:3",
        count: 4,
        userInstruction: "生成四张",
        providerParameters: {}
      },
      outputs: [{
        assetId: "output-partial-1",
        hash: "c".repeat(64),
        mimeType: "image/png",
        byteLength: 1024,
        fileName: "output-partial-1.png"
      }]
    });

    expect(manifest.parameters).toMatchObject({
      count: 4,
      providerParameters: {
        requestedCount: 4,
        receivedCount: 1,
        missingCount: 3,
        partialGeneration: true
      }
    });
    expect(manifest.outputs).toHaveLength(1);

    const [event] = createGenerationEvents(manifest, {
      ids: ["event-partial-1"],
      parentGenerationId: null
    });
    expect(event?.parameters).toEqual(manifest.parameters);
    expect(event?.parameters.count).toBe(4);
    expect(event?.parameters.providerParameters).toMatchObject({
      requestedCount: 4,
      receivedCount: 1,
      missingCount: 3,
      partialGeneration: true
    });
  });
});
