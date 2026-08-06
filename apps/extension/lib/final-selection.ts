import type { AssetRecord, GenerationEvent, ProjectRecord, SetQualityReport } from "@styleforge/contracts";
import { sha256Hex } from "@styleforge/core";

export function createProjectFinalSelection(
  asset: AssetRecord,
  event: GenerationEvent,
  qualityReport: SetQualityReport | undefined,
  qualityReportAssetId: string | undefined,
  selectedAt: number
): NonNullable<ProjectRecord["finalSelection"]> {
  const checked = qualityReport && qualityReportAssetId === asset.id;
  return {
    assetId: asset.id,
    outputSha256: asset.hash,
    generationEventId: event.id,
    criticDisposition: checked ? "checked" : "skipped",
    criticReportId: checked ? `${event.id}:${qualityReport.checkedAt}` : null,
    criticCheckedAt: checked ? qualityReport.checkedAt : null,
    selectedAt
  };
}

export function resolveProjectFinalAsset(project: ProjectRecord, assets: AssetRecord[]) {
  const finalAssetId = project.finalSelection?.assetId;
  if (!finalAssetId) return undefined;
  return assets.find((asset) => asset.id === finalAssetId);
}

export async function verifyProjectFinalAsset(
  asset: AssetRecord,
  selection: NonNullable<ProjectRecord["finalSelection"]>
) {
  if (asset.id !== selection.assetId) throw new Error("当前文件不是已选最终作品。");
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (hash !== selection.outputSha256 || hash !== asset.hash) {
    throw new Error("最终作品文件校验失败，请重新选择或重新生成。");
  }
  return hash;
}
