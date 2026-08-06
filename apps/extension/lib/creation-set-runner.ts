import type {
  CreationSet, CreationSetPlanItem, SetQualityIssue, SetQualityReport
} from "@styleforge/contracts";
import { cancelCreationSet, deriveCreationSetStatus } from "@styleforge/core";

interface SetItemResult {
  taskId: string;
  generationEventId: string;
  outputAssetId: string;
  outputSha256: string;
  byteLength: number;
  finalPrompt: string;
}

interface CreationSetRunnerDependencies {
  save: (creationSet: CreationSet) => Promise<CreationSet | void>;
  cancelled: () => boolean;
  execute: (creationSet: CreationSet, item: CreationSetPlanItem) => Promise<SetItemResult>;
  qualityCheck?: (creationSet: CreationSet, item: CreationSetPlanItem, result: SetItemResult) => Promise<{
    passed: boolean;
    issue?: SetQualityIssue;
    report?: SetQualityReport;
  }>;
  onQualityCheckError?: (item: CreationSetPlanItem, error: Error) => void;
  createTaskId?: () => string;
  now?: () => number;
  onChange?: (creationSet: CreationSet) => void;
}

function withItems(set: CreationSet, planItems: CreationSetPlanItem[], now: number): CreationSet {
  return {
    ...set,
    ...deriveCreationSetStatus(planItems),
    planItems,
    updatedAt: now
  };
}

export function safeCreationSetErrorMessage(
  rawMessage: string,
  fallback = "当前画面生成未完成，请重试这一张。"
) {
  const message = rawMessage.trim();
  const technical = /(?:TypeError|ReferenceError|SyntaxError|Error:|\/Users\/|\/home\/|[A-Za-z]:\\|node_modules|\bat\s+\S+|private[-_ ]?token|api[-_ ]?key|fetch failed|request failed|ECONN|ENOTFOUND|stack)/i;
  if (!message || message.length > 180 || message.includes("\n") || technical.test(message)) {
    return fallback;
  }
  return message;
}

export function mergeCreationSetProgress(latest: CreationSet, incoming: CreationSet): CreationSet {
  if (latest.id !== incoming.id) throw new Error("不能合并不同的套图记录。");
  const incomingById = new Map(incoming.planItems.map((item) => [item.id, item]));
  const planItems = latest.planItems.map((latestItem) => {
    const progress = incomingById.get(latestItem.id);
    if (!progress) return latestItem;
    const candidates = new Map(latestItem.outputCandidates.map((candidate) =>
      [candidate.outputAssetId, candidate]));
    for (const candidate of progress.outputCandidates) candidates.set(candidate.outputAssetId, candidate);
    return {
      ...latestItem,
      status: progress.status,
      taskId: progress.taskId,
      retryOfTaskId: progress.retryOfTaskId,
      generationEventId: progress.generationEventId,
      outputAssetId: progress.outputAssetId,
      outputCandidates: [...candidates.values()],
      qualityStatus: progress.qualityStatus,
      qualityMessage: progress.qualityMessage,
      qualityReport: progress.qualityReport,
      retryDirective: progress.retryDirective,
      finalPrompt: progress.finalPrompt,
      error: progress.error
    };
  });
  return {
    ...latest,
    status: incoming.status,
    completedCount: incoming.completedCount,
    failedCount: incoming.failedCount,
    updatedAt: Math.max(latest.updatedAt, incoming.updatedAt),
    planItems
  };
}

export async function runCreationSet(
  initial: CreationSet,
  dependencies: CreationSetRunnerDependencies
) {
  const now = dependencies.now ?? Date.now;
  let current = initial;
  const persist = async (next: CreationSet) => {
    current = await dependencies.save(next) ?? next;
    dependencies.onChange?.(current);
    return current;
  };
  for (const sourceItem of initial.planItems) {
    if (!["PENDING", "INTERRUPTED"].includes(sourceItem.status)) continue;
    if (dependencies.cancelled()) {
      current = cancelCreationSet(current, now());
      await persist(current);
      return current;
    }
    const item = current.planItems.find((candidate) => candidate.id === sourceItem.id)!;
    const taskId = item.taskId ?? dependencies.createTaskId?.() ?? crypto.randomUUID();
    current = withItems(current, current.planItems.map((candidate) =>
      candidate.id === item.id
        ? {
            ...candidate,
            status: "GENERATING",
            taskId,
            qualityStatus: dependencies.qualityCheck ? "checking" : "not_checked",
            qualityMessage: null,
            qualityReport: null,
            error: null
          }
        : candidate), now());
    await persist(current);
    try {
      const runningItem = current.planItems.find((candidate) => candidate.id === item.id)!;
      const result = await dependencies.execute(current, runningItem);
      const preserveCandidate = async (issueType: SetQualityIssue["type"] | null = null) => {
        const createdAt = now();
        current = withItems(current, current.planItems.map((candidate) => candidate.id === item.id &&
          !candidate.outputCandidates.some((entry) => entry.outputAssetId === result.outputAssetId) ? {
            ...candidate,
            outputCandidates: [...candidate.outputCandidates, {
              outputAssetId: result.outputAssetId,
              outputSha256: result.outputSha256,
              byteLength: result.byteLength,
              generationEventId: result.generationEventId,
              taskId: result.taskId,
              createdAt,
              source: candidate.retryDirective ? "targeted_retry" as const : "initial" as const,
              issueType
            }]
          } : candidate), createdAt);
        await persist(current);
      };
      await preserveCandidate(runningItem.retryDirective?.issueType ?? null);
      if (dependencies.cancelled() && dependencies.qualityCheck) {
        current = cancelCreationSet(current, now());
        await persist(current);
        return current;
      }
      const checkQuality = async (): Promise<{
        passed: boolean;
        issue?: SetQualityIssue;
        report?: SetQualityReport;
        status: NonNullable<CreationSetPlanItem["qualityStatus"]>;
        message: string | null;
      }> => {
        if (!dependencies.qualityCheck) return {
          passed: true,
          status: "not_checked",
          message: null,
          report: undefined
        };
        try {
          const checked = await dependencies.qualityCheck(current, runningItem, result);
          return {
            ...checked,
            status: checked.passed ? "passed" : "needs_repair",
            message: checked.passed ? null : checked.issue?.message ?? "质量检查未通过。"
          };
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          dependencies.onQualityCheckError?.(runningItem, error);
          const message = safeCreationSetErrorMessage(
            error.message,
            "图片已生成，但质量检查暂时不可用，可以稍后重试检查。"
          );
          return {
            passed: true,
            status: "unavailable",
            message,
            report: undefined
          };
        }
      };
      const quality = await checkQuality();
      current = withItems(current, current.planItems.map((candidate) =>
        candidate.id === item.id ? (() => {
          const createdAt = now();
          const outputCandidates = candidate.outputCandidates.some((entry) =>
            entry.outputAssetId === result.outputAssetId)
            ? candidate.outputCandidates
            : [...candidate.outputCandidates, {
                outputAssetId: result.outputAssetId,
                outputSha256: result.outputSha256,
                byteLength: result.byteLength,
                generationEventId: result.generationEventId,
                taskId: result.taskId,
                createdAt,
                source: candidate.retryDirective ? "targeted_retry" as const : "initial" as const,
                issueType: candidate.retryDirective?.issueType ?? null
              }];
          return {
            ...candidate,
            status: "COMPLETED" as const,
            taskId: result.taskId,
            generationEventId: result.generationEventId,
            outputAssetId: result.outputAssetId,
            outputCandidates,
            selectedOutputAssetId: candidate.selectedOutputAssetId,
            finalSelection: candidate.finalSelection ?? null,
            qualityStatus: quality.status,
            qualityMessage: quality.message,
            qualityReport: quality.report ?? null,
            retryDirective: null,
            finalPrompt: result.finalPrompt,
            error: quality.status === "unavailable" ? {
              code: "QUALITY_CHECK_UNAVAILABLE",
              message: quality.message ?? "图片已生成，但质量检查未完成。",
              retryable: true
            } : null
          };
        })() : candidate), now());
    } catch (cause) {
      const rawMessage = cause instanceof Error ? cause.message : String(cause);
      const completedBeforeFailure = current.planItems.filter((candidate) =>
        candidate.status === "COMPLETED").length;
      const message = /图像生成响应超时/.test(rawMessage)
        ? `这张作品等待时间过长，已停止生成。${completedBeforeFailure > 0 ? `前${completedBeforeFailure === 3 ? "三" : completedBeforeFailure}张作品不受影响，` : ""}点击“重试”只会重新生成这一张。`
        : safeCreationSetErrorMessage(rawMessage);
      current = withItems(current, current.planItems.map((candidate) =>
        candidate.id === item.id ? {
          ...candidate,
          status: dependencies.cancelled() ? "CANCELLED" : "FAILED",
          error: dependencies.cancelled() ? null : {
            code: "GENERATION_FAILED",
            message,
            retryable: true
          }
        } : candidate), now());
    }
    await persist(current);
  }
  if (dependencies.cancelled()) current = cancelCreationSet(current, now());
  else current = withItems(current, current.planItems, now());
  await persist(current);
  return current;
}
