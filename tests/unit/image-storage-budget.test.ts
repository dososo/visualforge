import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "@styleforge/contracts";
import * as imageModule from "../../apps/extension/lib/image";
import * as db from "../../apps/extension/lib/db";

type AssertDecodedImageSize = (width: number, height: number) => void;
const assertDecodedImageSize = (imageModule as Record<string, unknown>)
  .assertDecodedImageSize as AssertDecodedImageSize | undefined;

const asset = (id: string, bytes: number): AssetRecord => ({
  id,
  hash: id.padEnd(64, "a").slice(0, 64),
  role: "style_layout",
  mimeType: "image/png",
  width: 512,
  height: 512,
  byteLength: bytes,
  blob: new Blob([new Uint8Array(bytes)], { type: "image/png" }),
  thumbnailBlob: new Blob([new Uint8Array(Math.min(bytes, 512))], { type: "image/png" }),
  source: { type: "upload" },
  createdAt: Date.now()
});

describe("图片与本地存储预算", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("拒绝超长边或超过 3600 万解码像素的输入", () => {
    expect(assertDecodedImageSize).toBeTypeOf("function");
    if (!assertDecodedImageSize) return;
    expect(() => assertDecodedImageSize(12_001, 1000)).toThrow(/最长边/);
    expect(() => assertDecodedImageSize(10_000, 4_000)).toThrow(/像素/);
    expect(() => assertDecodedImageSize(6_000, 6_000)).not.toThrow();
  });

  it("在调用浏览器解码器前，从 PNG 文件头拒绝超大像素图片", async () => {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    header.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
    new DataView(header.buffer).setUint32(16, 12_001, false);
    new DataView(header.buffer).setUint32(20, 1_000, false);
    const decoder = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder);

    await expect(imageModule.normalizeImage(
      new Blob([header], { type: "image/png" }),
      "style_layout",
      { type: "upload" }
    )).rejects.toThrow(/最长边/);
    expect(decoder).not.toHaveBeenCalled();
  });

  it("能从 JPEG 与 WebP 文件头读取像素尺寸，并拒绝伪造图片", async () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
      0x04, 0x00, 0x06, 0x00, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00
    ]);
    const webp = new Uint8Array(30);
    webp.set(Array.from("RIFF").map((char) => char.charCodeAt(0)), 0);
    webp.set(Array.from("WEBPVP8X").map((char) => char.charCodeAt(0)), 8);
    new DataView(webp.buffer).setUint32(4, 22, true);
    new DataView(webp.buffer).setUint32(16, 10, true);
    webp.set([0xff, 0x03, 0x00], 24);
    webp.set([0xff, 0x02, 0x00], 27);

    await expect(imageModule.readEncodedImageDimensions(
      new Blob([jpeg], { type: "image/jpeg" })
    )).resolves.toEqual({ width: 1536, height: 1024 });
    await expect(imageModule.readEncodedImageDimensions(
      new Blob([webp], { type: "image/webp" })
    )).resolves.toEqual({ width: 1024, height: 768 });
    await expect(imageModule.readEncodedImageDimensions(
      new Blob(["not-an-image"], { type: "image/png" })
    )).rejects.toThrow(/文件头无效/);
  });

  it("保存前空间不足会保留既有原图并给出可理解错误", async () => {
    const existing = asset(`existing-${crypto.randomUUID()}`, 1);
    const incoming = asset(`incoming-${crypto.randomUUID()}`, 2048);
    await db.saveAsset(existing);
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 20 * 1024 * 1024, usage: 19 * 1024 * 1024 })
      }
    });

    await expect(db.saveAsset(incoming)).rejects.toThrow(/本地空间不足.*原图和已有作品不会被删除/);
    expect(await db.getAsset(existing.id)).toEqual(existing);
    expect(await db.getAsset(incoming.id)).toBeUndefined();
  });

  it("批量候选保存先统一预检，失败时不留下前半批孤儿资产", async () => {
    const first = asset(`batch-first-${crypto.randomUUID()}`, 1024);
    const second = asset(`batch-second-${crypto.randomUUID()}`, 1024);
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 17 * 1024 * 1024, usage: 16 * 1024 * 1024 })
      }
    });

    await expect(db.saveAssets([first, second])).rejects.toThrow(/本地空间不足/);
    expect(await db.getAsset(first.id)).toBeUndefined();
    expect(await db.getAsset(second.id)).toBeUndefined();
  });

  it("容量预检使用 Blob 真实字节，不信任偏小的记录字段", async () => {
    const incoming = {
      ...asset(`actual-size-${crypto.randomUUID()}`, 1),
      byteLength: 1,
      blob: new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/png" })
    };
    vi.stubGlobal("navigator", {
      storage: {
        estimate: async () => ({ quota: 17 * 1024 * 1024, usage: 0 })
      }
    });

    await expect(db.saveAsset(incoming)).rejects.toThrow(/本地空间不足/);
    expect(await db.getAsset(incoming.id)).toBeUndefined();
  });
});
