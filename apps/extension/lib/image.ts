import type { AssetRecord, AssetRole } from "@styleforge/contracts";

const allowed = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_DECODED_IMAGE_PIXELS = 36_000_000;
export const MAX_DECODED_IMAGE_EDGE = 12_000;
const IMAGE_HEADER_READ_BYTES = 20 * 1024 * 1024;

export function assertDecodedImageSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("无法确认图片像素尺寸，请选择其他图片。");
  }
  if (Math.max(width, height) > MAX_DECODED_IMAGE_EDGE) {
    throw new Error(`图片最长边超过 ${MAX_DECODED_IMAGE_EDGE}px，请先缩小图片后重试。`);
  }
  if (width * height > MAX_DECODED_IMAGE_PIXELS) {
    throw new Error(`图片解码像素超过 ${MAX_DECODED_IMAGE_PIXELS.toLocaleString("zh-CN")}，请先缩小图片后重试。`);
  }
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= bytes.length) break;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) break;
    if (sofMarkers.has(marker) && length >= 7) {
      return {
        height: (bytes[offset + 3]! << 8) | bytes[offset + 4]!,
        width: (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array, blobSize: number) {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (bytes.length < 25 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffSize = view.getUint32(4, true) + 8;
  const chunkSize = view.getUint32(16, true);
  if (riffSize > blobSize || chunkSize + 20 > blobSize) return null;
  const chunk = ascii(12, 4);
  if (chunk === "VP8X" && chunkSize >= 10 && bytes.length >= 30) {
    return {
      width: 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16),
      height: 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16)
    };
  }
  if (chunk === "VP8 " && chunkSize >= 10 && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26]! | (bytes[27]! << 8)) & 0x3fff,
      height: (bytes[28]! | (bytes[29]! << 8)) & 0x3fff
    };
  }
  if (chunk === "VP8L" && chunkSize >= 5 && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff)
    };
  }
  return null;
}

export async function readEncodedImageDimensions(blob: Blob) {
  const bytes = new Uint8Array(await blob.slice(0, IMAGE_HEADER_READ_BYTES).arrayBuffer());
  if (blob.type === "image/png" && bytes.length >= 24 &&
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 &&
    bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 13 &&
    bytes[12] === 73 && bytes[13] === 72 && bytes[14] === 68 && bytes[15] === 82) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  const dimensions = blob.type === "image/jpeg" ? jpegDimensions(bytes)
    : blob.type === "image/webp" ? webpDimensions(bytes, blob.size)
      : null;
  if (!dimensions) throw new Error("图片文件头无效或不受支持，请重新导出图片后重试。");
  return dimensions;
}

export async function assertEncodedImageSize(blob: Blob) {
  const dimensions = await readEncodedImageDimensions(blob);
  assertDecodedImageSize(dimensions.width, dimensions.height);
  return dimensions;
}

async function decode(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

async function resize(blob: Blob, maxEdge: number, type: string) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建图片处理画布");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: type === "image/jpeg" ? "image/jpeg" : "image/png", quality: 0.9 });
}

export async function normalizeImage(
  blob: Blob,
  role: AssetRole,
  source: AssetRecord["source"],
  minimumEdge = 256
): Promise<AssetRecord> {
  if (!allowed.includes(blob.type as typeof allowed[number])) throw new Error("仅支持 PNG、JPEG 和 WebP 图片。");
  if (blob.size > 20 * 1024 * 1024) throw new Error("图片超过 20MB，请选择更小的文件。");
  await assertEncodedImageSize(blob);
  const { width, height } = await decode(blob);
  assertDecodedImageSize(width, height);
  if (Math.min(width, height) < minimumEdge) throw new Error(`图片最短边需要至少 ${minimumEdge}px。`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    id: crypto.randomUUID(),
    hash,
    role,
    mimeType: blob.type as AssetRecord["mimeType"],
    width,
    height,
    byteLength: blob.size,
    blob,
    thumbnailBlob: await resize(blob, 512, blob.type),
    source,
    createdAt: Date.now()
  };
}

export async function createMockResult(reference: Blob, ratio: string, index: number) {
  const sizes: Record<string, [number, number]> = {
    "1:1": [1024, 1024], "4:3": [1200, 900], "3:4": [900, 1200], "16:9": [1280, 720], "9:16": [720, 1280]
  };
  const [width, height] = sizes[ratio] ?? sizes["4:3"]!;
  const bitmap = await createImageBitmap(reference);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法生成预览");
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const sw = width / scale;
  const sh = height / scale;
  ctx.filter = `saturate(${0.72 + index * 0.08}) contrast(0.94)`;
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, width, height);
  bitmap.close();
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(231,239,236,.10)");
  gradient.addColorStop(1, "rgba(49,95,82,.22)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,.82)";
  ctx.font = `600 ${Math.round(width * .025)}px system-ui`;
  ctx.fillText(`VisualForge · 离线预览 ${index + 1}`, width * .04, height * .94);
  return canvas.convertToBlob({ type: "image/png" });
}

export async function cropScreenshot(dataUrl: string, rect: { x: number; y: number; width: number; height: number; dpr: number }) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const x = Math.max(0, Math.round(rect.x * rect.dpr));
  const y = Math.max(0, Math.round(rect.y * rect.dpr));
  const width = Math.min(bitmap.width - x, Math.round(rect.width * rect.dpr));
  const height = Math.min(bitmap.height - y, Math.round(rect.height * rect.dpr));
  if (width < 1 || height < 1) throw new Error("截图区域不在当前可见页面内。");
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建截图画布");
  context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

export async function imageDifferenceSignature(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(9, 8);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法读取图片差异");
  context.drawImage(bitmap, 0, 0, 9, 8);
  bitmap.close();
  const pixels = context.getImageData(0, 0, 9, 8).data;
  const gray = Array.from({ length: 72 }, (_, index) => {
    const offset = index * 4;
    return Math.round(pixels[offset]! * 0.299 + pixels[offset + 1]! * 0.587 + pixels[offset + 2]! * 0.114);
  });
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += gray[row * 9 + column]! > gray[row * 9 + column + 1]! ? "1" : "0";
    }
  }
  let hash = "";
  for (let index = 0; index < bits.length; index += 4) {
    hash += Number.parseInt(bits.slice(index, index + 4), 2).toString(16);
  }
  return { hash, gray };
}

export function normalizedImageDifference(left: number[], right: number[]) {
  if (left.length !== right.length || !left.length) throw new Error("归一化图片尺寸必须一致");
  return left.reduce((sum, value, index) => sum + Math.abs(value - right[index]!), 0) / (left.length * 255);
}
