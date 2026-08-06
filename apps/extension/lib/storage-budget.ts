export const STORAGE_SAFETY_RESERVE_BYTES = 16 * 1024 * 1024;

export async function ensureBrowserStorageCapacity(additionalBytes: number) {
  const storage = globalThis.navigator?.storage;
  if (!storage?.estimate) return;
  let estimate: StorageEstimate;
  try {
    estimate = await storage.estimate();
  } catch {
    return;
  }
  if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;
  const available = Math.max(0, estimate.quota! - estimate.usage!);
  if (additionalBytes + STORAGE_SAFETY_RESERVE_BYTES > available) {
    throw new Error("浏览器本地空间不足，无法安全保存这张图片。请释放空间后重试；原图和已有作品不会被删除。");
  }
}
