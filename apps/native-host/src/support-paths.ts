import os from "node:os";
import path from "node:path";

export interface SupportDirectoryOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  localAppData?: string;
  xdgDataHome?: string;
}

export function resolveAbsoluteBaseDirectory(
  configured: string | undefined,
  fallback: string,
  platform: NodeJS.Platform
) {
  const value = configured?.trim();
  if (!value) return fallback;
  const absolute = platform === "win32" ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
  return absolute ? value : fallback;
}

export function resolveSupportDirectory(options: SupportDirectoryOptions = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  if (platform === "win32") {
    const fallback = path.join(homeDir, "AppData/Local");
    return path.join(
      resolveAbsoluteBaseDirectory(options.localAppData ?? process.env.LOCALAPPDATA, fallback, platform),
      "VisualForge"
    );
  }
  if (platform === "linux") {
    const fallback = path.join(homeDir, ".local/share");
    return path.join(
      resolveAbsoluteBaseDirectory(options.xdgDataHome ?? process.env.XDG_DATA_HOME, fallback, platform),
      "VisualForge"
    );
  }
  return path.join(homeDir, "Library/Application Support/VisualForge");
}
