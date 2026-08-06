import { describe, expect, it } from "vitest";
import * as nativeClient from "../../apps/extension/lib/native-client";

type CollectGeneratedOutputs = <T>(options: {
  count: number;
  requestBatch: (count: number) => Promise<T[]>;
  maxAttempts?: number;
}) => Promise<T[]>;

const collectGeneratedOutputs = (nativeClient as Record<string, unknown>)
  .collectGeneratedOutputs as CollectGeneratedOutputs | undefined;

describe("Native 生成数量补齐", () => {
  it("按 Host 实际返回数继续请求，直到补齐用户要求数量", async () => {
    expect(collectGeneratedOutputs).toBeTypeOf("function");
    if (!collectGeneratedOutputs) return;
    const requested: number[] = [];
    const outputs = await collectGeneratedOutputs({
      count: 4,
      requestBatch: async (count) => {
        requested.push(count);
        return [`output-${requested.length}`];
      }
    });
    expect(requested).toEqual([2, 2, 2, 1]);
    expect(outputs).toEqual(["output-1", "output-2", "output-3", "output-4"]);
  });

  it("有界补齐后仍不足时明确报告缺少数量", async () => {
    expect(collectGeneratedOutputs).toBeTypeOf("function");
    if (!collectGeneratedOutputs) return;
    let attempts = 0;
    await expect(collectGeneratedOutputs({
      count: 3,
      maxAttempts: 2,
      requestBatch: async () => {
        attempts += 1;
        return attempts === 1 ? ["only-output"] : [];
      }
    })).rejects.toMatchObject({
      message: "生成结果缺少 2 张，请重试。",
      partialOutputs: ["only-output"],
      missing: 2
    });
    expect(attempts).toBe(2);
  });

  it("Host 返回空批次时立即停止，不继续空耗模型调用", async () => {
    let attempts = 0;
    await expect(collectGeneratedOutputs({
      count: 4,
      requestBatch: async () => {
        attempts += 1;
        return [];
      }
    })).rejects.toMatchObject({ missing: 4, partialOutputs: [] });
    expect(attempts).toBe(1);
  });

  it("同一批下载到一半失败时，合并此前批次和本批已下载结果", async () => {
    let attempts = 0;
    await expect(collectGeneratedOutputs({
      count: 4,
      requestBatch: async () => {
        attempts += 1;
        if (attempts === 1) return ["first-batch"];
        throw new nativeClient.NativeGenerationIncompleteError(["second-batch-first"], 1);
      }
    })).rejects.toMatchObject({
      partialOutputs: ["first-batch", "second-batch-first"],
      missing: 2
    });
  });

  it("上传前拒绝超过统一上限的引用，不产生临时 Host 资产", () => {
    expect(nativeClient.assertGenerationReferenceCount).toBeTypeOf("function");
    expect(() => nativeClient.assertGenerationReferenceCount(8)).not.toThrow();
    expect(() => nativeClient.assertGenerationReferenceCount(9)).toThrow("最多使用 8 个参考输入");
  });
});
