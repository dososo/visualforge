import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeVersion = "22.17.1";
const downloadRoot = `https://nodejs.org/dist/v${nodeVersion}`;

const archives = {
  "darwin-arm64": "node-v22.17.1-darwin-arm64.tar.gz",
  "darwin-x64": "node-v22.17.1-darwin-x64.tar.gz",
  "win32-x64": "node-v22.17.1-win-x64.zip",
  "linux-x64": "node-v22.17.1-linux-x64.tar.xz"
};

async function download(url, destination) {
  const temporary = `${destination}.download-${process.pid}`;
  await unlink(temporary).catch(() => undefined);
  try {
    await execFileAsync("/usr/bin/curl", ["--fail", "--location", "--silent", "--show-error", "--output", temporary, url]);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function fetchNodeRuntime(targetPlatform, targetArch = "x64") {
  const runtimeKey = `${targetPlatform}-${targetArch}`;
  if (!Object.hasOwn(archives, runtimeKey)) {
    throw new Error(`不支持的 Node 运行时：${runtimeKey}`);
  }
  const archiveName = archives[runtimeKey];
  const cacheDir = path.join(packageRoot, "dist-standalone", "node-runtime-cache");
  const archivePath = path.join(cacheDir, archiveName);
  const shasumsPath = path.join(cacheDir, "SHASUMS256.txt");
  const extractedRoot = path.join(cacheDir, archiveName.replace(/\.(zip|tar\.xz|tar\.gz)$/, ""));
  const executablePath = targetPlatform === "win32"
    ? path.join(extractedRoot, "node.exe")
    : path.join(extractedRoot, "bin", "node");

  await mkdir(cacheDir, { recursive: true });
  await download(`${downloadRoot}/SHASUMS256.txt`, shasumsPath);
  const expectedLine = (await readFile(shasumsPath, "utf8"))
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith(`  ${archiveName}`));
  if (!expectedLine) throw new Error(`Node 官方 SHASUMS256.txt 中没有 ${archiveName}`);
  const expectedHash = expectedLine.trim().split(/\s+/)[0];

  let archive;
  try {
    archive = await readFile(archivePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await download(`${downloadRoot}/${archiveName}`, archivePath);
    archive = await readFile(archivePath);
  }
  let actualHash = createHash("sha256").update(archive).digest("hex");
  if (actualHash !== expectedHash) {
    await download(`${downloadRoot}/${archiveName}`, archivePath);
    archive = await readFile(archivePath);
    actualHash = createHash("sha256").update(archive).digest("hex");
  }
  if (actualHash !== expectedHash) {
    throw new Error(`Node 运行时校验失败：${archiveName}`);
  }

  try {
    await readFile(executablePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if (archiveName.endsWith(".zip")) {
      await execFileAsync("/usr/bin/unzip", ["-o", "-q", archivePath, "-d", cacheDir]);
    } else if (archiveName.endsWith(".tar.xz")) {
      await execFileAsync("/usr/bin/tar", ["-xJf", archivePath, "-C", cacheDir]);
    } else {
      await execFileAsync("/usr/bin/tar", ["-xzf", archivePath, "-C", cacheDir]);
    }
  }

  return {
    executablePath,
    licensePath: path.join(extractedRoot, "LICENSE"),
    nodeVersion: `v${nodeVersion}`,
    archiveName,
    archiveSha256: actualHash
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const targetPlatform = process.env.VISUALFORGE_TARGET_PLATFORM?.trim();
  if (!targetPlatform) throw new Error("缺少 VISUALFORGE_TARGET_PLATFORM");
  const targetArch = process.env.VISUALFORGE_TARGET_ARCH?.trim() || "x64";
  const runtime = await fetchNodeRuntime(targetPlatform, targetArch);
  process.stdout.write(`${runtime.executablePath}\n`);
}
