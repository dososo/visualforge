import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import {
  nativeRequestSchema,
  nativeResponseSchema
} from "@styleforge/contracts";

describe("Native Message Schema v1", () => {
  const request = (type: string, payload: unknown) => ({
    protocolVersion: 1,
    requestId: "request-1",
    type,
    payload
  });

  it.each([
    ["host.ping", {}],
    ["host.diagnostics", {}],
    ["host.uninstall", {}],
    ["data.purge.temporary", {}],
    ["data.purge.all", {}],
    ["analysis.start", { taskId: "task-1", assetId: "asset-1" }],
    ["grid.analysis.start", {
      taskId: "task-grid-1",
      assetId: "asset-grid-1",
      layout: {
        count: 3,
        columns: 3,
        rows: 1,
        columnStops: [0.24, 0.7],
        rowStops: [],
        confidence: 0.91,
        source: "divider"
      }
    }],
    ["generation.start", {
      taskId: "task-1",
      references: [
        { assetId: "asset-1", role: "style" },
        { assetId: "asset-2", role: "identity", imagePurpose: "face", sourceKind: "original" }
      ],
      prompt: "保留柔光",
      count: 2
    }],
    ["subject.quality.check", {
      taskId: "task-1",
      assetIds: ["asset-1", "asset-2"]
    }],
    ["task.cancel", { taskId: "task-1" }],
    ["asset.write.start", {
      assetId: "asset-1",
      mimeType: "image/png",
      byteLength: 8,
      chunkCount: 1,
      sha256: "a".repeat(64)
    }],
    ["asset.write.chunk", { assetId: "asset-1", index: 0, data: "aGVsbG8=" }],
    ["asset.write.finish", { assetId: "asset-1" }],
    ["asset.read.start", { assetId: "asset-1" }],
    ["asset.read.chunk", { assetId: "asset-1", index: 0 }]
  ])("校验 %s 请求", (type, payload) => {
    expect(nativeRequestSchema.safeParse(request(type, payload)).success).toBe(true);
  });

  it("拒绝未知消息和越界生成数量", () => {
    expect(nativeRequestSchema.safeParse(request("unknown", {})).success).toBe(false);
    expect(nativeRequestSchema.safeParse(request("generation.start", {
      taskId: "task-1",
      references: [{ assetId: "asset-1", role: "style" }],
      prompt: "test",
      count: 4
    })).success).toBe(false);
  });

  it("单图与宫格生成都容纳五张主体、身份板和构图引用", () => {
    const maxReferences = (contracts as Record<string, unknown>).MAX_GENERATION_REFERENCE_COUNT;
    expect(maxReferences).toBe(8);
    const references = Array.from({ length: 8 }, (_, index) => ({
      assetId: `asset-${index + 1}`,
      role: index === 0 ? "style" : index === 7 ? "composition" : "identity"
    }));
    expect(nativeRequestSchema.safeParse(request("generation.start", {
      taskId: "task-single-five-plus-board",
      references: references.slice(0, 7),
      prompt: "单图：风格、五张人物与身份板",
      count: 1
    })).success).toBe(true);
    expect(nativeRequestSchema.safeParse(request("generation.start", {
      taskId: "task-grid-five-plus-board",
      references,
      prompt: "宫格：风格、五张人物、身份板与逐格构图",
      count: 1
    })).success).toBe(true);
    expect(nativeRequestSchema.safeParse(request("generation.start", {
      taskId: "task-too-many-references",
      references: [...references, { assetId: "asset-9", role: "composition" }],
      prompt: "超过产品允许的引用数量",
      count: 1
    })).success).toBe(false);
  });

  it("人物生成协议完整保留脸部、全身和来源职责", () => {
    const parsed = nativeRequestSchema.parse(request("generation.start", {
      taskId: "task-person-evidence",
      references: [
        { assetId: "face-1", role: "identity", imagePurpose: "face", sourceKind: "original" },
        { assetId: "body-1", role: "identity", imagePurpose: "full_body", sourceKind: "original" }
      ],
      prompt: "保持同一个人",
      count: 1
    }));
    if (parsed.type !== "generation.start") throw new Error("协议类型错误");
    expect(parsed.payload.references).toEqual([
      { assetId: "face-1", role: "identity", imagePurpose: "face", sourceKind: "original" },
      { assetId: "body-1", role: "identity", imagePurpose: "full_body", sourceKind: "original" }
    ]);
  });

  it("生成协议把待复刻画面模板作为独立职责传到 Host", () => {
    const parsed = nativeRequestSchema.parse(request("generation.start", {
      taskId: "task-frame-template",
      references: [
        { assetId: "person-1", role: "identity", imagePurpose: "face", sourceKind: "original" },
        { assetId: "frame-1", role: "style_layout", sourceKind: "original" }
      ],
      prompt: "只替换人物身份，保持待复刻画面",
      count: 1
    }));
    if (parsed.type !== "generation.start") throw new Error("协议类型错误");
    expect(parsed.payload.references[1]?.role).toBe("style_layout");
  });

  it("校验诊断成功响应中的发现结果", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-1",
      ok: true,
      data: {
        state: "connected",
        label: "Codex 已连接",
        codex: {
          found: true,
          path: "/Applications/Codex.app/Contents/Resources/codex",
          version: "codex-cli 1.2.3",
          source: "common",
          security: {
            resolvedPath: "/Applications/Codex.app/Contents/Resources/codex",
            signatureStatus: "verified",
            teamId: "2DC432GLL2",
            identifier: "codex",
            trusted: true,
            risk: null
          },
          error: null
        },
        modelCount: 8,
        imagegen: true,
        imagegenSkill: {
          path: "/Users/test/.codex/skills/imagegen/SKILL.md",
          sha256: "b".repeat(64)
        }
      }
    }).success).toBe(true);
  });

  it("Host 握手返回版本、协议和能力清单", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-ping",
      ok: true,
      data: {
        protocolVersion: 1,
        version: "0.5.1",
        capabilities: [
          "generation-v1",
          "generation-reference-evidence-v1",
          "grid-analysis-v1",
          "quality-check-v1",
          "self-uninstall-v1"
        ]
      }
    }).success).toBe(true);
  });

  it("校验卸载成功响应明确保留浏览器作品", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-uninstall",
      ok: true,
      data: {
        removedFiles: 2,
        dataPreserved: true
      }
    }).success).toBe(true);
  });

  it("生成响应可携带兼容的阶段耗时", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-generation",
      ok: true,
      data: {
        outputs: [{
          assetId: "asset-output",
          mimeType: "image/png",
          byteLength: 1024,
          chunkSize: 384 * 1024,
          chunkCount: 1,
          sha256: "a".repeat(64)
        }],
        timings: {
          totalMs: 1500,
          codexStartupMs: 100,
          skillDiscoveryMs: 20,
          generationTurnMs: 1300,
          outputRegistrationMs: 40,
          outputReadMs: 10
        },
        imagegenSkill: {
          path: "/Users/test/.codex/skills/imagegen/SKILL.md",
          sha256: "b".repeat(64)
        }
      }
    }).success).toBe(true);
  });

  it("校验逐格语义分析成功响应", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-grid",
      ok: true,
      data: {
        schemaVersion: "1.0.0",
        analysisVersion: "grid-semantics-v1",
        model: "codex-app-server-default",
        sourceImageHash: "a".repeat(64),
        cells: [{
          index: 0,
          composition: "主体位于左侧，右侧保留呼吸空间",
          shotScale: "中景",
          action: "人物转身迈步",
          emotion: "克制而坚定"
        }]
      }
    }).success).toBe(true);
  });

  it("整组质检保留面部与全身体型参考职责", () => {
    const qualityRequest = request("creation-set.quality.check", {
      taskId: "quality-task",
      setId: "set-1",
      domain: "portrait",
      references: [
        { assetId: "face-1", role: "identity", imagePurpose: "face" },
        { assetId: "body-1", role: "identity", imagePurpose: "full_body" }
      ],
      sharedInvariants: ["人物身份", "体型轮廓"],
      signatureStyle: null,
      items: [{
        itemId: "shot-1",
        assetId: "output-1",
        planTitle: "雨中人物",
        creativePlan: {
          concept: "雨中人物",
          narrativeContext: "城市雨夜",
          storyPurpose: "建立人物",
          subjectState: "自然站立",
          cameraLanguage: "自然透视",
          cameraHeight: "胸口高度",
          horizontalAngle: "正侧之间",
          pitchAngle: "水平",
          shotScale: "全身",
          lens: "50mm",
          perspective: "自然",
          composition: "人物居中偏左",
          pose: "自然站立",
          actionPhase: "同侧单手持伞",
          gaze: "看向前方",
          gesture: "右手在右侧持伞",
          emotion: "自然平静",
          timeSense: "夜晚",
          weatherSense: "小雨",
          lightDirection: "侧前方",
          lightQuality: "柔和",
          shadowStrategy: "接触阴影可信",
          colorSystem: "冷色",
          lighting: "路灯",
          environment: "街道",
          atmosphere: "克制",
          material: "真实皮肤与衣料",
          postProcessing: "自然",
          shotResponsibility: "建立完整人物"
        }
      }]
    });
    expect(nativeRequestSchema.safeParse(qualityRequest).success).toBe(true);
  });

  it("校验主动数据清除的成功响应", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-purge",
      ok: true,
      data: {
        scope: "all",
        removedFiles: 4,
        removedDirectories: 3
      }
    }).success).toBe(true);
  });

  it("拒绝缺少错误原因的失败响应", () => {
    expect(nativeResponseSchema.safeParse({
      protocolVersion: 1,
      requestId: "request-1",
      ok: false
    }).success).toBe(false);
  });
});
