import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(packageRoot, "release", "darwin-universal", "visualforge-native-host");
const entitlementsPath = path.join(packageRoot, "release-entitlements.plist");
const signingIdentity = process.env.VISUALFORGE_SIGN_IDENTITY?.trim();

if (process.platform !== "darwin") throw new Error("Universal 最终签名只能在 macOS 执行");
if (!signingIdentity) throw new Error("缺少 VISUALFORGE_SIGN_IDENTITY，不能完成 Universal 最终签名");

// codesign 必须是本进程最后一个文件操作；调用者在本进程退出后再做冷验签与哈希记录。
execFileSync("/usr/bin/codesign", [
  "--force",
  "--options", "runtime",
  "--timestamp",
  "--entitlements", entitlementsPath,
  "--identifier", "com.blteam.visualforge.native-host",
  "--sign", signingIdentity,
  outputPath
], { stdio: "inherit" });
