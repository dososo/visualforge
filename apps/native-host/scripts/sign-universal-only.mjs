import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  renameSync,
  rmdirSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutputPath = path.join(packageRoot, "release", "darwin-universal", "visualforge-native-host");
const outputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultOutputPath;
const entitlementsPath = path.join(packageRoot, "release-entitlements.plist");
const signingIdentity = process.env.VISUALFORGE_SIGN_IDENTITY?.trim();
const MAX_TIMESTAMP_ATTEMPTS = 3;

if (process.platform !== "darwin") throw new Error("Universal 最终签名只能在 macOS 执行");
if (!signingIdentity) throw new Error("缺少 VISUALFORGE_SIGN_IDENTITY，不能完成 Universal 最终签名");

const temporaryDirectory = mkdtempSync(path.join(path.dirname(outputPath), ".visualforge-universal-sign-"));
const armSourcePath = path.join(temporaryDirectory, "source-arm64");
const x64SourcePath = path.join(temporaryDirectory, "source-x86_64");
const armPath = path.join(temporaryDirectory, "signed-arm64");
const x64Path = path.join(temporaryDirectory, "signed-x86_64");
const temporaryOutputPath = path.join(temporaryDirectory, "visualforge-native-host");

function removeExistingSignature(filePath) {
  try {
    execFileSync("/usr/bin/codesign", ["--remove-signature", filePath], { stdio: "pipe" });
  } catch (error) {
    const stderr = String(error?.stderr ?? "");
    if (!stderr.includes("code object is not signed at all")) throw error;
  }
}

async function signSlice(filePath) {
  for (let attempt = 1; attempt <= MAX_TIMESTAMP_ATTEMPTS; attempt += 1) {
    try {
      execFileSync("/usr/bin/codesign", [
        "--force",
        "--options", "runtime",
        "--timestamp",
        "--entitlements", entitlementsPath,
        "--identifier", "com.blteam.visualforge.native-host",
        "--sign", signingIdentity,
        filePath
      ], { stdio: "pipe" });
      return;
    } catch (error) {
      const stderr = String(error?.stderr ?? "");
      const timestampUnavailable = stderr.includes("The timestamp service is not available.");
      if (!timestampUnavailable || attempt === MAX_TIMESTAMP_ATTEMPTS) throw error;
      process.stderr.write(`Apple 时间戳暂时不可用，${attempt * 2} 秒后重试当前架构签名。\n`);
      await delay(attempt * 2_000);
    }
  }
}

try {
  copyFileSync(outputPath, armSourcePath);
  copyFileSync(outputPath, x64SourcePath);
  execFileSync("/usr/bin/lipo", [armSourcePath, "-extract", "arm64", "-output", armPath]);
  execFileSync("/usr/bin/lipo", [x64SourcePath, "-extract", "x86_64", "-output", x64Path]);
  removeExistingSignature(armPath);
  removeExistingSignature(x64Path);
  await signSlice(armPath);
  await signSlice(x64Path);
  execFileSync("/usr/bin/lipo", ["-create", armPath, x64Path, "-output", temporaryOutputPath]);
  chmodSync(temporaryOutputPath, 0o755);
  execFileSync("/usr/bin/codesign", [
    "--verify", "--strict", "--all-architectures", "--verbose=4", temporaryOutputPath
  ], { stdio: "inherit" });
  // 每个 Mach-O 切片的 codesign 是该切片最后一次修改；lipo 只负责组装 Fat 容器。
  renameSync(temporaryOutputPath, outputPath);
} finally {
  for (const filePath of [armSourcePath, x64SourcePath, armPath, x64Path, temporaryOutputPath]) {
    try {
      unlinkSync(filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  rmdirSync(temporaryDirectory);
}
