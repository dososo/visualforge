import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const extensionId = "jjmhfaamncdoaliheodgcnhklimoaocc";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const hostPath = path.resolve(scriptDir, "../dist/src/index.js");
const supportDir = path.join(os.homedir(), "Library/Application Support/VisualForge");
const launcherPath = path.join(supportDir, "visualforge-native-host");
const manifestDirs = [
  path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts")
];
if (process.argv.includes("--development-browsers")) manifestDirs.push(
  path.join(os.homedir(), "Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts"),
  path.join(os.homedir(), "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"),
  path.join(os.homedir(), "Library/Application Support/Chromium/NativeMessagingHosts")
);

await chmod(hostPath, 0o755).catch(() => {
  throw new Error("尚未构建 Native Host。请先运行 pnpm --filter @styleforge/native-host build。");
});
await mkdir(supportDir, { recursive: true });
await writeFile(
  launcherPath,
  `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(hostPath)}\n`,
  { mode: 0o755 }
);
await chmod(launcherPath, 0o755);
const manifest = `${JSON.stringify({
  name: "com.blteam.styleforge",
  description: "VisualForge 本地 Codex 桥接程序",
  path: launcherPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`]
}, null, 2)}\n`;

for (const manifestDir of manifestDirs) {
  await mkdir(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, "com.blteam.styleforge.json");
  await writeFile(manifestPath, manifest, { mode: 0o644 });
  process.stdout.write(`已安装 Native Host：${manifestPath}\n`);
}
process.stdout.write(`扩展 ID：${extensionId}\n`);
if (!process.argv.includes("--development-browsers")) {
  process.stdout.write("默认只安装到 Google Chrome Stable；开发测试浏览器请显式追加 --development-browsers。\n");
}
