import { describe, expect, it } from "vitest";
import { compilePrompt } from "@styleforge/core";
import { migrateVisualDNA, visualDNASchema } from "@styleforge/contracts";
import { dna } from "./contracts.test";

const locks = {
  identity: "unlocked",
  subject: "locked",
  composition: "locked",
  camera: "unlocked",
  lighting: "locked",
  palette: "unlocked",
  material: "unlocked",
  texture: "unlocked",
  style: "locked"
} as const;

describe("Visual DNA Lock", () => {
  it("Schema 保存九个 locked/unlocked 状态", () => {
    expect(visualDNASchema.parse({ ...dna, locks }).locks).toEqual(locks);
    expect(visualDNASchema.safeParse({
      ...dna,
      locks: { ...locks, subject: "fixed" }
    }).success).toBe(false);
  });

  it("旧 v1.0.0 数据读取时补齐 unlocked，不丢字段", () => {
    const { locks: _locks, ...oldDNA } = dna;
    const migrated = migrateVisualDNA({ ...oldDNA, schemaVersion: "1.0.0" });
    expect(Object.values(migrated.locks)).toEqual(Array(9).fill("unlocked"));
    expect(migrated.subject).toEqual(dna.subject);
  });

  it("Prompt 明确输出已锁定规则，不把 unlocked 写成必须保持", () => {
    const prompt = compilePrompt({
      visualDNA: { ...dna, locks },
      aspectRatio: "4:3",
      references: [{ index: 1, role: "style_layout" }]
    });
    expect(prompt).toContain("锁定视觉字段");
    expect(prompt).toContain("主体：单一商品");
    expect(prompt).toContain("光线：");
    expect(prompt).toContain("风格：克制");
    expect(prompt).not.toContain("镜头锁定");
  });
});
