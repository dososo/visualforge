import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { installSelfContainedHost } from "../../apps/native-host/src/distribution-install";
import * as distribution from "../../apps/native-host/src/distribution-install";

describe("Native Host 正式扩展 ID 安装", () => {
  it("Linux 默认写入 Chrome Stable Manifest 并安装无扩展名 Host", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-linux-install-"));
    const result = await installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      platform: "linux"
    });

    expect(result.installedPath).toBe(path.join(homeDir, ".local/share/VisualForge/bin/visualforge-native-host"));
    expect(result.installedManifests).toEqual([
      path.join(homeDir, ".config/google-chrome/NativeMessagingHosts/com.blteam.styleforge.json")
    ]);
  });

  it("Linux 开发安装同时覆盖 Chrome for Testing 与 Chromium", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-linux-development-install-"));
    const result = await installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      platform: "linux",
      includeDevelopmentBrowsers: true
    });

    expect(result.installedManifests).toEqual([
      path.join(homeDir, ".config/google-chrome/NativeMessagingHosts/com.blteam.styleforge.json"),
      path.join(homeDir, ".config/google-chrome-for-testing/NativeMessagingHosts/com.blteam.styleforge.json"),
      path.join(homeDir, ".config/chromium/NativeMessagingHosts/com.blteam.styleforge.json")
    ]);
  });

  it("Windows 安装 exe 并把 Manifest 绝对路径注册到当前用户注册表", async () => {
    const localAppData = await mkdtemp(path.join(os.tmpdir(), "visualforge-windows-install-"));
    const registryCalls: string[][] = [];
    const result = await installSelfContainedHost({
      executablePath: process.execPath,
      platform: "win32",
      localAppData,
      runRegistryCommand: async (args) => {
        registryCalls.push(args);
      }
    });
    const expectedManifest = path.join(localAppData, "VisualForge/com.blteam.styleforge.json");

    expect(result.installedPath).toBe(path.join(localAppData, "VisualForge/bin/visualforge-native-host.exe"));
    expect(result.installedManifests).toEqual([expectedManifest]);
    expect(registryCalls).toEqual([[
      "ADD",
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.blteam.styleforge",
      "/ve", "/t", "REG_SZ", "/d", expectedManifest, "/f"
    ]]);
  });

  it("Windows LOCALAPPDATA 含空格时 Manifest JSON 与注册表仍绑定同一绝对 Host 路径", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "visualforge-windows-spaces-"));
    const localAppData = path.join(root, "Local App Data");
    await mkdir(localAppData);
    const registryCalls: string[][] = [];
    const result = await installSelfContainedHost({
      executablePath: process.execPath,
      platform: "win32",
      localAppData,
      extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runRegistryCommand: async (args) => { registryCalls.push(args); }
    });
    const manifest = JSON.parse(await readFile(result.installedManifests[0]!, "utf8"));

    expect(path.isAbsolute(result.installedPath)).toBe(true);
    expect(manifest.path).toBe(result.installedPath);
    expect(manifest.allowed_origins).toEqual([
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
    ]);
    expect(registryCalls[0]).toContain(result.installedManifests[0]);
  });

  it("Windows 卸载删除当前用户 Native Messaging 注册表项", async () => {
    const localAppData = await mkdtemp(path.join(os.tmpdir(), "visualforge-windows-uninstall-"));
    const registryCalls: string[][] = [];

    await distribution.uninstallSelfContainedHost({
      platform: "win32",
      localAppData,
      runRegistryCommand: async (args) => {
        registryCalls.push(args);
      }
    });

    expect(registryCalls).toEqual([[
      "DELETE",
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.blteam.styleforge",
      "/f"
    ]]);
  });

  it("公开安装默认只为 Google Chrome Stable 写入 Native Messaging Manifest", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-stable-install-"));
    const result = await installSelfContainedHost({
      homeDir,
      executablePath: process.execPath
    });

    expect(result.installedManifests).toEqual([
      path.join(homeDir, "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.blteam.styleforge.json")
    ]);
  });

  it("只有显式开发选项才同时写入 Chrome for Testing 与 Chromium", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-development-browser-install-"));
    const result = await installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      includeDevelopmentBrowsers: true
    });

    expect(result.installedManifests).toHaveLength(4);
    expect(result.installedManifests.some((item) => item.includes("Chrome for Testing"))).toBe(true);
    expect(result.installedManifests.some((item) => item.includes("ChromeForTesting"))).toBe(true);
    expect(result.installedManifests.some((item) => item.includes("Chromium"))).toBe(true);
  });

  it("允许发行阶段注入 Chrome Web Store 正式 ID", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-extension-id-"));
    const extensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const result = await installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      extensionId
    });
    const manifest = JSON.parse(await readFile(result.installedManifests[0], "utf8"));

    expect(manifest.allowed_origins).toEqual([`chrome-extension://${extensionId}/`]);
  });

  it("拒绝无效扩展 ID，避免生成无法连接或越权的 Manifest", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-invalid-extension-id-"));

    await expect(installSelfContainedHost({
      homeDir,
      executablePath: process.execPath,
      extensionId: "not-a-chrome-extension-id"
    })).rejects.toThrow("扩展 ID");
  });

  it("卸载默认保留数据，只有显式选择时才同时删除 Native Host 用户数据", async () => {
    const uninstall = (distribution as unknown as {
      uninstallSelfContainedHost?: (options: { homeDir: string; deleteUserData?: boolean }) => Promise<unknown>;
    }).uninstallSelfContainedHost;
    expect(uninstall).toBeTypeOf("function");
    if (!uninstall) return;
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-uninstall-data-"));
    const supportDir = path.join(homeDir, "Library/Application Support/VisualForge");
    await mkdir(path.join(supportDir, "temp"), { recursive: true });
    await writeFile(path.join(supportDir, "temp/keep-first.tmp"), "keep");

    await uninstall({ homeDir });
    expect(await readFile(path.join(supportDir, "temp/keep-first.tmp"), "utf8")).toBe("keep");

    await uninstall({ homeDir, deleteUserData: true });
    await expect(lstat(path.join(supportDir, "temp"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("显式删除数据时同时删除 bin 内旧安装残留和整个 Support 目录", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "visualforge-uninstall-bin-residue-"));
    const supportDir = path.join(homeDir, "Library/Application Support/VisualForge");
    await mkdir(path.join(supportDir, "bin"), { recursive: true });
    await writeFile(path.join(supportDir, "bin/visualforge-native-host.installing-old"), "stale");

    await distribution.uninstallSelfContainedHost({ homeDir, deleteUserData: true });

    await expect(lstat(supportDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
