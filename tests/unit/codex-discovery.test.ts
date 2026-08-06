import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { discoverCodex } from "../../apps/native-host/src/codex-discovery";

describe("Codex Discovery v1", () => {
  const trustedSecurity = {
    resolvedPath: "/Applications/Codex.app/Contents/Resources/codex",
    signatureStatus: "verified" as const,
    teamId: "2DC432GLL2",
    identifier: "codex",
    trusted: true,
    risk: null
  };

  it("严格按显式配置、常见路径、PATH 的顺序检测", async () => {
    const inspected: string[] = [];
    const result = await discoverCodex({
      explicitPath: "/configured/codex",
      commonPaths: ["/Applications/Codex.app/codex"],
      pathValue: "/path-a:/path-b",
      inspect: async (candidate) => {
        inspected.push(candidate);
        return candidate === "/configured/codex" ? "codex-cli 1.2.3" : null;
      },
      inspectSecurity: async () => trustedSecurity
    });

    expect(inspected).toEqual(["/configured/codex"]);
    expect(result).toEqual({
      found: true,
      path: "/configured/codex",
      version: "codex-cli 1.2.3",
      source: "configured",
      security: trustedSecurity,
      error: null
    });
  });

  it("Windows 与 Linux 允许用户显式配置的 Codex 路径，但不自动信任扫描结果", async () => {
    for (const platform of ["win32", "linux"] as const) {
      const result = await discoverCodex({
        platform,
        explicitPath: platform === "win32" ? "C:\\Tools\\codex.exe" : "/opt/codex/bin/codex",
        commonPaths: [],
        pathValue: "",
        inspect: async () => "codex-cli 1.2.3",
        inspectSecurity: async (candidate) => ({
          resolvedPath: candidate,
          signatureStatus: "unavailable",
          teamId: null,
          identifier: null,
          trusted: false,
          risk: "当前平台没有 macOS codesign"
        })
      });

      expect(result).toMatchObject({
        found: true,
        source: "configured",
        version: "codex-cli 1.2.3",
        security: {
          signatureStatus: "unavailable",
          trusted: true,
          risk: null
        }
      });
    }
  });

  it("Windows 能通过 cmd.exe 检查 npm 安装生成的 codex.cmd", async () => {
    const module = await import("../../apps/native-host/src/codex-discovery");
    const createCommand = (module as unknown as {
      createCodexVersionCommand?: (candidate: string, platform: NodeJS.Platform) => {
        executable: string;
        args: string[];
      };
    }).createCodexVersionCommand;

    expect(createCommand).toBeTypeOf("function");
    expect(createCommand?.("C:\\Users\\jie\\AppData\\Roaming\\npm\\codex.cmd", "win32")).toEqual({
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\Users\\jie\\AppData\\Roaming\\npm\\codex.cmd" --version']
    });
  });

  it("Windows 通过 cmd.exe 启动 npm 生成的 codex.cmd App Server", async () => {
    const module = await import("../../apps/native-host/src/codex-discovery");
    const createCommand = (module as unknown as {
      createCodexAppServerCommand?: (candidate: string, platform: NodeJS.Platform) => {
        executable: string;
        args: string[];
      };
    }).createCodexAppServerCommand;

    expect(createCommand).toBeTypeOf("function");
    expect(createCommand?.("C:\\Users\\jie\\AppData\\Roaming\\npm\\codex.cmd", "win32")).toEqual({
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", '"C:\\Users\\jie\\AppData\\Roaming\\npm\\codex.cmd" app-server --stdio']
    });
    expect(createCommand?.("C:\\Program Files\\Codex\\codex.exe", "win32")).toEqual({
      executable: "C:\\Program Files\\Codex\\codex.exe",
      args: ["app-server", "--stdio"]
    });
  });

  it("CodexClient 使用跨平台 App Server 命令构造器", async () => {
    const source = await readFile(
      new URL("../../apps/native-host/src/codex-client.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("createCodexAppServerCommand");
    expect(source).not.toContain('spawn(this.codexPath, ["app-server", "--stdio"]');
  });

  it("签名有效但不是 OpenAI Team ID 时标记为不可信", async () => {
    const module = await import("../../apps/native-host/src/codex-discovery");
    const classify = (module as unknown as {
      classifyCodexSignature?: (
        path: string,
        verified: boolean,
        details: string
      ) => typeof trustedSecurity;
    }).classifyCodexSignature;
    expect(classify).toBeTypeOf("function");
    const security = classify!(
      "/custom/codex",
      true,
      "Identifier=codex\nTeamIdentifier=OTHERTEAM1\nAuthority=Developer ID Application: Other Vendor (OTHERTEAM1)"
    );
    expect(security).toMatchObject({
      signatureStatus: "verified",
      teamId: "OTHERTEAM1",
      trusted: false
    });
    expect(security.risk).toContain("不是已验证的 OpenAI 发行方");
  });

  it("不会自动连接未签名或错误 Team ID 的 Codex", async () => {
    const result = await discoverCodex({
      explicitPath: "/untrusted/codex",
      commonPaths: [],
      pathValue: "",
      inspect: async () => "codex-cli 9.9.9",
      inspectSecurity: async () => ({
        resolvedPath: "/untrusted/codex",
        signatureStatus: "verified",
        teamId: "OTHERTEAM1",
        identifier: "codex",
        trusted: false,
        risk: "不是已验证的 OpenAI 发行方"
      })
    });
    expect(result.found).toBe(false);
    expect(result.error).toContain("来源验证未通过");
  });

  it("显式路径不可用时继续检查声明过的常见路径", async () => {
    const inspected: string[] = [];
    const result = await discoverCodex({
      explicitPath: "/missing/codex",
      commonPaths: ["/common/codex"],
      pathValue: "/path-a",
      inspect: async (candidate) => {
        inspected.push(candidate);
        return candidate === "/common/codex" ? "codex-cli 2.0.0" : null;
      },
      inspectSecurity: async () => trustedSecurity
    });

    expect(inspected).toEqual(["/missing/codex", "/common/codex"]);
    expect(result.source).toBe("common");
    expect(result.path).toBe("/common/codex");
  });

  it("只从 PATH 声明的目录构造候选，不扫描文件系统", async () => {
    const inspected: string[] = [];
    const result = await discoverCodex({
      commonPaths: [],
      pathValue: "/path-a:/path-b:/path-a",
      inspect: async (candidate) => {
        inspected.push(candidate);
        return null;
      }
    });

    expect(inspected).toEqual(["/path-a/codex", "/path-b/codex"]);
    expect(result).toEqual({
      found: false,
      path: null,
      version: null,
      source: null,
      error: "未在显式配置、常见安装路径或 PATH 中找到可执行的 Codex CLI"
    });
  });
});
