import { afterEach, describe, expect, it, vi } from "vitest";
import { createGridLayout, gridCells } from "../../apps/extension/lib/grid-layout";
import * as gridLayoutModule from "../../apps/extension/lib/grid-layout";

type InferGridLayout = (input: {
  aspectRatio: number;
  columnDividers: Array<{ stop: number; score: number }>;
  rowDividers: Array<{ stop: number; score: number }>;
}) => { kind: "detected" | "uncertain" | "none"; layout: ReturnType<typeof createGridLayout> | null };

const inferGridLayout = (gridLayoutModule as unknown as { inferGridLayout?: InferGridLayout }).inferGridLayout;

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return new Blob([bytes], { type: "image/png" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("宫格布局", () => {
  it("解码前估算输入位图、全部输出和最大单格画布的总内存", () => {
    const estimate = (gridLayoutModule as Record<string, unknown>).estimateGridCropMemory as
      ((width: number, height: number, layout: ReturnType<typeof createGridLayout>, indices: number[]) => {
        inputBitmapBytes: number;
        allOutputBytes: number;
        largestCellCanvasBytes: number;
        totalBytes: number;
      }) | undefined;
    const budget = (gridLayoutModule as Record<string, unknown>).MAX_GRID_CROP_MEMORY_BYTES as number | undefined;
    expect(estimate).toBeTypeOf("function");
    expect(budget).toBeTypeOf("number");
    if (!estimate || !budget) return;

    const layout = createGridLayout(9);
    const oneCell = estimate(6000, 6000, layout, [0]);
    const allCells = estimate(6000, 6000, layout, gridCells(layout).map((cell) => cell.index));

    expect(oneCell).toEqual({
      inputBitmapBytes: 144_000_000,
      allOutputBytes: 16_000_000,
      largestCellCanvasBytes: 16_000_000,
      totalBytes: 176_000_000
    });
    expect(oneCell.totalBytes).toBeLessThan(budget);
    expect(allCells.allOutputBytes).toBe(144_000_000);
    expect(allCells.largestCellCanvasBytes).toBe(16_000_000);
    expect(allCells.totalBytes).toBe(304_000_000);
    expect(allCells.totalBytes).toBeGreaterThan(budget);
  });

  it("总内存超限时在 createImageBitmap 前给出可操作错误", async () => {
    const decoder = vi.fn();
    vi.stubGlobal("createImageBitmap", decoder);
    const cropGridCells = (gridLayoutModule as Record<string, unknown>).cropGridCells as
      ((blob: Blob, layout: ReturnType<typeof createGridLayout>) => Promise<Blob[]>) | undefined;
    expect(cropGridCells).toBeTypeOf("function");
    if (!cropGridCells) return;

    await expect(cropGridCells(pngHeader(6000, 6000), createGridLayout(9)))
      .rejects.toThrow(/宫格裁切预计占用.*输入位图.*全部输出.*单格画布.*超过.*请先缩小/);
    expect(decoder).not.toHaveBeenCalled();
  });

  it("12 格模型裁片把最长边限制为 2048px 且不放大小图", () => {
    const fitGridCellSize = (gridLayoutModule as Record<string, unknown>).fitGridCellSize as
      ((width: number, height: number) => { width: number; height: number }) | undefined;
    expect(fitGridCellSize).toBeTypeOf("function");
    if (!fitGridCellSize) return;
    expect(fitGridCellSize(8000, 4000)).toEqual({ width: 2048, height: 1024 });
    expect(fitGridCellSize(1200, 900)).toEqual({ width: 1200, height: 900 });
  });

  it("二宫格支持上下与左右排版，并识别单条真实分隔线", () => {
    expect(createGridLayout(2)).toMatchObject({ count: 2, columns: 2, rows: 1 });
    expect(createGridLayout(2, 1)).toMatchObject({ count: 2, columns: 1, rows: 2 });
    const result = inferGridLayout!({
      aspectRatio: 0.75,
      columnDividers: [],
      rowDividers: [{ stop: 0.38, score: 0.9 }]
    });
    expect(result.kind).toBe("detected");
    expect(result.layout).toMatchObject({ count: 2, columns: 1, rows: 2, rowStops: [0.38] });
  });

  it("三宫格支持横向与纵向，并按顺序产生三个独立画面", () => {
    const horizontal = createGridLayout(3, 3);
    const vertical = createGridLayout(3, 1);
    const cells = gridCells(horizontal);
    expect(cells.map((cell) => cell.index)).toEqual([0, 1, 2]);
    expect(cells[0]).toMatchObject({ left: 0, top: 0, height: 1 });
    expect(cells[1]?.left).toBeCloseTo(1 / 3);
    expect(cells[2]?.left).toBeCloseTo(2 / 3);
    expect(cells.every((cell) => Math.abs(cell.width - 1 / 3) < 1e-12)).toBe(true);
    expect(gridCells(vertical).map((cell) => cell.index)).toEqual([0, 1, 2]);
    expect(vertical.rows).toBe(3);
  });

  it.each([
    [2, 2, 1],
    [4, 2, 2],
    [6, 3, 2],
    [9, 3, 3],
    [12, 4, 3]
  ] as const)("%i 宫格使用 %i×%i 默认布局", (count, columns, rows) => {
    const layout = createGridLayout(count);
    expect(layout).toMatchObject({ count, columns, rows });
    expect(gridCells(layout)).toHaveLength(count);
  });

  it("从真实分隔位置保留非等分三宫格边界", () => {
    expect(typeof inferGridLayout).toBe("function");
    const result = inferGridLayout!({
      aspectRatio: 3,
      columnDividers: [{ stop: 0.24, score: 0.9 }, { stop: 0.7, score: 0.86 }],
      rowDividers: []
    });
    expect(result.kind).toBe("detected");
    expect(result.layout).toMatchObject({ count: 3, columns: 3, rows: 1, source: "divider" });
    expect(result.layout?.columnStops).toEqual([0.24, 0.7]);
  });

  it("保留缩略采样后仍高于图像检测下限的弱分隔线", () => {
    const result = inferGridLayout!({
      aspectRatio: 3.125,
      columnDividers: [{ stop: 0.24, score: 0.145 }, { stop: 0.7, score: 0.151 }],
      rowDividers: []
    });
    expect(result.kind).toBe("detected");
    expect(result.layout?.columnStops).toEqual([0.24, 0.7]);
  });

  it.each([
    [2, 2, 1, [0.5], []],
    [2, 1, 2, [], [0.5]],
    [4, 2, 2, [0.5], [0.5]],
    [6, 3, 2, [0.33, 0.67], [0.5]],
    [6, 2, 3, [0.5], [0.33, 0.67]],
    [9, 3, 3, [0.33, 0.67], [0.33, 0.67]],
    [12, 4, 3, [0.25, 0.5, 0.75], [0.33, 0.67]],
    [12, 3, 4, [0.33, 0.67], [0.25, 0.5, 0.75]]
  ] as const)("从分隔线识别 %i 格 %i×%i", (count, columns, rows, columnStops, rowStops) => {
    expect(typeof inferGridLayout).toBe("function");
    const result = inferGridLayout!({
      aspectRatio: columns / rows,
      columnDividers: columnStops.map((stop) => ({ stop, score: 0.9 })),
      rowDividers: rowStops.map((stop) => ({ stop, score: 0.9 }))
    });
    expect(result.kind).toBe("detected");
    expect(result.layout).toMatchObject({ count, columns, rows });
  });

  it("超宽但没有分隔线时只提示低置信度，不确认为三宫格", () => {
    expect(typeof inferGridLayout).toBe("function");
    const result = inferGridLayout!({ aspectRatio: 3, columnDividers: [], rowDividers: [] });
    expect(result.kind).toBe("uncertain");
    expect(result.layout).toMatchObject({ count: 3, confidence: 0.64, source: "aspect-ratio" });
  });

  it("createGridLayout 不接受不可能的三宫格列数", () => {
    expect(() => createGridLayout(3, 2)).toThrow("三宫格只支持横向或纵向");
  });
});
