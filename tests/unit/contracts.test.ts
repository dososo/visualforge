import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as contracts from "@styleforge/contracts";
import { migrateVisualDNA, nativeEnvelopeSchema, visualDNASchema, type VisualDNA } from "@styleforge/contracts";

export const dna: VisualDNA = {
  schemaVersion: "1.1.0",
  revision: 1,
  createdAt: 1_000,
  updatedAt: 1_000,
  sourceImageHash: "a".repeat(64),
  analysisModel: "codex",
  analysisVersion: "visual-dna-v1",
  domain: "product",
  summary: "安静的产品摄影",
  identity: { description: "无特定人物身份", distinctiveFeatures: [], preserve: [] },
  subject: { description: "单一商品", count: 1, action: null, environment: null },
  composition: { shotType: "中景", subjectPlacement: "偏右", negativeSpace: "左侧", depth: "浅景深", aspectRatioHint: null },
  camera: { angle: "平视", lens: "标准镜头", focalLength: "50mm", distance: "中距离", depthOfField: "浅景深", perspective: "自然透视" },
  lighting: { source: "柔光箱", direction: "右后方", quality: "柔和", contrast: "低", highlightBehavior: "圆润", shadowBehavior: "保留细节" },
  palette: { dominantColors: ["月白", "灰绿"], accentColors: [], saturation: "低", temperature: "中性", contrast: "低" },
  material: { types: ["哑光材质"], finish: "细腻", reflectivity: "低", translucency: "不透明" },
  texture: { medium: "摄影", grain: "轻微", sharpness: "主体清晰", surfaceDetail: "真实" },
  mood: { keywords: ["安静"], emotionalTone: "克制", atmosphere: "专业" },
  style: { keywords: ["克制"], medium: "编辑摄影" },
  locks: {
    identity: "unlocked",
    subject: "unlocked",
    composition: "unlocked",
    camera: "unlocked",
    lighting: "unlocked",
    palette: "unlocked",
    material: "unlocked",
    texture: "unlocked",
    style: "unlocked"
  },
  references: [{ assetId: null, sourceImageHash: "a".repeat(64), role: "style_layout", influence: 1, notes: null }],
  constraints: { preserve: ["轮廓"], avoid: ["Logo"] },
  invariants: ["构图"],
  variables: ["主体"],
  generationBrief: "保持构图与光线，创作原创商品摄影。",
  confidence: 0.8
};

describe("Visual DNA Schema", () => {
  it("接受 v1.0.0 完整结构并拒绝额外字段", () => {
    expect(visualDNASchema.parse(dna).summary).toBe(dna.summary);
    expect(visualDNASchema.safeParse({ ...dna, unexpected: true }).success).toBe(false);
  });

  it("导出由 Zod 生成的唯一 JSON Schema", () => {
    const jsonSchema = (contracts as Record<string, unknown>).visualDNAJsonSchema as {
      $schema?: string;
      required?: string[];
    } | undefined;
    expect(jsonSchema).toBeDefined();
    expect(jsonSchema?.required).toContain("identity");
    expect(jsonSchema?.required).toContain("references");
    expect(JSON.stringify(jsonSchema)).not.toContain('"$ref"');
    const assertStrictObjects = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "object" && record.properties && typeof record.properties === "object") {
        expect(new Set(record.required as string[])).toEqual(new Set(Object.keys(record.properties)));
      }
      Object.values(record).forEach(assertStrictObjects);
    };
    assertStrictObjects(jsonSchema);
    const artifact = JSON.parse(readFileSync(
      new URL("../../packages/contracts/schema/visual-dna-v1.schema.json", import.meta.url),
      "utf8"
    ));
    expect(artifact).toEqual(jsonSchema);
  });
});

describe("Visual DNA Migration", () => {
  it("提供统一的旧数据迁移入口", () => {
    const migrate = (contracts as Record<string, unknown>).migrateVisualDNA;
    expect(migrate).toBeTypeOf("function");
  });

  it("把旧 1.0 结构无损映射到 v1.0.0 核心字段", () => {
    const legacy = {
      schemaVersion: "1.0",
      domain: "product",
      summary: "旧版 DNA",
      subject: { description: "商品", count: 1 },
      composition: { shotType: "中景", cameraAngle: "俯视", subjectPlacement: "中央", negativeSpace: "四周", depth: "浅景深" },
      lighting: { source: "窗光", direction: "左侧", quality: "柔和", contrast: "低", highlightBehavior: "柔和", shadowBehavior: "开放" },
      color: { dominantColors: ["灰白"], saturation: "低", temperature: "中性", contrast: "低" },
      texture: { medium: "摄影", material: "陶瓷", grain: "细", sharpness: "清晰", surfaceDetail: "真实" },
      style: { keywords: ["克制"], invariants: ["留白"], variables: ["主体"] },
      constraints: { preserve: ["轮廓"], avoid: ["Logo"] },
      generationBrief: "生成旧版风格作品",
      confidence: 0.7
    };
    const migrated = migrateVisualDNA(legacy, {
      createdAt: 10,
      updatedAt: 20,
      sourceImageHash: "b".repeat(64)
    });
    expect(migrated.schemaVersion).toBe("1.1.0");
    expect(migrated.camera.angle).toBe("俯视");
    expect(migrated.palette.dominantColors).toEqual(["灰白"]);
    expect(migrated.material.types).toEqual(["陶瓷"]);
    expect(migrated.invariants).toEqual(["留白"]);
    expect(migrated.sourceImageHash).toBe("b".repeat(64));
  });

  it("读取当前版本时保持幂等", () => {
    expect(migrateVisualDNA(dna)).toEqual(dna);
  });
});

describe("Native Message Envelope", () => {
  it("校验协议版本和请求标识", () => {
    expect(nativeEnvelopeSchema.safeParse({ protocolVersion: 1, requestId: "a", type: "host.ping", payload: {} }).success).toBe(true);
    expect(nativeEnvelopeSchema.safeParse({ protocolVersion: 2, requestId: "", type: "", payload: {} }).success).toBe(false);
  });
});
