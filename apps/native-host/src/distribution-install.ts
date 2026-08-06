import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { NATIVE_HOST_NAME } from "@styleforge/contracts/native-messaging";
import { discoverCodex } from "./codex-discovery.js";
import { purgeAllUserData } from "./cleanup.js";
import { resolveAbsoluteBaseDirectory, resolveSupportDirectory } from "./support-paths.js";

export { resolveSupportDirectory } from "./support-paths.js";

const EXTENSION_ID = "jjmhfaamncdoaliheodgcnhklimoaocc";
const CHROME_EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const execFileAsync = promisify(execFile);
const WINDOWS_REGISTRY_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${NATIVE_HOST_NAME}`;
type RegistryCommand = (args: string[]) => Promise<void>;

function manifestDirectories(
  homeDir: string,
  platform: NodeJS.Platform,
  includeDevelopmentBrowsers = false,
  xdgConfigHome?: string
) {
  if (platform === "linux") {
    const configRoot = resolveAbsoluteBaseDirectory(
      xdgConfigHome ?? process.env.XDG_CONFIG_HOME,
      path.join(homeDir, ".config"),
      platform
    );
    const directories = [path.join(configRoot, "google-chrome/NativeMessagingHosts")];
    if (includeDevelopmentBrowsers) directories.push(
      path.join(configRoot, "google-chrome-for-testing/NativeMessagingHosts"),
      path.join(configRoot, "chromium/NativeMessagingHosts")
    );
    return directories;
  }
  const directories = ["Library/Application Support/Google/Chrome/NativeMessagingHosts"];
  if (includeDevelopmentBrowsers && platform === "darwin") directories.push(
    "Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts",
    "Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts",
    "Library/Application Support/Chromium/NativeMessagingHosts"
  );
  return directories.map((relative) => path.join(homeDir, relative));
}

async function runRegistry(args: string[]) {
  await execFileAsync("reg.exe", args, { windowsHide: true });
}

export async function installSelfContainedHost(options: {
  executablePath?: string;
  codexPath?: string;
  homeDir?: string;
  extensionId?: string;
  includeDevelopmentBrowsers?: boolean;
  platform?: NodeJS.Platform;
  localAppData?: string;
  xdgDataHome?: string;
  xdgConfigHome?: string;
  runRegistryCommand?: RegistryCommand;
} = {}) {
  const extensionId = options.extensionId ?? EXTENSION_ID;
  if (!CHROME_EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error(`Chrome 扩展 ID 无效：${extensionId}`);
  }
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const supportDir = resolveSupportDirectory({
    platform,
    homeDir,
    localAppData: options.localAppData,
    xdgDataHome: options.xdgDataHome
  });
  const binDir = path.join(supportDir, "bin");
  const installedPath = path.join(binDir, platform === "win32" ? "visualforge-native-host.exe" : "visualforge-native-host");
  const sourcePath = options.executablePath ?? process.execPath;
  const temporaryPath = `${installedPath}.installing-${process.pid}`;

  if (options.codexPath) {
    const discovery = await discoverCodex({
      explicitPath: options.codexPath,
      commonPaths: [],
      pathValue: "",
      platform
    });
    if (!discovery.found) throw new Error(`配置的 Codex 路径不可用：${options.codexPath}`);
  }

  await mkdir(binDir, { recursive: true, mode: 0o700 });
  try {
    await copyFile(sourcePath, temporaryPath);
    await chmod(temporaryPath, 0o755);
    await rename(temporaryPath, installedPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  if (options.codexPath) {
    await writeFile(
      path.join(supportDir, "host.json"),
      `${JSON.stringify({ codexPath: options.codexPath }, null, 2)}\n`,
      { mode: 0o600 }
    );
  }

  const manifest = `${JSON.stringify({
    name: NATIVE_HOST_NAME,
    description: "VisualForge 本地 Codex 桥接程序",
    path: installedPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  }, null, 2)}\n`;
  const installedManifests: string[] = [];
  const manifestPaths = platform === "win32"
    ? [path.join(supportDir, `${NATIVE_HOST_NAME}.json`)]
    : manifestDirectories(homeDir, platform, options.includeDevelopmentBrowsers, options.xdgConfigHome)
      .map((directory) => path.join(directory, `${NATIVE_HOST_NAME}.json`));
  for (const manifestPath of manifestPaths) {
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, manifest, { mode: 0o644 });
    installedManifests.push(manifestPath);
  }
  if (platform === "win32") {
    await (options.runRegistryCommand ?? runRegistry)([
      "ADD", WINDOWS_REGISTRY_KEY, "/ve", "/t", "REG_SZ", "/d", installedManifests[0]!, "/f"
    ]);
  }
  return { installedPath, installedManifests };
}

export async function configureCodexPath(codexPath: string, homeDir = os.homedir()) {
  const platform = process.platform;
  const discovery = await discoverCodex({
    explicitPath: codexPath,
    commonPaths: [],
    pathValue: "",
    platform
  });
  if (!discovery.found) throw new Error(`配置的 Codex 路径不可用：${codexPath}`);
  const supportDir = resolveSupportDirectory({ platform, homeDir });
  await mkdir(supportDir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(supportDir, "host.json"),
    `${JSON.stringify({ codexPath: discovery.path }, null, 2)}\n`,
    { mode: 0o600 }
  );
  return discovery;
}

export async function uninstallSelfContainedHost(options: {
  homeDir?: string;
  deleteUserData?: boolean;
  platform?: NodeJS.Platform;
  localAppData?: string;
  xdgDataHome?: string;
  xdgConfigHome?: string;
  runRegistryCommand?: RegistryCommand;
} = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const supportDir = resolveSupportDirectory({
    platform,
    homeDir,
    localAppData: options.localAppData,
    xdgDataHome: options.xdgDataHome
  });
  const manifestTargets = platform === "win32"
    ? [path.join(supportDir, `${NATIVE_HOST_NAME}.json`)]
    : manifestDirectories(homeDir, platform, true, options.xdgConfigHome)
      .map((directory) => path.join(directory, `${NATIVE_HOST_NAME}.json`));
  const targets = [
    ...manifestTargets,
    path.join(supportDir, "bin", platform === "win32" ? "visualforge-native-host.exe" : "visualforge-native-host")
  ];
  const removed: string[] = [];
  for (const target of targets) {
    await unlink(target).then(
      () => removed.push(target),
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }
    );
  }
  if (platform === "win32") {
    await (options.runRegistryCommand ?? runRegistry)(["DELETE", WINDOWS_REGISTRY_KEY, "/f"])
      .catch(() => undefined);
  }
  const purged = options.deleteUserData
    ? await purgeAllUserData({
      supportDir,
      preserveBin: false
    })
    : null;
  if (options.deleteUserData) {
    await rmdir(path.join(supportDir, "bin")).catch((error: NodeJS.ErrnoException) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code ?? "")) throw error;
    });
    await rmdir(supportDir).catch((error: NodeJS.ErrnoException) => {
      if (!["ENOENT", "ENOTEMPTY"].includes(error.code ?? "")) throw error;
    });
  }
  return { removed, purged };
}
