import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  publishArtifactGroup,
  validateUniversalBuildInputs,
  withFreshStagingDirectory
} from "./distribution-release-policy.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRoot = path.join(packageRoot, "release");
const armPath = path.join(releaseRoot, "darwin-arm64", "visualforge-native-host");
const x64Path = path.join(releaseRoot, "darwin-x64", "visualforge-native-host");
const outputDir = path.join(releaseRoot, "darwin-universal");
const outputPath = path.join(outputDir, "visualforge-native-host");
const packageVersion = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
const entitlementsPath = path.join(packageRoot, "release-entitlements.plist");
const entitlementsEvidencePath = path.join(packageRoot, "release-entitlements-evidence.json");
const signingIdentity = process.env.VISUALFORGE_SIGN_IDENTITY?.trim();
const entitlementsEvidence = JSON.parse(await readFile(entitlementsEvidencePath, "utf8"));

if (process.platform !== "darwin") throw new Error("Universal Native Host 只能在 macOS 构建");
if (!signingIdentity) throw new Error("缺少 VISUALFORGE_SIGN_IDENTITY，不能生成正式 Universal 候选");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function verifyChecksumFile(contents, expectedHash, binaryName, label) {
  const [actualHash, actualName] = contents.trim().split(/\s+/, 2);
  if (actualHash !== expectedHash || actualName !== binaryName) {
    throw new Error(`${label} SHA256SUMS 与现场文件不一致`);
  }
}

async function readSignatureDetails(filePath) {
  const result = await execFileAsync("/usr/bin/codesign", ["-d", "--verbose=4", filePath]);
  return `${result.stdout}\n${result.stderr}`;
}

const [armMetadata, x64Metadata, armBytes, x64Bytes, armChecksums, x64Checksums] = await Promise.all([
  readFile(path.join(releaseRoot, "darwin-arm64", "build-metadata.json"), "utf8").then(JSON.parse),
  readFile(path.join(releaseRoot, "darwin-x64", "build-metadata.json"), "utf8").then(JSON.parse),
  readFile(armPath),
  readFile(x64Path),
  readFile(path.join(releaseRoot, "darwin-arm64", "SHA256SUMS"), "utf8"),
  readFile(path.join(releaseRoot, "darwin-x64", "SHA256SUMS"), "utf8")
]);
const armActualSha256 = sha256(armBytes);
const x64ActualSha256 = sha256(x64Bytes);
verifyChecksumFile(armChecksums, armActualSha256, "visualforge-native-host", "arm64");
verifyChecksumFile(x64Checksums, x64ActualSha256, "visualforge-native-host", "x64");

const [armVersion, x64Version, armArchitectures, x64Architectures] = await Promise.all([
  execFileAsync("/usr/bin/arch", ["-arm64", armPath, "--version"], { timeout: 30_000 }),
  execFileAsync("/usr/bin/arch", ["-x86_64", x64Path, "--version"], { timeout: 30_000 }),
  execFileAsync("/usr/bin/lipo", ["-archs", armPath]),
  execFileAsync("/usr/bin/lipo", ["-archs", x64Path]),
  execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", armPath]),
  execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", x64Path])
]);
const [armSignatureDetails, x64SignatureDetails] = await Promise.all([
  readSignatureDetails(armPath),
  readSignatureDetails(x64Path)
]);

await mkdir(outputDir, { recursive: true });
await withFreshStagingDirectory(
  path.join(packageRoot, "dist-standalone"),
  "universal-build",
  async (temporaryDirectory) => {
    const temporaryOutputPath = path.join(temporaryDirectory, "visualforge-native-host");
    const unsignedArmPath = path.join(temporaryDirectory, "visualforge-native-host.unsigned-arm64");
    const unsignedX64Path = path.join(temporaryDirectory, "visualforge-native-host.unsigned-x86_64");
    const armExtractionSourcePath = path.join(temporaryDirectory, "visualforge-native-host.source-arm64");
    const x64ExtractionSourcePath = path.join(temporaryDirectory, "visualforge-native-host.source-x86_64");
    const extractedArmPath = path.join(temporaryDirectory, "visualforge-native-host.arm64");
    const extractedX64Path = path.join(temporaryDirectory, "visualforge-native-host.x86_64");
    const coldVerificationPath = path.join(temporaryDirectory, "visualforge-native-host.cold-verify");
    const publishedColdVerificationPath = path.join(temporaryDirectory, "visualforge-native-host.published-cold-verify");
    const publishedArmSourcePath = path.join(temporaryDirectory, "visualforge-native-host.published-source-arm64");
    const publishedX64SourcePath = path.join(temporaryDirectory, "visualforge-native-host.published-source-x86_64");
    const publishedArmPath = path.join(temporaryDirectory, "visualforge-native-host.published-arm64");
    const publishedX64Path = path.join(temporaryDirectory, "visualforge-native-host.published-x86_64");
    const committedColdVerificationPath = path.join(temporaryDirectory, "visualforge-native-host.committed-cold-verify");
    const committedArmSourcePath = path.join(temporaryDirectory, "visualforge-native-host.committed-source-arm64");
    const committedX64SourcePath = path.join(temporaryDirectory, "visualforge-native-host.committed-source-x86_64");
    const committedArmPath = path.join(temporaryDirectory, "visualforge-native-host.committed-arm64");
    const committedX64Path = path.join(temporaryDirectory, "visualforge-native-host.committed-x86_64");
    const temporaryChecksumsPath = path.join(temporaryDirectory, "SHA256SUMS");
    const temporaryMetadataPath = path.join(temporaryDirectory, "build-metadata.json");
    const signUniversal = (filePath = temporaryOutputPath) => execFileAsync("/usr/bin/codesign", [
      "--force",
      "--options", "runtime",
      "--timestamp",
      "--entitlements", entitlementsPath,
      "--identifier", "com.blteam.visualforge.native-host",
      "--sign", signingIdentity,
      filePath
    ]);
    await Promise.all([
      copyFile(armPath, unsignedArmPath),
      copyFile(x64Path, unsignedX64Path)
    ]);
    await Promise.all([
      execFileAsync("/usr/bin/codesign", ["--remove-signature", unsignedArmPath]),
      execFileAsync("/usr/bin/codesign", ["--remove-signature", unsignedX64Path])
    ]);
    await execFileAsync("/usr/bin/lipo", ["-create", unsignedArmPath, unsignedX64Path, "-output", temporaryOutputPath]);
    await chmod(temporaryOutputPath, 0o755);
    await signUniversal();
    await execFileAsync("/usr/bin/lipo", [temporaryOutputPath, "-verify_arch", "arm64", "x86_64"]);
    const architectures = await execFileAsync("/usr/bin/lipo", ["-archs", temporaryOutputPath]);
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", temporaryOutputPath]);
    const [universalArmVersion, universalX64Version] = await Promise.all([
      execFileAsync("/usr/bin/arch", ["-arm64", temporaryOutputPath, "--version"], { timeout: 30_000 }),
      execFileAsync("/usr/bin/arch", ["-x86_64", temporaryOutputPath, "--version"], { timeout: 30_000 })
    ]);
    // Node SEA 首次运行会改变既有代码签名的有效状态，运行自检后必须最后签名，且不得再次执行成品。
    await signUniversal();
    const universalSignatureDetails = await readSignatureDetails(temporaryOutputPath);
    await Promise.all([
      copyFile(temporaryOutputPath, armExtractionSourcePath),
      copyFile(temporaryOutputPath, x64ExtractionSourcePath)
    ]);
    await Promise.all([
      execFileAsync("/usr/bin/lipo", [armExtractionSourcePath, "-extract", "arm64", "-output", extractedArmPath]),
      execFileAsync("/usr/bin/lipo", [x64ExtractionSourcePath, "-extract", "x86_64", "-output", extractedX64Path])
    ]);
    const [universalArmBytes, universalX64Bytes] = await Promise.all([
      readFile(extractedArmPath),
      readFile(extractedX64Path)
    ]);
    await copyFile(temporaryOutputPath, coldVerificationPath);
    const finalSignatureVerification = await execFileAsync(
      "/usr/bin/codesign",
      ["--verify", "--strict", "--verbose=2", coldVerificationPath]
    );
    const universalArmSliceSha256 = sha256(universalArmBytes);
    const universalX64SliceSha256 = sha256(universalX64Bytes);
    validateUniversalBuildInputs({
      packageVersion,
      armMetadata,
      x64Metadata,
      armActualSha256,
      x64ActualSha256,
      armActualArchitectures: armArchitectures.stdout,
      x64ActualArchitectures: x64Architectures.stdout,
      armSignatureVerified: true,
      x64SignatureVerified: true,
      armSignatureDetails,
      x64SignatureDetails,
      armVersionOutput: armVersion.stdout,
      x64VersionOutput: x64Version.stdout,
      universalArmVersionOutput: universalArmVersion.stdout,
      universalX64VersionOutput: universalX64Version.stdout,
      universalArchitectures: architectures.stdout,
      universalSignatureVerified: finalSignatureVerification.stderr !== undefined,
      universalSignatureDetails,
      signingIdentity,
      universalArmSliceSha256,
      universalX64SliceSha256
    });

    let publishedHash = sha256(await readFile(temporaryOutputPath));
    const metadata = {
      hostVersion: packageVersion,
      platform: "darwin",
      arch: "universal",
      architectures: ["arm64", "x86_64"],
      nodeVersion: armMetadata.nodeVersion,
      sha256: publishedHash,
      signature: "developer-id-application",
      signingIdentity,
      hardenedRuntime: true,
      secureTimestamp: true,
      historicalEntitlementsEvidence: entitlementsEvidence,
      sourceGitCommit: armMetadata.sourceGitCommit,
      sourceGitDirty: armMetadata.sourceGitDirty,
      sourceIdentity: armMetadata.sourceIdentity,
      notarized: false,
      sourceSliceSha256: { arm64: armActualSha256, x86_64: x64ActualSha256 },
      universalSliceSha256: { arm64: universalArmSliceSha256, x86_64: universalX64SliceSha256 },
      signatureVerification: {
        arm64: true,
        x86_64: true,
        universal: true
      }
    };
    await writeFile(temporaryChecksumsPath, `${publishedHash}  visualforge-native-host\n`);
    await writeFile(temporaryMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    await publishArtifactGroup({
      replacements: [
        { temporaryPath: temporaryOutputPath, outputPath, copyInsteadOfRename: true },
        { temporaryPath: temporaryChecksumsPath, outputPath: path.join(outputDir, "SHA256SUMS") },
        { temporaryPath: temporaryMetadataPath, outputPath: path.join(outputDir, "build-metadata.json") }
      ],
      copyPath: async (sourcePath, destinationPath) => {
        await execFileAsync("/bin/cp", ["-p", sourcePath, destinationPath]);
      },
      finalize: async () => {
        await signUniversal(outputPath);
        await execFileAsync("/bin/cp", ["-p", outputPath, publishedColdVerificationPath]);
        await execFileAsync("/usr/bin/codesign", [
          "--verify", "--strict", "--verbose=2", publishedColdVerificationPath
        ]);
        await execFileAsync("/bin/cp", ["-p", outputPath, publishedArmSourcePath]);
        await execFileAsync("/bin/cp", ["-p", outputPath, publishedX64SourcePath]);
        await Promise.all([
          execFileAsync("/usr/bin/lipo", [publishedArmSourcePath, "-extract", "arm64", "-output", publishedArmPath]),
          execFileAsync("/usr/bin/lipo", [publishedX64SourcePath, "-extract", "x86_64", "-output", publishedX64Path])
        ]);
        const [publishedBytes, publishedArmBytes, publishedX64Bytes] = await Promise.all([
          readFile(outputPath),
          readFile(publishedArmPath),
          readFile(publishedX64Path)
        ]);
        publishedHash = sha256(publishedBytes);
        metadata.sha256 = publishedHash;
        metadata.universalSliceSha256 = {
          arm64: sha256(publishedArmBytes),
          x86_64: sha256(publishedX64Bytes)
        };
        await Promise.all([
          writeFile(path.join(outputDir, "SHA256SUMS"), `${publishedHash}  visualforge-native-host\n`),
          writeFile(path.join(outputDir, "build-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
        ]);
      }
    });
    // 事务发布会改变最终文件的 vnode；提交后在最终路径完成最后一次签名与冷验签。
    await signUniversal(outputPath);
    await execFileAsync("/bin/cp", ["-p", outputPath, committedColdVerificationPath]);
    await execFileAsync("/bin/cp", ["-p", outputPath, committedArmSourcePath]);
    await execFileAsync("/bin/cp", ["-p", outputPath, committedX64SourcePath]);
    await execFileAsync("/usr/bin/codesign", [
      "--verify", "--strict", "--verbose=2", committedColdVerificationPath
    ]);
    await Promise.all([
      execFileAsync("/usr/bin/lipo", [committedArmSourcePath, "-extract", "arm64", "-output", committedArmPath]),
      execFileAsync("/usr/bin/lipo", [committedX64SourcePath, "-extract", "x86_64", "-output", committedX64Path])
    ]);
    const [committedBytes, committedArmBytes, committedX64Bytes] = await Promise.all([
      readFile(outputPath),
      readFile(committedArmPath),
      readFile(committedX64Path)
    ]);
    publishedHash = sha256(committedBytes);
    metadata.sha256 = publishedHash;
    metadata.universalSliceSha256 = {
      arm64: sha256(committedArmBytes),
      x86_64: sha256(committedX64Bytes)
    };
    await Promise.all([
      writeFile(path.join(outputDir, "SHA256SUMS"), `${publishedHash}  visualforge-native-host\n`),
      writeFile(path.join(outputDir, "build-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    ]);
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", outputPath]);
    process.stdout.write(`已构建 Universal Native Host：${outputPath}\nSHA-256：${publishedHash}\n`);
  }
);
