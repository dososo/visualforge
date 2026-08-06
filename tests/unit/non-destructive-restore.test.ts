import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as db from "../../apps/extension/lib/db";
import * as core from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Visual DNA non-destructive restore", () => {
  it("追加恢复记录并保留原始与编辑版本", async () => {
    const save = (db as Record<string, unknown>).saveVisualDNARevision;
    const list = (db as Record<string, unknown>).listVisualDNARevisions;
    const create = (core as Record<string, unknown>).createVisualDNARevision;
    const restore = (core as Record<string, unknown>).restoreVisualDNARevision;
    expect(save).toBeTypeOf("function");
    expect(list).toBeTypeOf("function");
    expect(create).toBeTypeOf("function");
    expect(restore).toBeTypeOf("function");
    if ([save, list, create, restore].some((value) => typeof value !== "function")) return;

    const projectId = "restore-project";
    const edited = {
      ...dna,
      revision: 2,
      updatedAt: 2_000,
      palette: { ...dna.palette, temperature: "冷色" }
    };
    const restored = restore(edited, dna, 3_000);
    const records = [
      create({ id: "restore-r1", projectId, dna, previousDNA: null, origin: "analysis", createdAt: 1_000 }),
      create({ id: "restore-r2", projectId, dna: edited, previousDNA: dna, origin: "edit", createdAt: 2_000 }),
      create({
        id: "restore-r3",
        projectId,
        dna: restored,
        previousDNA: edited,
        origin: "restore",
        restoredFromRevision: 1,
        createdAt: 3_000
      })
    ];
    for (const record of records) await save(record);

    const history = await list(projectId) as Array<{
      revision: number;
      restoredFromRevision: number | null;
      dna: typeof dna;
    }>;
    expect(history.map((record) => record.revision)).toEqual([1, 2, 3]);
    expect(history[2].restoredFromRevision).toBe(1);
    expect(history[0].dna.palette.temperature).toBe(dna.palette.temperature);
    expect(history[1].dna.palette.temperature).toBe("冷色");
  });
});
