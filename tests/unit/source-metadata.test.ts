import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createCaptureSource } from "../../apps/extension/lib/capture";
import { getAsset, saveAsset } from "../../apps/extension/lib/db";

describe("捕获来源元数据", () => {
  it("完整保存网页来源、标题、时间与捕获方式", () => {
    expect(createCaptureSource({
      sourceUrl: "https://images.example/photo.jpg",
      pageUrl: "https://example/gallery",
      pageTitle: "示例图片页",
      capturedAt: 123,
      captureMethod: "dom-canvas"
    })).toEqual({
      type: "web",
      sourceUrl: "https://images.example/photo.jpg",
      pageUrl: "https://example/gallery",
      pageTitle: "示例图片页",
      capturedAt: 123,
      captureMethod: "dom-canvas"
    });
  });

  it("来源元数据经过 IndexedDB 往返保持不变", async () => {
    const source = createCaptureSource({
      pageUrl: "https://example.test/gallery",
      pageTitle: "图片列表",
      capturedAt: 456,
      captureMethod: "area-selection"
    });
    await saveAsset({
      id: "capture-source-metadata",
      hash: "e".repeat(64),
      role: "style_layout",
      mimeType: "image/png",
      width: 300,
      height: 300,
      byteLength: 1,
      blob: new Blob(["x"], { type: "image/png" }),
      thumbnailBlob: new Blob(["x"], { type: "image/png" }),
      source,
      createdAt: 456
    });
    expect((await getAsset("capture-source-metadata"))?.source).toEqual(source);
    expect(source.sourceUrl).toBeUndefined();
  });
});
