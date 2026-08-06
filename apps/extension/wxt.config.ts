import { defineConfig } from "wxt";
import { createHash } from "node:crypto";

const developmentManifestKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA/muJ3hPIvz8QC983CdXyrOlobC5l6fhrihJSZTWJctn0f0QxdtgYPAx2swS4+YKqCsiWiIvx+YhtbJM7kTPYqlzZ8o0gxVqtA02wHnDqzTWMCP6puOV5faEp/T8IOatptZn73pN3flXyVMpalQ0ezcrT3ZPXGsWncGKtZRpggqZddTOngGAJGYNQV9MQYTh4D8bvThPH3jTlGpTKGXY2nMnN9+n5nKm4GPLrBWW3SWDsgTbAcv0uVxSp0C+Qu+Yitns9OGf7TThII1xkUaBhgl8bZqnfY67a1t3iIrSg22IHEd0v2/tNy2+Ir8tU7BdEeG25pxrUCjnF7yjA8TxGfQIDAQAB";
const distributionChannel = process.env.VISUALFORGE_DISTRIBUTION_CHANNEL?.trim() || "developer";
const storeManifestKey = process.env.VISUALFORGE_EXTENSION_KEY?.trim();
const storeExtensionId = process.env.VISUALFORGE_EXTENSION_ID?.trim();
if (distributionChannel === "store") {
  if (!storeManifestKey) throw new Error("商店构建缺少 VISUALFORGE_EXTENSION_KEY（正式扩展 Public Key）");
  if (!/^[a-p]{32}$/.test(storeExtensionId ?? "")) throw new Error("商店构建缺少有效的 VISUALFORGE_EXTENSION_ID");
  const digest = createHash("sha256").update(Buffer.from(storeManifestKey, "base64")).digest().subarray(0, 16);
  const derivedId = [...digest].flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((value) => String.fromCharCode("a".charCodeAt(0) + value)).join("");
  if (derivedId !== storeExtensionId) throw new Error(`正式扩展 ID 与 Public Key 不匹配：${derivedId}`);
}
const manifestKey = distributionChannel === "store" ? storeManifestKey! : developmentManifestKey;

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  hooks: {
    "vite:build:extendConfig"(entrypoints, config) {
      if (!entrypoints.some((entrypoint) => entrypoint.type === "sidepanel")) return;
      config.build ??= {};
      config.build.rolldownOptions ??= {};
      config.build.rolldownOptions.output ??= {};
      const output = config.build.rolldownOptions.output;
      if (Array.isArray(output)) return;
      config.build.rolldownOptions.output = {
        ...output,
        codeSplitting: {
        groups: [
          {
            name: "vendor",
            test: /node_modules[\\/]/,
            maxSize: 300_000
          }
        ]
        }
      } as typeof output;
    }
  },
  manifest: {
    name: "VisualForge 风格铸造",
    description: "把参考图拆解为可编辑的视觉 DNA，并生成新的作品。",
    version: "0.5.8",
    minimum_chrome_version: "116",
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    },
    key: manifestKey,
    permissions: ["sidePanel", "contextMenus", "scripting", "storage", "nativeMessaging"],
    host_permissions: ["https://*/*"],
    icons: {
      "16": "icon/16.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "128": "icon/128.png"
    },
    action: {
      default_title: "打开 VisualForge",
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png"
      }
    },
    side_panel: { default_path: "sidepanel.html" },
    commands: {
      "_execute_action": {
        suggested_key: { default: "Alt+Shift+F", mac: "MacCtrl+Shift+F" }
      }
    }
  }
});
