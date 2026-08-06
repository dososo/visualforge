import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import * as core from "@styleforge/core";
import { dna } from "./contracts.test";

describe("Preference Event", () => {
  it("把编辑和 Lock 变化记录为事实事件", () => {
    const schema = (contracts as Record<string, unknown>).preferenceEventSchema as {
      parse: (input: unknown) => unknown;
    } | undefined;
    const create = (core as Record<string, unknown>).createPreferenceEvents;
    expect(schema).toBeDefined();
    expect(create).toBeTypeOf("function");
    if (!schema || typeof create !== "function") return;

    const after = {
      ...dna,
      revision: 2,
      palette: { ...dna.palette, saturation: "高" },
      locks: { ...dna.locks, palette: "locked" as const }
    };
    const events = create({
      actionId: "edit-1",
      projectId: "project-1",
      before: dna,
      after,
      source: "editor",
      createdAt: 2_000
    }) as Array<Record<string, unknown>>;
    events.forEach((event) => schema.parse(event));

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dimension: "palette",
        field: "palette.saturation",
        before: "低",
        after: "高",
        source: "editor",
        createdAt: 2_000
      }),
      expect.objectContaining({
        dimension: "palette",
        field: "locks.palette",
        before: "unlocked",
        after: "locked",
        source: "lock",
        createdAt: 2_000
      })
    ]));
  });

  it("恢复产生的变化全部标记为 restore，不伪装成编辑偏好", () => {
    const create = (core as Record<string, unknown>).createPreferenceEvents;
    expect(create).toBeTypeOf("function");
    if (typeof create !== "function") return;
    const current = { ...dna, palette: { ...dna.palette, temperature: "冷色" } };
    const events = create({
      actionId: "restore-1",
      projectId: "project-1",
      before: current,
      after: dna,
      source: "restore",
      createdAt: 3_000
    }) as Array<{ source: string; field: string; before: unknown; after: unknown }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      field: "palette.temperature",
      before: "冷色",
      after: "中性",
      source: "restore"
    });
  });
});
