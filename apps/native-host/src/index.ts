#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  nativeRequestSchema,
  nativeResponseSchema,
  NATIVE_HOST_CAPABILITIES,
  type ImagegenSkillProvenance,
  type NativeResponse
} from "@styleforge/contracts/native-messaging";
import { AssetStore } from "./asset-store.js";
import { cleanupExpiredHostFiles, purgeAllUserData, purgeTemporaryData } from "./cleanup.js";
import { CodexClient, diagnoseCodex } from "./codex-client.js";
import { discoverConfiguredCodex } from "./codex-discovery.js";
import {
  configureCodexPath,
  installSelfContainedHost,
  uninstallSelfContainedHost
} from "./distribution-install.js";
import { encodeNativeMessage, NativeMessageDecoder } from "./native-protocol.js";
import { resolveSupportDirectory } from "./support-paths.js";

const HOST_VERSION = "0.5.8";
const assets = new AssetStore();
const activeTasks = new Map<string, CodexClient>();
let warmClient: CodexClient | undefined;

function validResponse(value: unknown): NativeResponse {
  return nativeResponseSchema.parse(value);
}

async function createCodexClient() {
  if (warmClient) return warmClient;
  const discovery = await discoverConfiguredCodex();
  if (!discovery.found) throw new Error(discovery.error);
  warmClient = new CodexClient(discovery.path);
  return warmClient;
}

async function createIsolatedCodexClient() {
  const discovery = await discoverConfiguredCodex();
  if (!discovery.found) throw new Error(discovery.error);
  return new CodexClient(discovery.path);
}

async function handle(raw: unknown): Promise<NativeResponse> {
  const parsed = nativeRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return validResponse({
      protocolVersion: 1,
      requestId: "invalid",
      ok: false,
      error: { code: "INVALID_MESSAGE", message: "桥接消息格式无效", retryable: false }
    });
  }
  const request = parsed.data;
  switch (request.type) {
    case "host.ping":
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: {
          protocolVersion: 1,
          version: HOST_VERSION,
          capabilities: [...NATIVE_HOST_CAPABILITIES]
        }
      });
    case "host.diagnostics":
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: await diagnoseCodex()
      });
    case "host.uninstall": {
      if (activeTasks.size) throw new Error("有正在进行的创作，完成后才能卸载本地连接组件");
      if (process.platform === "win32") {
        throw new Error("Windows 请重新打开产品包并运行 Uninstall.ps1");
      }
      assets.clearTransientState();
      warmClient?.close();
      warmClient = undefined;
      const result = await uninstallSelfContainedHost();
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: {
          removedFiles: result.removed.length,
          dataPreserved: true
        }
      });
    }
    case "data.purge.temporary": {
      if (activeTasks.size) throw new Error("有正在进行的任务，暂时不能清除本地临时数据");
      assets.clearTransientState();
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: await purgeTemporaryData()
      });
    }
    case "data.purge.all": {
      if (activeTasks.size) throw new Error("有正在进行的任务，暂时不能清除全部本地数据");
      assets.clearTransientState();
      warmClient?.close();
      warmClient = undefined;
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: await purgeAllUserData()
      });
    }
    case "asset.write.start":
      assets.start(request.payload);
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: { accepted: true }
      });
    case "asset.write.chunk":
      assets.writeChunk(request.payload);
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: { accepted: true }
      });
    case "asset.write.finish":
      await assets.finish(request.payload.assetId);
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: { stored: true }
      });
    case "task.cancel": {
      const client = activeTasks.get(request.payload.taskId);
      const data = client
        ? await client.interruptActiveTurn()
        : { cancelled: false, message: "当前没有可取消的任务" };
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data
      });
    }
    case "analysis.start": {
      const client = await createCodexClient();
      try {
        await client.start();
        activeTasks.set(request.payload.taskId, client);
        const descriptor = await assets.readStart(request.payload.assetId);
        return validResponse({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          data: await client.analyzeImage(
            assets.getPath(request.payload.assetId),
            descriptor.sha256
          )
        });
      } finally {
        if (activeTasks.get(request.payload.taskId) === client) {
          activeTasks.delete(request.payload.taskId);
        }
        await assets.release(request.payload.assetId);
      }
    }
    case "domain.analysis.start": {
      const client = await createCodexClient();
      try {
        await client.start();
        activeTasks.set(request.payload.taskId, client);
        const descriptor = await assets.readStart(request.payload.assetId);
        return validResponse({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          data: await client.analyzeDomainImageReliable(
            assets.getPath(request.payload.assetId),
            descriptor.sha256
          )
        });
      } finally {
        if (activeTasks.get(request.payload.taskId) === client) {
          activeTasks.delete(request.payload.taskId);
        }
        await assets.release(request.payload.assetId);
      }
    }
    case "grid.analysis.start": {
      const client = await createCodexClient();
      try {
        await client.start();
        activeTasks.set(request.payload.taskId, client);
        const descriptor = await assets.readStart(request.payload.assetId);
        return validResponse({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          data: await client.analyzeGridImage(
            assets.getPath(request.payload.assetId),
            descriptor.sha256,
            request.payload.layout
          )
        });
      } finally {
        if (activeTasks.get(request.payload.taskId) === client) {
          activeTasks.delete(request.payload.taskId);
        }
        await assets.release(request.payload.assetId);
      }
    }
    case "subject.quality.check": {
      const client = await createCodexClient();
      try {
        await client.start();
        activeTasks.set(request.payload.taskId, client);
        const inputs = await Promise.all(request.payload.assetIds.map(async (assetId) => {
          await assets.readStart(assetId);
          return { assetId, path: assets.getPath(assetId) };
        }));
        return validResponse({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          data: await client.checkSubjectQuality(inputs)
        });
      } finally {
        if (activeTasks.get(request.payload.taskId) === client) activeTasks.delete(request.payload.taskId);
        await Promise.all(request.payload.assetIds.map((assetId) => assets.release(assetId)));
      }
    }
    case "creation-set.quality.check": {
      const client = await createCodexClient();
      try {
        await client.start();
        activeTasks.set(request.payload.taskId, client);
        const inputs = await Promise.all(request.payload.items.map(async (item) => {
          await assets.readStart(item.assetId);
          return {
            itemId: item.itemId,
            planTitle: item.planTitle,
            creativePlan: item.creativePlan,
            path: assets.getPath(item.assetId)
          };
        }));
        const references = await Promise.all(request.payload.references.map(async (reference) => {
          await assets.readStart(reference.assetId);
          return {
            role: reference.role,
            imagePurpose: reference.imagePurpose,
            path: assets.getPath(reference.assetId)
          };
        }));
        return validResponse({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          data: await client.checkCreationSetQuality(inputs, {
            domain: request.payload.domain,
            references,
            sharedInvariants: request.payload.sharedInvariants,
            signatureStyle: request.payload.signatureStyle
          })
        });
      } finally {
        if (activeTasks.get(request.payload.taskId) === client) activeTasks.delete(request.payload.taskId);
        await Promise.all([
          ...request.payload.items.map((item) => assets.release(item.assetId)),
          ...request.payload.references.map((item) => assets.release(item.assetId))
        ]);
      }
    }
    case "generation.start": {
      // 每次生成使用独立 App Server，避免多张套图长期复用进程造成资源累积。
      const client = await createIsolatedCodexClient();
      const outputDir = path.join(
        resolveSupportDirectory(),
        "tasks",
        randomUUID()
      );
      const generationStartedAt = performance.now();
      let codexStartupMs = 0;
      let skillDiscoveryMs = 0;
      let generationTurnMs = 0;
      let outputRegistrationMs = 0;
      let outputReadMs = 0;
      let imagegenSkill: ImagegenSkillProvenance | undefined;
      try {
        const codexStartupStartedAt = performance.now();
        await client.start();
        codexStartupMs = performance.now() - codexStartupStartedAt;
        activeTasks.set(request.payload.taskId, client);
        const paths = await client.generateImage(
          request.payload.references.map((reference) => ({
            path: assets.getPath(reference.assetId),
            role: reference.role,
            imagePurpose: reference.imagePurpose,
            sourceKind: reference.sourceKind
          })),
          request.payload.prompt,
          outputDir,
          request.payload.count,
          (timings) => {
            skillDiscoveryMs = timings.skillDiscoveryMs;
            generationTurnMs = timings.generationTurnMs;
          },
          (skill) => { imagegenSkill = skill; }
        );
        const outputIds = await Promise.all(paths.map(async (filePath) => {
          const startedAt = performance.now();
          const assetId = await assets.registerPath(filePath, outputDir);
          outputRegistrationMs += performance.now() - startedAt;
          return assetId;
        }));
        const outputs = await Promise.all(outputIds.map(async (assetId) => {
          const startedAt = performance.now();
          const descriptor = await assets.readStart(assetId);
          outputReadMs += performance.now() - startedAt;
          return descriptor;
        }));
        return validResponse({
          protocolVersion: 1,
          requestId: request.requestId,
          ok: true,
          data: {
            outputs,
            timings: {
              totalMs: performance.now() - generationStartedAt,
              codexStartupMs,
              skillDiscoveryMs,
              generationTurnMs,
              outputRegistrationMs,
              outputReadMs
            },
            ...(imagegenSkill ? { imagegenSkill } : {})
          }
        });
      } finally {
        if (activeTasks.get(request.payload.taskId) === client) {
          activeTasks.delete(request.payload.taskId);
        }
        client.close();
        await Promise.all([...new Set(request.payload.references.map((reference) => reference.assetId))]
          .map((assetId) => assets.release(assetId)));
      }
    }
    case "asset.read.start":
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: await assets.readStart(request.payload.assetId)
      });
    case "asset.read.chunk":
      return validResponse({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: {
          assetId: request.payload.assetId,
          index: request.payload.index,
          data: await assets.readChunk(request.payload.assetId, request.payload.index)
        }
      });
  }
}

function startNativeMessaging() {
  const decoder = new NativeMessageDecoder();
  process.stdin.on("data", (chunk: Buffer) => {
    try {
      for (const message of decoder.push(chunk)) {
        void handle(message)
          .then((response) => process.stdout.write(encodeNativeMessage(response)))
          .catch((error) => {
            const parsed = nativeRequestSchema.safeParse(message);
            const response = validResponse({
              protocolVersion: 1,
              requestId: parsed.success ? parsed.data.requestId : "invalid",
              ok: false,
              error: {
                code: "HOST_OPERATION_FAILED",
                message: "本地桥接操作失败",
                retryable: true,
                detail: error instanceof Error ? error.message : String(error)
              }
            });
            if (!response.ok) {
              process.stderr.write(`VisualForge Host 操作错误：${response.error.detail ?? response.error.message}\n`);
            }
            process.stdout.write(encodeNativeMessage(response));
          });
      }
    } catch (error) {
      process.stderr.write(`VisualForge Host 协议错误：${String(error)}\n`);
      process.exitCode = 1;
    }
  });
}

process.once("exit", () => warmClient?.close());
process.once("SIGTERM", () => {
  warmClient?.close();
  process.exit(0);
});

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--version")) {
    process.stdout.write(`visualforge-native-host ${HOST_VERSION}\n`);
    return;
  }
  if (process.argv.includes("--install")) {
    const result = await installSelfContainedHost({
      codexPath: argumentValue("--codex-path"),
      extensionId: argumentValue("--extension-id"),
      includeDevelopmentBrowsers: process.argv.includes("--development-browsers")
    });
    process.stdout.write(`Native Host 已安装：${result.installedPath}\n`);
    return;
  }
  if (process.argv.includes("--uninstall")) {
    const deleteUserData = process.argv.includes("--delete-data");
    const result = await uninstallSelfContainedHost({ deleteUserData });
    process.stdout.write(`已移除 ${result.removed.length} 个 Native Host 文件。\n`);
    process.stdout.write(deleteUserData
      ? "已同时删除 VisualForge Native Host 本地数据；浏览器内作品仍需在扩展设置中清除。\n"
      : "VisualForge Native Host 本地数据已保留；如需同时删除，请使用 --uninstall --delete-data。\n");
    return;
  }
  if (process.argv.includes("--configure-codex")) {
    const codexPath = argumentValue("--configure-codex");
    if (!codexPath) throw new Error("--configure-codex 需要 Codex CLI 的绝对路径");
    const result = await configureCodexPath(codexPath);
    process.stdout.write(`Codex 路径已配置：${result.path}\n`);
    if (result.found && result.security?.risk) {
      process.stderr.write(`安全提醒：${result.security.risk}\n`);
    }
    return;
  }

  const cleanup = await cleanupExpiredHostFiles().catch((error) => {
    process.stderr.write(`VisualForge Host 清理过期缓存失败：${String(error)}\n`);
    return null;
  });
  if (cleanup?.removedFiles) {
    process.stderr.write(`VisualForge Host 已清理 ${cleanup.removedFiles} 个过期缓存文件。\n`);
  }

  if (process.argv.includes("--diagnose")) {
    process.stdout.write(`${JSON.stringify(await diagnoseCodex(), null, 2)}\n`);
    return;
  }
  startNativeMessaging();
}

void main().catch((error) => {
  process.stderr.write(`VisualForge Host 启动失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
