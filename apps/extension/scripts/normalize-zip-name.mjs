import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { publishArtifactWithChecksum } from "../../native-host/scripts/distribution-release-policy.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")).version;
const outputDirectory = path.join(packageRoot, ".output");
const sourcePath = path.join(outputDirectory, `styleforgeextension-${packageVersion}-chrome.zip`);
const outputPath = path.join(outputDirectory, `VisualForge-${packageVersion}-chrome.zip`);

const hash = await publishArtifactWithChecksum({
  temporaryPath: sourcePath,
  outputPath,
  validate: async (candidatePath) => {
    await execFileAsync("/usr/bin/unzip", ["-t", candidatePath], { maxBuffer: 4 * 1024 * 1024 });
    const { stdout } = await execFileAsync("/usr/bin/unzip", ["-p", candidatePath, "manifest.json"], {
      maxBuffer: 4 * 1024 * 1024
    });
    const manifest = JSON.parse(stdout);
    if (manifest.version !== packageVersion) {
      throw new Error(`扩展 ZIP 版本不一致：期望 ${packageVersion}，实际 ${manifest.version ?? "缺失"}`);
    }
  }
});
process.stdout.write(`已生成 VisualForge 扩展包：${outputPath}\nSHA-256：${hash}\n`);
