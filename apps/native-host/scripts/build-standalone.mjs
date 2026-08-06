import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { fetchNodeRuntime } from "./fetch-node-runtime.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const packageVersion = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
if (typeof packageVersion !== "string" || !packageVersion.trim()) {
  throw new Error("Native Host package.json 缺少有效版本号");
}
const targetPlatform = process.env.VISUALFORGE_TARGET_PLATFORM?.trim() || process.platform;
if (!['darwin', 'win32', 'linux'].includes(targetPlatform)) {
  throw new Error(`不支持的目标平台：${targetPlatform}`);
}
const targetArch = process.env.VISUALFORGE_TARGET_ARCH?.trim() || process.arch;
if (!['arm64', 'x64'].includes(targetArch)) {
  throw new Error(`不支持的目标架构：${targetArch}`);
}
if (targetPlatform !== "darwin" && targetArch !== "x64") {
  throw new Error(`${targetPlatform} 当前只提供 x64 运行时`);
}
const configuredTargetNode = process.env.VISUALFORGE_NODE_EXECUTABLE?.trim();
const downloadedRuntime = !configuredTargetNode &&
  (targetPlatform !== process.platform || targetArch !== process.arch)
  ? await fetchNodeRuntime(targetPlatform, targetArch)
  : null;
const targetNode = path.resolve(configuredTargetNode || downloadedRuntime?.executablePath || process.execPath);
const buildDir = path.join(packageRoot, "dist-standalone", `build-${targetPlatform}-${targetArch}`);
const releaseDir = path.join(packageRoot, "release", `${targetPlatform}-${targetArch}`);
const bundlePath = path.join(buildDir, "styleforge-host.cjs");
const blobPath = path.join(buildDir, "styleforge-host.blob");
const configPath = path.join(buildDir, "sea-config.json");
const binaryName = targetPlatform === "win32" ? "visualforge-native-host.exe" : "visualforge-native-host";
const binaryPath = path.join(releaseDir, binaryName);
const postjectPath = path.join(packageRoot, "node_modules/.bin/postject");
const entitlementsPath = path.join(packageRoot, "release-entitlements.plist");
const entitlementsEvidencePath = path.join(packageRoot, "release-entitlements-evidence.json");
const signingIdentity = process.env.VISUALFORGE_SIGN_IDENTITY?.trim();
const entitlementsEvidence = JSON.parse(await readFile(entitlementsEvidencePath, "utf8"));

const [sourceGitCommitResult, sourceGitStatusResult] = await Promise.all([
  execFileAsync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot }),
  execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: workspaceRoot })
]);
const sourceGitCommit = sourceGitCommitResult.stdout.trim();
if (!/^[a-f0-9]{40}$/.test(sourceGitCommit)) throw new Error("无法取得有效的 Git source commit");
const sourceGitDirty = sourceGitStatusResult.stdout.trim().length > 0;
const sourceIdentity = `git:${sourceGitCommit}${sourceGitDirty ? "+dirty" : ""}`;

if (process.platform !== "darwin") {
  throw new Error("跨平台发行构建当前从 macOS 构建机执行");
}

const buildRuntimeInfo = { version: process.version, arch: process.arch, platform: process.platform };
if (buildRuntimeInfo.version !== "v22.17.1") {
  throw new Error(`SEA blob 必须使用 Node v22.17.1 生成，当前为 ${buildRuntimeInfo.version}`);
}
let targetRuntimeInfo = {
  version: downloadedRuntime?.nodeVersion ?? process.version,
  arch: targetArch,
  platform: targetPlatform
};
if (targetPlatform === process.platform) {
  const targetRuntime = await execFileAsync(targetNode, ["-p", "JSON.stringify({version:process.version,arch:process.arch,platform:process.platform})"]);
  targetRuntimeInfo = JSON.parse(targetRuntime.stdout.trim());
  if (targetRuntimeInfo.arch !== targetArch || targetRuntimeInfo.platform !== targetPlatform) {
    throw new Error(`目标 Node 不匹配：期望 ${targetPlatform}-${targetArch}，实际 ${targetRuntimeInfo.platform}-${targetRuntimeInfo.arch}`);
  }
}

await mkdir(buildDir, { recursive: true });
await mkdir(releaseDir, { recursive: true });
await build({
  entryPoints: [path.join(packageRoot, "src/index.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "none"
});
await writeFile(configPath, `${JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false
}, null, 2)}\n`);
await execFileAsync(process.execPath, ["--experimental-sea-config", configPath], {
  cwd: packageRoot
});
await copyFile(targetNode, binaryPath);
if (targetPlatform !== "win32") await chmod(binaryPath, 0o755);
if (targetPlatform === "darwin") {
  await execFileAsync("/usr/bin/codesign", ["--remove-signature", binaryPath]);
}
const postjectArgs = [
  binaryPath,
  "NODE_SEA_BLOB",
  blobPath,
  "--sentinel-fuse",
  "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
];
if (targetPlatform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
await execFileAsync(postjectPath, postjectArgs);
if (targetPlatform === "darwin" && signingIdentity) {
  await execFileAsync("/usr/bin/codesign", [
    "--force",
    "--options", "runtime",
    "--timestamp",
    "--entitlements", entitlementsPath,
    "--identifier", "com.blteam.visualforge.native-host",
    "--sign", signingIdentity,
    binaryPath
  ]);
} else if (targetPlatform === "darwin") {
  await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", binaryPath]);
}
if (targetPlatform === "darwin") {
  await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", binaryPath]);
}
let runtimeVerifiedOnBuildMachine = false;
if (targetPlatform === "darwin") {
  const selfCheckExecutable = targetArch === process.arch ? binaryPath : "/usr/bin/arch";
  const selfCheckArgs = targetArch === process.arch
    ? ["--version"]
    : [targetArch === "x64" ? "-x86_64" : "-arm64", binaryPath, "--version"];
  const version = await execFileAsync(selfCheckExecutable, selfCheckArgs, {
    env: { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin" },
    timeout: 30_000
  });
  if (!version.stdout.includes(`visualforge-native-host ${packageVersion}`)) {
    throw new Error("自包含 Native Host 版本自检失败");
  }
  runtimeVerifiedOnBuildMachine = true;
}
const hash = createHash("sha256").update(await readFile(binaryPath)).digest("hex");
await writeFile(path.join(releaseDir, "SHA256SUMS"), `${hash}  ${binaryName}\n`);
await writeFile(path.join(releaseDir, "build-metadata.json"), `${JSON.stringify({
  hostVersion: packageVersion,
  platform: targetPlatform,
  arch: targetArch,
  architectures: [targetArch === "x64" ? "x86_64" : "arm64"],
  nodeVersion: targetRuntimeInfo.version,
  sha256: hash,
  signature: targetPlatform === "darwin" ? (signingIdentity ? "developer-id-application" : "ad-hoc-development-only") : "unsigned",
  signingIdentity: targetPlatform === "darwin" ? signingIdentity || null : null,
  hardenedRuntime: targetPlatform === "darwin" && Boolean(signingIdentity),
  secureTimestamp: targetPlatform === "darwin" && Boolean(signingIdentity),
  historicalEntitlementsEvidence: targetPlatform === "darwin" ? entitlementsEvidence : null,
  sourceGitCommit,
  sourceGitDirty,
  sourceIdentity,
  buildMachine: buildRuntimeInfo,
  runtimeVerifiedOnBuildMachine,
  targetRuntimeArchive: downloadedRuntime?.archiveName ?? null,
  targetRuntimeArchiveSha256: downloadedRuntime?.archiveSha256 ?? null,
  notarized: false
}, null, 2)}\n`);
process.stdout.write(`已构建自包含 Native Host：${binaryPath}\nSHA-256：${hash}\n`);
