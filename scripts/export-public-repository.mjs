import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedOutput = process.argv.slice(2).find((argument) => argument !== "--")?.trim();
if (!requestedOutput) {
  throw new Error("用法：pnpm export:public -- <全新或空的输出目录>");
}
const outputRoot = path.resolve(requestedOutput);
if (outputRoot === workspaceRoot || workspaceRoot.startsWith(`${outputRoot}${path.sep}`)) {
  throw new Error("公开导出目录不能是当前仓库或其父目录。");
}
try {
  if ((await readdir(outputRoot)).length > 0) {
    throw new Error("公开导出目录必须为空，脚本不会覆盖或清理已有文件。");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await mkdir(outputRoot, { recursive: true });

const publicEntries = [
  ".github", ".gitignore", ".nojekyll",
  "apps", "packages", "tests/unit", "assets", "scripts/export-public-repository.mjs",
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "vitest.config.ts",
  "README.md", "README.en.md", "INSTALL.md", "INSTALL.en.md",
  "LICENSE", "NOTICE", "CONTRIBUTING.md", "SECURITY.md", "PRIVACY.md", "CHANGELOG.md",
  "index.html", "downloads.html", "privacy.html", "support.html"
];

const forbiddenPathFragments = [
  "tasks", "tests/evidence", "tests/real", "tests/fixtures", "tests/e2e",
  "VISUALFORGE_UX_FLOW_HANDOFF", "PRODUCT_AUDIT", "AGENTS.md",
  "StyleForge_Codex_执行包", "StyleForge_Final_Codex_Execution_Package",
  "dist-standalone", "dist-distribution", "apps/native-host/release"
];
const omittedUnitTests = new Set([
  "tests/unit/distribution-package.test.ts",
  "tests/unit/extension-release-contract.test.ts",
  "tests/unit/public-repository-readiness.test.ts",
  "tests/unit/signature-style-system.test.ts"
]);

function includeSource(source) {
  const relative = path.relative(workspaceRoot, source).split(path.sep).join("/");
  if (!relative) return true;
  if (forbiddenPathFragments.some((fragment) =>
    relative === fragment || relative.startsWith(`${fragment}/`) || relative.includes(`/${fragment}/`))) return false;
  if (omittedUnitTests.has(relative)) return false;
  if (["node_modules", ".output", ".wxt", "dist", "coverage", "test-results"]
    .some((segment) => relative.split("/").includes(segment))) return false;
  return true;
}

for (const entry of publicEntries) {
  const source = path.join(workspaceRoot, entry);
  try {
    await stat(source);
  } catch (error) {
    throw new Error(`公开白名单文件不存在：${entry}（${error.message}）`);
  }
  await cp(source, path.join(outputRoot, entry), {
    recursive: true,
    preserveTimestamps: false,
    filter: includeSource
  });
}

const exportedPackagePath = path.join(outputRoot, "package.json");
const exportedPackage = JSON.parse(await readFile(exportedPackagePath, "utf8"));
for (const script of Object.keys(exportedPackage.scripts ?? {})) {
  if (script === "e2e" || script.startsWith("e2e:") || script.startsWith("test:real:")) {
    delete exportedPackage.scripts[script];
  }
}
await writeFile(exportedPackagePath, `${JSON.stringify(exportedPackage, null, 2)}\n`);

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(absolute));
    else if (entry.isFile()) result.push(absolute);
  }
  return result;
}

const exportedFiles = await listFiles(outputRoot);
const exportedRelativePaths = exportedFiles.map((file) =>
  path.relative(outputRoot, file).split(path.sep).join("/"));
for (const relative of exportedRelativePaths) {
  if (forbiddenPathFragments.some((fragment) =>
    relative === fragment || relative.startsWith(`${fragment}/`) || relative.includes(`/${fragment}/`))) {
    throw new Error(`公开目录包含禁止路径：${relative}`);
  }
}

const forbiddenTextFragments = [
  ["man", "xiaochu"].join(""),
  ["YAN", "JIE LI"].join(""),
  ["ALV8", "Y54GCY"].join("")
];
const privateKeyPattern = new RegExp(["BEGIN", ".{0,24}", "PRIVATE KEY"].join(" "), "i");
const legacyDownloadRepositoryPattern = new RegExp(["visualforge", "downloads"].join("-"), "i");
const credentialPatterns = [
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/
];
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
  ".plist", ".sh", ".ts", ".tsx", ".txt", ".yaml", ".yml"
]);
for (let index = 0; index < exportedFiles.length; index += 1) {
  const file = exportedFiles[index];
  const relative = exportedRelativePaths[index];
  if (!textExtensions.has(path.extname(file)) && !["LICENSE", "NOTICE", ".gitignore", ".nojekyll"]
    .includes(path.basename(file))) continue;
  const content = await readFile(file, "utf8");
  const finding = forbiddenTextFragments.find((fragment) => content.includes(fragment))
    ?? (privateKeyPattern.test(content) ? "private-key-marker" : null)
    ?? (legacyDownloadRepositoryPattern.test(content) ? "legacy-download-repository" : null)
    ?? credentialPatterns.find((pattern) => pattern.test(content))?.source;
  if (finding) throw new Error(`公开文件扫描失败：${relative} 命中 ${finding}`);
}

const requiredPublicFiles = [
  "README.md", "README.en.md", "INSTALL.md", "INSTALL.en.md", "index.html", "downloads.html",
  "assets/screenshots/01-start.png", "assets/screenshots/04-result.png",
  "apps/extension/entrypoints/sidepanel/App.tsx", "apps/native-host/src/index.ts"
];
for (const required of requiredPublicFiles) {
  if (!exportedRelativePaths.includes(required)) throw new Error(`公开导出缺少必要文件：${required}`);
}

process.stdout.write(`${JSON.stringify({ outputRoot, fileCount: exportedFiles.length }, null, 2)}\n`);
