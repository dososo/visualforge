import { strToU8, zip } from "fflate";
import type { AssetRecord, CreationSet } from "@styleforge/contracts";
import { sha256Hex } from "@styleforge/core";
import { createGridLayout, gridCells, type GridLayout } from "./grid-layout";

export const MAX_CREATION_SET_EXPORT_BYTES = 64 * 1024 * 1024;
export const MAX_CREATION_SET_EXPORT_WORKING_BYTES = 192 * 1024 * 1024;
export const MAX_GRID_COMPOSITE_PIXELS = 16_000_000;
export const MAX_GRID_COMPOSITE_EDGE = 4_096;

export function resolveSourceGridLayout(creationSet: CreationSet): GridLayout | null {
  return creationSet.sourceGridLayout ?? creationSet.gridLayout ?? null;
}

export function resolveCompositeLayout(creationSet: CreationSet): GridLayout | null {
  if (creationSet.deliveryMode === "independent") return null;
  return creationSet.compositeLayout
    ?? creationSet.sourceGridLayout
    ?? creationSet.gridLayout
    ?? createGridLayout(creationSet.requestedCount);
}

export function calculateGridCompositeSize(
  first: Pick<AssetRecord, "width" | "height">,
  layout: Pick<GridLayout, "rows" | "columns">
) {
  const width = 1_800;
  const height = Math.max(1, Math.round((width / layout.columns) / (first.width / first.height) * layout.rows));
  const scale = Math.min(
    1,
    MAX_GRID_COMPOSITE_EDGE / Math.max(width, height),
    Math.sqrt(MAX_GRID_COMPOSITE_PIXELS / (width * height))
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function gridCompositeMemoryBudget(
  assets: AssetRecord[],
  layout: Pick<GridLayout, "rows" | "columns">
) {
  const compositeSize = calculateGridCompositeSize(assets[0]!, layout);
  return {
    sourceBytes: assets.reduce((total, asset) =>
      total + Math.max(asset.byteLength, asset.blob?.size ?? 0), 0),
    largestDecodedBitmapBytes: assets.reduce((largest, asset) =>
      Math.max(largest, asset.width * asset.height * 4), 0),
    compositeWorkingBytes: compositeSize.width * compositeSize.height * 4 * 3
  };
}

function assertGridCompositeBudget(
  assets: AssetRecord[],
  layout: Pick<GridLayout, "rows" | "columns">
) {
  const budget = gridCompositeMemoryBudget(assets, layout);
  const estimatedPeakBytes = budget.sourceBytes +
    budget.largestDecodedBitmapBytes + budget.compositeWorkingBytes;
  if (estimatedPeakBytes > MAX_CREATION_SET_EXPORT_WORKING_BYTES) {
    const actualMB = Math.ceil(estimatedPeakBytes / 1024 / 1024);
    const limitMB = MAX_CREATION_SET_EXPORT_WORKING_BYTES / 1024 / 1024;
    throw new Error(`宫格合成预计占用 ${actualMB}MB 工作内存，超过 ${limitMB}MB 安全上限。请先导出单张，或减少本次导出的画面。`);
  }
}

export function assertCreationSetExportBudget(
  creationSet: CreationSet,
  assets: Map<string, AssetRecord>
) {
  const selectedIds = creationSet.planItems.flatMap((item) => {
    if (item.status !== "COMPLETED") return [];
    const assetId = item.selectedOutputAssetId ?? item.outputAssetId;
    return assetId ? [assetId] : [];
  });
  const selectedAssets = selectedIds.flatMap((assetId) => {
    const asset = assets.get(assetId);
    return asset ? [asset] : [];
  });
  const totalBytes = selectedAssets.reduce((total, asset) =>
    total + Math.max(asset.byteLength, asset.blob?.size ?? 0), 0);
  if (totalBytes > MAX_CREATION_SET_EXPORT_BYTES) {
    const actualMB = Math.ceil(totalBytes / 1024 / 1024);
    const limitMB = MAX_CREATION_SET_EXPORT_BYTES / 1024 / 1024;
    throw new Error(`整组导出预计读取 ${actualMB}MB，超过 ${limitMB}MB 安全上限。请先导出单张，或减少本次导出的画面。`);
  }
  const shouldComposite = creationSet.deliveryMode !== "independent" &&
    selectedAssets.length === creationSet.requestedCount && selectedAssets.length > 0;
  const compositeLayout = resolveCompositeLayout(creationSet);
  const compositeSize = shouldComposite
    ? calculateGridCompositeSize(
      selectedAssets[0]!,
      compositeLayout ?? createGridLayout(creationSet.requestedCount)
    )
    : null;
  const largestDecodedBitmapBytes = shouldComposite
    ? selectedAssets.reduce((largest, asset) =>
      Math.max(largest, asset.width * asset.height * 4), 0)
    : 0;
  const compositeWorkingBytes = compositeSize
    ? compositeSize.width * compositeSize.height * 4 * 3
    : 0;
  const estimatedPeakBytes = totalBytes * 2 + largestDecodedBitmapBytes + compositeWorkingBytes;
  if (estimatedPeakBytes > MAX_CREATION_SET_EXPORT_WORKING_BYTES) {
    const actualMB = Math.ceil(estimatedPeakBytes / 1024 / 1024);
    const limitMB = MAX_CREATION_SET_EXPORT_WORKING_BYTES / 1024 / 1024;
    throw new Error(`整组导出预计占用 ${actualMB}MB 工作内存，超过 ${limitMB}MB 安全上限。请先导出单张，或减少本次导出的画面。`);
  }
}

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60) || "作品";
}

function extension(mimeType: AssetRecord["mimeType"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function createCreationSetZip(
  creationSet: CreationSet,
  assets: Map<string, AssetRecord>
) {
  assertCreationSetExportBudget(creationSet, assets);
  const files: Record<string, Uint8Array> = {};
  const exported: Array<{
    order: number;
    title: string;
    role: string;
    file: string;
    selected: boolean;
    assetId: string;
    generationEventId: string | null;
    outputSha256: string;
    criticDisposition: "checked" | "skipped" | "legacy_unverified";
  }> = [];
  for (const item of creationSet.planItems) {
    const finalAssetId = item.selectedOutputAssetId ?? item.outputAssetId;
    if (item.status !== "COMPLETED" || !finalAssetId) continue;
    const asset = assets.get(finalAssetId);
    if (!asset) continue;
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const actualHash = await sha256Hex(bytes);
    if (item.finalSelection && (
      item.finalSelection.assetId !== asset.id ||
      item.finalSelection.outputSha256 !== actualHash ||
      item.finalSelection.byteLength !== asset.byteLength ||
      asset.hash !== actualHash
    )) {
      throw new Error(`“${item.userFacingTitle}”最终作品文件校验失败，请重新选择或重新生成。`);
    }
    const file = `${String(item.order).padStart(2, "0")}-${safeName(item.userFacingTitle)}.${extension(asset.mimeType)}`;
    files[file] = bytes;
    exported.push({
      order: item.order,
      title: item.userFacingTitle,
      role: item.role,
      file,
      selected: Boolean(item.selectedOutputAssetId),
      assetId: asset.id,
      generationEventId: item.finalSelection?.generationEventId ?? null,
      outputSha256: actualHash,
      criticDisposition: item.finalSelection?.criticDisposition ?? "legacy_unverified"
    });
  }
  if (creationSet.deliveryMode !== "independent" && exported.length === creationSet.requestedCount) {
    const compositeLayout = resolveCompositeLayout(creationSet);
    const grid = await createGridComposite(
      creationSet,
      assets,
      compositeLayout ?? createGridLayout(creationSet.requestedCount)
    );
    files["宫格图.png"] = new Uint8Array(await grid.arrayBuffer());
  }
  files["metadata.json"] = strToU8(JSON.stringify({
    title: creationSet.title,
    domain: creationSet.domainProfile.domain,
    userIntent: creationSet.userIntent,
    createdAt: new Date(creationSet.createdAt).toISOString(),
    exportedCount: exported.length,
    works: exported
  }, null, 2));
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (error, archive) => error ? reject(error) : resolve(archive));
  });
  const archiveBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;
  return new Blob([archiveBuffer as ArrayBuffer], { type: "application/zip" });
}

export async function createGridComposite(
  creationSet: CreationSet,
  assets: Map<string, AssetRecord>,
  layout: GridLayout = resolveCompositeLayout(creationSet) ?? createGridLayout(creationSet.requestedCount),
  mimeType: "image/png" | "image/jpeg" = "image/png"
) {
  const orderedAssets = creationSet.planItems.map((item) =>
    assets.get(item.selectedOutputAssetId ?? item.outputAssetId ?? ""));
  if (orderedAssets.some((asset) => !asset)) throw new Error("宫格图仍有未完成画面，请先生成或修复失败项。");
  const completeAssets = orderedAssets as AssetRecord[];
  assertGridCompositeBudget(completeAssets, layout);
  const first = completeAssets[0]!;
  const compositeSize = calculateGridCompositeSize(first, layout);
  const canvasWidth = compositeSize.width;
  const canvasHeight = compositeSize.height;
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法合成宫格图。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  const gap = Math.max(4, Math.round(canvasWidth * 0.006));
  for (const cell of gridCells(layout)) {
    const asset = completeAssets[cell.index];
    if (!asset) continue;
    const bitmap = await createImageBitmap(asset.blob);
    try {
      const left = Math.round(cell.left * canvasWidth) + gap / 2;
      const top = Math.round(cell.top * canvasHeight) + gap / 2;
      const width = Math.round(cell.width * canvasWidth) - gap;
      const height = Math.round(cell.height * canvasHeight) - gap;
      const scale = Math.max(width / bitmap.width, height / bitmap.height);
      const sourceWidth = width / scale;
      const sourceHeight = height / scale;
      context.drawImage(
        bitmap,
        (bitmap.width - sourceWidth) / 2,
        (bitmap.height - sourceHeight) / 2,
        sourceWidth,
        sourceHeight,
        left,
        top,
        width,
        height
      );
    } finally {
      bitmap.close();
    }
  }
  return canvas.convertToBlob({ type: mimeType, quality: mimeType === "image/jpeg" ? 0.94 : undefined });
}
