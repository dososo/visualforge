import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lstat, mkdir, mkdtemp, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AssetStore } from "../../apps/native-host/src/asset-store";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("Native Host 文件边界", () => {
  it("上传完成的参考图可以从已校验内存字节读取描述符", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "visualforge-upload-read-"));
    const store = new AssetStore(path.join(base, "temp"));
    const sha256 = createHash("sha256").update(png).digest("hex");
    store.start({
      assetId: "reference-input",
      mimeType: "image/png",
      byteLength: png.byteLength,
      chunkCount: 1,
      sha256
    });
    store.writeChunk({ assetId: "reference-input", index: 0, data: png.toString("base64") });
    await store.finish("reference-input");

    await expect(store.readStart("reference-input")).resolves.toMatchObject({
      mimeType: "image/png",
      byteLength: png.byteLength,
      sha256
    });

    await store.release("reference-input");
    await rmdir(path.join(base, "temp"));
    await rmdir(base);
  });

  it("拒绝输出目录中的符号链接和目录外文件", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "styleforge-security-"));
    const outputDir = path.join(base, "output");
    const outside = path.join(base, "outside.png");
    const link = path.join(outputDir, "linked.png");
    await mkdir(outputDir);
    await writeFile(outside, png);
    await symlink(outside, link);
    const store = new AssetStore(path.join(base, "temp"));

    await expect(store.registerPath(link, outputDir)).rejects.toThrow(/符号链接/);

    await unlink(link);
    await unlink(outside);
    await rmdir(outputDir);
    await rmdir(base);
  });

  it("最后一个分块读取完成后删除已登记输出文件", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "styleforge-release-"));
    const outputDir = path.join(base, "output");
    const filePath = path.join(outputDir, "result.png");
    await mkdir(outputDir);
    await writeFile(filePath, png);
    const store = new AssetStore(path.join(base, "temp"));
    const assetId = await store.registerPath(filePath, outputDir);
    const descriptor = await store.readStart(assetId);

    await store.readChunk(assetId, descriptor.chunkCount - 1);
    await expect(lstat(filePath)).rejects.toMatchObject({ code: "ENOENT" });

    await rmdir(outputDir);
    await rmdir(base);
  });

  it("输出登记后只读取一次文件并从内存分块", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "styleforge-read-once-"));
    const outputDir = path.join(base, "output");
    const filePath = path.join(outputDir, "result.png");
    await mkdir(outputDir);
    await writeFile(filePath, Buffer.concat([png, Buffer.alloc(512 * 1024, 7)]));
    const store = new AssetStore(path.join(base, "temp"));
    const assetId = await store.registerPath(filePath, outputDir);
    await writeFile(filePath, Buffer.concat([png, Buffer.alloc(512 * 1024, 9)]));
    const descriptor = await store.readStart(assetId);

    await unlink(filePath);
    const chunks = [];
    for (let index = 0; index < descriptor.chunkCount; index += 1) {
      chunks.push(Buffer.from(await store.readChunk(assetId, index), "base64"));
    }

    expect(Buffer.concat(chunks)).toEqual(Buffer.concat([png, Buffer.alloc(512 * 1024, 7)]));
    await rmdir(outputDir);
    await rmdir(base);
  }, 15_000);

  it("主动清除临时数据时同步丢弃内存中的待传输与已登记资产", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "visualforge-store-purge-"));
    const outputDir = path.join(base, "output");
    const filePath = path.join(outputDir, "result.png");
    await mkdir(outputDir);
    await writeFile(filePath, png);
    const store = new AssetStore(path.join(base, "temp"));
    const assetId = await store.registerPath(filePath, outputDir);
    store.start({
      assetId: "pending-asset",
      mimeType: "image/png",
      byteLength: png.byteLength,
      chunkCount: 1,
      sha256: "a".repeat(64)
    });

    const clearTransientState = (store as unknown as {
      clearTransientState?: () => { pendingAssets: number; completedAssets: number };
    }).clearTransientState;
    expect(clearTransientState).toBeTypeOf("function");
    if (!clearTransientState) return;
    expect(clearTransientState.call(store)).toEqual({ pendingAssets: 1, completedAssets: 1 });
    expect(() => store.getPath(assetId)).toThrow("尚未传输完成");

    await unlink(filePath);
    await rmdir(outputDir);
    await rmdir(base);
  });
});
