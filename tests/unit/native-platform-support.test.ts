import { describe, expect, it } from "vitest";
import { lstat, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as distributionInstall from "../../apps/native-host/src/distribution-install";
import { cleanupExpiredHostFiles } from "../../apps/native-host/src/cleanup";

type SupportDirectoryResolver = (options: {
  platform: NodeJS.Platform;
  homeDir: string;
  localAppData?: string;
  xdgDataHome?: string;
}) => string;

describe("Native Host 跨平台支持目录", () => {
  it("macOS、Windows、Linux 由同一个规则解析支持目录", () => {
    const resolveSupportDirectory = (distributionInstall as unknown as {
      resolveSupportDirectory?: SupportDirectoryResolver;
    }).resolveSupportDirectory;
    expect(resolveSupportDirectory).toBeTypeOf("function");
    if (!resolveSupportDirectory) return;

    expect(resolveSupportDirectory({ platform: "darwin", homeDir: "/Users/jie" }))
      .toBe(path.join("/Users/jie", "Library/Application Support/VisualForge"));
    expect(resolveSupportDirectory({
      platform: "win32",
      homeDir: "C:\\Users\\jie",
      localAppData: "C:\\Users\\jie\\AppData\\Local"
    })).toBe(path.join("C:\\Users\\jie\\AppData\\Local", "VisualForge"));
    expect(resolveSupportDirectory({
      platform: "linux",
      homeDir: "/home/jie",
      xdgDataHome: "/mnt/user-data"
    })).toBe(path.join("/mnt/user-data", "VisualForge"));
    expect(resolveSupportDirectory({ platform: "linux", homeDir: "/home/jie" }))
      .toBe(path.join("/home/jie", ".local/share/VisualForge"));
    expect(resolveSupportDirectory({ platform: "linux", homeDir: "/home/jie", xdgDataHome: "" }))
      .toBe(path.join("/home/jie", ".local/share/VisualForge"));
    expect(resolveSupportDirectory({ platform: "linux", homeDir: "/home/jie", xdgDataHome: "relative/data" }))
      .toBe(path.join("/home/jie", ".local/share/VisualForge"));
  });

  it("Linux 安装与卸载对 XDG data/config 使用同一组绝对路径规则", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-xdg-home-"));
    const xdgRoot = await mkdtemp(path.join(os.tmpdir(), "visualforge xdg roots "));
    const xdgDataHome = path.join(xdgRoot, "data with spaces");
    const xdgConfigHome = path.join(xdgRoot, "config with spaces");
    const installed = await distributionInstall.installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      platform: "linux",
      xdgDataHome,
      xdgConfigHome
    });
    const expectedHost = path.join(xdgDataHome, "VisualForge/bin/visualforge-native-host");
    const expectedManifest = path.join(
      xdgConfigHome,
      "google-chrome/NativeMessagingHosts/com.blteam.styleforge.json"
    );
    expect(installed.installedPath).toBe(expectedHost);
    expect(installed.installedManifests).toEqual([expectedManifest]);
    expect(JSON.parse(await readFile(expectedManifest, "utf8")).path).toBe(expectedHost);

    await distributionInstall.uninstallSelfContainedHost({
      homeDir,
      platform: "linux",
      xdgDataHome,
      xdgConfigHome
    });
    await expect(lstat(expectedHost)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(expectedManifest)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("Linux 忽略空值或相对 XDG data/config，安装卸载都回退到用户目录", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-xdg-fallback-"));
    const installed = await distributionInstall.installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      platform: "linux",
      xdgDataHome: "relative/data",
      xdgConfigHome: ""
    });
    const expectedHost = path.join(homeDir, ".local/share/VisualForge/bin/visualforge-native-host");
    const expectedManifest = path.join(
      homeDir,
      ".config/google-chrome/NativeMessagingHosts/com.blteam.styleforge.json"
    );
    expect(installed.installedPath).toBe(expectedHost);
    expect(installed.installedManifests).toEqual([expectedManifest]);

    await distributionInstall.uninstallSelfContainedHost({
      homeDir,
      platform: "linux",
      xdgDataHome: "relative/data",
      xdgConfigHome: "relative/config"
    });
    await expect(lstat(expectedHost)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(lstat(expectedManifest)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("清理默认目录遵循传入的平台与 home，而不是固定写入 macOS 路径", async () => {
    const result = await cleanupExpiredHostFiles({
      platform: "linux",
      homeDir: "/home/jie"
    } as unknown as Parameters<typeof cleanupExpiredHostFiles>[0]);

    expect(result.roots).toEqual([
      path.join("/home/jie", ".local/share/VisualForge/temp"),
      path.join("/home/jie", ".local/share/VisualForge/tasks")
    ]);
  });

  it("素材、任务、清理、安装和 Codex 配置全部复用同一支持目录 helper", async () => {
    const files = [
      "asset-store.ts",
      "index.ts",
      "cleanup.ts",
      "distribution-install.ts",
      "codex-discovery.ts"
    ];
    const sources = await Promise.all(files.map((file) => readFile(
      new URL(`../../apps/native-host/src/${file}`, import.meta.url),
      "utf8"
    )));

    for (const source of sources) expect(source).toContain("resolveSupportDirectory");
    for (const source of sources) expect(source).not.toContain("Library/Application Support/VisualForge");
  });
});
