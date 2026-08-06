import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import {
  COMMON_HOVER_SITE_PATTERNS,
  applyHoverSettingToOpenTabs,
  sitePermissionOriginForUrl
} from "../../apps/extension/lib/site-permissions";

const root = new URL("../../", import.meta.url);

describe("悬浮按钮网站权限", () => {
  it("只把当前 HTTPS origin 转为当前网站权限范围", () => {
    expect(sitePermissionOriginForUrl("https://www.behance.net/gallery/123")).toBe("https://www.behance.net/*");
    expect(sitePermissionOriginForUrl("http://localhost:4173/gallery")).toBeNull();
    expect(sitePermissionOriginForUrl("chrome://settings")).toBeNull();
    expect(sitePermissionOriginForUrl("not a url")).toBeNull();
  });

  it("列出七个常用网站但不包含全网页强制权限", () => {
    expect(COMMON_HOVER_SITE_PATTERNS).toEqual(expect.arrayContaining([
      "https://*.pinterest.com/*",
      "https://*.behance.net/*",
      "https://*.dribbble.com/*",
      "https://*.unsplash.com/*",
      "https://*.pexels.com/*",
      "https://*.pixabay.com/*",
      "https://*.xiaohongshu.com/*"
    ]));
    expect(COMMON_HOVER_SITE_PATTERNS).not.toContain("<all_urls>");
  });

  it("实际 Manifest 使用安装时 HTTPS 权限且产品代码不再请求虚假的逐站权限", async () => {
    const [{ default: config }, sitePermissionSource, sidePanelSource] = await Promise.all([
      import("../../apps/extension/wxt.config"),
      readFile(new URL("apps/extension/lib/site-permissions.ts", root), "utf8"),
      readFile(new URL("apps/extension/entrypoints/sidepanel/App.tsx", root), "utf8")
    ]);
    const manifest = config.manifest as {
      permissions?: string[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };

    expect(manifest.host_permissions).toEqual(["https://*/*"]);
    expect(manifest.optional_host_permissions ?? []).toEqual([]);
    expect(manifest.permissions ?? []).not.toContain("permissions");
    expect(`${sitePermissionSource}\n${sidePanelSource}`).not.toMatch(/permissions\s*\.\s*request/);
    expect(sidePanelSource).not.toContain("enableHoverForSite");
  }, 15_000);

  it("全局开启时立即给已打开的普通网页补注入按钮", async () => {
    const injected: number[] = [];
    const disabled: number[] = [];
    const api = {
      scripting: {
        executeScript: async ({ target }: { target: { tabId: number } }) => {
          injected.push(target.tabId);
        }
      },
      tabs: {
        query: async () => [
          { id: 1, url: "https://dribbble.com/shots/1" },
          { id: 2, url: "https://example.com/" },
          { id: 3, url: "chrome://settings/" }
        ],
        sendMessage: async (tabId: number) => {
          disabled.push(tabId);
        }
      }
    };
    await applyHoverSettingToOpenTabs(api, true);
    expect(injected).toEqual([1, 2]);
    expect(disabled).toEqual([]);

    await applyHoverSettingToOpenTabs(api, false);
    expect(disabled).toEqual([1, 2]);
  });
});
