import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveSupportDirectory } from "./support-paths.js";

interface PendingAsset {
  mimeType: string;
  byteLength: number;
  chunkCount: number;
  sha256: string;
  chunks: Array<Buffer | undefined>;
}

export class AssetStore {
  private pending = new Map<string, PendingAsset>();
  private completed = new Map<string, string>();
  private readableBytes = new Map<string, Buffer>();

  constructor(private tempDir = path.join(resolveSupportDirectory(), "temp")) {}

  clearTransientState() {
    const result = {
      pendingAssets: this.pending.size,
      completedAssets: this.completed.size
    };
    this.pending.clear();
    this.completed.clear();
    this.readableBytes.clear();
    return result;
  }

  start(input: { assetId: string; mimeType: string; byteLength: number; chunkCount: number; sha256: string }) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(input.assetId)) throw new Error("assetId 格式无效");
    if (!["image/png", "image/jpeg", "image/webp"].includes(input.mimeType)) throw new Error("图片格式不支持");
    if (input.byteLength < 1 || input.byteLength > 20 * 1024 * 1024) throw new Error("图片大小无效");
    if (input.chunkCount < 1 || input.chunkCount > 100) throw new Error("图片分块数量无效");
    this.pending.set(input.assetId, { ...input, chunks: new Array(input.chunkCount) });
  }

  writeChunk(input: { assetId: string; index: number; data: string }) {
    const pending = this.pending.get(input.assetId);
    if (!pending) throw new Error("图片传输尚未开始");
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= pending.chunkCount) throw new Error("图片分块序号无效");
    const chunk = Buffer.from(input.data, "base64");
    if (chunk.byteLength > 384 * 1024) throw new Error("图片分块超过 384KB");
    pending.chunks[input.index] = chunk;
  }

  async finish(assetId: string) {
    const pending = this.pending.get(assetId);
    if (!pending || pending.chunks.some((chunk) => !chunk)) throw new Error("图片分块不完整");
    const bytes = Buffer.concat(pending.chunks as Buffer[]);
    if (bytes.byteLength !== pending.byteLength) throw new Error("图片字节长度校验失败");
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== pending.sha256) throw new Error("图片 SHA-256 校验失败");
    await mkdir(this.tempDir, { recursive: true, mode: 0o700 });
    const extension = pending.mimeType === "image/png" ? "png" : pending.mimeType === "image/webp" ? "webp" : "jpg";
    const filePath = path.join(this.tempDir, `${randomUUID()}.${extension}`);
    await writeFile(filePath, bytes, { mode: 0o600 });
    this.pending.delete(assetId);
    this.completed.set(assetId, filePath);
    this.readableBytes.set(assetId, bytes);
    return filePath;
  }

  getPath(assetId: string) {
    const filePath = this.completed.get(assetId);
    if (!filePath) throw new Error("图片尚未传输完成");
    return filePath;
  }

  async registerPath(filePath: string, allowedRoot: string) {
    const linkInfo = await lstat(filePath);
    if (linkInfo.isSymbolicLink()) throw new Error("生成结果不能是符号链接");
    if (!linkInfo.isFile()) throw new Error("生成结果不是普通文件");
    if (linkInfo.size < 1 || linkInfo.size > 20 * 1024 * 1024) throw new Error("生成结果大小无效");
    const [resolvedFile, resolvedRoot] = await Promise.all([realpath(filePath), realpath(allowedRoot)]);
    if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("生成结果超出任务目录");
    const handle = await open(resolvedFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes!: Buffer;
    try {
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile()) throw new Error("生成结果不是普通文件");
      if (openedInfo.size < 1 || openedInfo.size > 20 * 1024 * 1024) throw new Error("生成结果大小无效");
      bytes = await handle.readFile();
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
    const header = bytes.subarray(0, 12);
    const isPng = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isWebp = header.subarray(0, 4).toString("ascii") === "RIFF"
      && header.subarray(8, 12).toString("ascii") === "WEBP";
    if (!isPng && !isJpeg && !isWebp) throw new Error("生成结果不是受支持的图片");
    const assetId = randomUUID();
    this.completed.set(assetId, resolvedFile);
    this.readableBytes.set(assetId, bytes);
    return assetId;
  }

  async release(assetId: string) {
    const filePath = this.completed.get(assetId);
    this.completed.delete(assetId);
    this.readableBytes.delete(assetId);
    if (!filePath) return;
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  async readStart(assetId: string) {
    const filePath = this.getPath(assetId);
    const bytes = this.readableBytes.get(assetId);
    if (!bytes) throw new Error("图片尚未完成安全登记");
    const extension = path.extname(filePath).toLowerCase();
    return {
      assetId,
      mimeType: extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png",
      byteLength: bytes.length,
      chunkSize: 384 * 1024,
      chunkCount: Math.ceil(bytes.length / (384 * 1024)),
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  }

  async readChunk(assetId: string, index: number) {
    this.getPath(assetId);
    const bytes = this.readableBytes.get(assetId);
    if (!bytes) throw new Error("图片尚未完成安全登记");
    const chunkSize = 384 * 1024;
    const chunkCount = Math.ceil(bytes.length / chunkSize);
    if (!Number.isInteger(index) || index < 0 || index >= chunkCount) throw new Error("输出图片分块序号无效");
    const result = bytes.subarray(index * chunkSize, Math.min((index + 1) * chunkSize, bytes.length)).toString("base64");
    if (index === chunkCount - 1) await this.release(assetId);
    return result;
  }
}
