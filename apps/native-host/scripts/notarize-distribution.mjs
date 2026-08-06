import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  clearDarwinFinderHiddenFlags,
  publishArtifactWithChecksum,
  removeStaleChecksum
} from "./distribution-release-policy.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const packageVersion = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
if (typeof packageVersion !== "string" || !packageVersion.trim()) {
  throw new Error("Native Host package.json 缺少有效版本号");
}
const targetArch = process.env.VISUALFORGE_TARGET_ARCH?.trim() || process.arch;
if (!['arm64', 'x64', 'universal'].includes(targetArch)) {
  throw new Error(`不支持的公证架构：${targetArch}`);
}
const archivePath = path.join(workspaceRoot, "dist-distribution", `VisualForge-${packageVersion}-macos-${targetArch}.dmg`);
const resultPath = path.join(
  workspaceRoot,
  "dist-distribution",
  `VisualForge-${packageVersion}-macos-${targetArch}.notarization-result.json`
);
const temporaryArchivePath = `${archivePath}.notarizing-${process.pid}.dmg`;
const temporaryResultPath = `${resultPath}.building-${process.pid}`;
const profile = process.env.VISUALFORGE_NOTARY_PROFILE?.trim();

if (!profile) {
  throw new Error("缺少 VISUALFORGE_NOTARY_PROFILE。请先用 notarytool store-credentials 创建钥匙串配置，再重试。");
}
async function inspectPackagedHost(dmgPath) {
  const mountPoint = await mkdtemp(path.join(os.tmpdir(), "visualforge-notarization-audit-"));
  try {
    await execFileAsync("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath]);
    const hostPath = path.join(mountPoint, "visualforge-native-host");
    const metadata = JSON.parse(await readFile(path.join(mountPoint, "build-metadata.json"), "utf8"));
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", hostPath]);
    const hostSha256 = createHash("sha256").update(await readFile(hostPath)).digest("hex");
    if (metadata.sha256 !== hostSha256) {
      throw new Error(`DMG 内 Host 哈希与构建元数据不一致：metadata=${metadata.sha256}，actual=${hostSha256}`);
    }
    return { metadata, hostSha256 };
  } finally {
    await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint]).catch(() => undefined);
    await rmdir(mountPoint).catch(() => undefined);
  }
}

const packagedHost = await inspectPackagedHost(archivePath);
const metadata = packagedHost.metadata;
if (metadata.signature !== "developer-id-application") {
  throw new Error("当前 Native Host 不是 Developer ID Application 签名，不能提交公证。");
}

await removeStaleChecksum(archivePath);
await copyFile(archivePath, temporaryArchivePath);
try {
  const { stdout } = await execFileAsync("/usr/bin/xcrun", [
    "notarytool", "submit", temporaryArchivePath,
    "--keychain-profile", profile,
    "--wait",
    "--output-format", "json"
  ], { maxBuffer: 4 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (result.status !== "Accepted") {
    throw new Error(`Apple 公证未通过：${result.status ?? "未知状态"}，submission id=${result.id ?? "未知"}`);
  }
  await execFileAsync("/usr/bin/xcrun", ["stapler", "staple", temporaryArchivePath]);
  const archiveHash = await publishArtifactWithChecksum({
    temporaryPath: temporaryArchivePath,
    outputPath: archivePath,
    validate: async (candidatePath) => {
      await execFileAsync("/usr/bin/xcrun", ["stapler", "validate", candidatePath]);
      await execFileAsync("/usr/sbin/spctl", [
        "--assess", "--type", "open", "--context", "context:primary-signature", "--verbose=2", candidatePath
      ]);
      const stapledHost = await inspectPackagedHost(candidatePath);
      if (stapledHost.hostSha256 !== packagedHost.hostSha256) {
        throw new Error("Staple 前后 DMG 内 Host 字节发生变化");
      }
    }
  });
  await writeFile(temporaryResultPath, `${JSON.stringify({
    artifact: path.basename(archivePath),
    artifactSha256AfterStaple: archiveHash,
    buildSha256: packagedHost.hostSha256,
    architectures: metadata.architectures,
    notarized: true,
    notarizationId: result.id,
    notarizedAt: new Date().toISOString(),
    status: result.status,
    stapled: true,
    gatekeeperAssessment: "accepted"
  }, null, 2)}\n`);
  await rename(temporaryResultPath, resultPath);
  await clearDarwinFinderHiddenFlags([archivePath, `${archivePath}.sha256`, resultPath]);
  process.stdout.write(`Apple 公证、Staple 与 Gatekeeper 验证通过：${result.id}\n证据：${resultPath}\n`);
} finally {
  await Promise.all([
    unlink(temporaryArchivePath).catch(() => undefined),
    unlink(temporaryResultPath).catch(() => undefined)
  ]);
}
