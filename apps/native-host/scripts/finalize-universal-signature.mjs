import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(packageRoot, "release", "darwin-universal");
const outputPath = path.join(outputDir, "visualforge-native-host");
const metadataPath = path.join(outputDir, "build-metadata.json");
const checksumsPath = path.join(outputDir, "SHA256SUMS");
const entitlementsPath = path.join(packageRoot, "release-entitlements.plist");
const signOnlyScriptPath = path.join(packageRoot, "scripts", "sign-universal-only.mjs");
const signingIdentity = process.env.VISUALFORGE_SIGN_IDENTITY?.trim();

if (process.platform !== "darwin") throw new Error("Universal 最终签名只能在 macOS 执行");
if (!signingIdentity) throw new Error("缺少 VISUALFORGE_SIGN_IDENTITY，不能完成 Universal 最终签名");

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "visualforge-final-signature-"));
const armSourcePath = path.join(temporaryDirectory, "visualforge-native-host.source-arm64");
const x64SourcePath = path.join(temporaryDirectory, "visualforge-native-host.source-x86_64");
const armPath = path.join(temporaryDirectory, "visualforge-native-host.arm64");
const x64Path = path.join(temporaryDirectory, "visualforge-native-host.x86_64");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

try {
  await execFileAsync("/bin/cp", ["-p", outputPath, armSourcePath]);
  await execFileAsync("/bin/cp", ["-p", outputPath, x64SourcePath]);
  await execFileAsync("/usr/bin/lipo", [armSourcePath, "-extract", "arm64", "-output", armPath]);
  await execFileAsync("/usr/bin/lipo", [x64SourcePath, "-extract", "x86_64", "-output", x64Path]);
  await Promise.all([
    execFileAsync("/usr/bin/codesign", ["--remove-signature", armPath]),
    execFileAsync("/usr/bin/codesign", ["--remove-signature", x64Path])
  ]);
  const [unsignedArmBytes, unsignedX64Bytes, metadata] = await Promise.all([
    readFile(armPath),
    readFile(x64Path),
    readFile(metadataPath, "utf8").then(JSON.parse)
  ]);
  metadata.preFinalUnsignedSliceSha256 = {
    arm64: sha256(unsignedArmBytes),
    x86_64: sha256(unsignedX64Bytes)
  };
  delete metadata.universalSliceSha256;
  await unlink(outputPath);
  await execFileAsync("/usr/bin/lipo", ["-create", armPath, x64Path, "-output", outputPath]);
  await chmod(outputPath, 0o755);
  // 在最终路径创建全新无签名 fat 文件后，由独立进程只签一次并立即退出。
  await execFileAsync(process.execPath, [signOnlyScriptPath], { env: process.env });
  const hash = sha256(await readFile(outputPath));
  metadata.sha256 = hash;
  metadata.finalSignatureAppliedAfterAudit = true;
  await Promise.all([
    writeFile(checksumsPath, `${hash}  visualforge-native-host\n`),
    writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
  ]);
  await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=4", outputPath]);
  process.stdout.write(`Universal 最终路径签名与冷验签通过：${outputPath}\nSHA-256：${hash}\n`);
} finally {
  for (const filePath of [armSourcePath, x64SourcePath, armPath, x64Path]) {
    await unlink(filePath).catch(() => undefined);
  }
  await rmdir(temporaryDirectory).catch(() => undefined);
}
