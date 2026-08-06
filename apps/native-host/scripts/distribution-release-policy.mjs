import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const execFileAsync = promisify(execFile);

export async function createFreshStagingDirectory(root, prefix) {
  await mkdir(root, { recursive: true });
  return mkdtemp(path.join(root, `${prefix}-`));
}

export async function cleanupStagingDirectory(stagingDir) {
  const entries = await readdir(stagingDir, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length) {
    throw new Error(`staging 只能包含平铺文件，不能清理目录：${directories.map((entry) => entry.name).join(", ")}`);
  }
  await Promise.all(entries.map((entry) => unlink(path.join(stagingDir, entry.name))));
  await rmdir(stagingDir);
}

export async function withFreshStagingDirectory(root, prefix, work) {
  const stagingDir = await createFreshStagingDirectory(root, prefix);
  try {
    return await work(stagingDir);
  } finally {
    await cleanupStagingDirectory(stagingDir);
  }
}

export async function assertStagingMatchesManifest(stagingDir, files) {
  const expected = files.map((file) => path.basename(file));
  if (new Set(expected).size !== expected.length) {
    throw new Error("发行清单包含重复文件名");
  }
  const actual = (await readdir(stagingDir, { withFileTypes: true }))
    .map((entry) => entry.name);
  const unexpected = actual.filter((name) => !expected.includes(name));
  if (unexpected.length) {
    throw new Error(`staging 包含不在发行清单中的文件：${unexpected.join(", ")}`);
  }
  const missing = expected.filter((name) => !actual.includes(name));
  if (missing.length) {
    throw new Error(`staging 缺少发行清单文件：${missing.join(", ")}`);
  }
}

export function assertArchiveEntries(actual, expected) {
  const actualNames = actual.map((name) => name.replace(/^\.\//, "")).filter(Boolean);
  const expectedNames = expected.map((name) => path.basename(name));
  const unexpected = actualNames.filter((name) => !expectedNames.includes(name));
  if (unexpected.length) throw new Error(`发行压缩包包含多余文件：${unexpected.join(", ")}`);
  const missing = expectedNames.filter((name) => !actualNames.includes(name));
  if (missing.length) throw new Error(`发行压缩包缺少文件：${missing.join(", ")}`);
  if (new Set(actualNames).size !== actualNames.length) throw new Error("发行压缩包包含重复文件名");
}

export function assertDarwinDmgFinderEntriesVisible(entries) {
  const hiddenEntries = entries.filter(({ flags }) =>
    String(flags).split(/[\s,]+/).includes("hidden"));
  if (hiddenEntries.length) {
    throw new Error(`DMG 包含 Finder 隐藏项：${hiddenEntries.map(({ name }) => name).join(", ")}`);
  }
}

export async function clearDarwinFinderHiddenFlags(paths) {
  if (process.platform !== "darwin" || paths.length === 0) return;
  await execFileAsync("/usr/bin/chflags", ["nohidden", ...paths]);
  const entries = await Promise.all(paths.map(async (filePath) => {
    const { stdout } = await execFileAsync("/usr/bin/stat", ["-f", "%Sf", filePath]);
    return { name: path.basename(filePath), flags: stdout.trim() };
  }));
  assertDarwinDmgFinderEntriesVisible(entries);
}

export function validateHostBuildMetadata({
  metadata,
  packageVersion,
  targetPlatform,
  targetArch,
  binaryName,
  actualSha256,
  checksums
}) {
  const checks = [
    ["Host 版本", metadata.hostVersion, packageVersion],
    ["Host 平台", metadata.platform, targetPlatform],
    ["Host 架构", metadata.arch, targetArch],
    ["Host 现场 SHA-256", actualSha256, metadata.sha256]
  ];
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) throw new Error(`${label}不匹配：期望 ${expected}，实际 ${actual ?? "缺失"}`);
  }
  const expectedArchitectures = targetArch === "universal"
    ? ["arm64", "x86_64"]
    : [targetArch === "x64" ? "x86_64" : "arm64"];
  if (JSON.stringify(metadata.architectures) !== JSON.stringify(expectedArchitectures)) {
    throw new Error(`Host 元数据 architectures 不匹配：${JSON.stringify(metadata.architectures)}`);
  }
  const [checksumHash, checksumName] = checksums.trim().split(/\s+/, 2);
  if (checksumHash !== actualSha256 || checksumName !== binaryName) {
    throw new Error("Host SHA256SUMS 与现场文件不一致");
  }
  if (!/^[a-f0-9]{40}$/.test(metadata.sourceGitCommit ?? "")) {
    throw new Error("Host build-metadata sourceGitCommit 无效");
  }
  if (typeof metadata.sourceGitDirty !== "boolean") {
    throw new Error("Host build-metadata sourceGitDirty 必须是真实布尔值");
  }
  const expectedSourceIdentity = `git:${metadata.sourceGitCommit}${metadata.sourceGitDirty ? "+dirty" : ""}`;
  if (metadata.sourceIdentity !== expectedSourceIdentity) {
    throw new Error(`Host build-metadata sourceIdentity 不匹配：期望 ${expectedSourceIdentity}`);
  }
}

export function renderDistributionInstaller({ platform, binaryName, releaseExtensionId }) {
  if (!CHROME_EXTENSION_ID_PATTERN.test(releaseExtensionId)) {
    throw new Error(`Chrome 扩展 ID 无效：${releaseExtensionId}`);
  }
  if (platform === "win32") {
    return [
      "$ErrorActionPreference = 'Stop'",
      `$HostExecutable = Join-Path $PSScriptRoot '${binaryName}'`,
      `& $HostExecutable --install --extension-id '${releaseExtensionId}'`,
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      "Write-Host 'VisualForge Native Host 安装完成。'"
    ].join("\r\n") + "\r\n";
  }
  return [
    "#!/bin/sh",
    "set -eu",
    "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    `\"$SCRIPT_DIR/${binaryName}\" --install --extension-id \"${releaseExtensionId}\"`,
    "echo \"VisualForge Native Host 安装完成。\""
  ].join("\n") + "\n";
}

export function renderLinuxInstaller(input) {
  return renderDistributionInstaller({ ...input, platform: "linux" });
}

export function renderDistributionUninstaller({ platform, binaryName }) {
  if (platform === "win32") {
    return [
      "param([switch]$DeleteData)",
      "$ErrorActionPreference = 'Stop'",
      `$HostExecutable = Join-Path $PSScriptRoot '${binaryName}'`,
      "$Arguments = @('--uninstall')",
      "if ($DeleteData) { $Arguments += '--delete-data' }",
      "& $HostExecutable @Arguments",
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      "if ($DeleteData) {",
      "  Write-Host '已同时删除 VisualForge 本地数据；浏览器内作品仍需在扩展设置中清除。'",
      "} else {",
      "  Write-Host 'VisualForge Native Host 已卸载；本地作品数据已保留。'",
      "}"
    ].join("\r\n") + "\r\n";
  }
  return [
    "#!/bin/sh",
    "set -eu",
    "SCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)",
    "if [ \"${1:-}\" = \"--delete-data\" ]; then",
    `  \"$SCRIPT_DIR/${binaryName}\" --uninstall --delete-data`,
    "  echo \"已同时删除 VisualForge 本地数据；浏览器内作品仍需在扩展设置中清除。\"",
    "else",
    `  \"$SCRIPT_DIR/${binaryName}\" --uninstall`,
    "  echo \"VisualForge Native Host 已卸载；本地作品数据已保留。\"",
    "fi"
  ].join("\n") + "\n";
}

export function renderCodexDiscoveryGuidance(platform, binaryName) {
  if (platform === "darwin") return [];
  const command = platform === "win32"
    ? `& \".\\${binaryName}\" --configure-codex \"C:\\你的\\codex.exe\"`
    : `./${binaryName} --configure-codex \"/你的/codex/绝对路径\"`;
  return [
    "若 Windows／Linux 未自动发现 Codex，请只在确认路径可信后运行：",
    command
  ];
}

export function validateUniversalBuildInputs(input) {
  const expectedVersion = `visualforge-native-host ${input.packageVersion}`;
  const checks = [
    ["arm64 元数据版本", input.armMetadata.hostVersion, input.packageVersion],
    ["x64 元数据版本", input.x64Metadata.hostVersion, input.packageVersion],
    ["arm64 元数据平台", input.armMetadata.platform, "darwin"],
    ["x64 元数据平台", input.x64Metadata.platform, "darwin"],
    ["arm64 元数据架构", input.armMetadata.arch, "arm64"],
    ["x64 元数据架构", input.x64Metadata.arch, "x64"],
    ["arm64 切片 SHA-256", input.armActualSha256, input.armMetadata.sha256],
    ["x64 切片 SHA-256", input.x64ActualSha256, input.x64Metadata.sha256],
    ["arm64 切片实际架构", input.armActualArchitectures.trim(), "arm64"],
    ["x64 切片实际架构", input.x64ActualArchitectures.trim(), "x86_64"],
    ["arm64 切片实际版本", input.armVersionOutput.trim(), expectedVersion],
    ["x64 切片实际版本", input.x64VersionOutput.trim(), expectedVersion],
    ["Universal arm64 实际版本", input.universalArmVersionOutput.trim(), expectedVersion],
    ["Universal x64 实际版本", input.universalX64VersionOutput.trim(), expectedVersion]
  ];
  for (const [label, actual, expected] of checks) {
    if (actual !== expected) throw new Error(`${label}不匹配：期望 ${expected}，实际 ${actual ?? "缺失"}`);
  }
  if (input.armMetadata.nodeVersion !== input.x64Metadata.nodeVersion) {
    throw new Error(`两个 Node runtime 版本不一致：${input.armMetadata.nodeVersion} / ${input.x64Metadata.nodeVersion}`);
  }
  for (const [label, metadata] of [["arm64", input.armMetadata], ["x64", input.x64Metadata]]) {
    if (!/^[a-f0-9]{40}$/.test(metadata.sourceGitCommit ?? "") ||
      typeof metadata.sourceGitDirty !== "boolean") {
      throw new Error(`${label} 切片源码标识无效`);
    }
    const expectedIdentity = `git:${metadata.sourceGitCommit}${metadata.sourceGitDirty ? "+dirty" : ""}`;
    if (metadata.sourceIdentity !== expectedIdentity) throw new Error(`${label} 切片 sourceIdentity 不匹配`);
  }
  if (input.armMetadata.sourceGitCommit !== input.x64Metadata.sourceGitCommit ||
    input.armMetadata.sourceGitDirty !== input.x64Metadata.sourceGitDirty ||
    input.armMetadata.sourceIdentity !== input.x64Metadata.sourceIdentity) {
    throw new Error("Universal 两个切片的源码提交不一致");
  }
  for (const [label, metadata, verified] of [
    ["arm64", input.armMetadata, input.armSignatureVerified],
    ["x64", input.x64Metadata, input.x64SignatureVerified]
  ]) {
    if (!verified || metadata.signature !== "developer-id-application" ||
      metadata.hardenedRuntime !== true || metadata.secureTimestamp !== true) {
      throw new Error(`${label} 切片签名未通过正式发行门禁`);
    }
  }
  if (!input.armMetadata.signingIdentity ||
    input.armMetadata.signingIdentity !== input.x64Metadata.signingIdentity) {
    throw new Error("两个切片签名身份不一致");
  }
  if (input.armMetadata.signingIdentity !== input.signingIdentity) {
    throw new Error("切片元数据与当前签名身份不一致");
  }
  const expectedTeamId = input.signingIdentity.match(/\(([A-Z0-9]{10})\)\s*$/)?.[1];
  for (const [label, details] of [
    ["arm64 切片", input.armSignatureDetails],
    ["x64 切片", input.x64SignatureDetails],
    ["Universal", input.universalSignatureDetails]
  ]) {
    if (!details.includes("Authority=Developer ID Application:") ||
      (expectedTeamId && !details.includes(`TeamIdentifier=${expectedTeamId}`))) {
      throw new Error(`${label}签名身份与当前 Developer ID 不一致`);
    }
    if (!/flags=.*\bruntime\b/i.test(details) ||
      !/Timestamp=(?!none\b).+/i.test(details)) {
      throw new Error(`${label}未现场证明 Hardened Runtime 或安全时间戳`);
    }
  }
  const architectures = new Set(input.universalArchitectures.trim().split(/\s+/));
  if (!architectures.has("arm64") || !architectures.has("x86_64")) {
    throw new Error(`Universal 架构不完整：${input.universalArchitectures.trim()}`);
  }
  if (!input.universalSignatureVerified) throw new Error("Universal 签名验证失败");
  for (const [label, hash] of [
    ["Universal arm64 切片", input.universalArmSliceSha256],
    ["Universal x64 切片", input.universalX64SliceSha256]
  ]) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`${label} SHA-256 无效`);
  }
}

export function requireDistributionExtensionId({ channel, configuredId, developmentId }) {
  const extensionId = configuredId?.trim();
  if (channel === "store" && !extensionId) {
    throw new Error("Chrome Web Store 分发必须设置 VISUALFORGE_EXTENSION_ID，禁止回退开发扩展 ID");
  }
  const resolved = extensionId || developmentId;
  if (!CHROME_EXTENSION_ID_PATTERN.test(resolved)) {
    throw new Error(`Chrome 扩展 ID 无效：${resolved}`);
  }
  return resolved;
}

export function createPackagedBuildMetadata(metadata, distributionChannel, releaseExtensionId, extensionZip) {
  return {
    ...metadata,
    distributionChannel,
    releaseExtensionId,
    allowedOrigins: [`chrome-extension://${releaseExtensionId}/`],
    ...(extensionZip ?? {})
  };
}

export function verifyInstallCommandBinding(command, extensionId) {
  const boundIds = [...command.matchAll(/--extension-id\s+["']?([a-p]{32})["']?/g)]
    .map((match) => match[1]);
  if (boundIds.length !== 1 || boundIds[0] !== extensionId) {
    throw new Error(`Install.command 未绑定发行扩展 ID：${extensionId}`);
  }
}

export function verifyNativeManifestBinding(manifest, extensionId) {
  const expected = [`chrome-extension://${extensionId}/`];
  if (JSON.stringify(manifest.allowed_origins) !== JSON.stringify(expected)) {
    throw new Error(`Native Messaging manifest allowed_origins 未绑定发行扩展 ID：${extensionId}`);
  }
}

export function deriveChromeExtensionIdFromManifestKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("扩展 Manifest 缺少 key，无法反查扩展 ID");
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((value) => String.fromCharCode("a".charCodeAt(0) + value))
    .join("");
}

export function verifyDistributionBindings({
  installer,
  metadata,
  extensionManifest,
  releaseExtensionId,
  distributionChannel,
  actualExtensionZipSha256,
  extensionZipSource
}) {
  verifyInstallCommandBinding(installer, releaseExtensionId);
  verifyNativeManifestBinding({ allowed_origins: metadata.allowedOrigins }, releaseExtensionId);
  if (distributionChannel && metadata.distributionChannel !== distributionChannel) {
    throw new Error(`build-metadata 分发渠道不匹配：期望 ${distributionChannel}，实际 ${metadata.distributionChannel ?? "缺失"}`);
  }
  if (metadata.releaseExtensionId !== releaseExtensionId) {
    throw new Error(`build-metadata releaseExtensionId 未绑定发行扩展 ID：${releaseExtensionId}`);
  }
  if (metadata.hostVersion !== extensionManifest.version) {
    throw new Error(`Host 与扩展 Manifest 版本不一致：${metadata.hostVersion} / ${extensionManifest.version ?? "缺失"}`);
  }
  if (!/^[a-f0-9]{64}$/.test(actualExtensionZipSha256 ?? "") ||
    metadata.extensionZipSha256 !== actualExtensionZipSha256) {
    throw new Error("build-metadata 扩展 ZIP SHA-256 与现场文件不一致");
  }
  if (!extensionZipSource || metadata.extensionZipSource !== extensionZipSource) {
    throw new Error("build-metadata 扩展 ZIP 来源标识与现场文件不一致");
  }
  const derivedId = deriveChromeExtensionIdFromManifestKey(extensionManifest.key);
  if (derivedId !== releaseExtensionId) {
    throw new Error(`扩展 Manifest key 推导 ID 不匹配：期望 ${releaseExtensionId}，实际 ${derivedId}`);
  }
  const installerIds = [...new Set(installer.match(/[a-p]{32}/g) ?? [])];
  if (installerIds.length !== 1 || installerIds[0] !== releaseExtensionId) {
    throw new Error(`安装脚本包含旧或第二个扩展 ID：${installerIds.join(", ") || "未找到"}`);
  }
}

function checksumLine(hash, outputPath) {
  return `${hash}  ${path.basename(outputPath)}\n`;
}

export async function removeStaleChecksum(outputPath) {
  const checksumPath = `${outputPath}.sha256`;
  let sidecar;
  try {
    sidecar = await readFile(checksumPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  let bytes;
  try {
    bytes = await readFile(outputPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await unlink(checksumPath);
    return;
  }
  const [expectedHash, expectedName] = sidecar.trim().split(/\s+/, 2);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash !== actualHash || expectedName !== path.basename(outputPath)) {
    await unlink(checksumPath);
  }
}

export async function publishArtifactWithChecksum({ temporaryPath, outputPath, validate, renamePath }) {
  const [hash] = await publishArtifactSetWithChecksums({
    artifacts: [{ temporaryPath, outputPath, validate }],
    renamePath
  });
  return hash;
}

export async function publishArtifactSetWithChecksums({ artifacts, renamePath }) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("发行成品集合不能为空");
  }
  const prepared = [];
  try {
    for (const [index, artifact] of artifacts.entries()) {
      await artifact.validate?.(artifact.temporaryPath);
      const hash = createHash("sha256")
        .update(await readFile(artifact.temporaryPath))
        .digest("hex");
      const temporaryChecksumPath = `${artifact.outputPath}.sha256.building-${process.pid}-${Date.now()}-${index}`;
      await writeFile(temporaryChecksumPath, checksumLine(hash, artifact.outputPath));
      prepared.push({ ...artifact, hash, temporaryChecksumPath });
    }
    const replacements = prepared.flatMap(({ temporaryPath, outputPath, temporaryChecksumPath }) => [
        { temporaryPath, outputPath },
        { temporaryPath: temporaryChecksumPath, outputPath: `${outputPath}.sha256` }
      ]);
    await publishArtifactGroup({
      replacements,
      renamePath,
      finalize: () => clearDarwinFinderHiddenFlags(replacements.map(({ outputPath }) => outputPath))
    });
    return prepared.map(({ hash }) => hash);
  } finally {
    await Promise.all([
      ...artifacts.map(({ temporaryPath }) => unlink(temporaryPath).catch(() => undefined)),
      ...prepared.map(({ temporaryChecksumPath }) => unlink(temporaryChecksumPath).catch(() => undefined))
    ]);
  }
}

export async function publishArtifactGroup({ replacements, renamePath = rename, copyPath = copyFile, finalize }) {
  if (!Array.isArray(replacements) || replacements.length === 0) {
    throw new Error("原子发布组不能为空");
  }
  const outputPaths = replacements.map(({ outputPath }) => outputPath);
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("原子发布组包含重复成品路径");
  const transactionId = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const records = replacements.map((replacement, index) => ({
    ...replacement,
    backupPath: `${replacement.outputPath}.previous-${transactionId}-${index}`,
    hadOriginal: false,
    published: false
  }));
  let committed = false;
  try {
    for (const record of records) {
      try {
        await stat(record.outputPath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      try {
        if (record.copyInsteadOfRename) {
          await copyPath(record.outputPath, record.backupPath);
        } else {
          await renamePath(record.outputPath, record.backupPath);
        }
        record.hadOriginal = true;
      } catch (error) {
        if (error.code !== "ENOENT") {
          await unlink(record.backupPath).catch(() => undefined);
          throw error;
        }
      }
    }
    for (const record of records) {
      if (record.copyInsteadOfRename) {
        record.published = true;
        await unlink(record.outputPath).catch((error) => {
          if (error.code !== "ENOENT") throw error;
        });
        await copyPath(record.temporaryPath, record.outputPath);
      } else {
        await renamePath(record.temporaryPath, record.outputPath);
        record.published = true;
      }
    }
    await finalize?.();
    committed = true;
  } catch (publishError) {
    const rollbackErrors = [];
    for (const record of [...records].reverse()) {
      if (record.published) {
        await unlink(record.outputPath).catch((error) => {
          if (error.code !== "ENOENT") rollbackErrors.push(error);
        });
      }
      if (record.hadOriginal) {
        try {
          if (record.copyInsteadOfRename) {
            await unlink(record.outputPath).catch((error) => {
              if (error.code !== "ENOENT") throw error;
            });
            await copyPath(record.backupPath, record.outputPath);
            await unlink(record.backupPath);
          } else {
            await renamePath(record.backupPath, record.outputPath);
          }
        } catch (error) {
          rollbackErrors.push(error);
        }
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [publishError, ...rollbackErrors],
        `发行成品组发布失败且回滚不完整；保留的 previous 文件不得删除：${records.map(({ backupPath }) => backupPath).join(", ")}`
      );
    }
    throw publishError;
  } finally {
    await Promise.all(records.map(({ temporaryPath: candidatePath }) => unlink(candidatePath).catch(() => undefined)));
    if (committed) {
      await Promise.all(records.map(({ backupPath }) => unlink(backupPath).catch(() => undefined)));
    }
  }
}
