import { describe, expect, it } from "vitest";
import * as core from "@styleforge/core";
import { dna } from "./contracts.test";

describe("DNA Revision 与生成历史", () => {
  it("修改后生成新事件，并保留原事件 revision", async () => {
    const revise = (core as Record<string, unknown>).reviseVisualDNA;
    expect(revise).toBeTypeOf("function");
    if (typeof revise !== "function") return;
    const original = dna;
    const revised = revise(original, {
      palette: { ...dna.palette, temperature: "暖色" }
    }, 2_000);
    const makeManifest = (visualDNA: typeof original, id: string, outputId: string, completedAt: number) =>
      core.createGenerationManifest({
        id,
        projectId: "project",
        taskId: `task-${id}`,
        createdAt: completedAt - 1,
        completedAt,
        source: {
          assetId: "source",
          hash: "a".repeat(64),
          mimeType: "image/png",
          fileName: "source.png"
        },
        visualDNA,
        prompt: `Prompt ${id}`,
        model: { provider: "mock", name: "styleforge-mock", version: "1" },
        parameters: {
          aspectRatio: "4:3",
          count: 1,
          userInstruction: "",
          providerParameters: {}
        },
        outputs: [{
          assetId: outputId,
          hash: (id === "old" ? "b" : "c").repeat(64),
          mimeType: "image/png",
          byteLength: 10,
          fileName: `${outputId}.png`
        }]
      });
    const oldEvent = core.createGenerationEvents(
      await makeManifest(original, "old", "old-output", 10),
      { ids: ["old-event"], parentGenerationId: null }
    )[0]!;
    const newEvent = core.createGenerationEvents(
      await makeManifest(revised, "new", "new-output", 20),
      { ids: ["new-event"], parentGenerationId: oldEvent.id }
    )[0]!;
    expect(oldEvent.dnaRevision).toBe(1);
    expect(newEvent.dnaRevision).toBe(2);
    expect(newEvent.parentGenerationId).toBe(oldEvent.id);
    expect(oldEvent.outputAssetId).toBe("old-output");
  });
});
