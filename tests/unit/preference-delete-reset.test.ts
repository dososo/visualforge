import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import * as contracts from "@styleforge/contracts";
import * as core from "@styleforge/core";
import * as db from "../../apps/extension/lib/db";

const paletteSummary = {
  dimension: "palette",
  field: "palette.saturation",
  label: "饱和度",
  value: "低",
  explanation: "饱和度倾向：低",
  confidence: 1,
  sampleCount: 2,
  lastUpdated: 2_000
} as const;

const lightingSummary = {
  dimension: "lighting",
  field: "lighting.quality",
  label: "光质",
  value: "柔光",
  explanation: "光质倾向：柔光",
  confidence: 1,
  sampleCount: 2,
  lastUpdated: 2_500
} as const;

describe("Preference Summary delete/reset", () => {
  it("单条删除和全部清除只隐藏摘要，Preference Event 始终保留", async () => {
    const schema = (contracts as Record<string, unknown>).preferenceSummaryDismissalSchema;
    const filter = (core as Record<string, unknown>).filterDismissedPreferenceSummaries;
    const saveEvents = (db as Record<string, unknown>).savePreferenceEvents;
    const dismiss = (db as Record<string, unknown>).dismissPreferenceSummary;
    const dismissAll = (db as Record<string, unknown>).dismissPreferenceSummaries;
    const listDismissals = (db as Record<string, unknown>).listPreferenceSummaryDismissals;
    expect(schema).toBeDefined();
    expect(filter).toBeTypeOf("function");
    expect(saveEvents).toBeTypeOf("function");
    expect(dismiss).toBeTypeOf("function");
    expect(dismissAll).toBeTypeOf("function");
    expect(listDismissals).toBeTypeOf("function");
    if ([filter, saveEvents, dismiss, dismissAll, listDismissals].some((value) => typeof value !== "function")) return;

    const facts = [1_000, 2_000].map((createdAt, index) => ({
      schemaVersion: "1.0.0",
      id: `delete-fact-${index}`,
      projectId: "delete-project",
      dimension: "palette",
      field: "palette.saturation",
      label: "饱和度",
      before: "高",
      after: "低",
      source: "editor",
      createdAt
    }));
    await saveEvents(facts);
    await dismiss(paletteSummary, 3_000);
    let dismissals = await listDismissals();
    expect(filter([paletteSummary, lightingSummary], dismissals)).toEqual([lightingSummary]);
    expect((await db.listPreferenceEvents()).filter((event) => event.projectId === "delete-project")).toEqual(facts);

    await dismissAll([paletteSummary, lightingSummary], 4_000);
    dismissals = await listDismissals();
    expect(filter([paletteSummary, lightingSummary], dismissals)).toEqual([]);
    expect(filter([{ ...paletteSummary, lastUpdated: 5_000 }], dismissals)).toHaveLength(1);
    expect((await db.listPreferenceEvents()).filter((event) => event.projectId === "delete-project")).toEqual(facts);
  });
});
