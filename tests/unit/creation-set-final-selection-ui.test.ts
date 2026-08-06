import { describe, expect, it } from "vitest";
import type { CreationSetPlanItem } from "@styleforge/contracts";

type FinalSelectionItem = Pick<
  CreationSetPlanItem,
  "status" | "selectedOutputAssetId" | "finalSelection"
>;

function item(
  assetId: string,
  options: { selected?: boolean; boundAssetId?: string } = {}
): FinalSelectionItem {
  const selectedOutputAssetId = options.selected ? assetId : null;
  return {
    status: "COMPLETED",
    selectedOutputAssetId,
    finalSelection: options.selected
      ? {
          assetId: options.boundAssetId ?? assetId,
          outputSha256: "a".repeat(64),
          byteLength: 10,
          generationEventId: `event-${assetId}`,
          criticDisposition: "skipped",
          criticReportId: null,
          criticCheckedAt: null,
          selectedAt: 100
        }
      : null
  };
}

describe("套图 Final Selection UI 门禁", () => {
  it("只有每格都持久化了与当前候选一致的人工选择才允许导出", async () => {
    const module = await import(
      "../../apps/extension/entrypoints/sidepanel/CreationSetView"
    );
    const getProgress = (module as unknown as {
      getCreationSetFinalSelectionProgress?: (
        items: FinalSelectionItem[],
        requestedCount: number
      ) => { selectedCount: number; requiredCount: number; ready: boolean };
    }).getCreationSetFinalSelectionProgress;

    expect(getProgress).toBeTypeOf("function");
    expect(getProgress!([item("one"), item("two", { selected: true })], 2)).toEqual({
      selectedCount: 1,
      requiredCount: 2,
      ready: false
    });
    expect(getProgress!([
      item("one", { selected: true, boundAssetId: "another" }),
      item("two", { selected: true })
    ], 2)).toEqual({
      selectedCount: 1,
      requiredCount: 2,
      ready: false
    });
    expect(getProgress!([
      item("one", { selected: true }),
      item("two", { selected: true })
    ], 2)).toEqual({
      selectedCount: 2,
      requiredCount: 2,
      ready: true
    });
  });

  it("质量未完成或发现问题时要求显式确认，只有通过时无需确认", async () => {
    const module = await import(
      "../../apps/extension/entrypoints/sidepanel/CreationSetView"
    );
    const getWarning = (module as unknown as {
      getCreationSetFinalSelectionWarning?: (
        qualityStatus: CreationSetPlanItem["qualityStatus"]
      ) => string | null;
    }).getCreationSetFinalSelectionWarning;

    expect(getWarning).toBeTypeOf("function");
    expect(getWarning!("passed")).toBeNull();
    expect(getWarning!("needs_repair")).toContain("仍有问题");
    expect(getWarning!("unavailable")).toContain("还没有完成质量检查");
    expect(getWarning!("not_checked")).toContain("还没有完成质量检查");
  });

  it("部分失败时只要求已完成画面全部选定，允许导出已完成单张", async () => {
    const module = await import(
      "../../apps/extension/entrypoints/sidepanel/CreationSetView"
    );
    const getProgress = (module as unknown as {
      getCreationSetFinalSelectionProgress: (
        items: FinalSelectionItem[],
        requestedCount: number
      ) => { selectedCount: number; requiredCount: number; ready: boolean };
    }).getCreationSetFinalSelectionProgress;
    const completed = [
      item("one", { selected: true }),
      item("two", { selected: true }),
      { status: "FAILED", selectedOutputAssetId: null, finalSelection: null } as FinalSelectionItem,
      { status: "FAILED", selectedOutputAssetId: null, finalSelection: null } as FinalSelectionItem
    ];
    expect(getProgress(completed, 2)).toEqual({
      selectedCount: 2,
      requiredCount: 2,
      ready: true
    });
  });
});
