import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import * as releasePolicy from "../../apps/native-host/scripts/distribution-release-policy.mjs";

type DistributionHardeningPolicy = {
  createFreshStagingDirectory?: (root: string, prefix: string) => Promise<string>;
  withFreshStagingDirectory?: <T>(root: string, prefix: string, work: (stagingDir: string) => Promise<T>) => Promise<T>;
  assertStagingMatchesManifest?: (stagingDir: string, files: string[]) => Promise<void>;
  renderLinuxInstaller?: (input: { binaryName: string; releaseExtensionId: string }) => string;
  renderDistributionInstaller?: (input: {
    platform: NodeJS.Platform;
    binaryName: string;
    releaseExtensionId: string;
  }) => string;
  renderDistributionUninstaller?: (input: {
    platform: NodeJS.Platform;
    binaryName: string;
  }) => string;
  renderCodexDiscoveryGuidance?: (platform: NodeJS.Platform, binaryName: string) => string[];
  verifyDistributionBindings?: (input: {
    installer: string;
    metadata: Record<string, unknown>;
    extensionManifest: Record<string, unknown>;
    releaseExtensionId: string;
    distributionChannel?: string;
    actualExtensionZipSha256?: string;
    extensionZipSource?: string;
  }) => void;
  removeStaleChecksum?: (outputPath: string) => Promise<void>;
  publishArtifactWithChecksum?: (input: {
    temporaryPath: string;
    outputPath: string;
    validate?: (temporaryPath: string) => Promise<void>;
    renamePath?: typeof rename;
  }) => Promise<string>;
  publishArtifactSetWithChecksums?: (input: {
    artifacts: Array<{
      temporaryPath: string;
      outputPath: string;
      validate?: (temporaryPath: string) => Promise<void>;
    }>;
    renamePath?: typeof rename;
  }) => Promise<string[]>;
  publishArtifactGroup?: (input: {
    replacements: Array<{ temporaryPath: string; outputPath: string; copyInsteadOfRename?: boolean }>;
    renamePath?: typeof rename;
    copyPath?: typeof copyFile;
    finalize?: () => Promise<void>;
  }) => Promise<void>;
  validateHostBuildMetadata?: (input: {
    metadata: Record<string, unknown>;
    packageVersion: string;
    targetPlatform: NodeJS.Platform;
    targetArch: string;
    binaryName: string;
    actualSha256: string;
    checksums: string;
  }) => void;
  assertArchiveEntries?: (actual: string[], expected: string[]) => void;
  assertDarwinDmgFinderEntriesVisible?: (entries: Array<{ name: string; flags: string }>) => void;
  validateUniversalBuildInputs?: (input: {
    packageVersion: string;
    armMetadata: Record<string, unknown>;
    x64Metadata: Record<string, unknown>;
    armActualSha256: string;
    x64ActualSha256: string;
    armActualArchitectures: string;
    x64ActualArchitectures: string;
    armSignatureVerified: boolean;
    x64SignatureVerified: boolean;
    armSignatureDetails: string;
    x64SignatureDetails: string;
    armVersionOutput: string;
    x64VersionOutput: string;
    universalArmVersionOutput: string;
    universalX64VersionOutput: string;
    universalArchitectures: string;
    universalSignatureVerified: boolean;
    universalSignatureDetails: string;
      signingIdentity: string;
      universalArmSliceSha256: string;
      universalX64SliceSha256: string;
  }) => void;
};

const policy = releasePolicy as DistributionHardeningPolicy;
const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        for (const child of await readdir(entryPath).catch(() => [])) {
          await unlink(path.join(entryPath, child)).catch(() => undefined);
        }
        await rmdir(entryPath).catch(() => undefined);
      } else {
        await unlink(entryPath).catch(() => undefined);
      }
    }
    await rmdir(root).catch(() => undefined);
  }
});

describe("发行打包安全基线", () => {
  it("每次打包使用全新的空 staging，不复用旧目录", async () => {
    expect(policy.createFreshStagingDirectory).toBeTypeOf("function");
    if (!policy.createFreshStagingDirectory) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-staging-test-"));
    temporaryRoots.push(root);
    const legacyDir = path.join(root, "package-darwin-arm64");
    await mkdir(legacyDir);
    await writeFile(path.join(legacyDir, "legacy-0.1.0.txt"), "stale");

    const first = await policy.createFreshStagingDirectory(root, "package-darwin-arm64");
    const second = await policy.createFreshStagingDirectory(root, "package-darwin-arm64");

    expect(first).not.toBe(second);
    expect(await readdir(first)).toEqual([]);
    expect(await readdir(second)).toEqual([]);
    expect(await readFile(path.join(legacyDir, "legacy-0.1.0.txt"), "utf8")).toBe("stale");
  });

  it("staging 在工作成功或失败后都被 finally 清空", async () => {
    expect(policy.withFreshStagingDirectory).toBeTypeOf("function");
    if (!policy.withFreshStagingDirectory) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-staging-finally-"));
    temporaryRoots.push(root);
    let successDirectory = "";
    await policy.withFreshStagingDirectory(root, "success", async (stagingDir) => {
      successDirectory = stagingDir;
      await writeFile(path.join(stagingDir, "artifact.txt"), "ok");
    });
    await expect(lstat(successDirectory)).rejects.toMatchObject({ code: "ENOENT" });

    let failedDirectory = "";
    await expect(policy.withFreshStagingDirectory(root, "failure", async (stagingDir) => {
      failedDirectory = stagingDir;
      await writeFile(path.join(stagingDir, "artifact.txt"), "bad");
      throw new Error("预期失败");
    })).rejects.toThrow("预期失败");
    await expect(lstat(failedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("ZIP、DMG 共用的显式清单会拒绝 staging 中的多余文件", async () => {
    expect(policy.assertStagingMatchesManifest).toBeTypeOf("function");
    if (!policy.assertStagingMatchesManifest) return;
    const stagingDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-manifest-test-"));
    temporaryRoots.push(stagingDir);
    const host = path.join(stagingDir, "visualforge-native-host");
    const installer = path.join(stagingDir, "Install.command");
    const stale = path.join(stagingDir, "VisualForge-extension-0.1.0.zip");
    await Promise.all([
      writeFile(host, "host"),
      writeFile(installer, "installer"),
      writeFile(stale, "stale")
    ]);

    await expect(policy.assertStagingMatchesManifest(stagingDir, [host, installer]))
      .rejects.toThrow("不在发行清单");
    await unlink(stale);
    await expect(policy.assertStagingMatchesManifest(stagingDir, [host, installer]))
      .resolves.toBeUndefined();
  });

  it("Linux 安装脚本把真实发行扩展 ID交给同一 Host 安装逻辑", () => {
    expect(policy.renderLinuxInstaller).toBeTypeOf("function");
    if (!policy.renderLinuxInstaller) return;
    const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const installer = policy.renderLinuxInstaller({
      binaryName: "visualforge-native-host",
      releaseExtensionId: extensionId
    });

    expect(installer).toContain(`--install --extension-id "${extensionId}"`);
    expect(installer).not.toContain("${releaseExtensionId}");
    expect(installer).not.toContain("NativeMessagingHosts");
  });

  it("Universal 产物必须同时校验切片版本、元数据版本、架构和成品实际运行版本", () => {
    expect(policy.validateUniversalBuildInputs).toBeTypeOf("function");
    if (!policy.validateUniversalBuildInputs) return;
    const valid = {
      packageVersion: "0.5.1",
      armMetadata: {
        hostVersion: "0.5.1", platform: "darwin", arch: "arm64", architectures: ["arm64"],
        nodeVersion: "v22.17.1", sha256: "a".repeat(64), signature: "developer-id-application",
        signingIdentity: "Developer ID Application: VisualForge (TEAM123456)", hardenedRuntime: true,
        secureTimestamp: true, sourceGitCommit: "1".repeat(40), sourceGitDirty: true,
        sourceIdentity: `git:${"1".repeat(40)}+dirty`
      },
      x64Metadata: {
        hostVersion: "0.5.1", platform: "darwin", arch: "x64", architectures: ["x86_64"],
        nodeVersion: "v22.17.1", sha256: "b".repeat(64), signature: "developer-id-application",
        signingIdentity: "Developer ID Application: VisualForge (TEAM123456)", hardenedRuntime: true,
        secureTimestamp: true, sourceGitCommit: "1".repeat(40), sourceGitDirty: true,
        sourceIdentity: `git:${"1".repeat(40)}+dirty`
      },
      armActualSha256: "a".repeat(64),
      x64ActualSha256: "b".repeat(64),
      armActualArchitectures: "arm64",
      x64ActualArchitectures: "x86_64",
      armSignatureVerified: true,
      x64SignatureVerified: true,
      armSignatureDetails: "Authority=Developer ID Application: VisualForge (TEAM123456)\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)\nTimestamp=Aug 3, 2026",
      x64SignatureDetails: "Authority=Developer ID Application: VisualForge (TEAM123456)\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)\nTimestamp=Aug 3, 2026",
      armVersionOutput: "visualforge-native-host 0.5.1",
      x64VersionOutput: "visualforge-native-host 0.5.1",
      universalArmVersionOutput: "visualforge-native-host 0.5.1",
      universalX64VersionOutput: "visualforge-native-host 0.5.1",
      universalArchitectures: "x86_64 arm64",
      universalSignatureVerified: true,
      universalSignatureDetails: "Authority=Developer ID Application: VisualForge (TEAM123456)\nTeamIdentifier=TEAM123456\nflags=0x10000(runtime)\nTimestamp=Aug 3, 2026",
      signingIdentity: "Developer ID Application: VisualForge (TEAM123456)",
      universalArmSliceSha256: "c".repeat(64),
      universalX64SliceSha256: "d".repeat(64)
    };

    expect(() => policy.validateUniversalBuildInputs?.(valid)).not.toThrow();
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      armMetadata: { ...valid.armMetadata, hostVersion: "0.1.0" }
    })).toThrow("arm64 元数据版本");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      x64VersionOutput: "visualforge-native-host 0.1.0"
    })).toThrow("x64 切片实际版本");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      universalArchitectures: "arm64"
    })).toThrow("Universal 架构");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      armActualSha256: "e".repeat(64)
    })).toThrow("arm64 切片 SHA-256");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      x64ActualArchitectures: "arm64"
    })).toThrow("x64 切片实际架构");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      armSignatureVerified: false
    })).toThrow("arm64 切片签名");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      universalSignatureVerified: false
    })).toThrow("Universal 签名");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      x64SignatureDetails: "Signature=adhoc\nTeamIdentifier=not set"
    })).toThrow("x64 切片签名身份");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      universalSignatureDetails: "Authority=Developer ID Application: VisualForge (TEAM123456)\nTeamIdentifier=TEAM123456"
    })).toThrow("Hardened Runtime 或安全时间戳");
    expect(() => policy.validateUniversalBuildInputs?.({
      ...valid,
      x64Metadata: {
        ...valid.x64Metadata,
        sourceGitCommit: "2".repeat(40),
        sourceIdentity: `git:${"2".repeat(40)}+dirty`
      }
    })).toThrow("源码提交不一致");
  });

  it("三平台安装脚本、扩展 Manifest 与发行元数据只能绑定同一个扩展 ID", () => {
    expect(policy.renderDistributionInstaller).toBeTypeOf("function");
    expect(policy.renderDistributionUninstaller).toBeTypeOf("function");
    expect(policy.verifyDistributionBindings).toBeTypeOf("function");
    if (!policy.renderDistributionInstaller || !policy.renderDistributionUninstaller ||
      !policy.verifyDistributionBindings) return;
    const extensionId = "jjmhfaamncdoaliheodgcnhklimoaocc";
    const manifestKey = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA/muJ3hPIvz8QC983CdXyrOlobC5l6fhrihJSZTWJctn0f0QxdtgYPAx2swS4+YKqCsiWiIvx+YhtbJM7kTPYqlzZ8o0gxVqtA02wHnDqzTWMCP6puOV5faEp/T8IOatptZn73pN3flXyVMpalQ0ezcrT3ZPXGsWncGKtZRpggqZddTOngGAJGYNQV9MQYTh4D8bvThPH3jTlGpTKGXY2nMnN9+n5nKm4GPLrBWW3SWDsgTbAcv0uVxSp0C+Qu+Yitns9OGf7TThII1xkUaBhgl8bZqnfY67a1t3iIrSg22IHEd0v2/tNy2+Ir8tU7BdEeG25pxrUCjnF7yjA8TxGfQIDAQAB";
    const metadata = {
      hostVersion: "0.5.1",
      distributionChannel: "developer",
      releaseExtensionId: extensionId,
      allowedOrigins: [`chrome-extension://${extensionId}/`],
      sourceGitCommit: "1".repeat(40),
      sourceGitDirty: true,
      sourceIdentity: `git:${"1".repeat(40)}+dirty`,
      extensionZipSha256: "a".repeat(64),
      extensionZipSource: "VisualForge-0.5.1-chrome.zip"
    };
    const extensionManifest = { name: "VisualForge 风格铸造", version: "0.5.1", key: manifestKey };

    for (const platform of ["darwin", "win32", "linux"] as const) {
      const binaryName = platform === "win32" ? "visualforge-native-host.exe" : "visualforge-native-host";
      const installer = policy.renderDistributionInstaller({ platform, binaryName, releaseExtensionId: extensionId });
      expect(() => policy.verifyDistributionBindings?.({
        installer, metadata, extensionManifest, releaseExtensionId: extensionId,
        distributionChannel: "developer",
        actualExtensionZipSha256: "a".repeat(64),
        extensionZipSource: "VisualForge-0.5.1-chrome.zip"
      })).not.toThrow();
      expect(policy.renderDistributionUninstaller({ platform, binaryName })).toContain("--uninstall");
    }
    expect(() => policy.verifyDistributionBindings?.({
      installer: `visualforge-native-host --install --extension-id "${extensionId}"`,
      metadata: { ...metadata, allowedOrigins: [...metadata.allowedOrigins, "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"] },
      extensionManifest,
      releaseExtensionId: extensionId,
      distributionChannel: "developer",
      actualExtensionZipSha256: "a".repeat(64),
      extensionZipSource: "VisualForge-0.5.1-chrome.zip"
    })).toThrow("allowed_origins");
    expect(() => policy.verifyDistributionBindings?.({
      installer: `visualforge-native-host --install --extension-id "${extensionId}"`,
      metadata: { ...metadata, distributionChannel: "store" },
      extensionManifest,
      releaseExtensionId: extensionId,
      distributionChannel: "developer",
      actualExtensionZipSha256: "a".repeat(64),
      extensionZipSource: "VisualForge-0.5.1-chrome.zip"
    })).toThrow("分发渠道");
    expect(() => policy.verifyDistributionBindings?.({
      installer: `visualforge-native-host --install --extension-id "${extensionId}"`,
      metadata: { ...metadata, extensionZipSha256: "b".repeat(64) },
      extensionManifest,
      releaseExtensionId: extensionId,
      distributionChannel: "developer",
      actualExtensionZipSha256: "a".repeat(64),
      extensionZipSource: "VisualForge-0.5.1-chrome.zip"
    })).toThrow("扩展 ZIP SHA-256");
  });

  it("打包前反查 Host 现场哈希、版本、平台、架构和 SHA256SUMS", () => {
    expect(policy.validateHostBuildMetadata).toBeTypeOf("function");
    if (!policy.validateHostBuildMetadata) return;
    const valid = {
      metadata: {
        hostVersion: "0.5.1",
        platform: "linux",
        arch: "x64",
        architectures: ["x86_64"],
        sha256: "a".repeat(64),
        sourceGitCommit: "1".repeat(40),
        sourceGitDirty: true,
        sourceIdentity: `git:${"1".repeat(40)}+dirty`
      },
      packageVersion: "0.5.1",
      targetPlatform: "linux" as const,
      targetArch: "x64",
      binaryName: "visualforge-native-host",
      actualSha256: "a".repeat(64),
      checksums: `${"a".repeat(64)}  visualforge-native-host\n`
    };
    expect(() => policy.validateHostBuildMetadata?.(valid)).not.toThrow();
    expect(() => policy.validateHostBuildMetadata?.({
      ...valid,
      actualSha256: "b".repeat(64)
    })).toThrow("现场 SHA-256");
    expect(() => policy.validateHostBuildMetadata?.({
      ...valid,
      metadata: { ...valid.metadata, hostVersion: "0.5.0" }
    })).toThrow("Host 版本");
    expect(() => policy.validateHostBuildMetadata?.({
      ...valid,
      metadata: { ...valid.metadata, sourceGitDirty: "false" }
    })).toThrow("sourceGitDirty");
    expect(() => policy.validateHostBuildMetadata?.({
      ...valid,
      metadata: { ...valid.metadata, sourceIdentity: `git:${"1".repeat(40)}` }
    })).toThrow("sourceIdentity");
  });

  it("压缩后真实文件列表仍必须与显式发行清单完全一致", () => {
    expect(policy.assertArchiveEntries).toBeTypeOf("function");
    if (!policy.assertArchiveEntries) return;
    const expected = ["visualforge-native-host", "install.sh", "build-metadata.json"];
    expect(() => policy.assertArchiveEntries?.([...expected], expected)).not.toThrow();
    expect(() => policy.assertArchiveEntries?.([...expected, "legacy.zip"], expected))
      .toThrow("多余文件");
    expect(() => policy.assertArchiveEntries?.(expected.slice(0, 2), expected))
      .toThrow("缺少文件");
  });

  it("macOS DMG 拒绝把安装文件打成 Finder 隐藏项", () => {
    expect(policy.assertDarwinDmgFinderEntriesVisible).toBeTypeOf("function");
    if (!policy.assertDarwinDmgFinderEntriesVisible) return;

    expect(() => policy.assertDarwinDmgFinderEntriesVisible([
      { name: "Install.command", flags: "-" },
      { name: "Uninstall.command", flags: "-" },
      { name: "README-install.txt", flags: "-" }
    ])).not.toThrow();
    expect(() => policy.assertDarwinDmgFinderEntriesVisible([
      { name: "Install.command", flags: "hidden" },
      { name: "Uninstall.command", flags: "-" }
    ])).toThrow("Finder 隐藏项：Install.command");
  });

  it("Windows 与 Linux 仅在包内给出自动发现失败后的安全配置命令", () => {
    expect(policy.renderCodexDiscoveryGuidance).toBeTypeOf("function");
    if (!policy.renderCodexDiscoveryGuidance) return;
    expect(policy.renderCodexDiscoveryGuidance("darwin", "visualforge-native-host")).toEqual([]);
    expect(policy.renderCodexDiscoveryGuidance("linux", "visualforge-native-host").join("\n"))
      .toContain('./visualforge-native-host --configure-codex "/你的/codex/绝对路径"');
    expect(policy.renderCodexDiscoveryGuidance("win32", "visualforge-native-host.exe").join("\n"))
      .toContain('& ".\\visualforge-native-host.exe" --configure-codex "C:\\你的\\codex.exe"');
  });

  it("Windows 安装与卸载通过参数调用 Host，包目录含空格时不拼接命令字符串", () => {
    expect(policy.renderDistributionInstaller).toBeTypeOf("function");
    expect(policy.renderDistributionUninstaller).toBeTypeOf("function");
    if (!policy.renderDistributionInstaller || !policy.renderDistributionUninstaller) return;
    const installer = policy.renderDistributionInstaller({
      platform: "win32",
      binaryName: "visualforge-native-host.exe",
      releaseExtensionId: "jjmhfaamncdoaliheodgcnhklimoaocc"
    });
    const uninstaller = policy.renderDistributionUninstaller({
      platform: "win32",
      binaryName: "visualforge-native-host.exe"
    });

    for (const script of [installer, uninstaller]) {
      expect(script).toContain("Join-Path $PSScriptRoot 'visualforge-native-host.exe'");
      expect(script).toContain("& $HostExecutable");
      expect(script).not.toContain("Invoke-Expression");
    }
  });

  it("临时成品校验失败不覆盖最后有效包，成功后包与校验文件同值", async () => {
    expect(policy.publishArtifactWithChecksum).toBeTypeOf("function");
    if (!policy.publishArtifactWithChecksum) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-atomic-publish-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "VisualForge.zip");
    const temporaryPath = path.join(root, ".VisualForge.zip.building");
    await writeFile(outputPath, "last-good");
    await writeFile(`${outputPath}.sha256`, "last-good-checksum\n");
    await writeFile(temporaryPath, "invalid-new");
    await expect(policy.publishArtifactWithChecksum({
      temporaryPath,
      outputPath,
      validate: async () => { throw new Error("产物校验失败"); }
    })).rejects.toThrow("产物校验失败");
    expect(await readFile(outputPath, "utf8")).toBe("last-good");
    expect(await readFile(`${outputPath}.sha256`, "utf8")).toBe("last-good-checksum\n");

    await writeFile(temporaryPath, "new-good");
    if (process.platform === "darwin") {
      await execFileAsync("/usr/bin/chflags", ["hidden", temporaryPath]);
    }
    const hash = await policy.publishArtifactWithChecksum({
      temporaryPath,
      outputPath,
      validate: async (candidate) => {
        expect(await readFile(candidate, "utf8")).toBe("new-good");
      }
    });
    expect(await readFile(outputPath, "utf8")).toBe("new-good");
    expect(await readFile(`${outputPath}.sha256`, "utf8"))
      .toBe(`${hash}  VisualForge.zip\n`);
    if (process.platform === "darwin") {
      for (const publishedPath of [outputPath, `${outputPath}.sha256`]) {
        const { stdout } = await execFileAsync("/usr/bin/stat", ["-f", "%Sf", publishedPath]);
        expect(stdout.trim().split(/[\s,]+/)).not.toContain("hidden");
      }
    }
  });

  it("sidecar 发布失败时回滚新成品与旧 sha256，不能留下新包旧校验", async () => {
    expect(policy.publishArtifactWithChecksum).toBeTypeOf("function");
    if (!policy.publishArtifactWithChecksum) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-sidecar-rollback-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "VisualForge.zip");
    const temporaryPath = path.join(root, ".VisualForge.zip.building");
    await writeFile(outputPath, "last-good");
    await writeFile(`${outputPath}.sha256`, "last-good-checksum\n");
    await writeFile(temporaryPath, "new-but-incomplete-pair");

    await expect(policy.publishArtifactWithChecksum({
      temporaryPath,
      outputPath,
      renamePath: async (from, to) => {
        if (from.includes(".sha256.building-") && to === `${outputPath}.sha256`) {
          throw new Error("模拟 sidecar 发布失败");
        }
        await rename(from, to);
      }
    })).rejects.toThrow("模拟 sidecar 发布失败");

    expect(await readFile(outputPath, "utf8")).toBe("last-good");
    expect(await readFile(`${outputPath}.sha256`, "utf8")).toBe("last-good-checksum\n");
  });

  it("Universal 二进制、SHA256SUMS、元数据任一发布失败时整组回滚", async () => {
    expect(policy.publishArtifactGroup).toBeTypeOf("function");
    if (!policy.publishArtifactGroup) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-universal-rollback-"));
    temporaryRoots.push(root);
    const names = ["visualforge-native-host", "SHA256SUMS", "build-metadata.json"];
    const replacements = names.map((name) => ({
      temporaryPath: path.join(root, `${name}.building`),
      outputPath: path.join(root, name)
    }));
    await Promise.all(replacements.flatMap(({ temporaryPath, outputPath }, index) => [
      writeFile(outputPath, `old-${index}`),
      writeFile(temporaryPath, `new-${index}`)
    ]));

    await expect(policy.publishArtifactGroup({
      replacements,
      renamePath: async (from, to) => {
        if (from.endsWith("build-metadata.json.building") && to.endsWith("build-metadata.json")) {
          throw new Error("模拟元数据发布失败");
        }
        await rename(from, to);
      }
    })).rejects.toThrow("模拟元数据发布失败");

    await Promise.all(replacements.map(async ({ outputPath }, index) => {
      expect(await readFile(outputPath, "utf8")).toBe(`old-${index}`);
    }));
  });

  it("签名二进制使用复制发布时，最终路径签名失败仍恢复上一份成品", async () => {
    expect(policy.publishArtifactGroup).toBeTypeOf("function");
    if (!policy.publishArtifactGroup) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-signed-copy-rollback-"));
    temporaryRoots.push(root);
    const hostOutput = path.join(root, "visualforge-native-host");
    const hostTemporary = path.join(root, "visualforge-native-host.building");
    const metadataOutput = path.join(root, "build-metadata.json");
    const metadataTemporary = path.join(root, "build-metadata.json.building");
    await Promise.all([
      writeFile(hostOutput, "old-signed-host"),
      writeFile(hostTemporary, "new-signed-host"),
      writeFile(metadataOutput, "old-metadata"),
      writeFile(metadataTemporary, "new-metadata")
    ]);

    await expect(policy.publishArtifactGroup({
      replacements: [
        { temporaryPath: hostTemporary, outputPath: hostOutput, copyInsteadOfRename: true },
        { temporaryPath: metadataTemporary, outputPath: metadataOutput }
      ],
      copyPath: copyFile,
      finalize: async () => {
        throw new Error("模拟最终路径签名失败");
      }
    })).rejects.toThrow("模拟最终路径签名失败");

    expect(await readFile(hostOutput, "utf8")).toBe("old-signed-host");
    expect(await readFile(metadataOutput, "utf8")).toBe("old-metadata");
  });

  it("签名二进制首次发布时不尝试备份不存在的旧成品", async () => {
    expect(policy.publishArtifactGroup).toBeTypeOf("function");
    if (!policy.publishArtifactGroup) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-signed-first-publish-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "visualforge-native-host");
    const temporaryPath = path.join(root, "visualforge-native-host.building");
    await writeFile(temporaryPath, "first-signed-host");

    await policy.publishArtifactGroup({
      replacements: [{ temporaryPath, outputPath, copyInsteadOfRename: true }],
      copyPath: async (from, to) => {
        if (from === outputPath) throw Object.assign(new Error("cp 找不到旧成品"), { code: 1 });
        await copyFile(from, to);
      }
    });

    expect(await readFile(outputPath, "utf8")).toBe("first-signed-host");
  });

  it("macOS ZIP、DMG 与两份校验文件任一发布失败时整组回滚", async () => {
    expect(policy.publishArtifactSetWithChecksums).toBeTypeOf("function");
    if (!policy.publishArtifactSetWithChecksums) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-macos-pair-rollback-"));
    temporaryRoots.push(root);
    const zipPath = path.join(root, "VisualForge.zip");
    const dmgPath = path.join(root, "VisualForge.dmg");
    const temporaryZip = path.join(root, "VisualForge.zip.building");
    const temporaryDmg = path.join(root, "VisualForge.dmg.building");
    await Promise.all([
      writeFile(zipPath, "old-zip"),
      writeFile(`${zipPath}.sha256`, "old-zip-sha"),
      writeFile(dmgPath, "old-dmg"),
      writeFile(`${dmgPath}.sha256`, "old-dmg-sha"),
      writeFile(temporaryZip, "new-zip"),
      writeFile(temporaryDmg, "new-dmg")
    ]);

    await expect(policy.publishArtifactSetWithChecksums({
      artifacts: [
        { temporaryPath: temporaryZip, outputPath: zipPath },
        { temporaryPath: temporaryDmg, outputPath: dmgPath }
      ],
      renamePath: async (from, to) => {
        if (from.includes("VisualForge.dmg.sha256.building-") && to === `${dmgPath}.sha256`) {
          throw new Error("模拟 DMG sidecar 发布失败");
        }
        await rename(from, to);
      }
    })).rejects.toThrow("模拟 DMG sidecar 发布失败");

    expect(await readFile(zipPath, "utf8")).toBe("old-zip");
    expect(await readFile(`${zipPath}.sha256`, "utf8")).toBe("old-zip-sha");
    expect(await readFile(dmgPath, "utf8")).toBe("old-dmg");
    expect(await readFile(`${dmgPath}.sha256`, "utf8")).toBe("old-dmg-sha");
  });

  it("发现与成品不匹配的旧 sha256 时只清理 sidecar，不删除最后成品", async () => {
    expect(policy.removeStaleChecksum).toBeTypeOf("function");
    if (!policy.removeStaleChecksum) return;
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-stale-sha-"));
    temporaryRoots.push(root);
    const outputPath = path.join(root, "VisualForge.tar.gz");
    await writeFile(outputPath, "artifact");
    await writeFile(`${outputPath}.sha256`, `${"0".repeat(64)}  VisualForge.tar.gz\n`);

    await policy.removeStaleChecksum(outputPath);

    expect(await readFile(outputPath, "utf8")).toBe("artifact");
    await expect(lstat(`${outputPath}.sha256`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("真实打包脚本接入新 staging、同一清单和动态包版本", async () => {
    const [packageSource, universalSource, packageJsonText, notarizeSource] = await Promise.all([
      readFile(new URL("../../apps/native-host/scripts/package-distribution.mjs", import.meta.url), "utf8"),
      readFile(new URL("../../apps/native-host/scripts/build-universal.mjs", import.meta.url), "utf8"),
      readFile(new URL("../../apps/native-host/package.json", import.meta.url), "utf8"),
      readFile(new URL("../../apps/native-host/scripts/notarize-distribution.mjs", import.meta.url), "utf8")
    ]);
    const packageJson = JSON.parse(packageJsonText) as { scripts?: Record<string, string> };

    expect(packageSource).toContain("createFreshStagingDirectory");
    expect(packageSource).toContain("assertStagingMatchesManifest");
    expect(packageSource).toContain("renderLinuxInstaller");
    expect(packageSource).toContain("packageVersion");
    expect(universalSource).toContain("validateUniversalBuildInputs");
    expect(universalSource).not.toContain('hostVersion: "0.5.0"');
    expect(packageJson.scripts?.["build:universal"]).toContain("VISUALFORGE_TARGET_ARCH=arm64");
    expect(packageJson.scripts?.["build:universal"]).toContain("VISUALFORGE_TARGET_ARCH=x64");
    expect(packageJson.scripts?.["package:universal"]).toContain("@styleforge/extension zip");
    expect(packageJson.scripts?.["package:universal"]).toContain("build:universal");
    for (const scriptName of ["package:distribution", "package:windows-x64", "package:linux-x64"]) {
      expect(packageJson.scripts?.[scriptName]).toContain("@styleforge/extension zip");
    }
    expect(packageSource).toContain("publishArtifactWithChecksum");
    expect(packageSource).toContain("await publishArtifactSetWithChecksums");
    expect(packageSource.indexOf("await publishArtifactSetWithChecksums"))
      .toBeGreaterThan(packageSource.indexOf('"create",'));
    expect(packageSource).toContain("removeStaleChecksum");
    expect(packageSource).toContain("cleanupStagingDirectory");
    expect(universalSource).toContain("publishArtifactGroup");
    expect(packageSource).toContain("extensionZipSha256");
    expect(packageSource).toContain('const stagingRoot = targetPlatform === "darwin" ? os.tmpdir()');
    expect(packageSource).toMatch(/createFreshStagingDirectory\(\s*stagingRoot/);
    expect(packageSource).toContain('"/usr/bin/chflags", ["nohidden"');
    expect(packageSource).toContain("assertDarwinDmgFinderEntriesVisible");
    expect(notarizeSource).toContain("clearDarwinFinderHiddenFlags");
    expect(notarizeSource).toMatch(/clearDarwinFinderHiddenFlags\(\[archivePath, `\$\{archivePath\}\.sha256`, resultPath\]\)/);
  });
});
