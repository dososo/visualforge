import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertStagingMatchesManifest,
  assertArchiveEntries,
  assertDarwinDmgFinderEntriesVisible,
  cleanupStagingDirectory,
  createFreshStagingDirectory,
  createPackagedBuildMetadata,
  publishArtifactSetWithChecksums,
  publishArtifactWithChecksum,
  removeStaleChecksum,
  renderCodexDiscoveryGuidance,
  renderDistributionInstaller,
  renderDistributionUninstaller,
  renderLinuxInstaller,
  requireDistributionExtensionId,
  validateHostBuildMetadata,
  verifyDistributionBindings,
  verifyInstallCommandBinding,
  verifyNativeManifestBinding
} from "./distribution-release-policy.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const packageVersion = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
if (typeof packageVersion !== "string" || !packageVersion.trim()) {
  throw new Error("Native Host package.json 缺少有效版本号");
}
const targetPlatform = process.env.VISUALFORGE_TARGET_PLATFORM?.trim() || "darwin";
if (!['darwin', 'win32', 'linux'].includes(targetPlatform)) {
  throw new Error(`不支持的分发平台：${targetPlatform}`);
}
const targetArch = process.env.VISUALFORGE_TARGET_ARCH?.trim() || process.arch;
if (!['arm64', 'x64', 'universal'].includes(targetArch)) {
  throw new Error(`不支持的分发架构：${targetArch}`);
}
if (targetPlatform !== "darwin" && targetArch !== "x64") {
  throw new Error(`${targetPlatform} 当前只提供 x64 分发包`);
}
const distributionChannel = process.env.VISUALFORGE_DISTRIBUTION_CHANNEL?.trim() || "developer";
if (!['developer', 'store'].includes(distributionChannel)) {
  throw new Error(`不支持的分发渠道：${distributionChannel}`);
}
const storeDistribution = distributionChannel === "store";
const developmentExtensionId = "jjmhfaamncdoaliheodgcnhklimoaocc";
const releaseExtensionId = requireDistributionExtensionId({
  channel: distributionChannel,
  configuredId: process.env.VISUALFORGE_EXTENSION_ID,
  developmentId: developmentExtensionId
});
const platformLabel = targetPlatform === "darwin" ? "macos" : targetPlatform === "win32" ? "windows" : "linux";
const binaryName = targetPlatform === "win32" ? "visualforge-native-host.exe" : "visualforge-native-host";
const stagingRoot = targetPlatform === "darwin" ? os.tmpdir() : path.join(packageRoot, "dist-standalone");
const stagingDir = await createFreshStagingDirectory(
  stagingRoot,
  `package-${targetPlatform}-${targetArch}`
);
const outputDir = path.join(workspaceRoot, "dist-distribution");
const archiveExtension = targetPlatform === "linux" ? "tar.gz" : "zip";
const outputPath = path.join(outputDir, `VisualForge-${packageVersion}-${platformLabel}-${targetArch}.${archiveExtension}`);
const dmgPath = path.join(outputDir, `VisualForge-${packageVersion}-macos-${targetArch}.dmg`);
const notarizationResultPath = path.join(outputDir, `VisualForge-${packageVersion}-macos-${targetArch}.notarization-result.json`);
const temporaryOutputPath = `${outputPath}.building-${process.pid}.${archiveExtension}`;
const temporaryDmgPath = `${dmgPath}.building-${process.pid}.dmg`;
const releaseDir = path.join(packageRoot, "release", `${targetPlatform}-${targetArch}`);
const hostPath = path.join(releaseDir, binaryName);
const metadataPath = path.join(releaseDir, "build-metadata.json");
const checksumsPath = path.join(releaseDir, "SHA256SUMS");
const extensionPath = path.join(workspaceRoot, `apps/extension/.output/VisualForge-${packageVersion}-chrome.zip`);
const stagedHost = path.join(stagingDir, binaryName);
const stagedExtension = path.join(stagingDir, "VisualForge-extension.zip");
const installerName = targetPlatform === "darwin" ? "Install.command" : targetPlatform === "win32" ? "Install.ps1" : "install.sh";
const uninstallerName = targetPlatform === "darwin" ? "Uninstall.command" : targetPlatform === "win32" ? "Uninstall.ps1" : "uninstall.sh";
const installerPath = path.join(stagingDir, installerName);
const uninstallerPath = path.join(stagingDir, uninstallerName);
const readmePath = path.join(stagingDir, "README-install.txt");
const noticesPath = path.join(stagingDir, "THIRD_PARTY_NOTICES.txt");
const extensionNoticesPath = path.join(stagingDir, "EXTENSION_THIRD_PARTY_NOTICES.txt");
const productLicensePath = path.join(stagingDir, "VISUALFORGE_LICENSE.txt");
const nodeLicensePath = path.join(stagingDir, "NODE_LICENSE.txt");
const stagedMetadata = path.join(stagingDir, "build-metadata.json");
const stagedChecksums = path.join(stagingDir, "SHA256SUMS");
const entitlementsEvidencePath = path.join(packageRoot, "release-entitlements-evidence.json");
const entitlementsPath = path.join(packageRoot, "release-entitlements.plist");
const stagedEntitlementsEvidence = path.join(stagingDir, "release-entitlements-evidence.json");
const sourceExtensionNotices = path.join(workspaceRoot, "apps/extension/public/THIRD_PARTY_NOTICES.txt");
const sourceProductLicense = path.join(workspaceRoot, "LICENSE");
const runtimeFolder = targetPlatform === "win32"
  ? "node-v22.17.1-win-x64"
  : "node-v22.17.1-linux-x64";
const sourceNodeLicense = targetPlatform === "darwin"
  ? path.resolve(path.dirname(process.execPath), "..", "LICENSE")
  : path.join(packageRoot, "dist-standalone", "node-runtime-cache", runtimeFolder, "LICENSE");
try {
const [sourceMetadata, hostBytes, checksums, extensionBytes, extensionManifestOutput] = await Promise.all([
  readFile(metadataPath, "utf8").then(JSON.parse),
  readFile(hostPath),
  readFile(checksumsPath, "utf8"),
  readFile(extensionPath),
  execFileAsync("/usr/bin/unzip", ["-p", extensionPath, "manifest.json"], { maxBuffer: 4 * 1024 * 1024 })
]);
const extensionManifest = JSON.parse(extensionManifestOutput.stdout);
const hostSha256 = createHash("sha256").update(hostBytes).digest("hex");
const extensionZipSha256 = createHash("sha256").update(extensionBytes).digest("hex");
const extensionZipSource = path.basename(extensionPath);
validateHostBuildMetadata({
  metadata: sourceMetadata,
  packageVersion,
  targetPlatform,
  targetArch,
  binaryName,
  actualSha256: hostSha256,
  checksums
});
const metadata = createPackagedBuildMetadata(
  sourceMetadata,
  distributionChannel,
  releaseExtensionId,
  { extensionZipSha256, extensionZipSource, extensionZipIncluded: !storeDistribution }
);
metadata.runtimeVerifiedOnBuildMachine = targetPlatform === process.platform &&
  (metadata.runtimeVerifiedOnBuildMachine === true || targetArch === "universal");
const signingIdentity = process.env.VISUALFORGE_SIGN_IDENTITY?.trim();

await mkdir(outputDir, { recursive: true });
await Promise.all([
  removeStaleChecksum(outputPath),
  ...(targetPlatform === "darwin" ? [removeStaleChecksum(dmgPath)] : []),
  unlink(temporaryOutputPath).catch((error) => { if (error.code !== "ENOENT") throw error; }),
  ...(targetPlatform === "darwin"
    ? [unlink(temporaryDmgPath).catch((error) => { if (error.code !== "ENOENT") throw error; })]
    : [])
]);
await Promise.all([
  copyFile(hostPath, stagedHost),
  copyFile(checksumsPath, stagedChecksums),
  copyFile(sourceProductLicense, productLicensePath),
  copyFile(sourceNodeLicense, nodeLicensePath),
  ...(targetPlatform === "darwin" ? [copyFile(entitlementsEvidencePath, stagedEntitlementsEvidence)] : [])
]);
await writeFile(stagedMetadata, `${JSON.stringify(metadata, null, 2)}\n`);
if (storeDistribution) {
  await Promise.all([
    unlink(stagedExtension).catch((error) => { if (error.code !== "ENOENT") throw error; }),
    unlink(extensionNoticesPath).catch((error) => { if (error.code !== "ENOENT") throw error; })
  ]);
} else {
  await Promise.all([
    copyFile(extensionPath, stagedExtension),
    copyFile(sourceExtensionNotices, extensionNoticesPath)
  ]);
}
if (targetPlatform !== "win32") await chmod(stagedHost, 0o755);

const installer = targetPlatform === "linux"
  ? renderLinuxInstaller({ binaryName, releaseExtensionId })
  : renderDistributionInstaller({ platform: targetPlatform, binaryName, releaseExtensionId });
const uninstaller = renderDistributionUninstaller({ platform: targetPlatform, binaryName });
await writeFile(installerPath, installer, targetPlatform === "win32" ? undefined : { mode: 0o755 });
await writeFile(uninstallerPath, uninstaller, targetPlatform === "win32" ? undefined : { mode: 0o755 });
if (targetPlatform !== "win32") {
  await chmod(installerPath, 0o755);
  await chmod(uninstallerPath, 0o755);
}
verifyDistributionBindings({
  installer,
  metadata,
  extensionManifest,
  releaseExtensionId,
  distributionChannel,
  actualExtensionZipSha256: storeDistribution
    ? extensionZipSha256
    : createHash("sha256").update(await readFile(stagedExtension)).digest("hex"),
  extensionZipSource
});

async function verifyInstalledNativeManifest() {
  if (targetPlatform !== "darwin") return;
  const verificationHome = await mkdtemp(path.join(os.tmpdir(), "visualforge-package-binding-"));
  const supportRoot = path.join(verificationHome, "Library/Application Support");
  const manifestDirectory = path.join(supportRoot, "Google/Chrome/NativeMessagingHosts");
  const manifestPath = path.join(manifestDirectory, "com.blteam.styleforge.json");
  const installedBinDirectory = path.join(supportRoot, "VisualForge/bin");
  const installedHostPath = path.join(installedBinDirectory, "visualforge-native-host");
  try {
    await execFileAsync(stagedHost, ["--install", "--extension-id", releaseExtensionId], {
      env: { ...process.env, HOME: verificationHome }
    });
    verifyNativeManifestBinding(JSON.parse(await readFile(manifestPath, "utf8")), releaseExtensionId);
  } finally {
    await unlink(manifestPath).catch(() => undefined);
    await unlink(installedHostPath).catch(() => undefined);
    for (const directory of [
      manifestDirectory, path.dirname(manifestDirectory), path.dirname(path.dirname(manifestDirectory)),
      installedBinDirectory, path.dirname(installedBinDirectory), supportRoot,
      path.dirname(supportRoot), verificationHome
    ]) await rmdir(directory).catch(() => undefined);
  }
}
await verifyInstalledNativeManifest();

async function finalizeStagedDarwinHost() {
  if (targetPlatform !== "darwin" || targetArch !== "universal"
    || metadata.signature !== "developer-id-application") return;
  if (!signingIdentity) throw new Error("缺少 VISUALFORGE_SIGN_IDENTITY，不能完成包内 Host 最终签名");
  const verificationDirectory = await mkdtemp(path.join(os.tmpdir(), "visualforge-staged-signature-"));
  const armPath = path.join(verificationDirectory, "visualforge-native-host.arm64");
  const x64Path = path.join(verificationDirectory, "visualforge-native-host.x86_64");
  try {
    await execFileAsync("/usr/bin/lipo", [stagedHost, "-extract", "arm64", "-output", armPath]);
    await execFileAsync("/usr/bin/lipo", [stagedHost, "-extract", "x86_64", "-output", x64Path]);
    await Promise.all([
      execFileAsync("/usr/bin/codesign", ["--remove-signature", armPath]),
      execFileAsync("/usr/bin/codesign", ["--remove-signature", x64Path])
    ]);
    await unlink(stagedHost);
    await execFileAsync("/usr/bin/lipo", ["-create", armPath, x64Path, "-output", stagedHost]);
    await chmod(stagedHost, 0o755);
    await execFileAsync("/usr/bin/codesign", [
      "--force",
      "--options", "runtime",
      "--timestamp",
      "--entitlements", entitlementsPath,
      "--identifier", "com.blteam.visualforge.native-host",
      "--sign", signingIdentity,
      stagedHost
    ]);
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", stagedHost]);
    const [hostBytes, armBytes, x64Bytes] = await Promise.all([
      readFile(stagedHost), readFile(armPath), readFile(x64Path)
    ]);
    metadata.sha256 = createHash("sha256").update(hostBytes).digest("hex");
    metadata.preFinalUnsignedSliceSha256 = {
      arm64: createHash("sha256").update(armBytes).digest("hex"),
      x86_64: createHash("sha256").update(x64Bytes).digest("hex")
    };
    delete metadata.universalSliceSha256;
    metadata.postInstallFinalSignatureVerified = true;
    await Promise.all([
      writeFile(stagedChecksums, `${metadata.sha256}  ${binaryName}\n`),
      writeFile(stagedMetadata, `${JSON.stringify(metadata, null, 2)}\n`)
    ]);
  } finally {
    await Promise.all([unlink(armPath).catch(() => undefined), unlink(x64Path).catch(() => undefined)]);
    await rmdir(verificationDirectory).catch(() => undefined);
  }
}

await finalizeStagedDarwinHost();

const installationSteps = storeDistribution
  ? [
      `1. 运行 ${installerName} 安装 Native Host。`,
      "2. 扩展请从 Chrome Web Store 安装；本包不包含扩展安装文件。",
      `3. 如需卸载 Host，运行 ${uninstallerName}。`
    ]
  : [
      `1. 运行 ${installerName} 安装 Native Host。`,
      "2. 解压 VisualForge-extension.zip。",
      "3. 打开 chrome://extensions，启用开发者模式，加载解压后的扩展目录。",
      `4. 如需卸载 Host，运行 ${uninstallerName}。`
    ];
const codexDiscoveryGuidance = renderCodexDiscoveryGuidance(targetPlatform, binaryName);
await writeFile(readmePath, [
  `VisualForge ${platformLabel} ${targetArch} 独立分发候选版`,
  "",
  ...installationSteps,
  "",
  "本包不依赖用户安装 Node，但仍要求本机已安装并登录 Codex CLI。",
  ...codexDiscoveryGuidance,
  metadata.runtimeVerifiedOnBuildMachine
    ? "当前 SEA 已在构建机执行版本自检。"
    : "当前 SEA 为交叉构建产物，未在目标系统执行；必须在目标系统完成安装与运行验收。",
  targetPlatform === "darwin"
    ? (metadata.signature === "developer-id-application"
        ? "当前二进制已使用 Developer ID Application 签名并启用 Hardened Runtime；Apple 公证状态以 build-metadata.json 和发布报告为准。"
        : "当前二进制仅为 ad-hoc 签名候选，尚未完成 Developer ID 签名与 Apple 公证。")
    : "当前二进制未做平台代码签名。"
].join("\n") + "\n");
await writeFile(noticesPath, [
  "VisualForge Native Host includes:",
  "- Node.js runtime — MIT License",
  "- Zod — MIT License",
  "Build tooling: esbuild and postject — MIT License",
  "See each upstream project for full license text."
].join("\n") + "\n");

const corePackageFiles = [
  stagedHost, installerPath, uninstallerPath, readmePath, noticesPath,
  productLicensePath, nodeLicensePath, stagedMetadata, stagedChecksums,
  ...(targetPlatform === "darwin" ? [stagedEntitlementsEvidence] : [])
];
const archiveFiles = storeDistribution ? corePackageFiles : [
  ...corePackageFiles,
  stagedExtension,
  extensionNoticesPath
];
await assertStagingMatchesManifest(stagingDir, archiveFiles);
if (targetPlatform === "darwin") {
  await execFileAsync("/usr/bin/chflags", ["nohidden", ...archiveFiles]);
}
if (targetPlatform === "linux") {
  await execFileAsync("/usr/bin/tar", [
    "-czf", temporaryOutputPath, "-C", stagingDir,
    ...archiveFiles.map((file) => path.basename(file))
  ]);
} else {
  await execFileAsync("/usr/bin/zip", ["-j", "-X", temporaryOutputPath, ...archiveFiles]);
}
const validateArchive = async (candidatePath) => {
  const command = targetPlatform === "linux" ? "/usr/bin/tar" : "/usr/bin/unzip";
  const args = targetPlatform === "linux" ? ["-tzf", candidatePath] : ["-Z1", candidatePath];
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 4 * 1024 * 1024 });
  assertArchiveEntries(stdout.split(/\r?\n/), archiveFiles);
  if (targetPlatform === "darwin" && targetArch === "universal") {
    const verificationDirectory = await mkdtemp(path.join(os.tmpdir(), "visualforge-archive-signature-"));
    const archivedHost = path.join(verificationDirectory, binaryName);
    try {
      await execFileAsync("/usr/bin/unzip", ["-q", candidatePath, binaryName, "-d", verificationDirectory]);
      await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", archivedHost]);
    } finally {
      await unlink(archivedHost).catch(() => undefined);
      await rmdir(verificationDirectory).catch(() => undefined);
    }
  }
};

const validateDarwinDmg = async (candidatePath) => {
  await execFileAsync("/usr/bin/hdiutil", ["verify", candidatePath]);
  const mountPoint = await mkdtemp(path.join(os.tmpdir(), "visualforge-dmg-finder-audit-"));
  try {
    await execFileAsync("/usr/bin/hdiutil", [
      "attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, candidatePath
    ]);
    const entries = await Promise.all(archiveFiles.map(async (file) => {
      const name = path.basename(file);
      const { stdout } = await execFileAsync("/usr/bin/stat", ["-f", "%Sf", path.join(mountPoint, name)]);
      return { name, flags: stdout.trim() };
    }));
    assertDarwinDmgFinderEntriesVisible(entries);
  } finally {
    await execFileAsync("/usr/bin/hdiutil", ["detach", mountPoint]).catch(() => undefined);
    await rmdir(mountPoint).catch(() => undefined);
  }
};

if (targetPlatform === "darwin") {
  await execFileAsync("/usr/bin/hdiutil", [
    "create",
    "-volname", "VisualForge",
    "-srcfolder", stagingDir,
    "-format", "UDZO",
    "-ov", temporaryDmgPath
  ]);
  if (metadata.signature === "developer-id-application") {
    if (!signingIdentity) throw new Error("Native Host 已正式签名，但缺少 VISUALFORGE_SIGN_IDENTITY，不能签名 DMG");
    await execFileAsync("/usr/bin/codesign", ["--force", "--timestamp", "--sign", signingIdentity, temporaryDmgPath]);
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", temporaryDmgPath]);
  }
  const [archiveHash, dmgHash] = await publishArtifactSetWithChecksums({
    artifacts: [
      { temporaryPath: temporaryOutputPath, outputPath, validate: validateArchive },
      {
        temporaryPath: temporaryDmgPath,
        outputPath: dmgPath,
        validate: validateDarwinDmg
      }
    ]
  });
  await unlink(notarizationResultPath).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  process.stdout.write(`已生成独立分发候选包：${outputPath}\nZIP SHA-256：${archiveHash}\n已生成可公证 DMG：${dmgPath}\nDMG SHA-256：${dmgHash}\n`);
} else {
  const archiveHash = await publishArtifactWithChecksum({
    temporaryPath: temporaryOutputPath,
    outputPath,
    validate: validateArchive
  });
  process.stdout.write(`已生成交叉构建分发候选包：${outputPath}\nSHA-256：${archiveHash}\n目标系统运行验证：未执行\n`);
}
} finally {
  await Promise.all([
    unlink(temporaryOutputPath).catch(() => undefined),
    unlink(temporaryDmgPath).catch(() => undefined)
  ]);
  await cleanupStagingDirectory(stagingDir);
}
