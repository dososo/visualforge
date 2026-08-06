import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import * as core from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Visual DNA revision history", () => {
  it("记录可确认的维度级 before/after 修改摘要", () => {
    const schema = (contracts as Record<string, unknown>).visualDNARevisionSchema as {
      parse: (input: unknown) => { changes: Array<{ dimension: string; before: string | null; after: string }> };
    } | undefined;
    const create = (core as Record<string, unknown>).createVisualDNARevision;
    expect(schema).toBeDefined();
    expect(create).toBeTypeOf("function");
    if (!schema || typeof create !== "function") return;

    const revised = {
      ...dna,
      revision: 2,
      updatedAt: 2_000,
      lighting: { ...dna.lighting, quality: "硬光" },
      palette: { ...dna.palette, temperature: "冷色" }
    };
    const record = schema.parse(create({
      id: "revision-2",
      projectId: "project-1",
      dna: revised,
      previousDNA: dna,
      origin: "edit",
      createdAt: 2_000
    }));

    expect(record.changes.map((change) => change.dimension)).toEqual(["lighting", "palette"]);
    expect(record.changes[0]).toMatchObject({ before: expect.stringContaining("柔和"), after: expect.stringContaining("硬光") });
    expect(record.changes[1]).toMatchObject({ before: expect.stringContaining("中性"), after: expect.stringContaining("冷色") });
  });

  it("原始分析不伪造修改摘要", () => {
    const create = (core as Record<string, unknown>).createVisualDNARevision;
    expect(create).toBeTypeOf("function");
    if (typeof create !== "function") return;
    const record = create({
      id: "revision-1",
      projectId: "project-1",
      dna,
      previousDNA: null,
      origin: "analysis",
      createdAt: 1_000
    }) as { revision: number; changes: unknown[]; origin: string };
    expect(record).toMatchObject({ revision: 1, origin: "analysis", changes: [] });
  });
});
