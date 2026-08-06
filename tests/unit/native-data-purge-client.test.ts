import { afterEach, describe, expect, it, vi } from "vitest";
import * as nativeClient from "../../apps/extension/lib/native-client";

function createPort(
  respond: (request: { requestId: string; type: string }, listeners: Set<(message: unknown) => void>, disconnect: Set<() => void>) => void
) {
  const messageListeners = new Set<(message: unknown) => void>();
  const disconnectListeners = new Set<() => void>();
  const disconnect = vi.fn(() => {
    for (const listener of [...disconnectListeners]) listener();
  });
  return {
    onMessage: {
      addListener: (listener: (message: unknown) => void) => messageListeners.add(listener),
      removeListener: (listener: (message: unknown) => void) => messageListeners.delete(listener)
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnectListeners.add(listener),
      removeListener: (listener: () => void) => disconnectListeners.delete(listener)
    },
    postMessage: (request: { requestId: string; type: string }) => {
      queueMicrotask(() => respond(request, messageListeners, disconnectListeners));
    },
    disconnect
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Side Panel Native Host 数据清除客户端", () => {
  it("提供临时数据与全部用户数据两种明确调用", () => {
    expect(nativeClient.purgeTemporaryData).toBeTypeOf("function");
    expect(nativeClient.purgeAllUserData).toBeTypeOf("function");
  });

  it("卸载连接组件后主动断开旧连接并保留浏览器作品", async () => {
    const port = createPort((request, messages) => {
      for (const listener of [...messages]) listener({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: { removedFiles: 2, dataPreserved: true }
      });
    });
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        connectNative: vi.fn(() => port),
        lastError: undefined
      }
    });

    await expect(nativeClient.uninstallNativeHost()).resolves.toEqual({
      removedFiles: 2,
      dataPreserved: true
    });
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it("诊断首次连接断开时只重连一次并返回第二次结果", async () => {
    const firstPort = createPort((_request, _messages, disconnects) => {
      for (const listener of [...disconnects]) listener();
    });
    const secondPort = createPort((request, messages) => {
      const response = {
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        data: request.type === "host.ping"
          ? {
              protocolVersion: 1,
              version: nativeClient.REQUIRED_NATIVE_HOST_VERSION,
              capabilities: [...nativeClient.REQUIRED_NATIVE_HOST_CAPABILITIES]
            }
          : {
              state: "connected",
              label: "Codex 已连接",
              codex: {
                found: true,
                path: "/Applications/Codex.app/Contents/Resources/codex",
                version: "codex-cli 1.2.3",
                source: "common",
                error: null
              },
              modelCount: 1,
              imagegen: true
            }
      };
      for (const listener of [...messages]) listener(response);
    });
    const connectNative = vi.fn()
      .mockReturnValueOnce(firstPort)
      .mockReturnValueOnce(secondPort);
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        connectNative,
        lastError: { message: "本地连接通信失败" }
      }
    });
    const { diagnoseNative } = await import("../../apps/extension/lib/native-client");

    await expect(diagnoseNative()).resolves.toMatchObject({
      state: "connected",
      label: "Codex 已连接",
      codexVersion: "codex-cli 1.2.3"
    });
    expect(connectNative).toHaveBeenCalledTimes(2);
  });
});
