export const HOVER_CONTENT_SCRIPT_FILE = "content-scripts/hover.js";

export const COMMON_HOVER_SITE_PATTERNS = [
  "https://*.pinterest.com/*",
  "https://*.behance.net/*",
  "https://*.dribbble.com/*",
  "https://*.unsplash.com/*",
  "https://*.pexels.com/*",
  "https://*.pixabay.com/*",
  "https://*.xiaohongshu.com/*"
] as const;

interface OpenTabHoverApi {
  scripting: {
    executeScript(input: {
      target: { tabId: number };
      files: string[];
    }): Promise<unknown>;
  };
  tabs: {
    query(input: Record<string, never>): Promise<Array<{ id?: number; url?: string }>>;
    sendMessage(tabId: number, message: { type: "hover.disable" }): Promise<unknown>;
  };
}

export function sitePermissionOriginForUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

export async function applyHoverSettingToOpenTabs(
  api: OpenTabHoverApi,
  enabled: boolean
): Promise<void> {
  const tabs = await api.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (tab.id === undefined || !tab.url || !sitePermissionOriginForUrl(tab.url)) return;
    if (enabled) {
      await api.scripting.executeScript({
        target: { tabId: tab.id },
        files: [HOVER_CONTENT_SCRIPT_FILE]
      }).catch(() => undefined);
      return;
    }
    await api.tabs.sendMessage(tab.id, { type: "hover.disable" }).catch(() => undefined);
  }));
}
