import {
  NATIVE_HOST_NAME,
  NATIVE_HOST_CAPABILITIES,
  MAX_GENERATION_REFERENCE_COUNT,
  migrateVisualDNA,
  nativeRequestSchema,
  nativeResponseSchema,
  type HostDiagnostics,
  type NativeHostHandshake,
  type ImagegenSkillProvenance,
  type NativeAssetDescriptor,
  type NativeGenerationTimings,
  type NativeRequest,
  type GenerationReferenceRole,
  type CreationSetPlanItem,
  type GridCellAnalysisResult,
  type GridLayout,
  type Domain,
  domainAnalysisResultSchema,
  gridCellAnalysisResultSchema,
  setQualityReportSchema,
  type DomainAnalysisResult,
  type SetQualityReport,
  type SubjectQualityReport,
  type VisualDNA
} from "@styleforge/contracts";
import { chunkBytes, sha256Hex } from "@styleforge/core";

export type ConnectionState = "connected" | "host-missing" | "host-outdated" | "codex-missing" | "login-required" | "error";
export const REQUIRED_NATIVE_HOST_VERSION = "0.5.8";
export const REQUIRED_NATIVE_HOST_CAPABILITIES = NATIVE_HOST_CAPABILITIES;
export const GRID_ANALYSIS_CLIENT_TIMEOUT_MS = 90_000;
export const NATIVE_GENERATION_TOTAL_TIMEOUT_MS = 20 * 60 * 1000;
export type NativeGenerationTimingBreakdown = Partial<NativeGenerationTimings> & {
  referenceUploadMs: number;
  resultTransferMs: number;
  clientTotalMs: number;
};

export interface NativeDataPurgeResult {
  scope: "temporary" | "all";
  removedFiles: number;
  removedDirectories: number;
}

export interface NativeHostUninstallResult {
  removedFiles: number;
  dataPreserved: true;
}

export type Diagnostics = Pick<HostDiagnostics, "label"> & Partial<Omit<HostDiagnostics, "state" | "label">> & {
  state: ConnectionState;
  codexVersion?: string;
  hostVersion?: string;
  hostCapabilities?: string[];
};

function numericVersion(version: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? match.slice(1).map(Number) : null;
}

export function assessNativeHostCompatibility(handshake: NativeHostHandshake):
  | { compatible: true }
  | { compatible: false; reason: "version" | "capability"; detail: string } {
  const current = numericVersion(handshake.version);
  const required = numericVersion(REQUIRED_NATIVE_HOST_VERSION)!;
  const versionComparison = current?.reduce((comparison, value, index) =>
    comparison || Math.sign(value - required[index]!), 0) ?? -1;
  const versionCompatible = versionComparison >= 0;
  if (!versionCompatible) {
    return {
      compatible: false,
      reason: "version",
      detail: `当前连接组件 ${handshake.version}，需要 ${REQUIRED_NATIVE_HOST_VERSION} 或更高版本。`
    };
  }
  const available = new Set(handshake.capabilities ?? []);
  const missing = REQUIRED_NATIVE_HOST_CAPABILITIES.filter((capability) => !available.has(capability));
  if (missing.length) {
    return {
      compatible: false,
      reason: "capability",
      detail: `当前连接组件缺少能力：${missing.join("、")}。`
    };
  }
  return { compatible: true };
}

let activeDiagnostics: Promise<Diagnostics> | undefined;
let warmNativePort: chrome.runtime.Port | undefined;

function getWarmNativePort() {
  if (warmNativePort) return warmNativePort;
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  warmNativePort = port;
  port.onDisconnect.addListener(() => {
    if (warmNativePort === port) warmNativePort = undefined;
  });
  return port;
}

export function diagnoseNative(): Promise<Diagnostics> {
  if (activeDiagnostics) return activeDiagnostics;
  activeDiagnostics = runDiagnostics().finally(() => {
    activeDiagnostics = undefined;
  });
  return activeDiagnostics;
}

export function purgeTemporaryData() {
  return callPort<NativeDataPurgeResult>(getWarmNativePort(), "data.purge.temporary", {});
}

export function purgeAllUserData() {
  return callPort<NativeDataPurgeResult>(getWarmNativePort(), "data.purge.all", {});
}

export async function uninstallNativeHost() {
  const port = getWarmNativePort();
  const result = await callPort<NativeHostUninstallResult>(port, "host.uninstall", {});
  port.disconnect();
  if (warmNativePort === port) warmNativePort = undefined;
  return result;
}

async function runDiagnostics(): Promise<Diagnostics> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let port: chrome.runtime.Port | undefined;
    try {
      port = getWarmNativePort();
      const handshake = await callPort<NativeHostHandshake>(port, "host.ping", {}, 10_000);
      const compatibility = assessNativeHostCompatibility(handshake);
      if (!compatibility.compatible) {
        return {
          state: "host-outdated",
          label: "需要更新本地连接组件",
          detail: compatibility.detail,
          hostVersion: handshake.version,
          hostCapabilities: handshake.capabilities ?? []
        };
      }
      const diagnostics = await callPort<HostDiagnostics>(
        port,
        "host.diagnostics",
        {},
        30_000
      );
      return {
        ...diagnostics,
        hostVersion: handshake.version,
        hostCapabilities: handshake.capabilities ?? [],
        codexVersion: diagnostics.codex.found ? diagnostics.codex.version : undefined
      };
    } catch (error) {
      lastError = error;
      if (warmNativePort === port) warmNativePort = undefined;
      if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  const hostMissing = /native messaging host|host.*not found|本地桥接已断开/i.test(detail);
  return {
    state: hostMissing ? "host-missing" : "error",
    label: hostMissing ? "需要安装本地桥接程序" : "Codex 连接失败",
    detail
  };
}

function callPort<T>(
  port: chrome.runtime.Port,
  type: NativeRequest["type"],
  payload: unknown,
  timeoutMs = 15_000
): Promise<T> {
  const requestId = crypto.randomUUID();
  const request = nativeRequestSchema.parse({
    protocolVersion: 1,
    requestId,
    type,
    payload
  });
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${type} 响应超时`));
    }, timeoutMs);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || !("requestId" in message)
        || message.requestId !== requestId) return;
      cleanup();
      const response = nativeResponseSchema.safeParse(message);
      if (!response.success) {
        reject(new Error(`${type} 返回了无效的桥接响应`));
      } else if (response.data.ok) {
        resolve(response.data.data as T);
      } else {
        reject(new Error(response.data.error.detail ?? response.data.error.message));
      }
    };
    const onDisconnect = () => {
      cleanup();
      reject(new Error(chrome.runtime.lastError?.message ?? "本地桥接已断开"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
    };
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    port.postMessage(request);
  });
}

const activeNativeOperations = new Map<string, chrome.runtime.Port>();

export async function cancelNativeTask(taskId: string) {
  const port = activeNativeOperations.get(taskId);
  if (!port) return { cancelled: false, message: "当前没有可取消的任务" };
  return callPort<{ cancelled: boolean; message: string }>(port, "task.cancel", { taskId });
}

export async function analyzeNative(
  blob: Blob,
  taskId: string,
  onStatus?: (status: "UPLOADING" | "ANALYZING") => void | Promise<void>
): Promise<VisualDNA> {
  const port = getWarmNativePort();
  activeNativeOperations.set(taskId, port);
  try {
    await onStatus?.("UPLOADING");
    const { assetId, sha256 } = await uploadAsset(port, blob);
    await onStatus?.("ANALYZING");
    const result = await callPort<unknown>(port, "analysis.start", { taskId, assetId }, 180_000);
    return migrateVisualDNA(result, { sourceImageHash: sha256 });
  } finally {
    if (activeNativeOperations.get(taskId) === port) activeNativeOperations.delete(taskId);
  }
}

export async function analyzeDomainNative(
  blob: Blob,
  taskId: string,
  onStatus?: (status: "UPLOADING" | "ANALYZING") => void | Promise<void>
): Promise<DomainAnalysisResult> {
  const port = getWarmNativePort();
  activeNativeOperations.set(taskId, port);
  try {
    await onStatus?.("UPLOADING");
    const { assetId, sha256 } = await uploadAsset(port, blob);
    await onStatus?.("ANALYZING");
    const result = domainAnalysisResultSchema.parse(await callPort<unknown>(
      port,
      "domain.analysis.start",
      { taskId, assetId },
      900_000
    ));
    return {
      ...result,
      visualDNA: migrateVisualDNA(result.visualDNA, { sourceImageHash: sha256 })
    };
  } finally {
    if (activeNativeOperations.get(taskId) === port) activeNativeOperations.delete(taskId);
  }
}

export async function analyzeGridNative(
  blob: Blob,
  layout: GridLayout,
  taskId: string,
  onStatus?: (status: "UPLOADING" | "ANALYZING") => void | Promise<void>
): Promise<GridCellAnalysisResult> {
  const port = getWarmNativePort();
  activeNativeOperations.set(taskId, port);
  try {
    await onStatus?.("UPLOADING");
    const { assetId } = await uploadAsset(port, blob);
    await onStatus?.("ANALYZING");
    return gridCellAnalysisResultSchema.parse(await callPort<unknown>(
      port,
      "grid.analysis.start",
      { taskId, assetId, layout },
      GRID_ANALYSIS_CLIENT_TIMEOUT_MS
    ));
  } finally {
    if (activeNativeOperations.get(taskId) === port) activeNativeOperations.delete(taskId);
  }
}

async function uploadAsset(port: chrome.runtime.Port, blob: Blob) {
  const assetId = crypto.randomUUID();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = chunkBytes(bytes);
  const sha256 = await sha256Hex(bytes);
  await callPort(port, "asset.write.start", {
    assetId,
    mimeType: blob.type,
    byteLength: bytes.length,
    chunkCount: chunks.length,
    sha256
  });
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    let binary = "";
    for (let offset = 0; offset < chunk.length; offset += 0x8000) {
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 0x8000));
    }
    await callPort(port, "asset.write.chunk", { assetId, index, data: btoa(binary) });
  }
  await callPort(port, "asset.write.finish", { assetId });
  return { assetId, sha256 };
}

export async function collectGeneratedOutputs<T>(options: {
  count: number;
  requestBatch: (count: number) => Promise<T[]>;
  maxAttempts?: number;
}) {
  const outputs: T[] = [];
  const maxAttempts = options.maxAttempts ?? options.count;
  let attempts = 0;
  while (outputs.length < options.count && attempts < maxAttempts) {
    const requested = Math.min(2, options.count - outputs.length);
    let batch: T[];
    try {
      batch = await options.requestBatch(requested);
    } catch (cause) {
      if (cause instanceof NativeGenerationIncompleteError) {
        const partialOutputs = [...outputs, ...cause.partialOutputs] as T[];
        throw new NativeGenerationIncompleteError(partialOutputs, options.count - partialOutputs.length);
      }
      if (!outputs.length) throw cause;
      throw new NativeGenerationIncompleteError(outputs, options.count - outputs.length);
    }
    if (!batch.length) break;
    outputs.push(...batch.slice(0, requested));
    attempts += 1;
  }
  const missing = options.count - outputs.length;
  if (missing > 0) throw new NativeGenerationIncompleteError(outputs, missing);
  return outputs;
}

export class NativeGenerationIncompleteError<T = Blob> extends Error {
  constructor(
    public readonly partialOutputs: T[],
    public readonly missing: number
  ) {
    super(`生成结果缺少 ${missing} 张，请重试。`);
    this.name = "NativeGenerationIncompleteError";
  }
}

export function assertGenerationReferenceCount(count: number) {
  if (count < 1 || count > MAX_GENERATION_REFERENCE_COUNT) {
    throw new Error(`每次生成最多使用 ${MAX_GENERATION_REFERENCE_COUNT} 个参考输入。`);
  }
}

async function readGeneratedAsset(port: chrome.runtime.Port, descriptor: NativeAssetDescriptor) {
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < descriptor.chunkCount; index += 1) {
    const result = await callPort<{ data: string }>(port, "asset.read.chunk", {
      assetId: descriptor.assetId,
      index
    });
    const binary = atob(result.data);
    chunks.push(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  }
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (bytes.length !== descriptor.byteLength || await sha256Hex(bytes) !== descriptor.sha256) {
    throw new Error("生成结果传输校验失败，请重试。");
  }
  return new Blob([bytes], { type: descriptor.mimeType });
}

export async function generateNative(
  references: Array<{
    blob: Blob;
    role: GenerationReferenceRole;
    imagePurpose?: "face" | "full_body";
    sourceKind?: "original" | "identity_board";
  }>,
  prompt: string,
  count: number,
  taskId: string,
  onStatus?: (status: "UPLOADING" | "GENERATING") => void | Promise<void>,
  onTiming?: (timings: NativeGenerationTimingBreakdown) => void,
  onSkill?: (skill: ImagegenSkillProvenance) => void
) {
  assertGenerationReferenceCount(references.length);
  const clientStartedAt = performance.now();
  const deadline = clientStartedAt + NATIVE_GENERATION_TOTAL_TIMEOUT_MS;
  const port = getWarmNativePort();
  activeNativeOperations.set(taskId, port);
  try {
    await onStatus?.("UPLOADING");
    await onStatus?.("GENERATING");
    let hostTimings: NativeGenerationTimings | undefined;
    let referenceUploadMs = 0;
    let resultTransferMs = 0;
    const blobs = await collectGeneratedOutputs<Blob>({
      count,
      requestBatch: async (batch) => {
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) throw new Error("生成等待已达到 20 分钟上限，已停止继续补齐。");
        const uploadStartedAt = performance.now();
        const uploaded = await Promise.all(references.map(async (reference) => ({
          ...(await uploadAsset(port, reference.blob)),
          role: reference.role,
          imagePurpose: reference.imagePurpose,
          sourceKind: reference.sourceKind
        })));
        referenceUploadMs += performance.now() - uploadStartedAt;
        const result = await callPort<{
          outputs: NativeAssetDescriptor[];
          timings?: NativeGenerationTimings;
          imagegenSkill?: ImagegenSkillProvenance;
        }>(
          port, "generation.start", {
            taskId,
            references: uploaded.map(({ assetId, role, imagePurpose, sourceKind }) => ({
              assetId, role, imagePurpose, sourceKind
            })),
            prompt,
            count: batch
          }, Math.max(1_000, Math.min(900_000, remainingMs))
        );
        if (result.imagegenSkill) onSkill?.(result.imagegenSkill);
        if (result.timings) {
          if (!hostTimings) hostTimings = { ...result.timings };
          else {
            for (const key of Object.keys(hostTimings) as Array<keyof NativeGenerationTimings>) {
              hostTimings[key] += result.timings[key];
            }
          }
        }
        const transferStartedAt = performance.now();
        const batchOutputs: Blob[] = [];
        try {
          for (const descriptor of result.outputs) {
            batchOutputs.push(await readGeneratedAsset(port, descriptor));
          }
        } catch (cause) {
          if (!batchOutputs.length) throw cause;
          throw new NativeGenerationIncompleteError(
            batchOutputs,
            Math.max(1, result.outputs.length - batchOutputs.length)
          );
        }
        resultTransferMs += performance.now() - transferStartedAt;
        return batchOutputs;
      }
    });
    onTiming?.({
      ...(hostTimings ?? {}),
      referenceUploadMs,
      resultTransferMs,
      clientTotalMs: performance.now() - clientStartedAt
    });
    return blobs;
  } finally {
    if (activeNativeOperations.get(taskId) === port) activeNativeOperations.delete(taskId);
  }
}

export async function checkSubjectQualityNative(
  blobs: Blob[],
  taskId: string
): Promise<SubjectQualityReport> {
  const port = getWarmNativePort();
  activeNativeOperations.set(taskId, port);
  try {
    const uploaded = await Promise.all(blobs.map((blob) => uploadAsset(port, blob)));
    return await callPort<SubjectQualityReport>(
      port,
      "subject.quality.check",
      { taskId, assetIds: uploaded.map((item) => item.assetId) },
      180_000
    );
  } finally {
    if (activeNativeOperations.get(taskId) === port) activeNativeOperations.delete(taskId);
  }
}

export async function checkCreationSetQualityNative(
  items: Array<{
    itemId: string;
    planTitle: string;
    creativePlan: CreationSetPlanItem["creativePlan"];
    blob: Blob;
  }>,
  setId: string,
  taskId: string,
  context: {
    domain: Domain;
    references: Array<{
      role: GenerationReferenceRole;
      imagePurpose?: "face" | "full_body";
      blob: Blob;
    }>;
    sharedInvariants: string[];
    signatureStyle?: {
      styleId: string;
      styleName: string;
      signatureCode: string;
      dedicatedDimensions: string[];
      observableSignals: string[];
      failureSignals: string[];
      retryStrategy: string;
    } | null;
  }
): Promise<SetQualityReport> {
  const port = getWarmNativePort();
  activeNativeOperations.set(taskId, port);
  try {
    const [uploaded, uploadedReferences] = await Promise.all([
      Promise.all(items.map(async (item) => ({
        ...item,
        ...(await uploadAsset(port, item.blob))
      }))),
      Promise.all(context.references.map(async (reference) => ({
        ...reference,
        ...(await uploadAsset(port, reference.blob))
      })))
    ]);
    return setQualityReportSchema.parse(await callPort<unknown>(
      port,
      "creation-set.quality.check",
      {
        taskId,
        setId,
        domain: context.domain,
        references: uploadedReferences.map(({ role, imagePurpose, assetId }) => ({
          role,
          imagePurpose,
          assetId
        })),
        sharedInvariants: context.sharedInvariants,
        signatureStyle: context.signatureStyle ?? null,
        items: uploaded.map(({ itemId, planTitle, creativePlan, assetId }) => ({
          itemId,
          planTitle,
          creativePlan,
          assetId
        }))
      },
      900_000
    ));
  } finally {
    if (activeNativeOperations.get(taskId) === port) activeNativeOperations.delete(taskId);
  }
}
