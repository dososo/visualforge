import type {
  AssetSource, CreationSetPlanItem, GenerationEvent, GenerationReferenceRole,
  ImagegenSkillProvenance, TaskRecord, TaskStatus
} from "@styleforge/contracts";
import type { ConnectionState, Diagnostics } from "../../lib/native-client";

type TaskStepState = "complete" | "current" | "pending";
type LocalPhase = "saving" | null;
type ErrorContext = "capture" | "image" | "analysis" | "generation" | "connection" | "cancel" | "generic";
type ReferenceDomain = "portrait" | "product" | "poster" | "illustration" | "photography";
type CompatibleSubjectType = "person" | "product" | "object" | "character" | "pet";

export interface TaskLifecyclePresentation {
  status: TaskStatus;
  label: string;
  steps: Array<{ status: TaskStatus; label: string; state: TaskStepState }>;
}

export interface UserFacingError {
  title: string;
  reason: string;
  solution: string;
  actionLabel?: string;
}

export interface ReferenceSourcePresentation {
  site: string;
  title: string;
}

export interface ResultReferencePresentation {
  assetId: string;
  role: GenerationReferenceRole;
  label: string;
}

export const NATIVE_HOST_DOWNLOAD = {
  url: "https://dososo.github.io/visualforge/"
} as const;

export function selectMostRecentCreationTarget(
  projects: Array<{ id: string; updatedAt: number; outputAssetIds?: string[] }>,
  creationSets: Array<{ id: string; updatedAt: number; status?: string }>
): { kind: "project" | "set"; id: string } | null {
  const candidates = [
    ...projects
      .filter((project) => !project.outputAssetIds?.length)
      .map((project) => ({ kind: "project" as const, ...project })),
    ...creationSets
      .filter((creationSet) => creationSet.status !== "COMPLETED")
      .map((creationSet) => ({ kind: "set" as const, ...creationSet }))
  ];
  const latest = candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0];
  return latest ? { kind: latest.kind, id: latest.id } : null;
}

export function runtimeProviderParameters(
  diagnostics: Diagnostics,
  actualSkill: ImagegenSkillProvenance | undefined = diagnostics.imagegenSkill
): Record<string, string | boolean | null> {
  const parameters: Record<string, string | boolean | null> = {};
  if (diagnostics.codex?.found) {
    parameters.codexVersion = diagnostics.codex.version;
    parameters.codexPath = diagnostics.codex.path;
    if (diagnostics.codex.security) {
      parameters.codexResolvedPath = diagnostics.codex.security.resolvedPath;
      parameters.codexSignatureStatus = diagnostics.codex.security.signatureStatus;
      parameters.codexTeamId = diagnostics.codex.security.teamId;
      parameters.codexTrusted = diagnostics.codex.security.trusted;
      parameters.codexSecurityRisk = diagnostics.codex.security.risk;
    }
  } else if (diagnostics.codexVersion) {
    parameters.codexVersion = diagnostics.codexVersion;
  }
  if (actualSkill) {
    parameters.imagegenSkillPath = actualSkill.path;
    parameters.imagegenSkillSha256 = actualSkill.sha256;
  }
  return parameters;
}

export function selectLastCompatibleSubjectId(
  domain: ReferenceDomain,
  projects: Array<{ selectedSubjectAssetId?: string | null; updatedAt: number }>,
  subjects: Array<{ id: string; type: CompatibleSubjectType }>
): string | null {
  const expectedType = domain === "portrait"
    ? "person"
    : domain === "product"
      ? "product"
      : null;
  if (!expectedType) return null;
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject]));
  return [...projects]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((project) => project.selectedSubjectAssetId)
    .find((id): id is string => Boolean(id && subjectsById.get(id)?.type === expectedType))
    ?? null;
}

export function composeFinalPrompt(
  originalReferencePrompt: string,
  confirmedReferencePrompt: string,
  compiledFinalPrompt: string
): string {
  const confirmed = confirmedReferencePrompt.trim();
  if (!confirmed || confirmed === originalReferencePrompt.trim()) return compiledFinalPrompt;
  return [
    "用户确认的参考图反推提示词（其视觉方法优先执行）：",
    confirmed,
    "",
    "本次对象替换、身份保护与生成约束：",
    compiledFinalPrompt
  ].join("\n");
}

export function presentResultReferences(references: Array<{
  assetId: string;
  role: GenerationReferenceRole;
  subjectName?: string | null;
}>): ResultReferencePresentation[] {
  const rank: Record<GenerationReferenceRole, number> = {
    style_layout: 0,
    style: 0,
    identity: 1,
    subject: 1,
    composition: 2,
    edit_base: 3
  };
  const seenAssets = new Set<string>();
  return [...references]
    .sort((left, right) => rank[left.role] - rank[right.role])
    .filter((reference) => {
      if (seenAssets.has(reference.assetId)) return false;
      seenAssets.add(reference.assetId);
      return true;
    })
    .map((reference) => ({
      assetId: reference.assetId,
      role: reference.role,
      label: reference.subjectName?.trim() || (
        reference.role === "style_layout" ? "待复刻画面" :
          reference.role === "style" ? "参考图" :
          reference.role === "identity" ? "我的人物" :
            reference.role === "subject" ? "我的商品" :
              reference.role === "edit_base" ? "待修复候选" : "构图参考"
      )
    }));
}

export function appendGeneratedCandidates(
  existing: string[],
  generated: string[],
  _legacySelectGeneratedAsFinal: boolean
): string[] {
  return [...existing, ...generated];
}

export function presentFinalSelectionAction(criticCompleted: boolean, hasIssues = false): {
  label: string;
  requiresConfirmation: boolean;
} {
  if (criticCompleted && hasIssues) {
    return { label: "仍选为最终版本", requiresConfirmation: true };
  }
  return criticCompleted
    ? { label: "选为最终版本", requiresConfirmation: false }
    : { label: "跳过检查并选为最终版本", requiresConfirmation: true };
}

export function findCriticPlanItem(
  sets: Array<{ id: string; planItems: CreationSetPlanItem[] }>,
  event: Pick<GenerationEvent, "id" | "setId" | "planItemId"> | undefined,
  outputAssetId: string
): CreationSetPlanItem | undefined {
  if (!event?.setId) return undefined;
  return sets.find((set) => set.id === event.setId)?.planItems.find((item) =>
    item.id === event.planItemId ||
    item.outputAssetId === outputAssetId ||
    item.generationEventId === event.id
  );
}

export function presentReferenceSource(source?: AssetSource): ReferenceSourcePresentation | null {
  if (!source || !["web", "capture"].includes(source.type)) return null;
  const url = source.pageUrl ?? source.sourceUrl;
  let site = "";
  if (url) {
    try {
      site = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      site = "";
    }
  }
  const title = source.pageTitle?.trim() ?? "";
  if (!site && !title) return null;
  return {
    site: site || "网页参考",
    title: title || "来自当前网页"
  };
}

export function canCreateWithRuntime(forceMock: boolean, state: ConnectionState): boolean {
  return forceMock || state === "connected";
}

const statusLabels: Record<TaskStatus, string> = {
  CREATED: "正在准备",
  UPLOADING: "正在读取参考图",
  ANALYZING: "正在理解参考图",
  READY: "参考图已准备好",
  GENERATING: "正在生成作品",
  COMPLETED: "作品生成完成",
  FAILED: "这次创作没有完成",
  CANCELLED: "已取消",
  INTERRUPTED: "上次创作没有完成",
  RETRYING: "正在重新尝试"
};

const analysisPath: TaskStatus[] = ["CREATED", "UPLOADING", "ANALYZING", "READY"];
const generationPath: TaskStatus[] = ["CREATED", "UPLOADING", "GENERATING", "COMPLETED"];

export function presentTaskLifecycle(
  operation: TaskRecord["operation"],
  status: TaskStatus,
  localPhase: LocalPhase = null
): TaskLifecyclePresentation {
  const path = operation === "ANALYSIS" ? analysisPath : generationPath;
  const currentIndex = path.indexOf(status);
  const steps = currentIndex < 0
    ? [{ status, label: statusLabels[status], state: "current" as const }]
    : path.map((step, index) => ({
        status: step,
        label: statusLabels[step],
        state: index < currentIndex ? "complete" as const : index === currentIndex ? "current" as const : "pending" as const
      }));
  return {
    status,
    label: localPhase === "saving" && status === "GENERATING"
      ? "正在校验并保存结果"
      : statusLabels[status],
    steps
  };
}

const captureMethodLabels: Record<string, string> = {
  direct: "直接读取",
  "dom-canvas": "页面图像",
  "visible-screenshot": "可见区域截图",
  "area-selection": "网页框选截图"
};

function safeUserFacingFailureDetail(message: string) {
  const detail = message.trim();
  if (!detail || detail.length > 120 || /[\r\n]/.test(detail) || !/[\u3400-\u9fff]/.test(detail)) return null;
  if (/(?:TypeError|ReferenceError|SyntaxError|Error:|ERR_[A-Z_]+|ECONN|ENOTFOUND|EPIPE|https?:\/\/|file:\/\/|\/Users\/|[A-Za-z]:\\|\bat\s+\w+)/i.test(detail)) return null;
  return detail;
}

export function presentUserError(
  context: ErrorContext,
  _technicalMessage = "",
  captureMethod?: string
): UserFacingError {
  if (context === "connection") {
    return {
      title: "需要连接本地创作",
      reason: "参考图和创作要求已经保留，但尚未开始分析或生成。",
      solution: "前往设置连接本地创作后，即可从这里继续。",
      actionLabel: "连接本地创作"
    };
  }
  if (context === "capture") {
    const method = captureMethodLabels[captureMethod ?? ""] ?? "网页捕获";
    return {
      title: "图片没有添加成功",
      reason: `捕获方式：${method}。该网页限制了原图访问，备用捕获也未能完成。`,
      solution: "请重新捕获，或改用网页框选截图。",
      actionLabel: "框选当前网页"
    };
  }
  if (context === "image") {
    if (_technicalMessage.includes("原参考图已不存在")) {
      return {
        title: "原参考图已不存在",
        reason: "这条任务的原始输入已被清理，无法直接重试。",
        solution: "请重新添加参考图并重新分析后开始创作。",
        actionLabel: "重新选择图片"
      };
    }
    return {
      title: "图片无法读取",
      reason: "文件格式可能不受支持，或图片内容已经损坏。",
      solution: "请选择 PNG、JPG 或 WebP 图片后重试。",
      actionLabel: "重新选择图片"
    };
  }
  if (context === "analysis") {
    return {
      title: "参考图分析未完成",
      reason: "本地创作服务没有完成这次分析。",
      solution: "输入和图片仍然保留，可以直接重试。",
      actionLabel: "重试"
    };
  }
  if (context === "generation") {
    if (_technicalMessage.includes("创作记录已不存在")) {
      return {
        title: "创作记录已不存在",
        reason: "这条恢复任务对应的作品记录已被清理，不能直接继续。",
        solution: "请返回创作首页，重新添加参考图后开始。"
      };
    }
    if (_technicalMessage.includes("缺少已保存的参考图分析")) {
      return {
        title: "参考图分析记录不完整",
        reason: "这条恢复任务缺少生成所需的参考图理解，不能直接继续。",
        solution: "请返回创作首页，重新分析参考图后开始。"
      };
    }
    if (_technicalMessage === "IMAGEGEN_UNAVAILABLE") {
      return {
        title: "暂时不能生成作品",
        reason: "本地创作服务已连接，但图像生成功能还不可用。",
        solution: "请在设置中检查本地创作连接后重试。"
      };
    }
    const failureDetail = safeUserFacingFailureDetail(_technicalMessage);
    return {
      title: "这次没有生成出来",
      reason: failureDetail
        ? `失败原因：${failureDetail}。参考图和要求已经保存。`
        : "参考图和要求已经保存，不需要重新填写。",
      solution: "可以直接再试一次；如果仍失败，请检查连接。",
      actionLabel: "再试一次"
    };
  }
  if (context === "cancel") {
    return {
      title: "暂时无法取消",
      reason: "取消请求暂时没有送达正在运行的创作。",
      solution: "任务仍可能继续运行，请稍后再次尝试。"
    };
  }
  return {
    title: "这一步没有完成",
    reason: "操作暂时未能完成。",
    solution: "请检查输入后重试。"
  };
}

export function connectionGuidance(state: ConnectionState): UserFacingError | null {
  if (state === "connected") return null;
  const shared = {
    title: "完成本地连接",
    reason: "VisualForge 使用你已经登录的 Codex 分析和生成图片，不需要 API Key。",
    actionLabel: "重新检查连接"
  };
  if (state === "host-missing") {
    return {
      ...shared,
      solution: "请安装本地连接组件，然后重新检查连接。"
    };
  }
  if (state === "host-outdated") {
    return {
      ...shared,
      title: "更新本地连接组件",
      solution: "当前连接组件版本过旧或能力不完整。请更新后重新检查连接。"
    };
  }
  if (state === "codex-missing") {
    return {
      ...shared,
      solution: "未找到 Codex。请安装或启动 Codex，然后重新检查连接。"
    };
  }
  if (state === "login-required") {
    return {
      ...shared,
      solution: "请先在 Codex 中完成登录，然后重新检查连接。"
    };
  }
  return {
    ...shared,
    solution: "本地连接通信失败。请确认组件和 Codex 正在运行，然后重新检查连接。"
  };
}
