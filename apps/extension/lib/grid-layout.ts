import { readEncodedImageDimensions } from "./image";

export type GridPanelCount = 2 | 3 | 4 | 6 | 9 | 12;

export interface GridLayout {
  count: GridPanelCount;
  columns: number;
  rows: number;
  columnStops: number[];
  rowStops: number[];
  confidence: number;
  source: "divider" | "aspect-ratio" | "manual";
}

export interface GridDetection {
  kind: "detected" | "uncertain" | "none";
  layout: GridLayout | null;
}

const layouts: Record<Exclude<GridPanelCount, 3>, Array<[number, number]>> = {
  2: [[2, 1], [1, 2]],
  4: [[2, 2]],
  6: [[3, 2], [2, 3]],
  9: [[3, 3]],
  12: [[4, 3], [3, 4]]
};

export function createGridLayout(count: GridPanelCount, columns?: number): GridLayout {
  if (count === 3 && columns !== undefined && columns !== 1 && columns !== 3) {
    throw new Error("三宫格只支持横向或纵向");
  }
  const [resolvedColumns, rows] = count === 3
    ? [columns ?? 3, columns === 1 ? 3 : 1]
    : layouts[count].find(([candidate]) => candidate === columns) ?? layouts[count][0]!;
  return {
    count,
    columns: resolvedColumns,
    rows,
    columnStops: Array.from({ length: resolvedColumns - 1 }, (_, index) => (index + 1) / resolvedColumns),
    rowStops: Array.from({ length: rows - 1 }, (_, index) => (index + 1) / rows),
    confidence: 1,
    source: "manual"
  };
}

export function gridLayoutAlternatives(count: GridPanelCount): GridLayout[] {
  if (count === 3) return [createGridLayout(3, 3), createGridLayout(3, 1)];
  return layouts[count].map(([columns]) => createGridLayout(count, columns));
}

export function inferGridLayout(input: {
  aspectRatio: number;
  columnDividers: Array<{ stop: number; score: number }>;
  rowDividers: Array<{ stop: number; score: number }>;
}): GridDetection {
  const normalize = (dividers: Array<{ stop: number; score: number }>) => dividers
    .filter((item) => item.score >= 0.12 && item.stop > 0.08 && item.stop < 0.92)
    .sort((left, right) => left.stop - right.stop)
    .reduce<Array<{ stop: number; score: number }>>((merged, item) => {
      const previous = merged.at(-1);
      if (previous && item.stop - previous.stop <= 0.04) {
        const total = previous.score + item.score;
        previous.stop = (previous.stop * previous.score + item.stop * item.score) / total;
        previous.score = Math.max(previous.score, item.score);
      } else {
        merged.push({ ...item });
      }
      return merged;
    }, []);
  const columns = normalize(input.columnDividers);
  const rows = normalize(input.rowDividers);
  const columnCount = columns.length + 1;
  const rowCount = rows.length + 1;
  const count = columnCount * rowCount;
  if ([2, 3, 4, 6, 9, 12].includes(count) && columnCount <= 4 && rowCount <= 4) {
    const dividerScores = [...columns, ...rows].map((item) => item.score);
    const dividerConfidence = dividerScores.length
      ? dividerScores.reduce((total, score) => total + score, 0) / dividerScores.length
      : 0;
    const aspectPenalty = Math.min(0.12, Math.abs(input.aspectRatio - columnCount / rowCount) * 0.025);
    return {
      kind: "detected",
      layout: {
        count: count as GridPanelCount,
        columns: columnCount,
        rows: rowCount,
        columnStops: columns.map((item) => item.stop),
        rowStops: rows.map((item) => item.stop),
        confidence: Math.min(0.96, Math.max(0.72, dividerConfidence - aspectPenalty)),
        source: "divider"
      }
    };
  }
  if (input.aspectRatio >= 2.4) {
    return { kind: "uncertain", layout: { ...createGridLayout(3, 3), confidence: 0.64, source: "aspect-ratio" } };
  }
  if (input.aspectRatio <= 0.42) {
    return { kind: "uncertain", layout: { ...createGridLayout(3, 1), confidence: 0.64, source: "aspect-ratio" } };
  }
  return { kind: "none", layout: null };
}

function strongestDividerStops(data: Uint8ClampedArray, width: number, height: number, axis: "x" | "y") {
  const length = axis === "x" ? width : height;
  const other = axis === "x" ? height : width;
  const scores = Array.from({ length }, (_, position) => {
    if (position < length * 0.12 || position > length * 0.88) return { score: 0, coverage: 0 };
    let total = 0;
    let edgePixels = 0;
    for (let offset = 0; offset < other; offset += 1) {
      const index = (axis === "x" ? offset * width + position : position * width + offset) * 4;
      const previous = (axis === "x" ? offset * width + position - 1 : (position - 1) * width + offset) * 4;
      const difference = Math.abs(data[index]! - data[previous]!)
        + Math.abs(data[index + 1]! - data[previous + 1]!)
        + Math.abs(data[index + 2]! - data[previous + 2]!);
      total += difference;
      if (difference / (3 * 255) >= 0.08) edgePixels += 1;
    }
    return {
      score: total / (other * 3 * 255),
      coverage: edgePixels / other
    };
  });
  return scores
    .map(({ score, coverage }, position) => ({ score, coverage, position }))
    .sort((a, b) => b.score - a.score)
    .filter((candidate, index, all) => all.slice(0, index).every((otherCandidate) =>
      Math.abs(otherCandidate.position - candidate.position) > length * 0.08));
}

export async function detectGridLayout(blob: Blob): Promise<GridLayout | null> {
  const encodedDimensions = await readEncodedImageDimensions(blob);
  assertGridDetectionMemoryBudget(encodedDimensions.width, encodedDimensions.height);
  const bitmap = await createImageBitmap(blob);
  try {
    assertGridDetectionMemoryBudget(bitmap.width, bitmap.height);
    const aspect = bitmap.width / bitmap.height;
    const width = 256;
    const height = Math.max(64, Math.min(768, Math.round(width * bitmap.height / bitmap.width)));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const data = context.getImageData(0, 0, width, height).data;
    const columns = strongestDividerStops(data, width, height, "x");
    const rows = strongestDividerStops(data, width, height, "y");
    const strongDividers = (candidates: Array<{ score: number; coverage: number; position: number }>) => {
      const threshold = Math.max(0.12, (candidates[0]?.score ?? 0) * 0.65);
      return candidates.filter((candidate) => candidate.score >= threshold && candidate.coverage >= 0.62);
    };
    const strongColumns = strongDividers(columns);
    const strongRows = strongDividers(rows);
    return inferGridLayout({
      aspectRatio: aspect,
      columnDividers: strongColumns.map((item) => ({ stop: item.position / width, score: item.score })),
      rowDividers: strongRows.map((item) => ({ stop: item.position / height, score: item.score }))
    }).layout;
  } finally {
    bitmap.close();
  }
}

const RGBA_BYTES_PER_PIXEL = 4;
const MEBIBYTE = 1024 * 1024;
export const MAX_GRID_CROP_MEMORY_BYTES = 192 * MEBIBYTE;
export const MAX_GRID_CELL_EDGE = 2048;

export interface GridCropMemoryEstimate {
  inputBitmapBytes: number;
  allOutputBytes: number;
  largestCellCanvasBytes: number;
  totalBytes: number;
}

function decodedPixelBytes(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("无法确认宫格图片像素尺寸，请重新导出图片后重试。");
  }
  const bytes = Math.ceil(width) * Math.ceil(height) * RGBA_BYTES_PER_PIXEL;
  return Number.isSafeInteger(bytes) ? bytes : Number.POSITIVE_INFINITY;
}

function addMemoryBytes(left: number, right: number) {
  const total = left + right;
  return Number.isSafeInteger(total) ? total : Number.POSITIVE_INFINITY;
}

export function estimateGridCropMemory(
  width: number,
  height: number,
  layout: GridLayout,
  indices: number[]
): GridCropMemoryEstimate {
  const cells = gridCells(layout);
  if (indices.some((index) => !cells[index])) throw new Error("宫格画面索引不存在");
  const inputBitmapBytes = decodedPixelBytes(width, height);
  let allOutputBytes = 0;
  let largestCellCanvasBytes = 0;
  for (const index of indices) {
    const cell = cells[index]!;
    const sourceWidth = Math.max(1, Math.round(cell.width * width));
    const sourceHeight = Math.max(1, Math.round(cell.height * height));
    const output = fitGridCellSize(sourceWidth, sourceHeight);
    const outputBytes = decodedPixelBytes(output.width, output.height);
    allOutputBytes = addMemoryBytes(allOutputBytes, outputBytes);
    largestCellCanvasBytes = Math.max(largestCellCanvasBytes, outputBytes);
  }
  return {
    inputBitmapBytes,
    allOutputBytes,
    largestCellCanvasBytes,
    totalBytes: addMemoryBytes(addMemoryBytes(inputBitmapBytes, allOutputBytes), largestCellCanvasBytes)
  };
}

function formatMemory(bytes: number) {
  return Number.isFinite(bytes) ? `${Math.ceil(bytes / MEBIBYTE)} MB` : "超出可安全估算范围";
}

function assertGridCropMemoryBudget(width: number, height: number, layout: GridLayout, indices: number[]) {
  const estimate = estimateGridCropMemory(width, height, layout, indices);
  if (estimate.totalBytes <= MAX_GRID_CROP_MEMORY_BYTES) return;
  throw new Error(
    `宫格裁切预计占用 ${formatMemory(estimate.totalBytes)}` +
    `（输入位图 ${formatMemory(estimate.inputBitmapBytes)}、全部输出 ${formatMemory(estimate.allOutputBytes)}、` +
    `单格画布峰值 ${formatMemory(estimate.largestCellCanvasBytes)}），` +
    `超过 ${formatMemory(MAX_GRID_CROP_MEMORY_BYTES)} 安全上限。请先缩小参考图尺寸后重试。`
  );
}

function assertGridDetectionMemoryBudget(width: number, height: number) {
  const inputBitmapBytes = decodedPixelBytes(width, height);
  const sampleHeight = Math.max(64, Math.min(768, Math.round(256 * height / width)));
  const sampleBytes = decodedPixelBytes(256, sampleHeight);
  const totalBytes = addMemoryBytes(inputBitmapBytes, sampleBytes * 2);
  if (totalBytes > MAX_GRID_CROP_MEMORY_BYTES) {
    throw new Error(
      `宫格识别预计占用 ${formatMemory(totalBytes)}，超过 ${formatMemory(MAX_GRID_CROP_MEMORY_BYTES)} 安全上限。` +
      "请先缩小参考图尺寸后重试。"
    );
  }
}

async function cropGridCellsAt(
  blob: Blob,
  layout: GridLayout,
  indices: number[],
  onProgress?: (completed: number, total: number) => void
): Promise<Blob[]> {
  const cells = gridCells(layout);
  if (indices.some((index) => !cells[index])) throw new Error("宫格画面索引不存在");
  const encodedDimensions = await readEncodedImageDimensions(blob);
  assertGridCropMemoryBudget(encodedDimensions.width, encodedDimensions.height, layout, indices);
  const bitmap = await createImageBitmap(blob);
  try {
    assertGridCropMemoryBudget(bitmap.width, bitmap.height, layout, indices);
    const outputs: Blob[] = [];
    for (const index of indices) {
      const cell = cells[index]!;
      const sourceX = Math.round(cell.left * bitmap.width);
      const sourceY = Math.round(cell.top * bitmap.height);
      const sourceWidth = Math.max(1, Math.round(cell.width * bitmap.width));
      const sourceHeight = Math.max(1, Math.round(cell.height * bitmap.height));
      const output = fitGridCellSize(sourceWidth, sourceHeight);
      const canvas = new OffscreenCanvas(output.width, output.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建宫格画布");
      context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height);
      outputs.push(await canvas.convertToBlob({ type: "image/png" }));
      canvas.width = 1;
      canvas.height = 1;
      onProgress?.(outputs.length, indices.length);
    }
    return outputs;
  } finally {
    bitmap.close();
  }
}

export function fitGridCellSize(width: number, height: number) {
  const scale = Math.min(1, MAX_GRID_CELL_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export async function cropGridCell(blob: Blob, layout: GridLayout, index: number): Promise<Blob> {
  return (await cropGridCellsAt(blob, layout, [index]))[0]!;
}

export async function cropGridCells(
  blob: Blob,
  layout: GridLayout,
  onProgress?: (completed: number, total: number) => void
): Promise<Blob[]> {
  return cropGridCellsAt(blob, layout, gridCells(layout).map((cell) => cell.index), onProgress);
}

export function gridCells(layout: GridLayout) {
  const x = [0, ...layout.columnStops, 1];
  const y = [0, ...layout.rowStops, 1];
  return y.slice(0, -1).flatMap((top, row) => x.slice(0, -1).map((left, column) => ({
    index: row * layout.columns + column,
    left,
    top,
    width: x[column + 1]! - left,
    height: y[row + 1]! - top
  }))).slice(0, layout.count);
}
