import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";
import { assembleChunks, chunkBytes, compilePrompt, sha256Hex } from "@styleforge/core";
import { dna } from "./contracts.test";

describe("提示词编译器", () => {
  it("明确单参考图职责", () => {
    const prompt = compilePrompt({ visualDNA: dna, aspectRatio: "4:3", references: [{ index: 1, role: "style_layout" }] });
    expect(prompt).toContain("图 1：待复刻画面模板");
    expect(prompt).toContain("未指定替换主体，保持参考图核心主体");
    expect(prompt).toContain("输出比例为 4:3");
  });

  it("明确商品参考职责", () => {
    const prompt = compilePrompt({
      visualDNA: dna, aspectRatio: "1:1", userInstruction: "换成咖啡机",
      references: [{ index: 1, role: "style_layout" }, { index: 2, role: "subject" }]
    });
    expect(prompt).toContain("图 2：主体／商品参考");
    expect(prompt).toContain("保持外形、结构、材质和主要颜色");
  });

  it("明确人物身份职责", () => {
    const prompt = compilePrompt({
      visualDNA: dna, aspectRatio: "3:4",
      references: [{ index: 1, role: "style_layout" }, { index: 2, role: "identity" }]
    });
    expect(prompt).toContain("图 2：人物身份参考");
    expect(prompt).toContain("只负责保持同一个人的身份、年龄感");
    expect(prompt).toContain("动作、表情、服装、背景和构图服从待复刻画面");
    expect(prompt).toContain("脸型");
    expect(prompt).toContain("眼睛、眉形、鼻子、嘴唇");
    expect(prompt).toContain("不得用待复刻画面中的原人物身份覆盖");
  });

  it("人像提示词要求身体结构和遮挡关系可解释", () => {
    const prompt = compilePrompt({
      visualDNA: dna,
      domainProfile: {
        domain: "portrait",
        confidence: 1,
        routingState: "confirmed",
        profileVersion: "portrait-test",
        source: "user"
      },
      aspectRatio: "3:4",
      userInstruction: "让我的人物站在摩托车前",
      references: [{ index: 1, role: "style_layout" }, { index: 2, role: "identity" }]
    });
    expect(prompt).toContain("人体结构与遮挡");
    expect(prompt).toContain("髋、膝、踝、脚");
    expect(prompt).toContain("缺失、融合、多余肢体");
    expect(prompt).toContain("人物与车辆");
    expect(prompt).toContain("整条腿完全消失");
    expect(prompt).toContain("双腿可读性");
  });
});

describe("图片分块", () => {
  it("组装后字节与 SHA-256 保持一致", async () => {
    const source = new TextEncoder().encode("VisualForge".repeat(1000));
    const chunks = chunkBytes(source, 97);
    const assembled = assembleChunks(chunks);
    expect(assembled).toEqual(source);
    expect(await sha256Hex(assembled)).toBe(await sha256Hex(source));
  });
});

describe("生成追溯清单", () => {
  it("使用实际 Prompt、编译器版本和 DNA 快照创建 Manifest", async () => {
    const create = (core as Record<string, unknown>).createGenerationManifest;
    expect(create).toBeTypeOf("function");
    if (typeof create !== "function") return;

    const manifest = await create({
      id: "manifest",
      projectId: "project",
      taskId: "task",
      createdAt: 10,
      completedAt: 20,
      source: { assetId: "source", hash: "a".repeat(64), mimeType: "image/png", fileName: "source.png" },
      visualDNA: dna,
      prompt: "实际发送的 Prompt",
      model: { provider: "codex", name: "imagegen", version: null },
      parameters: { aspectRatio: "4:3", count: 1, userInstruction: "商品摄影", providerParameters: {} },
      outputs: [{ assetId: "output", hash: "c".repeat(64), mimeType: "image/png", byteLength: 100, fileName: "output.png" }]
    });

    expect(manifest.prompt.text).toBe("实际发送的 Prompt");
    expect(manifest.prompt.compilerVersion).toBe("visual-prompt-v6");
    expect(manifest.visualDNA.revision).toBe(1);
    expect(manifest.visualDNA.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
