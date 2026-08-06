import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CodexDiscoveryResult,
  CodexExecutableSecurity
} from "@styleforge/contracts/native-messaging";
import { resolveSupportDirectory } from "./support-paths.js";

const execFileAsync = promisify(execFile);

export type DiscoverySource = "configured" | "common" | "path";
type InspectCandidate = (candidate: string) => Promise<string | null>;
type InspectSecurity = (candidate: string) => Promise<CodexExecutableSecurity>;

export const TRUSTED_CODEX_TEAM_IDS = ["2DC432GLL2"] as const;

export interface DiscoverCodexOptions {
  explicitPath?: string | null;
  commonPaths?: string[];
  pathValue?: string;
  inspect?: InspectCandidate;
  inspectSecurity?: InspectSecurity;
  platform?: NodeJS.Platform;
}

export const STYLEFORGE_SUPPORT_DIR = resolveSupportDirectory();

export const DEFAULT_CODEX_PATHS = [
  "/Applications/Codex.app/Contents/Resources/codex",
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  path.join(os.homedir(), ".local/bin/codex"),
  path.join(os.homedir(), ".volta/bin/codex"),
  path.join(os.homedir(), "Library/pnpm/codex")
];

function defaultCodexPaths(platform: NodeJS.Platform) {
  if (platform === "win32") {
    const homeDir = os.homedir();
    return [
      path.join(process.env.LOCALAPPDATA ?? path.join(homeDir, "AppData/Local"), "Programs/Codex/codex.exe"),
      path.join(process.env.APPDATA ?? path.join(homeDir, "AppData/Roaming"), "npm/codex.cmd"),
      path.join(homeDir, ".local/bin/codex.exe")
    ];
  }
  if (platform === "linux") {
    return [
      "/usr/local/bin/codex",
      "/usr/bin/codex",
      path.join(os.homedir(), ".local/bin/codex"),
      path.join(os.homedir(), ".npm-global/bin/codex")
    ];
  }
  return DEFAULT_CODEX_PATHS;
}

async function inspectCodex(candidate: string) {
  try {
    await access(candidate, constants.X_OK);
    const resolved = await realpath(candidate);
    const info = await stat(resolved);
    if (!info.isFile()) return null;
    const command = createCodexVersionCommand(resolved);
    const result = await execFileAsync(command.executable, command.args, {
      timeout: 5000,
      windowsHide: true
    });
    const version = result.stdout.trim();
    return version || null;
  } catch {
    return null;
  }
}

export function createCodexVersionCommand(
  candidate: string,
  platform: NodeJS.Platform = process.platform
) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", `"${candidate}" --version`]
    };
  }
  return { executable: candidate, args: ["--version"] };
}

export function createCodexAppServerCommand(
  candidate: string,
  platform: NodeJS.Platform = process.platform
) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) {
    return {
      executable: "cmd.exe",
      args: ["/d", "/s", "/c", `"${candidate}" app-server --stdio`]
    };
  }
  return { executable: candidate, args: ["app-server", "--stdio"] };
}

function commandErrorOutput(error: unknown) {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  return [value.stdout, value.stderr, value.message]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .join("\n");
}

export function classifyCodexSignature(
  resolvedPath: string,
  verified: boolean,
  details: string
): CodexExecutableSecurity {
  const teamId = details.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() || null;
  const identifier = details.match(/^Identifier=(.+)$/m)?.[1]?.trim() || null;
  const unsigned = /not signed at all|code object is not signed/i.test(details);
  const signatureStatus = verified ? "verified" as const : unsigned ? "unsigned" as const : "invalid" as const;
  const trusted = signatureStatus === "verified" && Boolean(
    teamId && TRUSTED_CODEX_TEAM_IDS.includes(teamId as typeof TRUSTED_CODEX_TEAM_IDS[number])
  );
  const risk = trusted
    ? null
    : signatureStatus === "verified"
      ? `Codex 可执行文件签名有效，但签名团队 ${teamId ?? "未知"} 不是已验证的 OpenAI 发行方。VisualForge 不会自动使用此路径。`
      : signatureStatus === "unsigned"
        ? "Codex 可执行文件没有有效代码签名。VisualForge 不会自动使用此路径。"
        : "Codex 可执行文件的代码签名无效。VisualForge 不会自动使用此路径。";
  return { resolvedPath, signatureStatus, teamId, identifier, trusted, risk };
}

export async function inspectCodexExecutableSecurity(candidate: string): Promise<CodexExecutableSecurity> {
  const resolvedPath = await realpath(candidate).catch(() => path.resolve(candidate));
  if (process.platform !== "darwin") {
    return {
      resolvedPath,
      signatureStatus: "unavailable",
      teamId: null,
      identifier: null,
      trusted: false,
      risk: "当前系统无法使用 macOS codesign 验证 Codex 来源。VisualForge 不会自动使用此路径。"
    };
  }
  let verified = false;
  let verifyOutput = "";
  try {
    const result = await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", "--verbose=2", resolvedPath]);
    verified = true;
    verifyOutput = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    verifyOutput = commandErrorOutput(error);
  }
  let details = "";
  try {
    const result = await execFileAsync("/usr/bin/codesign", ["-d", "--verbose=4", resolvedPath]);
    details = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    details = commandErrorOutput(error);
  }
  return classifyCodexSignature(resolvedPath, verified, `${verifyOutput}\n${details}`);
}

function uniqueCandidates(values: string[]) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

export async function readConfiguredCodexPath(
  supportDir = STYLEFORGE_SUPPORT_DIR
): Promise<string | null> {
  if (process.env.STYLEFORGE_CODEX_PATH?.trim()) {
    return process.env.STYLEFORGE_CODEX_PATH.trim();
  }
  try {
    const config = JSON.parse(await readFile(path.join(supportDir, "host.json"), "utf8")) as {
      codexPath?: unknown;
    };
    return typeof config.codexPath === "string" && config.codexPath.trim()
      ? config.codexPath.trim()
      : null;
  } catch {
    return null;
  }
}

export async function discoverCodex(
  options: DiscoverCodexOptions = {}
): Promise<CodexDiscoveryResult> {
  const platform = options.platform ?? process.platform;
  const inspect = options.inspect ?? inspectCodex;
  const inspectSecurity = options.inspectSecurity ?? inspectCodexExecutableSecurity;
  const groups: Array<{ source: DiscoverySource; paths: string[] }> = [
    {
      source: "configured",
      paths: options.explicitPath ? [options.explicitPath] : []
    },
    {
      source: "common",
      paths: uniqueCandidates(options.commonPaths ?? defaultCodexPaths(platform))
    },
    {
      source: "path",
      paths: uniqueCandidates((options.pathValue ?? process.env.PATH ?? "")
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, platform === "win32" ? "codex.exe" : "codex")))
    }
  ];
  const rejected: string[] = [];

  for (const group of groups) {
    for (const candidate of group.paths) {
      const version = await inspect(candidate);
      if (version) {
        const inspectedSecurity = await inspectSecurity(candidate);
        const security = platform !== "darwin" && group.source === "configured"
          ? { ...inspectedSecurity, trusted: true, risk: null }
          : inspectedSecurity;
        if (!security.trusted) {
          rejected.push(`${security.resolvedPath}：${security.risk ?? "来源验证未通过"}`);
          continue;
        }
        return {
          found: true,
          path: candidate,
          version,
          source: group.source,
          security,
          error: null
        };
      }
    }
  }

  return {
    found: false,
    path: null,
    version: null,
    source: null,
    error: rejected.length
      ? `找到 Codex，但来源验证未通过：${rejected.join("；")}`
      : "未在显式配置、常见安装路径或 PATH 中找到可执行的 Codex CLI"
  };
}

export async function discoverConfiguredCodex() {
  return discoverCodex({ explicitPath: await readConfiguredCodexPath() });
}
