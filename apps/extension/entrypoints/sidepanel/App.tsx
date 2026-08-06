import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ArrowDownToLine, Check, ChevronDown, CircleAlert, ClipboardPaste, Copy, Globe2, ImagePlus,
  Library, LoaderCircle, Palette, Pencil, RefreshCw, Settings, Trash2, Upload, X
} from "lucide-react";
import type {
  AppSettings, AspectRatio, AssetRecord, AssetRole, GenerationEvent, PreferenceEvent, ProjectRecord, TaskError,
  TaskRecord, VisualDNA, VisualDNARevision, UserPreferenceSummary, GenerationReferenceSnapshot,
  SubjectAsset, SubjectAssetSnapshot, SubjectAssetType, SubjectQualityReport,
  CreationSet, CreationSetPlanItem, Domain, DomainProfile, SetQualityIssue, SetQualityReport,
  SignatureStyleSelection
} from "@styleforge/contracts";
import {
  aggregatePreferenceEvents, compilePrompt, createGenerationEvents, createGenerationManifest,
  compileSetItemPrompt, createCreativeDirection, createDirectedCreationSetPlan, createMigrationDomainProfile,
  createTransformationBlueprint,
  createPreferenceEvents, createRetryTask, createVisualDNARevision, filterDismissedPreferenceSummaries,
  overrideDomainProfile, resolvePreferenceSuggestion, resumeCreationSet, retryFailedSetItems,
  restoreVisualDNARevision, reviseVisualDNA, transitionTask, analysisCacheKey, createPerformanceTrace,
  applySignatureStyleToCreationPlan, buildSignatureStyleCriticContext,
  applyGridCellAnalysisToPlanItem,
  buildTargetedRetryPrompt, hammingDistance, isPortraitBlockingQualityIssue,
  finalizeCreationSetOutput, prepareCreationSetItemRetry, prepareTargetedRetry,
  orderGenerationReferences, orderPersonImageIdsByEvidence, validateSetQualityReportItems
} from "@styleforge/core";
import {
  clearAllBrowserData, defaultSettings, deleteStandaloneProjectWorks, dismissPreferenceSummaries,
  dismissPreferenceSummary, getAsset, getProject, getSettings, deleteSubjectAsset, getSubjectAsset,
  ensureVisualDNARevisions, listGenerationEvents, listRetryableTaskRecords, listProjects,
  listPreferenceEvents, listPreferenceSummaryDismissals, listVisualDNARevisions,
  recoverInterruptedTaskRecords, refreshTaskHeartbeat, saveAsset, saveAssets, saveGenerationBundle, saveProject,
  saveProjectRevision, saveSettings, saveTaskRecord, saveSubjectAsset, listSubjectAssets,
  deleteCreationSet, deleteCreationSetWithWorks, getCreationSet, listCreationSets,
  reconcileCreationSets, saveCreationSet, updateCreationSet, updateProject, getAnalysisCache, putAnalysisCache, savePerformanceTrace,
  createIntegrityDiagnostic, inspectStartupRecordIntegrity, summarizeDataClearResult,
  type DataIntegrityIssue
} from "../../lib/db";
import {
  createMockResult, cropScreenshot, normalizeImage, imageDifferenceSignature, normalizedImageDifference
} from "../../lib/image";
import { analyzeMock } from "../../lib/mock-provider";
import {
  analyzeDomainNative, analyzeGridNative, cancelNativeTask, checkCreationSetQualityNative, checkSubjectQualityNative,
  diagnoseNative, generateNative, NativeGenerationIncompleteError, purgeAllUserData,
  uninstallNativeHost,
  type Diagnostics, type NativeGenerationTimingBreakdown
} from "../../lib/native-client";
import { createCreationSetZip, createGridComposite } from "../../lib/creation-set-export";
import {
  mergeCreationSetProgress, runCreationSet, safeCreationSetErrorMessage
} from "../../lib/creation-set-runner";
import { createGridLayout, cropGridCell, cropGridCells, detectGridLayout, gridCells, type GridLayout } from "../../lib/grid-layout";
import {
  createProjectFinalSelection, resolveProjectFinalAsset, verifyProjectFinalAsset
} from "../../lib/final-selection";
import { VisualDNAEditor } from "./VisualDNAEditor";
import { VisualDNAHistory } from "./VisualDNAHistory";
import { PreferenceSuggestion } from "./PreferenceSuggestion";
import { PreferenceCenter } from "./PreferenceCenter";
import { StyleBreakdown } from "./StyleBreakdown";
import {
  appendGeneratedCandidates, canCreateWithRuntime, connectionGuidance, presentReferenceSource,
  composeFinalPrompt, findCriticPlanItem, presentFinalSelectionAction, presentResultReferences, presentTaskLifecycle, presentUserError,
  runtimeProviderParameters, selectLastCompatibleSubjectId, selectMostRecentCreationTarget, NATIVE_HOST_DOWNLOAD
} from "./experience";
import {
  SubjectAssetEditor,
  SubjectAssetLibraryCard,
  SubjectAssetPicker,
  type SubjectAssetDraft
} from "./SubjectAssets";
import { subjectTypePresentation } from "./subject-presentation";
import {
  CreationSetCard, CreationSetView, DomainHint
} from "./CreationSetView";
import { applyHoverSettingToOpenTabs, sitePermissionOriginForUrl } from "../../lib/site-permissions";
import portraitShowcaseUrl from "../../assets/reference-cards/fashion-editorial-hero.png?url";
import rainShowcaseUrl from "../../assets/reference-cards/rain-night-dynamic.png?url";
import perfumeShowcaseUrl from "../../assets/reference-cards/perfume-material-hero.png?url";

type Route = "create" | "library" | "settings";
type Mode = "direct" | "analyze";
type Stage = "idle" | "analyzing" | "ready" | "rendering" | "saving" | "complete" | "error";
type LibraryKind = "works" | "people" | "subjects";
interface CapturePreview {
  blob: Blob;
  source: AssetRecord["source"];
}

interface TaskNotification {
  taskId: string;
  projectId: string;
  creationSetId?: string;
  title: string;
  status: "completed" | "partial" | "cancelled" | "failed";
  completedCount?: number;
  failedCount?: number;
  requestedCount?: number;
  unread: boolean;
  createdAt: number;
}

const TASK_NOTIFICATIONS_KEY = "visualForgeTaskNotificationsV1";
const DISMISSED_RETRY_TASKS_KEY = "visualForgeDismissedRetryTasksV1";
const TASK_HEARTBEAT_INTERVAL_MS = 30_000;
const taskNotificationToken = (notification: TaskNotification) => `${notification.taskId}:${notification.createdAt}`;
const pasteShortcutLabel = () => /Mac|iPhone|iPad/i.test(navigator.platform) ? "⌘V" : "Ctrl+V";

function taskNotificationCopy(notification: TaskNotification) {
  const count = notification.completedCount !== undefined && notification.requestedCount !== undefined
    ? `（${notification.completedCount} / ${notification.requestedCount}）`
    : "";
  if (notification.status === "completed") return {
    title: `“${notification.title}”已完成${count}`,
    detail: "结果已保存到作品。"
  };
  if (notification.status === "partial") return {
    title: `“${notification.title}”部分完成${count}`,
    detail: "已完成内容已保留，可查看、导出或继续重试。"
  };
  if (notification.status === "cancelled") return {
    title: `“${notification.title}”已停止${count}`,
    detail: "已完成内容已保留，可随时继续未完成项。"
  };
  return {
    title: `“${notification.title}”生成失败`,
    detail: "输入和已完成内容已保留，可查看并重试。"
  };
}

function retryTaskUserMessage(task: TaskRecord) {
  if (!task.error?.message) return "图片和要求仍然保留，可以继续处理。";
  const context = task.operation === "ANALYSIS" ? "analysis" : "generation";
  const guidance = presentUserError(context, task.error.message);
  return `${guidance.reason} ${guidance.solution}`;
}

function startTaskHeartbeat(taskId: string) {
  const timer = window.setInterval(() => {
    void refreshTaskHeartbeat(taskId).catch(() => undefined);
  }, TASK_HEARTBEAT_INTERVAL_MS);
  return () => window.clearInterval(timer);
}

async function readHeldVisualForgeLocks() {
  if (!("locks" in navigator) || typeof navigator.locks.query !== "function") return undefined;
  try {
    const snapshot = await navigator.locks.query();
    return new Set((snapshot.held ?? [])
      .map((lock) => lock.name)
      .filter((name): name is string => Boolean(name?.startsWith("visualforge:"))));
  } catch {
    return undefined;
  }
}

function shouldRevealCompletedTask(context: {
  route: Route;
  stage: Stage;
  currentProjectId?: string;
  completedProjectId: string;
  activeCreationSetId?: string;
}) {
  return context.route === "create"
    && ["rendering", "saving"].includes(context.stage)
    && context.currentProjectId === context.completedProjectId
    && !context.activeCreationSetId;
}

async function persistTaskNotification(notification: TaskNotification) {
  const stored = await chrome.storage.local.get(TASK_NOTIFICATIONS_KEY);
  const previous = Array.isArray(stored[TASK_NOTIFICATIONS_KEY])
    ? stored[TASK_NOTIFICATIONS_KEY] as TaskNotification[] : [];
  const next = [notification, ...previous.filter((item) => item.taskId !== notification.taskId)].slice(0, 20);
  await chrome.storage.local.set({ [TASK_NOTIFICATIONS_KEY]: next });
  return next;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ratioOptions: AspectRatio[] = ["3:4", "1:1", "4:3", "16:9", "9:16"];
const singleGenerationLabel = (candidateCount: 1 | 2 | 4) => candidateCount === 1
  ? "生成 1 张作品"
  : `生成 ${candidateCount} 个候选版本`;
const gridLayoutNames = {
  2: "二宫格",
  3: "三宫格",
  4: "四宫格",
  6: "六宫格",
  9: "九宫格",
  12: "十二宫格"
} as const;
const gridLayoutName = (count: keyof typeof gridLayoutNames) => gridLayoutNames[count];
const roleLabels: Record<AssetRole, string> = {
  style_layout: "风格与构图", subject: "主体／商品", identity: "人物身份", output: "生成结果"
};

function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) return setUrl("");
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function gridLayoutAlternatives(count: GridLayout["count"]) {
  if (count === 2) return [createGridLayout(2, 2), createGridLayout(2, 1)];
  if (count === 3) return [createGridLayout(3, 3), createGridLayout(3, 1)];
  if (count === 6) return [createGridLayout(6, 3), createGridLayout(6, 2)];
  if (count === 12) return [createGridLayout(12, 4), createGridLayout(12, 3)];
  return [createGridLayout(count)];
}

function gridLayoutOrientationLabel(layout: GridLayout) {
  const direction = layout.columns > layout.rows
    ? "横向"
    : layout.rows > layout.columns
      ? "纵向"
      : "方形";
  if (layout.count === 3) return `${direction}三宫格`;
  return `${direction} · ${layout.columns} 列 × ${layout.rows} 行`;
}

function GridBoundaryPreview({ asset, layout }: { asset: AssetRecord; layout: GridLayout }) {
  const url = useObjectUrl(asset.blob);
  return (
    <figure className="grid-boundary-preview">
      <div>
        <img src={url} alt="参考宫格与当前裁切边界" />
        {gridCells(layout).map((cell) => (
          <span
            key={cell.index}
            aria-hidden="true"
            style={{
              left: `${cell.left * 100}%`,
              top: `${cell.top * 100}%`,
              width: `${cell.width * 100}%`,
              height: `${cell.height * 100}%`
            }}
          >{cell.index + 1}</span>
        ))}
      </div>
      <figcaption>可见裁切范围 · 拖动下方分隔线后即时更新</figcaption>
    </figure>
  );
}

const showcaseItems = [
  { src: portraitShowcaseUrl, label: "环境肖像", description: "让人物与空间共同讲故事" },
  { src: rainShowcaseUrl, label: "动态瞬间", description: "用动作中间帧建立电影感" },
  { src: perfumeShowcaseUrl, label: "材质细节", description: "用反射和边缘高光表现工艺" }
] as const;

function ReferenceShowcase() {
  return (
    <div className="reference-showcase" aria-label="顶级案例精选">
      {showcaseItems.map((item) => (
        <figure key={item.label}>
          <img src={item.src} alt={`${item.label}真实生成案例`} />
          <figcaption><strong>{item.label}</strong><small>{item.description}</small></figcaption>
        </figure>
      ))}
    </div>
  );
}

function RecentCreationCard({ target, onOpen, onDelete }: {
  target: { kind: "project"; project: ProjectRecord } | { kind: "set"; creationSet: CreationSet };
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [asset, setAsset] = useState<AssetRecord>();
  const url = useObjectUrl(asset?.thumbnailBlob);
  const title = target.kind === "project" ? target.project.title : target.creationSet.title;
  const coverAssetId = target.kind === "project"
    ? target.project.outputAssetIds.at(-1) ?? target.project.referenceAssetIds[0] ?? ""
    : [...target.creationSet.planItems].reverse().map((item) =>
        item.selectedOutputAssetId ?? item.outputAssetId ?? item.outputCandidates.at(-1)?.outputAssetId
      ).find(Boolean) ?? "";
  const detail = target.kind === "set" && target.creationSet.completedCount > 0
    ? `已完成 ${target.creationSet.completedCount} / ${target.creationSet.requestedCount}，可继续生成剩余画面`
    : "参考图和要求已保存，可继续完成";
  useEffect(() => {
    if (!coverAssetId) return setAsset(undefined);
    void getAsset(coverAssetId).then(setAsset);
  }, [coverAssetId]);
  return (
    <section className="recent-context" aria-label="继续未完成创作">
      {url && <img src={url} alt="" />}
      <div>
        <small>继续未完成创作</small>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <div className="recent-actions">
        <button type="button" className="icon-button" aria-label="删除未完成创作" title="删除" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
        <button type="button" onClick={onOpen}>继续完成</button>
      </div>
    </section>
  );
}

function ProjectNameEditor({ project, onRename, className = "" }: {
  project: ProjectRecord;
  onRename: (title: string) => void | Promise<void>;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState("");
  const renameTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setTitle(project.title), [project.title]);
  const finishEditing = () => {
    setEditing(false);
    window.requestAnimationFrame(() => renameTriggerRef.current?.focus());
  };
  const commit = async () => {
    const next = title.trim();
    if (!next) {
      setTitle(project.title);
      finishEditing();
      return;
    }
    setSaving(true);
    setRenameError("");
    try {
      await onRename(next);
      finishEditing();
    } catch {
      setRenameError("名称没有保存成功，请重试。");
    } finally {
      setSaving(false);
    }
  };
  if (editing) {
    return (
      <form className={`project-name-editor ${className}`} aria-busy={saving} onSubmit={(event) => {
        event.preventDefault();
        void commit();
      }}>
        <input
          autoFocus
          aria-label="作品名称"
          value={title}
          maxLength={40}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setTitle(project.title);
              setRenameError("");
              finishEditing();
            }
          }}
        />
        <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        {renameError && <p className="project-name-error" role="alert">{renameError}</p>}
      </form>
    );
  }
  return (
    <button
      ref={renameTriggerRef}
      type="button"
      className={`project-title ${className}`}
      aria-label="修改作品名称"
      title="修改名称"
      onClick={() => { setRenameError(""); setEditing(true); }}
    >
      <span>{project.title}</span><Pencil size={13} aria-hidden="true" />
    </button>
  );
}

function TaskReferencePreview({ asset }: { asset: AssetRecord }) {
  const url = useObjectUrl(asset.thumbnailBlob ?? asset.blob);
  const source = presentReferenceSource(asset.source);
  return (
    <figure className="progress-reference">
      <img src={url} alt="正在处理的参考图" />
      <figcaption>
        <strong>参考图已捕获</strong>
        <small>{source?.title ?? source?.site ?? `${asset.width} × ${asset.height}`}</small>
      </figcaption>
    </figure>
  );
}

function ImageSlot({ asset, role, onPick, onRemove, onEnableWebCapture, onPasteClipboard, onCaptureArea, webCaptureStatus, webCaptureEnabled = true, webCaptureBusy = false, compact = false }: {
  asset?: AssetRecord;
  role: AssetRole;
  onPick: (file: File) => void;
  onRemove: () => void;
  onEnableWebCapture?: () => void;
  onPasteClipboard?: () => void;
  onCaptureArea?: () => void;
  webCaptureStatus?: string;
  webCaptureEnabled?: boolean;
  webCaptureBusy?: boolean;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const url = useObjectUrl(asset?.thumbnailBlob);
  const source = presentReferenceSource(asset?.source);
  const displayLabel = role === "style_layout" ? "喜欢的照片" : roleLabels[role];
  return (
    <div className={`image-slot ${asset ? "has-image" : ""} ${compact ? "compact" : ""}`}>
      <input
        ref={input}
        id={role === "style_layout" ? "styleforge-primary-image" : undefined}
        hidden type="file" accept="image/png,image/jpeg,image/webp"
        onChange={(event) => event.target.files?.[0] && onPick(event.target.files[0])}
      />
      {asset ? (
        <>
          <img src={url} alt={`${roleLabels[role]}预览`} />
          <div className="image-meta">
            <span>
              <strong>{displayLabel}</strong>
              <small>{asset.width} × {asset.height}</small>
              {source && <small className="source-site">{source.site}</small>}
              {source && <small className="source-title" title={source.title}>{source.title}</small>}
            </span>
            <span className="slot-actions">
              <button className="text-button" onClick={() => input.current?.click()}>替换</button>
              <button className="icon-button" aria-label={`移除${roleLabels[role]}`} title="移除" onClick={onRemove}><X size={16} /></button>
            </span>
          </div>
        </>
      ) : compact ? (
        <button className="slot-empty" onClick={() => input.current?.click()}>
          <ImagePlus size={compact ? 20 : 26} />
          <span>{`添加${roleLabels[role]}`}</span>
        </button>
      ) : (
        <section className="onboarding" aria-label="开始创作">
          <h1>看到喜欢的图片，把它变成你的作品。</h1>
          <p>
            <strong>找一个喜欢的视觉</strong>
            <span>VisualForge 会理解参考图，并生成你的版本。</span>
          </p>
          <ReferenceShowcase />
          <button type="button" className="onboarding-capture" disabled={webCaptureBusy} onClick={onEnableWebCapture}>
            {webCaptureBusy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Globe2 size={15} aria-hidden="true" />}
            {webCaptureBusy
              ? "正在准备网页按钮…"
              : webCaptureEnabled && webCaptureStatus?.startsWith("当前页面的网页按钮已准备好")
                ? "网页按钮已准备好"
                : "在网页图片上使用 VisualForge"}
          </button>
          <p className="web-capture-status" role="status">
            {webCaptureStatus || "网页按钮默认开启。点击可检查当前页面并补充显示按钮。"}
          </p>
          <details className="capture-privacy-disclosure">
            <summary>数据如何处理</summary>
            <p>点击捕获后，所选图片、来源页面和你的要求会保存在本机；分析或生成时会通过本机连接交给当前登录的 Codex／OpenAI 处理。VisualForge 不会在点击前上传页面内容。</p>
          </details>
          <div className="onboarding-secondary" aria-label="添加参考图的方法">
            <button type="button" onClick={() => input.current?.click()}>
              <Upload size={15} aria-hidden="true" /><span><strong>上传参考图</strong><small>PNG、JPG 或 WebP</small></span>
            </button>
            <button type="button" onClick={onPasteClipboard}>
              <ClipboardPaste size={15} aria-hidden="true" /><span><strong>粘贴参考图</strong><small>点击后按 {pasteShortcutLabel()}</small></span>
            </button>
            <button type="button" onClick={onCaptureArea}>
              <ImagePlus size={15} aria-hidden="true" /><span><strong>框选网页区域</strong><small>截取当前可见画面</small></span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function ConnectionOnboarding({
  diagnostics,
  onRetry
}: {
  diagnostics: Diagnostics;
  onRetry: () => void;
}) {
  const issue = diagnostics.imagegen === false
    ? {
        title: "完成本地连接",
        reason: "VisualForge 已连接 Codex，但当前图像生成功能不可用。",
        solution: "请更新或重新登录 Codex，然后重新检查连接。"
      }
    : connectionGuidance(diagnostics.state);
  return (
    <main className="connection-onboarding" aria-labelledby="connection-title">
      <div className="connection-mark"><Settings size={22} aria-hidden="true" /></div>
      <h1 id="connection-title">完成本地连接</h1>
      <p>VisualForge 使用你已经登录的 Codex 分析和生成图片，不需要 API Key。</p>
      <ol>
        <li><span>1</span>打开下载页，选择当前系统。</li>
        <li><span>2</span>运行安装文件。</li>
        <li><span>3</span>返回 VisualForge，重新检查连接。</li>
      </ol>
      {issue && <div className="connection-current" role="status"><strong>{issue.title}</strong><span>{issue.solution}</span></div>}
      <a className="primary" href={NATIVE_HOST_DOWNLOAD.url} target="_blank" rel="noreferrer">
        下载适合本机的连接组件
      </a>
      <button type="button" className="secondary connection-retry" onClick={onRetry}>重新检查连接</button>
      <details>
        <summary>查看安装步骤</summary>
        <p>下载页会按 macOS、Windows 或 Linux 提供对应安装包和校验值。若 Codex 未登录，请先在 Codex 中完成登录。</p>
        {diagnostics.detail && <pre>{diagnostics.detail}</pre>}
      </details>
    </main>
  );
}

function CapturePreviewCard({ preview, onConfirm, onCancel }: {
  preview: CapturePreview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const url = useObjectUrl(preview.blob);
  return (
    <section className="capture-preview" aria-label="截图预览">
      <div className="section-heading"><span>截图预览</span><small>确认后才会加入参考图</small></div>
      <img src={url} alt="框选截图预览" />
      <div>
        <button className="primary" onClick={onConfirm}>加入参考图</button>
        <button className="secondary" onClick={onCancel}>取消</button>
      </div>
    </section>
  );
}

function ProvenancePanel({ event }: { event?: GenerationEvent }) {
  const [source, setSource] = useState<AssetRecord>();
  const [referenceAssets, setReferenceAssets] = useState<Map<string, AssetRecord>>(new Map());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => {
    setSource(undefined);
    setReferenceAssets(new Map());
    setCopied(false);
    setCopyError(false);
    if (event) {
      void getAsset(event.sourceAssetId).then(setSource);
      void Promise.all((event.references ?? []).map(async (reference) =>
        [reference.assetId, await getAsset(reference.assetId)] as const
      )).then((items) => setReferenceAssets(new Map(
        items.filter((item): item is readonly [string, AssetRecord] => Boolean(item[1]))
      )));
    }
  }, [event]);
  const sourceUrl = useObjectUrl(source?.thumbnailBlob);
  if (!event) {
    return <section className="provenance"><div className="section-heading"><span>创作记录</span><small>早期作品记录不完整</small></div></section>;
  }
  const copyPrompt = async () => {
    setCopied(false);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(event.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError(true);
    }
  };
  return (
    <section className="provenance" aria-label="创作记录">
      <div className="section-heading"><span>创作记录</span><small>{new Date(event.createdAt).toLocaleString("zh-CN")}</small></div>
      <div className="provenance-source">
        {sourceUrl && <img src={sourceUrl} alt="溯源参考图" />}
        <span><strong>参考图</strong><small>{event.sourceAssetId}</small></span>
      </div>
      {(event.references?.length ?? 0) > 0 && <div className="provenance-references" aria-label="本次参考资产">
        <strong>本次参考资产</strong>
        {event.references!.map((reference, index) => {
          const image = referenceAssets.get(reference.assetId);
          const role = reference.role === "style" ? "风格"
            : reference.role === "composition" ? "构图"
              : reference.role === "identity" ? "人物" : "主体";
          return <div key={`${reference.role}-${reference.assetId}-${index}`}>
            {image && <ReferenceThumb asset={image} alt={`${role}参考`} />}
            <span>
              <b>{reference.subjectAsset?.name ?? `${role}参考图`}</b>
              <small>{role}{reference.subjectAsset ? ` · ${reference.subjectAsset.type}` : ""}</small>
            </span>
          </div>;
        })}
      </div>}
      <details className="technical-details">
        <summary>技术详情</summary>
        <dl>
          <div><dt>分析版本</dt><dd>{event.visualDNASchemaVersion} · 版本 {event.dnaRevision}</dd></div>
          <div><dt>生成规则版本</dt><dd>{event.promptCompilerVersion}</dd></div>
          <div><dt>模型</dt><dd>{event.model.name} · {event.model.version ?? "版本未返回"}</dd></div>
          <div><dt>运行方式</dt><dd>{event.model.provider}</dd></div>
          <div><dt>文件校验</dt><dd className="hash">{event.outputHash}</dd></div>
          <div><dt>保持项</dt><dd>{event.lockedFields?.length ? event.lockedFields.join(" · ") : "无"}</dd></div>
        </dl>
        <label className="provenance-prompt">
          <span>完整生成指令</span>
          <textarea aria-label="完整生成指令" readOnly value={event.prompt} />
        </label>
        <button className="secondary provenance-copy" aria-live="polite" onClick={() => void copyPrompt()}>
          {copyError ? "复制失败，请重试" : copied ? "已复制" : "复制完整指令"}
        </button>
      </details>
    </section>
  );
}

function ReferenceThumb({ asset, alt }: { asset: AssetRecord; alt: string }) {
  const url = useObjectUrl(asset.thumbnailBlob);
  return <img src={url} alt={alt} />;
}

function ResultThumb({ asset, alt }: { asset: AssetRecord; alt: string }) {
  const url = useObjectUrl(asset.thumbnailBlob);
  return <img src={url} alt={alt} />;
}

function ResultContext({ event }: { event?: GenerationEvent }) {
  const [items, setItems] = useState<Array<{ reference: NonNullable<GenerationEvent["references"]>[number]; asset: AssetRecord }>>([]);
  useEffect(() => {
    if (!event?.references?.length) return setItems([]);
    void Promise.all(event.references.map(async (reference) => ({
      reference,
      asset: await getAsset(reference.assetId)
    }))).then((loaded) => setItems(loaded.filter(
      (item): item is { reference: NonNullable<GenerationEvent["references"]>[number]; asset: AssetRecord } => Boolean(item.asset)
    )));
  }, [event?.id]);
  if (!items.length) return null;
  const presented = presentResultReferences(items.map(({ reference }) => ({
    assetId: reference.assetId,
    role: reference.role,
    subjectName: reference.subjectAsset?.name
  })));
  return <div className="result-context" aria-label="本次创作使用的参考">
    {presented.map(({ assetId, role, label }, index) => {
      const asset = items.find((item) => item.asset.id === assetId)?.asset;
      if (!asset) return null;
      return <span key={`${role}-${assetId}-${index}`}>
        <ReferenceThumb asset={asset} alt={label} />
        <small>{label}</small>
      </span>;
    })}
    <b>→</b><span className="result-context-output"><Check size={15} /><small>当前作品</small></span>
  </div>;
}

function ResultView({
  assets, events, project, dnaHistory, task, onEdit, onRegenerate, onCreateSet, onBack,
  onBackToSet, onDomainChange, onExport, onRestoreDNA, onCommitDNA,
  qualityReport, qualityReportAssetId, qualityChecking, onCheckQuality, onTargetedRetry, onSelectFinal,
  onRename, onDelete, focusAssetId
}: {
  assets: AssetRecord[];
  events: GenerationEvent[];
  project: ProjectRecord;
  dnaHistory: VisualDNARevision[];
  task?: TaskRecord;
  onEdit: (asset: AssetRecord, event?: GenerationEvent) => void;
  onRegenerate: (asset: AssetRecord, event?: GenerationEvent) => void;
  onCreateSet: () => void;
  onBack: () => void;
  onBackToSet?: () => void;
  onDomainChange: (domain: Domain) => void;
  onExport: (asset: AssetRecord) => void | Promise<void>;
  onRestoreDNA: (record: VisualDNARevision) => void | Promise<void>;
  onCommitDNA: (dna: VisualDNA) => void | Promise<void>;
  qualityReport?: SetQualityReport;
  qualityReportAssetId?: string;
  qualityChecking: boolean;
  onCheckQuality?: (asset: AssetRecord) => void;
  onTargetedRetry: (asset: AssetRecord, event: GenerationEvent | undefined, issue: SetQualityIssue) => void;
  onSelectFinal: (asset: AssetRecord) => void;
  onRename: (title: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  focusAssetId?: string;
}) {
  const [selected, setSelected] = useState(() => {
    const focusedIndex = focusAssetId ? assets.findIndex((item) => item.id === focusAssetId) : -1;
    return focusedIndex >= 0 ? focusedIndex : Math.max(0, assets.length - 1);
  });
  const previousAssetIds = useRef(assets.map((item) => item.id));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusedHeadingOnce = useRef(false);
  const asset = assets[selected];
  const finalAsset = resolveProjectFinalAsset(project, assets);
  const event = asset ? events.find((item) => item.outputAssetId === asset.id) : undefined;
  const criticCompleted = Boolean(qualityReport && qualityReportAssetId === asset?.id);
  const currentQualityIssues = criticCompleted
    ? qualityReport!.issues.filter((issue) => issue.itemIds.includes(asset?.id ?? ""))
    : [];
  const finalSelectionAction = presentFinalSelectionAction(criticCompleted, currentQualityIssues.length > 0);
  const url = useObjectUrl(asset?.blob);
  useEffect(() => {
    if (!asset || focusedHeadingOnce.current) return;
    focusedHeadingOnce.current = true;
    headingRef.current?.focus();
  }, [Boolean(asset)]);
  useEffect(() => {
    if (!focusAssetId) return;
    const focusedIndex = assets.findIndex((item) => item.id === focusAssetId);
    if (focusedIndex >= 0) setSelected(focusedIndex);
  }, [focusAssetId, assets.map((item) => item.id).join("|")]);
  useEffect(() => {
    if (focusAssetId) {
      previousAssetIds.current = assets.map((item) => item.id);
      return;
    }
    const addedIndex = assets.findIndex((item) => !previousAssetIds.current.includes(item.id));
    setSelected(addedIndex >= 0 ? addedIndex : Math.max(0, assets.length - 1));
    previousAssetIds.current = assets.map((item) => item.id);
  }, [focusAssetId, assets.map((item) => item.id).join("|")]);
  if (!asset) return null;
  return (
    <section className="result" aria-labelledby="result-heading">
      <div className="detail-navigation">
        <button
          type="button"
          className="result-back text-button"
          aria-label={onBackToSet ? "返回整组" : "返回作品"}
          onClick={onBackToSet ?? onBack}
        >
          {onBackToSet ? "← 返回整组" : "← 返回作品"}
        </button>
      </div>
      <div className="result-project-heading">
        <div>
          <small>单张作品</small>
          <ProjectNameEditor project={project} onRename={onRename} className="result-project-title" />
        </div>
        <button type="button" className="icon-button danger-icon" aria-label="删除当前作品" title="删除作品" onClick={onDelete}>
          <Trash2 size={16} />
        </button>
      </div>
      <div className="section-heading">
        <h1 id="result-heading" ref={headingRef} tabIndex={-1}><Check size={17} aria-hidden="true" />生成完成</h1>
        <small role="status" aria-live="polite">{selected + 1} / {assets.length}</small>
      </div>
      <img className="result-image" src={url} alt={`VisualForge 生成结果 ${selected + 1}/${assets.length}`} />
      {assets.length > 1 && <div className="result-pager" aria-label="生成结果选择">
        {assets.map((item, index) => (
          <button
            type="button"
            aria-label={`查看结果 ${index + 1}`}
            aria-current={index === selected ? "true" : undefined}
            className={index === selected ? "active" : ""}
            key={item.id}
            onClick={() => setSelected(index)}
          ><ResultThumb asset={item} alt={`结果 ${index + 1}`} /></button>
        ))}
      </div>}
      <section className="single-review" aria-label="作品评审与最终选择">
        <div>
          <strong>{project.finalSelection?.assetId === asset.id ? "已由你选定为最终版本" : "比较后选定这一版"}</strong>
          <p>AI 检查只会标出问题，是否生成修复版由你决定。</p>
        </div>
        {onCheckQuality && (
          <button type="button" onClick={() => onCheckQuality(asset)} disabled={qualityChecking}>
            {qualityChecking ? "正在检查…" : criticCompleted ? "重新检查当前作品" : "先检查当前作品"}
          </button>
        )}
        {project.finalSelection?.assetId !== asset.id && (
          <button type="button" className="primary" onClick={() => {
            if (finalSelectionAction.requiresConfirmation && !confirm(
              currentQualityIssues.length
                ? `AI 检查仍发现 ${currentQualityIssues.length} 个问题。确定仍选为最终版本吗？`
                : "当前作品还没有完成 AI 检查。确定跳过检查并选为最终版本吗？"
            )) return;
            onSelectFinal(asset);
          }}>{finalSelectionAction.label}</button>
        )}
        {qualityReport && qualityReportAssetId === asset.id && (
          <div className="single-review-report" role="status">
            <strong>AI 建议</strong>
            <p>{qualityReport.summary}</p>
            {qualityReport.issues.map((issue, index) => (
              <article key={`${issue.type}-${index}`}>
                <b>{issue.message}</b>
                {issue.impact && <p>为什么影响作品：{issue.impact}</p>}
                <p>重试时强化：{issue.retryFocus ?? issue.suggestion ?? "针对当前问题调整"}</p>
                {!!issue.preserve?.length && <p>必须保持：{issue.preserve.join("；")}</p>}
                {issue.itemIds.includes(asset.id) && (
                  <button type="button" onClick={() => onTargetedRetry(asset, event, issue)}>重新优化这一版</button>
                )}
              </article>
            ))}
            {!qualityReport.issues.length && <p>当前没有发现需要定向重试的问题。</p>}
          </div>
        )}
      </section>
      <div className="result-actions" aria-label="其他操作">
        <button type="button" onClick={() => onEdit(asset, event)}>调整这张作品</button>
        <button type="button" onClick={() => onRegenerate(asset, event)}>再生成一个版本</button>
        <button type="button" className={finalAsset ? "primary" : undefined} onClick={() => void onExport(finalAsset ?? asset)}>
          <ArrowDownToLine size={15} aria-hidden="true" />{finalAsset ? "导出最终作品" : "导出当前候选"}
        </button>
        <button type="button" className="set-entry-action" onClick={onCreateSet}>
          {project.domainProfile?.domain === "portrait" && project.selectedSubjectAssetId
            ? "生成写真套图"
            : project.domainProfile?.domain === "product"
              ? "生成广告套图"
              : "生成一套"}
        </button>
      </div>
      <ResultContext event={event} />
      {task?.status === "COMPLETED" && <p className="task-complete"><Check size={13} /><span>作品与创作记录已保存在本机</span></p>}
      <p className="result-caption">已按当前参考图的方法生成<br /><strong>{project.visualDNA?.style.keywords.join(" · ")}</strong></p>
      <details className="result-section">
        <summary><span>参考图与创作记录</span><small>{event ? "已保存在本机" : "早期记录不完整"}</small><ChevronDown size={15} /></summary>
        <ProvenancePanel event={event} />
      </details>
      {project.visualDNA && <details className="result-section">
        <summary><span>参考图方法（专业）</span><small>可精细调整</small><ChevronDown size={15} /></summary>
        <DomainHint profile={project.domainProfile} expanded onChange={onDomainChange} />
        <VisualDNAEditor dna={project.visualDNA} domain={project.domainProfile?.domain} onCommit={onCommitDNA} />
      </details>}
      <details className="result-section">
        <summary><span>修改历史</span><small>{dnaHistory.length} 个版本</small><ChevronDown size={15} /></summary>
        {project.visualDNA && (
          <VisualDNAHistory
            records={dnaHistory}
            currentRevision={project.visualDNA.revision}
            onRestore={onRestoreDNA}
          />
        )}
      </details>
      <details className="result-section">
        <summary><span>我的创作偏好</span><small>由你决定是否使用</small><ChevronDown size={15} /></summary>
        <p className="result-preference">
          {event?.prompt.includes("用户已确认的视觉偏好")
            ? "本次生成应用了你确认的偏好建议。"
            : "本次生成未自动应用视觉偏好。"}
        </p>
      </details>
    </section>
  );
}

const subjectConstraints: Record<SubjectAssetType, string[]> = {
  person: [
    "以人物原始照片为最高可信来源，不得被风格参考图中的人物身份覆盖",
    "保持脸型、眼睛、眉形、鼻子、嘴唇和五官相对位置",
    "保持年龄感、发型、发际线和稳定识别特征"
  ],
  product: [
    "必须保持商品完整外形、长宽厚比例、轮廓和朝向关系",
    "必须保持按钮、接口、瓶口、瓶盖、开合件和组件的数量、位置与形状",
    "必须保持主材质、透明度、表面处理、反射方式和主体颜色",
    "Logo 和可读文字只在模型能力允许时保持，不得用错误品牌替代"
  ],
  object: ["保持物体外形、结构、材质和关键特征"],
  character: ["保持角色轮廓、面部特征、服装标识和主要设定"],
  pet: ["保持宠物品种特征、毛色、脸部花纹和体型"]
};

function localQualityReport(images: AssetRecord[]): SubjectQualityReport {
  const unconfirmed = {
    status: "unconfirmed" as const,
    message: "无法确认",
    suggestion: null,
    canContinue: true
  };
  const unusable = images.filter((image) => image.width < 256 || image.height < 256);
  const allUnusable = unusable.length === images.length;
  return {
    schemaVersion: "1.0.0",
    checkedAt: Date.now(),
    model: "local-structure-check",
    overall: allUnusable ? "blocked" : "warning",
    blockingReasons: allUnusable ? ["所有照片分辨率都过低，无法作为可用人物参考。"] : [],
    sameIdentity: {
      ...unconfirmed,
      suggestion: images.length > 1 ? "连接 Codex 后可检查多张照片是否为同一个人。" : null
    },
    images: images.map((image) => ({
      assetId: image.id,
      checks: {
        faceDetected: { ...unconfirmed, suggestion: "连接 Codex 后可检查是否检测到人脸。" },
        multiplePeople: { ...unconfirmed, suggestion: "请优先使用只有一个人的照片。" },
        resolution: image.width < 256 || image.height < 256
          ? { status: "fail", message: `分辨率过低（${image.width} × ${image.height}）`, suggestion: "请换用更清晰的照片。", canContinue: !allUnusable }
          : image.width < 512 || image.height < 512
            ? { status: "warning", message: `分辨率偏低（${image.width} × ${image.height}）`, suggestion: "建议换用至少 512px 的清晰照片。", canContinue: true }
            : { status: "pass", message: "分辨率可用", suggestion: null, canContinue: true },
        underexposed: unconfirmed,
        overexposed: unconfirmed,
        facialOcclusion: unconfirmed,
        extremeProfile: unconfirmed,
        frontalInformation: { ...unconfirmed, suggestion: "建议至少保留一张清晰正脸照片。" }
      }
    }))
  };
}

export function App() {
  const forceMock = import.meta.env.VITE_VISUALFORGE_ENABLE_MOCK === "1"
    && new URLSearchParams(location.search).has("mock");
  const [route, setRoute] = useState<Route>("create");
  const [mode, setMode] = useState<Mode>("direct");
  const [refs, setRefs] = useState<Partial<Record<AssetRole, AssetRecord>>>({});
  const [instruction, setInstruction] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("3:4");
  const [count, setCount] = useState<1 | 2 | 4>(1);
  const [creationForm, setCreationForm] = useState<"single" | "set">("single");
  const [requestedSetCount, setRequestedSetCount] = useState<2 | 3 | 4 | 6 | 9 | 12>(4);
  const [deliveryMode, setDeliveryMode] = useState<"independent" | "grid" | "both">("both");
  const [detectedGrid, setDetectedGrid] = useState<GridLayout | null>(null);
  const [gridCreationPrepared, setGridCreationPrepared] = useState(false);
  const [gridPlanningProgress, setGridPlanningProgress] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [dna, setDna] = useState<VisualDNA>();
  const [domainProfile, setDomainProfile] = useState<DomainProfile>();
  const [currentProject, setCurrentProject] = useState<ProjectRecord>();
  const [outputs, setOutputs] = useState<AssetRecord[]>([]);
  const [resultFocusAssetId, setResultFocusAssetId] = useState<string>();
  const [generationEvents, setGenerationEvents] = useState<GenerationEvent[]>([]);
  const [dnaHistory, setDnaHistory] = useState<VisualDNARevision[]>([]);
  const [preferenceSummaries, setPreferenceSummaries] = useState<UserPreferenceSummary[]>([]);
  const [preferenceEvents, setPreferenceEvents] = useState<PreferenceEvent[]>([]);
  const [pendingPreferenceGeneration, setPendingPreferenceGeneration] = useState<{
    project: ProjectRecord;
    dna: VisualDNA;
    parentGenerationId: string | null;
    summaries: UserPreferenceSummary[];
    promptOverride?: string;
    selectGeneratedAsFinal: boolean;
  }>();
  const [pendingParentGenerationId, setPendingParentGenerationId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [creationSets, setCreationSets] = useState<CreationSet[]>([]);
  const [activeCreationSet, setActiveCreationSet] = useState<CreationSet>();
  const [setOutputAssets, setSetOutputAssets] = useState<Map<string, AssetRecord>>(new Map());
  const [returnToCreationSetId, setReturnToCreationSetId] = useState<string>();
  const [settingsValue, setSettingsValue] = useState<AppSettings>(defaultSettings);
  const [diagnostics, setDiagnostics] = useState<Diagnostics>({ state: "host-missing", label: "需要连接" });
  const [error, setError] = useState("");
  const [errorContext, setErrorContext] = useState<"capture" | "image" | "analysis" | "generation" | "connection" | "cancel" | "generic">("generic");
  const [captureErrorMethod, setCaptureErrorMethod] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [libraryKind, setLibraryKind] = useState<LibraryKind>("works");
  const [libraryDetailOpen, setLibraryDetailOpen] = useState(false);
  const [subjectAssets, setSubjectAssets] = useState<SubjectAsset[]>([]);
  const [subjectImages, setSubjectImages] = useState<Map<string, AssetRecord>>(new Map());
  const [selectedSubject, setSelectedSubject] = useState<SubjectAsset>();
  const [autoSelectedSubjectName, setAutoSelectedSubjectName] = useState("");
  const [subjectPickerOpen, setSubjectPickerOpen] = useState(false);
  const [subjectReminderOpen, setSubjectReminderOpen] = useState(false);
  const [subjectEditor, setSubjectEditor] = useState<{ asset?: SubjectAsset; initialType: SubjectAssetType }>();
  const [confirmedReferencePrompt, setConfirmedReferencePrompt] = useState("");
  const [promptConfirmed, setPromptConfirmed] = useState(false);
  const [signatureStyleSelection, setSignatureStyleSelection] = useState<SignatureStyleSelection | null>(null);
  const [finalPromptCopied, setFinalPromptCopied] = useState(false);
  const [finalPromptCopyError, setFinalPromptCopyError] = useState(false);
  const [identityBoardBusy, setIdentityBoardBusy] = useState(false);
  const [qualityCheckingSetId, setQualityCheckingSetId] = useState<string>();
  const [singleQualityReport, setSingleQualityReport] = useState<SetQualityReport>();
  const [singleQualityAssetId, setSingleQualityAssetId] = useState<string>();
  const [singleQualityChecking, setSingleQualityChecking] = useState(false);
  const [toast, setToast] = useState("");
  const [uninstallingHost, setUninstallingHost] = useState(false);
  const [webCaptureStatus, setWebCaptureStatus] = useState("");
  const [webCaptureBusy, setWebCaptureBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [hydrationError, setHydrationError] = useState<string>();
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [integrityIssues, setIntegrityIssues] = useState<DataIntegrityIssue[]>([]);
  const [diagnosticsChecked, setDiagnosticsChecked] = useState(forceMock);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingAutoAnalysis, setPendingAutoAnalysis] = useState<{ asset: AssetRecord; intent: "use-style" | "analyze" }>();
  const [interruptedTasks, setInterruptedTasks] = useState<TaskRecord[]>([]);
  const [dismissedRetryTaskIds, setDismissedRetryTaskIds] = useState<Set<string>>(new Set());
  const [lastRetryableTask, setLastRetryableTask] = useState<TaskRecord>();
  const [activeTask, setActiveTask] = useState<TaskRecord>();
  const [taskNotifications, setTaskNotifications] = useState<TaskNotification[]>([]);
  const [deferredNotificationTokens, setDeferredNotificationTokens] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [capturePreview, setCapturePreview] = useState<CapturePreview>();
  const cancelRef = useRef(false);
  const setCancelRef = useRef(false);
  const singleRunInFlightRef = useRef(false);
  const setRunInFlightRef = useRef(false);
  const activeSetTaskIdRef = useRef<string | undefined>(undefined);
  const afterAnalysisRef = useRef<"single" | "set" | "none">("none");
  const pendingGridLayoutRef = useRef<GridLayout | null>(null);
  const activeTaskRef = useRef<TaskRecord | undefined>(undefined);
  const errorStateRef = useRef<HTMLElement | null>(null);
  const subjectReminderReturnFocusRef = useRef<HTMLElement | null>(null);
  const subjectEditorReturnFocusRef = useRef<HTMLElement | null>(null);
  const diagnoseStartedRef = useRef(false);
  const routeRef = useRef<Route>(route);
  const stageRef = useRef<Stage>(stage);
  const currentProjectIdRef = useRef<string | undefined>(currentProject?.id);
  const activeCreationSetIdRef = useRef<string | undefined>(activeCreationSet?.id);

  const reference = refs.style_layout;
  const placeholder = selectedSubject
    ? subjectTypePresentation[selectedSubject.type].instructionPlaceholder
    : "可以留空；也可以说一句你想改变的地方。";
  const creationInputReady = mode !== "analyze" || Boolean(dna && (promptConfirmed || gridCreationPrepared));

  const refreshProjects = async () => {
    const records = await listProjects();
    setProjects(records);
    return records;
  };
  const persistProjectUpdate = async (
    id: string,
    transform: (current: ProjectRecord) => ProjectRecord
  ) => {
    const updated = await updateProject(id, transform);
    if (!updated) throw new Error("作品已在另一窗口删除。");
    if (currentProjectIdRef.current === id) setCurrentProject(updated);
    return updated;
  };
  const refreshCreationSets = async () => {
    const records = await listCreationSets();
    setCreationSets(records);
    return records;
  };
  const loadCreationSetOutputs = async (creationSet: CreationSet, reveal = true) => {
    const ids = [...new Set([
      ...creationSet.sharedReferenceSnapshots.map((reference) => reference.assetId),
      ...creationSet.subjectAssetSnapshots.flatMap((snapshot) =>
        snapshot.images.map((image) => image.assetId)),
      ...creationSet.planItems.flatMap((item) => [
        ...(item.gridCellReference ? [item.gridCellReference.assetId] : []),
        ...(item.outputAssetId ? [item.outputAssetId] : []),
        ...item.outputCandidates.map((candidate) => candidate.outputAssetId)
      ])
    ])];
    const loaded = await Promise.all(ids.map(async (id) => [id, await getAsset(id)] as const));
    const assets = new Map(loaded.filter((entry): entry is readonly [string, AssetRecord] => Boolean(entry[1])));
    if (reveal) setSetOutputAssets(assets);
    return assets;
  };
  const refreshSubjectAssets = async () => {
    const records = await listSubjectAssets();
    const ids = [...new Set(records.flatMap((record) => [
      ...record.imageIds,
      ...(record.identityBoard ? [record.identityBoard.assetId] : [])
    ]))];
    const loaded = await Promise.all(ids.map(async (id) => [id, await getAsset(id)] as const));
    setSubjectAssets(records);
    setSubjectImages(new Map(loaded.filter((entry): entry is readonly [string, AssetRecord] => Boolean(entry[1]))));
    return records;
  };
  const refreshPreferenceSummaries = async () => {
    const [events, dismissals] = await Promise.all([
      listPreferenceEvents(),
      listPreferenceSummaryDismissals()
    ]);
    setPreferenceEvents(events);
    setPreferenceSummaries(filterDismissedPreferenceSummaries(
      aggregatePreferenceEvents(events),
      dismissals
    ));
  };

  useEffect(() => {
    routeRef.current = route;
    stageRef.current = stage;
    currentProjectIdRef.current = currentProject?.id;
    activeCreationSetIdRef.current = activeCreationSet?.id;
  }, [route, stage, currentProject?.id, activeCreationSet?.id]);

  useEffect(() => {
    if (stage !== "error") return;
    window.requestAnimationFrame(() => errorStateRef.current?.focus());
  }, [stage, error]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setHydrationError(undefined);
        setIntegrityIssues([]);
        let saved = await getSettings();
        const migration = await chrome.storage.local.get("visualForgeDefaultRatioV2");
        if (!migration.visualForgeDefaultRatioV2 && saved.defaultAspectRatio === "4:3") {
          saved = { ...saved, defaultAspectRatio: "3:4" };
          await saveSettings(saved);
        }
        await chrome.storage.local.set({
          visualForgeDefaultRatioV2: true,
          hoverCaptureEnabled: saved.hoverCaptureEnabled
        });
        if (cancelled) return;
        setSettingsValue(saved);
        setRoute(saved.lastRoute);
        setRatio(saved.defaultAspectRatio);
        setCount(saved.defaultCount);
        const notificationStore = await chrome.storage.local.get([
          TASK_NOTIFICATIONS_KEY,
          DISMISSED_RETRY_TASKS_KEY
        ]);
        setTaskNotifications(Array.isArray(notificationStore[TASK_NOTIFICATIONS_KEY])
          ? notificationStore[TASK_NOTIFICATIONS_KEY] as TaskNotification[] : []);
        const dismissedRetryIds = new Set<string>(
          Array.isArray(notificationStore[DISMISSED_RETRY_TASKS_KEY])
            ? notificationStore[DISMISSED_RETRY_TASKS_KEY] as string[]
            : []
        );
        setDismissedRetryTaskIds(dismissedRetryIds);
        const integrity = await inspectStartupRecordIntegrity();
        if (cancelled) return;
        setIntegrityIssues(integrity.issues);
        const recovered = await recoverInterruptedTaskRecords(await readHeldVisualForgeLocks());
        const retryableTasks = await listRetryableTaskRecords();
        setInterruptedTasks(retryableTasks.filter((task) => !dismissedRetryIds.has(task.taskId)));
        if (recovered.length) setToast(`${recovered.length} 个任务异常中断`);
        const [, , , sets] = await Promise.all([
          refreshProjects(), refreshPreferenceSummaries(), refreshSubjectAssets(), reconcileCreationSets()
        ]);
        if (cancelled) return;
        setCreationSets(sets);
        const interruptedSet = sets.find((set) => set.status === "INTERRUPTED");
        if (interruptedSet) {
          setRoute("create");
          setActiveCreationSet(interruptedSet);
          await loadCreationSetOutputs(interruptedSet);
        } else if (retryableTasks.length) {
          setRoute("create");
        }
      } catch (cause) {
        if (!cancelled) {
          setHydrationError(cause instanceof Error ? cause.message : "本地记录暂时无法读取");
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrationAttempt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        const recovered = await recoverInterruptedTaskRecords(await readHeldVisualForgeLocks());
        if (!recovered.length) return;
          const stored = await chrome.storage.local.get(DISMISSED_RETRY_TASKS_KEY);
          const dismissedIds = new Set<string>(Array.isArray(stored[DISMISSED_RETRY_TASKS_KEY])
            ? stored[DISMISSED_RETRY_TASKS_KEY] as string[] : []);
          setInterruptedTasks((await listRetryableTaskRecords())
            .filter((task) => !dismissedIds.has(task.taskId)));
        setCreationSets(await reconcileCreationSets());
        setToast(`${recovered.length} 个失去活动窗口的任务已恢复，可继续重试`);
      })().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const retryHydration = () => {
    setHydrated(false);
    setHydrationError(undefined);
    setHydrationAttempt((attempt) => attempt + 1);
  };

  const downloadIntegrityDiagnostic = () => {
    const diagnostic = createIntegrityDiagnostic(integrityIssues, {
      appVersion: chrome.runtime.getManifest().version
    });
    const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `visualforge-integrity-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  useEffect(() => {
    if (hydrated && !forceMock && !diagnoseStartedRef.current) {
      diagnoseStartedRef.current = true;
      void diagnoseNative().then(setDiagnostics).finally(() => setDiagnosticsChecked(true));
    }
  }, [hydrated]);

  useEffect(() => {
    const consumePending = async () => {
      const stored = await chrome.storage.local.get(["pendingWebImage", "pendingCapture"]);
      const pending = stored.pendingCapture ?? stored.pendingWebImage;
      if (!pending) return;
      try {
        if (pending.error) {
          setStage("error");
          setErrorContext("capture");
          setCaptureErrorMethod(pending.source?.captureMethod);
          setError(pending.error);
        } else if (pending.dataUrl) {
          const blob = pending.rect
            ? await cropScreenshot(pending.dataUrl, pending.rect)
            : await (await fetch(pending.dataUrl)).blob();
          if (pending === stored.pendingCapture) {
            setCapturePreview({ blob, source: pending.source });
          } else {
            const asset = await addImage(blob, "style_layout", pending.source);
            if (asset && pending.intent === "save") {
              const now = Date.now();
              await saveProject({
                id: crypto.randomUUID(),
                title: pending.source?.pageTitle?.trim().slice(0, 60) || "网页灵感",
                mode: "analyze",
                referenceAssetIds: [asset.id],
                referenceSnapshots: [{
                  assetId: asset.id,
                  hash: asset.hash,
                  mimeType: asset.mimeType,
                  role: "style",
                  sourceKind: "original",
                  subjectAsset: null
                }],
                outputAssetIds: [],
                userInstruction: "",
                aspectRatio: "3:4",
                count: 1,
                provider: "codex",
                favorite: true,
                createdAt: now,
                updatedAt: now
              });
              await refreshProjects();
              setToast("灵感已保存到本地作品");
            } else if (asset) {
              const intent = pending.intent === "analyze" ? "analyze" : "use-style";
              setMode("analyze");
              setPendingAutoAnalysis({ asset, intent });
            }
            if (pending.fallbackMessage) setToast(pending.fallbackMessage);
          }
          await navigate("create");
        } else {
          setStage("error");
          setErrorContext("capture");
          setCaptureErrorMethod(pending.source?.captureMethod);
          setError("暂时无法捕获这张图片，请使用“框选截图”。");
        }
      } finally {
        await chrome.storage.local.remove(["pendingWebImage", "pendingCapture"]);
      }
    };
    const listener = (message: unknown) => {
      const typed = message as { type?: string };
      if (typed.type === "web-image.pending" || typed.type === "capture.ready") void consumePending();
    };
    chrome.runtime.onMessage.addListener(listener);
    void consumePending();
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (!hydrated || !diagnosticsChecked || !pendingAutoAnalysis || activeTaskRef.current) return;
    const pending = pendingAutoAnalysis;
    setPendingAutoAnalysis(undefined);
    afterAnalysisRef.current = "none";
    void runAnalyze(null, undefined, pending.asset);
  }, [hydrated, diagnosticsChecked, pendingAutoAnalysis]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? []).find((item) => item.type.startsWith("image/"));
      if (file && route === "create") void addImage(file, "style_layout", "paste");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  useEffect(() => {
    if (!toast || toast === "已移除作品 · 点击撤销") return;
    const timer = window.setTimeout(() => setToast(""), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!activeTask || !["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(activeTask.status)) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = activeTask.startedAt ?? activeTask.heartbeat;
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [activeTask?.taskId, activeTask?.status, activeTask?.startedAt]);

  async function navigate(next: Route) {
    routeRef.current = next;
    setRoute(next);
    const currentSettings = await getSettings();
    const lastRoute = next === "settings" ? currentSettings.lastRoute : next;
    const nextSettings = { ...currentSettings, lastRoute };
    setSettingsValue(nextSettings);
    await saveSettings(nextSettings);
    if (next === "library") await Promise.all([refreshProjects(), refreshSubjectAssets(), refreshCreationSets()]);
  }

  function openSubjectEditor(next: { asset?: SubjectAsset; initialType: SubjectAssetType }) {
    subjectEditorReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setSubjectEditor(next);
  }

  function closeSubjectEditor() {
    setSubjectEditor(undefined);
    window.requestAnimationFrame(() => subjectEditorReturnFocusRef.current?.focus());
  }

  async function persistSettingsChange(
    next: AppSettings,
    effect?: (value: AppSettings) => Promise<void>
  ) {
    const previous = settingsValue;
    setSettingsValue(next);
    try {
      await saveSettings(next);
      await effect?.(next);
    } catch {
      setSettingsValue(previous);
      await saveSettings(previous).catch(() => undefined);
      await effect?.(previous).catch(() => undefined);
      setToast("设置没有保存成功，已恢复原值，请重试");
    }
  }

  function adjustGridStop(axis: "columnStops" | "rowStops", index: number, value: number) {
    if (!detectedGrid) return;
    const stops = [...detectedGrid[axis]];
    const lower = index === 0 ? 0.08 : stops[index - 1]! + 0.08;
    const upper = index === stops.length - 1 ? 0.92 : stops[index + 1]! - 0.08;
    stops[index] = Math.min(upper, Math.max(lower, value));
    const layout = { ...detectedGrid, [axis]: stops, confidence: 1, source: "manual" as const };
    setDetectedGrid(layout);
    pendingGridLayoutRef.current = layout;
  }

  function applyDetectedGridLayout(layout: GridLayout) {
    const next = { ...layout, confidence: 1, source: "manual" as const };
    setDetectedGrid(next);
    pendingGridLayoutRef.current = next;
  }

  function focusSubjectStep() {
    window.requestAnimationFrame(() => {
      const target = document.getElementById("subject-step-title");
      target?.focus();
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function prepareDetectedGridCreation(layout: GridLayout) {
    setCreationForm("set");
    setRequestedSetCount(layout.count);
    setDeliveryMode("both");
    pendingGridLayoutRef.current = layout;
    setGridCreationPrepared(true);
    setSubjectReminderOpen(false);
    focusSubjectStep();
  }

  async function enableCurrentSiteCapture() {
    setWebCaptureBusy(true);
    if (!settingsValue.hoverCaptureEnabled) {
      const next = { ...settingsValue, hoverCaptureEnabled: true };
      setSettingsValue(next);
      await Promise.all([
        saveSettings(next),
        chrome.storage.local.set({ hoverCaptureEnabled: true })
      ]);
      await applyHoverSettingToOpenTabs(chrome, true);
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const { styleforgeActiveTab } = await chrome.storage.session.get("styleforgeActiveTab") as {
      styleforgeActiveTab?: { id: number | null; url: string | null };
    };
    if (tab?.id && !tab.url && styleforgeActiveTab?.id !== tab.id) {
      setWebCaptureBusy(false);
      setWebCaptureStatus("没有找到当前网页。请回到目标网页，再点击浏览器工具栏中的 VisualForge。");
      return;
    }
    const activeContext = tab?.id && tab.url
      ? { id: tab.id, url: tab.url }
      : styleforgeActiveTab;
    const activeUrl = activeContext?.url;
    const activeTabId = activeContext?.id;
    if (!activeUrl || !sitePermissionOriginForUrl(activeUrl)) {
      setWebCaptureBusy(false);
      setWebCaptureStatus("当前页面不支持网页按钮。请回到 HTTPS 网页后再试，或改用上传参考图。");
      return;
    }
    if (!activeTabId) {
      setWebCaptureBusy(false);
      setWebCaptureStatus("没有找到当前网页。请回到目标网页，再点击浏览器工具栏中的 VisualForge。");
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        files: ["content-scripts/hover.js"]
      });
      const [probe] = await chrome.scripting.executeScript({
        target: { tabId: activeTabId },
        func: () => Boolean(document.getElementById("styleforge-hover-root"))
      });
      if (!probe?.result) throw new Error("网页按钮没有完成注入");
    } catch (error) {
      console.error("VisualForge Hover 注入失败", error);
      setWebCaptureBusy(false);
      setWebCaptureStatus("Chrome 当前限制 VisualForge 在这个页面运行。请检查扩展的网站访问设置并刷新，或改用上传参考图。");
      return;
    }
    setWebCaptureBusy(false);
    setWebCaptureStatus("当前页面的网页按钮已准备好。回到网页，点击图片上的 VisualForge 按钮。");
    setToast("已检查：回到网页，点击图片上的“VisualForge”按钮");
  }

  function pasteReferenceFromClipboard() {
    window.focus();
    setWebCaptureStatus(`复制图片后，在侧边栏按 ${pasteShortcutLabel()}；VisualForge 只接收这次粘贴的图片。`);
  }

  async function requestAreaCapture() {
    const response = await chrome.runtime.sendMessage({ type: "capture.area.request" }).catch(() => null);
    if (!response?.ok) {
      setWebCaptureStatus("当前页面暂时不能框选。请回到普通网页后重试，或改用上传参考图。");
      setToast("当前页面不能框选，请回到普通网页后重试");
    }
  }

  function createSubjectSnapshot(subject: SubjectAsset): SubjectAssetSnapshot {
    const orderedIds = subject.type === "person"
      ? orderPersonImageIdsByEvidence(subject)
      : [subject.primaryImageId, ...subject.imageIds.filter((id) => id !== subject.primaryImageId)];
    const images = orderedIds.map((id) => subjectImages.get(id)).filter((image): image is AssetRecord => Boolean(image));
    return {
      subjectAssetId: subject.id,
      name: subject.name,
      type: subject.type,
      primaryImageId: subject.primaryImageId,
      imagePurposes: subject.imagePurposes,
      images: images.map((image) => ({
        assetId: image.id,
        hash: image.hash,
        mimeType: image.mimeType,
        width: image.width,
        height: image.height
      })),
      constraints: subject.type === "product" && subject.productIdentityLock?.status === "confirmed"
        ? subject.productIdentityLock.invariants
        : subject.type === "person"
          ? [
              ...subjectConstraints.person,
              ...(Object.values(subject.imagePurposes ?? {}).includes("full_body")
                ? ["全身参考负责身高感、肩胯关系、体态、腿部比例、完整双脚与地面接触"]
                : ["当前只有面部参考，只锁定脸型、五官相对位置、年龄感与发型，不推断身材和腿部比例"])
            ]
          : subjectConstraints[subject.type],
      identityBoard: subject.identityBoard ?? null,
      productIdentityLock: subject.productIdentityLock ?? null
    };
  }

  function currentReferenceSnapshots(
    source: AssetRecord,
    subject = selectedSubject,
    sourceRole: GenerationReferenceSnapshot["role"] = "style_layout"
  ): GenerationReferenceSnapshot[] {
    const snapshots: GenerationReferenceSnapshot[] = [
      { assetId: source.id, hash: source.hash, mimeType: source.mimeType, role: sourceRole, sourceKind: "original", subjectAsset: null }
    ];
    if (!subject) return snapshots;
    const subjectSnapshot = createSubjectSnapshot(subject);
    const originalImages = subjectSnapshot.images;
    const references: GenerationReferenceSnapshot[] = [
      ...snapshots,
      ...originalImages.map((image) => ({
        assetId: image.assetId,
        hash: image.hash,
        mimeType: image.mimeType,
        role: subject.type === "person" ? "identity" as const : "subject" as const,
        sourceKind: "original" as const,
        subjectAsset: subjectSnapshot
      }))
    ];
    // AI 基准图只供人工比对，不能回灌并覆盖用户上传的原始身份依据。
    return subject.type === "person"
      ? orderGenerationReferences(references, "portrait")
      : references;
  }

  async function chooseSubjectAsset(asset: SubjectAsset) {
    let selected = asset;
    if (asset.type === "product" && !asset.productIdentityLock) {
      const images = (await Promise.all(asset.imageIds.map(getAsset)))
        .filter((image): image is AssetRecord => Boolean(image));
      selected = await saveSubjectAsset({
        ...asset,
        productIdentityLock: {
          status: "draft",
          imageHashes: images.map((image) => image.hash),
          invariants: subjectConstraints.product,
          confirmedAt: null
        },
        updatedAt: Date.now()
      });
      await refreshSubjectAssets();
    }
    setSelectedSubject(selected);
    setSubjectReminderOpen(false);
    setAutoSelectedSubjectName("");
    setSubjectPickerOpen(false);
    const expectedDomain = {
      person: "portrait",
      product: "product",
      pet: "photography",
      character: "illustration",
      object: "product"
    }[selected.type] as Domain;
    const currentDomain = domainProfile ?? currentProject?.domainProfile;
    const alignedDomain = currentDomain?.domain !== expectedDomain
      ? overrideDomainProfile(currentDomain ?? createMigrationDomainProfile(), expectedDomain)
      : currentDomain;
    const retainedStyle = signatureStyleSelection &&
      !signatureStyleSelection.styleSnapshot.suitableDomains.includes(expectedDomain)
      ? null
      : signatureStyleSelection;
    if (retainedStyle !== signatureStyleSelection) {
      setSignatureStyleSelection(retainedStyle);
      setConfirmedReferencePrompt(referencePrompt);
    }
    if (alignedDomain) setDomainProfile(alignedDomain);
    if (currentProject) {
      await persistProjectUpdate(currentProject.id, (stored) => ({
        ...stored,
        selectedSubjectAssetId: selected.id,
        domainProfile: alignedDomain ?? stored.domainProfile,
        signatureStyleSelection: retainedStyle,
        compiledPrompt: retainedStyle === signatureStyleSelection
          ? stored.compiledPrompt : referencePrompt,
        updatedAt: Date.now()
      }));
    }
  }

  function requireConfirmedProductIdentityLock() {
    if (selectedSubject?.type !== "product" ||
        selectedSubject.productIdentityLock?.status === "confirmed") return true;
    openSubjectEditor({ asset: selectedSubject, initialType: "product" });
    setToast("请先确认商品身份锁，再开始生成");
    return false;
  }

  async function clearSubjectAsset() {
    setSelectedSubject(undefined);
    setAutoSelectedSubjectName("");
    if (!currentProject?.selectedSubjectAssetId) return;
    await persistProjectUpdate(currentProject.id, (stored) => ({
      ...stored,
      selectedSubjectAssetId: null,
      updatedAt: Date.now()
    }));
  }

  function promptReferences(references: GenerationReferenceSnapshot[]) {
    const imageIndex = new Map<string, number>();
    let nextIndex = 1;
    return references.map((reference) => {
      let index = imageIndex.get(reference.assetId);
      if (!index) {
        index = nextIndex++;
        imageIndex.set(reference.assetId, index);
      }
      return {
        index,
        role: reference.role,
        imagePurpose: reference.role === "identity"
          ? reference.subjectAsset?.imagePurposes?.[reference.assetId]
          : undefined,
        subjectType: reference.subjectAsset?.type,
        subjectName: reference.subjectAsset?.name,
        subjectConstraints: reference.subjectAsset?.constraints
      };
    });
  }

  function applyReferencesToDNA(
    visualDNA: VisualDNA,
    references: GenerationReferenceSnapshot[]
  ): VisualDNA {
    const hasIdentity = references.some((reference) => reference.role === "identity");
    const hasSubject = references.some((reference) => reference.role === "subject");
    return {
      ...visualDNA,
      locks: {
        ...visualDNA.locks,
        identity: hasIdentity ? "locked" : visualDNA.locks.identity,
        subject: hasSubject ? "locked" : visualDNA.locks.subject
      },
      references: references.flatMap((reference) => reference.role === "edit_base"
        ? []
        : [{
            assetId: reference.assetId,
            sourceImageHash: reference.hash,
            role: reference.role,
            influence: 1,
            notes: reference.subjectAsset
              ? `${reference.subjectAsset.name} · ${reference.subjectAsset.constraints.join("；")}`
              : null
          }])
    };
  }

  async function commitVisualDNA(next: VisualDNA) {
    if (!currentProject) return;
    const references = reference
      ? currentReferenceSnapshots(reference)
      : currentProject.referenceSnapshots ?? [];
    const referencedDNA = applyReferencesToDNA(next, references);
    setDna(referencedDNA);
    const compiledPrompt = compilePrompt({
      visualDNA: referencedDNA,
      domainProfile: currentProject.domainProfile,
      userInstruction: currentProject.userInstruction,
      aspectRatio: currentProject.aspectRatio,
      references: promptReferences(references)
    });
    const updated = {
      ...currentProject,
      visualDNA: referencedDNA,
      referenceSnapshots: references,
      compiledPrompt,
      updatedAt: Date.now()
    };
    const revision = createVisualDNARevision({
      id: crypto.randomUUID(),
      projectId: currentProject.id,
      dna: referencedDNA,
      previousDNA: currentProject.visualDNA ?? null,
      origin: "edit",
      createdAt: referencedDNA.updatedAt
    });
    const preferenceEvents = createPreferenceEvents({
      actionId: revision.id,
      projectId: currentProject.id,
      before: currentProject.visualDNA ?? next,
      after: referencedDNA,
      source: "editor",
      createdAt: referencedDNA.updatedAt
    });
    const savedProject = await saveProjectRevision(updated, revision, preferenceEvents);
    setCurrentProject(savedProject);
    setDnaHistory(await listVisualDNARevisions(currentProject.id));
    await refreshPreferenceSummaries();
  }

  async function restoreDNA(record: VisualDNARevision) {
    if (!currentProject?.visualDNA) return;
    const now = Date.now();
    const references = reference
      ? currentReferenceSnapshots(reference)
      : currentProject.referenceSnapshots ?? [];
    const restored = applyReferencesToDNA(
      restoreVisualDNARevision(currentProject.visualDNA, record.dna, now),
      references
    );
    const compiledPrompt = compilePrompt({
      visualDNA: restored,
      domainProfile: currentProject.domainProfile,
      userInstruction: currentProject.userInstruction,
      aspectRatio: currentProject.aspectRatio,
      references: promptReferences(references)
    });
    const updated = {
      ...currentProject,
      visualDNA: restored,
      referenceSnapshots: references,
      compiledPrompt,
      updatedAt: now
    };
    const revision = createVisualDNARevision({
      id: crypto.randomUUID(),
      projectId: currentProject.id,
      dna: restored,
      previousDNA: currentProject.visualDNA,
      origin: "restore",
      restoredFromRevision: record.revision,
      createdAt: now
    });
    const preferenceEvents = createPreferenceEvents({
      actionId: revision.id,
      projectId: currentProject.id,
      before: currentProject.visualDNA,
      after: restored,
      source: "restore",
      createdAt: now
    });
    const savedProject = await saveProjectRevision(updated, revision, preferenceEvents);
    setDna(restored);
    setCurrentProject(savedProject);
    setDnaHistory(await listVisualDNARevisions(currentProject.id));
    await refreshPreferenceSummaries();
    setToast(`已恢复为版本 ${restored.revision}，历史版本未覆盖`);
  }

  async function removePreferenceSummary(summary: UserPreferenceSummary) {
    await dismissPreferenceSummary(summary, Date.now());
    await refreshPreferenceSummaries();
    setToast("已删除总结，真实行为证据仍保留");
  }

  async function resetPreferenceSummaries() {
    if (!confirm("只清除你看到的偏好总结，不删除原始调整记录、参考图方法、作品或修改历史。确定继续吗？")) return;
    await dismissPreferenceSummaries(preferenceSummaries, Date.now());
    await refreshPreferenceSummaries();
    setToast("已清除全部偏好总结，真实行为证据仍保留");
  }

  async function addImage(
    file: Blob,
    role: AssetRole,
    source: AssetRecord["source"] | "upload" | "paste" | "web" | "capture" = "upload"
  ) {
    if (role === "style_layout" && activeTaskRef.current &&
      ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(activeTaskRef.current.status)) {
      setToast("当前创作仍在进行，请完成或取消后再更换参考图");
      return undefined;
    }
    setError("");
    setErrorContext("generic");
    try {
      const rawSource: AssetRecord["source"] = typeof source === "string" ? { type: source } : source;
      const savedSettings = await getSettings();
      const assetSource = savedSettings.saveSourceUrl
        ? rawSource
        : { ...rawSource, sourceUrl: undefined, pageUrl: undefined };
      const asset = await saveAsset(await normalizeImage(file, role, assetSource));
      setRefs((current) => ({ ...current, [role]: asset }));
      if (role === "style_layout") {
        const grid = await detectGridLayout(file).catch(() => null);
        setDetectedGrid(grid);
        pendingGridLayoutRef.current = grid;
        setGridCreationPrepared(false);
        setGridPlanningProgress(null);
        setMode("analyze");
        setDna(undefined);
        setDomainProfile(undefined);
        setSignatureStyleSelection(null);
        setConfirmedReferencePrompt("");
        setPromptConfirmed(false);
        setFinalPromptCopied(false);
        setFinalPromptCopyError(false);
        setActiveCreationSet(undefined);
        setOutputs([]);
        setDnaHistory([]);
        setPendingPreferenceGeneration(undefined);
        setCurrentProject(undefined);
        setStage("idle");
        setPendingAutoAnalysis({ asset, intent: "use-style" });
      }
      return asset;
    } catch (cause) {
      setStage("error");
      setErrorContext("image");
      setError(cause instanceof Error ? cause.message : "图片读取失败，请换一张图片重试。");
      return undefined;
    }
  }

  async function saveSubjectDraft(
    draft: SubjectAssetDraft,
    existing?: SubjectAsset
  ): Promise<{ saved: boolean; report: SubjectQualityReport | null }> {
    const role: AssetRole = draft.type === "person" ? "identity" : "subject";
    const candidates = await Promise.all(draft.photos.map((photo) => photo instanceof File
      ? normalizeImage(photo, role, { type: "upload" })
      : Promise.resolve(photo)));
    let images = candidates;
    const newIndexes = draft.photos.flatMap((photo, index) => photo instanceof File ? [index] : []);
    const savedNew = await saveAssets(newIndexes.map((index) => candidates[index]!));
    images = candidates.map((image, index) => {
      const savedIndex = newIndexes.indexOf(index);
      return savedIndex >= 0 ? savedNew[savedIndex]! : image;
    });
    const report = draft.type === "person" ? localQualityReport(images) : null;
    const now = Date.now();
    const imageIds = images.map((image) => image.id);
    const identityBoard = existing?.identityBoard &&
      existing.imageIds.length === imageIds.length &&
      existing.imageIds.every((id, index) => id === imageIds[index])
      ? existing.identityBoard
      : null;
    const imageHashes = images.map((image) => image.hash);
    const productIdentityLock = draft.type === "product"
      ? existing?.productIdentityLock &&
        existing.productIdentityLock.imageHashes.length === imageHashes.length &&
        existing.productIdentityLock.imageHashes.every((hash, index) => hash === imageHashes[index])
        ? existing.productIdentityLock
        : {
            status: "draft" as const,
            imageHashes,
            invariants: subjectConstraints.product,
            confirmedAt: null
          }
      : null;
    const saved = await saveSubjectAsset({
      schemaVersion: "1.0.0",
      id: existing?.id ?? crypto.randomUUID(),
      name: draft.name,
      type: draft.type,
      imageIds,
      primaryImageId: images[draft.primaryIndex]?.id ?? images[0]!.id,
      imagePurposes: draft.type === "person"
        ? Object.fromEntries(images.map((image, index) => [image.id, draft.photoPurposes[index] ?? "face"]))
        : undefined,
      qualityReport: report,
      identityBoard,
      productIdentityLock,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    });
    await refreshSubjectAssets();
    await chooseSubjectAsset(saved);
    setToast(!report || report.overall === "pass"
      ? `${subjectTypePresentation[saved.type].label}“${saved.name}”已保存`
      : `${subjectTypePresentation[saved.type].label}“${saved.name}”已保存；照片建议仅供参考`);
    if (draft.type === "person" && diagnostics.state === "connected") {
      const checkedImageIds = [...imageIds];
      void checkSubjectQualityNative(images.map((image) => image.blob), crypto.randomUUID())
        .then(async (raw) => {
          const current = await getSubjectAsset(saved.id);
          // 只在照片版本未变化时写回后台建议，避免覆盖用户随后完成的编辑。
          if (!current || current.imageIds.length !== checkedImageIds.length ||
            current.imageIds.some((id, index) => id !== checkedImageIds[index])) return;
          const qualityReport = {
            ...raw,
            images: raw.images.map((item, index) => ({
              ...item,
              assetId: checkedImageIds[index] ?? item.assetId
            }))
          };
          const updated = await saveSubjectAsset({
            ...current,
            qualityReport,
            updatedAt: Date.now()
          });
          await refreshSubjectAssets();
          setSelectedSubject((selected) => selected?.id === updated.id ? updated : selected);
          setSubjectEditor((editor) => editor?.asset?.id === updated.id
            ? { ...editor, asset: updated }
            : editor);
        })
        .catch(() => undefined);
    }
    return { saved: true, report };
  }

  async function updateIdentityBoardSubject(subject: SubjectAsset, identityBoard: SubjectAsset["identityBoard"]) {
    const saved = await saveSubjectAsset({ ...subject, identityBoard, updatedAt: Date.now() });
    await refreshSubjectAssets();
    setSelectedSubject((current) => current?.id === saved.id ? saved : current);
    setSubjectEditor((current) => current?.asset?.id === saved.id
      ? { ...current, asset: saved }
      : current);
    return saved;
  }

  async function setProductIdentityLockStatus(
    subject: SubjectAsset,
    status: "confirmed" | "disabled"
  ) {
    if (subject.type !== "product" || !subject.productIdentityLock) {
      throw new Error("当前商品还没有可确认的身份锁。");
    }
    const saved = await saveSubjectAsset({
      ...subject,
      productIdentityLock: {
        ...subject.productIdentityLock,
        status,
        confirmedAt: subject.productIdentityLock.confirmedAt ?? Date.now()
      },
      updatedAt: Date.now()
    });
    await refreshSubjectAssets();
    setSelectedSubject((current) => current?.id === saved.id ? saved : current);
    setSubjectEditor((current) => current?.asset?.id === saved.id
      ? { ...current, asset: saved }
      : current);
    return saved;
  }

  async function generateIdentityBoard(subject: SubjectAsset) {
    if (diagnostics.state !== "connected") throw new Error("人物基准图需要已连接的 Codex Runtime。");
    setIdentityBoardBusy(true);
    const startedAt = Date.now();
    try {
      const originals = (await Promise.all(subject.imageIds.map(getAsset)))
        .filter((asset): asset is AssetRecord => Boolean(asset));
      if (!originals.length) throw new Error("人物原始照片已不存在，无法生成基准图。");
      const taskId = crypto.randomUUID();
      const [blob] = await generateNative(
        originals.map((asset) => ({ blob: asset.blob, role: "identity" as const })),
        `根据人物原始照片生成一张仅用于身份参考的中性人物基准图。原始照片是最高可信来源。
保持同一个人的年龄感、脸型、五官比例、发型和主要外观。采用正面或四分之三侧面、自然表情、中性柔光、简洁背景。
不要美化成另一个人，不添加文字、Logo、水印或身份信息。`,
        1,
        taskId
      );
      if (!blob) throw new Error("Codex 没有返回人物基准图。");
      const asset = await saveAsset(await normalizeImage(blob, "identity", { type: "generated" }));
      await updateIdentityBoardSubject(subject, {
        assetId: asset.id,
        hash: asset.hash,
        status: "draft",
        generatedAt: Date.now(),
        confirmedAt: null,
        aiGenerated: true
      });
      const completedAt = Date.now();
      await savePerformanceTrace(createPerformanceTrace({
        id: crypto.randomUUID(),
        taskId,
        projectId: subject.id,
        operation: "identity_board",
        startedAt,
        completedAt,
        stages: { imagegenMs: completedAt - startedAt }
      }));
      setToast("人物基准图已生成，请预览并确认");
    } finally {
      setIdentityBoardBusy(false);
    }
  }

  async function setIdentityBoardStatus(subject: SubjectAsset, status: "confirmed" | "disabled") {
    if (!subject.identityBoard) return;
    await updateIdentityBoardSubject(subject, {
      ...subject.identityBoard,
      status,
      confirmedAt: subject.identityBoard.confirmedAt ?? Date.now()
    });
  }

  async function deleteIdentityBoard(subject: SubjectAsset) {
    await updateIdentityBoardSubject(subject, null);
    setToast("人物基准图已移除，原始照片和历史作品未删除");
  }

  async function removeSubjectAssetRecord(asset: SubjectAsset) {
    const label = subjectTypePresentation[asset.type].label;
    if (!confirm(`从主体库移除${label}“${asset.name}”后不能再用于新创作。历史作品仍会保留当时使用的参考快照。确定移除吗？`)) return;
    await deleteSubjectAsset(asset.id);
    if (selectedSubject?.id === asset.id) setSelectedSubject(undefined);
    closeSubjectEditor();
    await refreshSubjectAssets();
    setToast(`已从主体库移除${label}，历史作品仍保留当时的参考快照`);
  }

  async function useSubjectAsset(asset: SubjectAsset) {
    await chooseSubjectAsset(asset);
    closeSubjectEditor();
    await navigate("create");
  }

  function removeImage(role: AssetRole) {
    setRefs((current) => {
      const next = { ...current };
      delete next[role];
      return next;
    });
    if (role === "style_layout") {
      setDetectedGrid(null);
      pendingGridLayoutRef.current = null;
      setGridCreationPrepared(false);
      setGridPlanningProgress(null);
      setDna(undefined);
      setDomainProfile(undefined);
      setSignatureStyleSelection(null);
      setConfirmedReferencePrompt("");
      setPromptConfirmed(false);
      setActiveCreationSet(undefined);
      setOutputs([]);
      setDnaHistory([]);
      setPendingPreferenceGeneration(undefined);
      setStage("idle");
    }
  }

  async function saveTransition(
    task: TaskRecord,
    status: TaskRecord["status"],
    errorValue: TaskError | null = null
  ) {
    const next = transitionTask(task, status, Date.now(), errorValue);
    await saveTaskRecord(next);
    activeTaskRef.current = next;
    setActiveTask(next);
    return next;
  }

  async function ensureProject(source = reference) {
    if (!source) throw new Error("请先放入一张参考图。");
    const now = Date.now();
    const references = orderGenerationReferences(
      currentReferenceSnapshots(source),
      domainProfile?.domain ?? currentProject?.domainProfile?.domain ?? "photography"
    );
    const referenceAssetIds = [...new Set(references.map((item) => item.assetId))];
    const project: ProjectRecord = currentProject ?? {
      id: crypto.randomUUID(),
      title: instruction.trim().slice(0, 28) || "未命名创作",
      mode,
      referenceAssetIds,
      selectedSubjectAssetId: selectedSubject?.id ?? null,
      referenceSnapshots: references,
      outputAssetIds: [],
      userInstruction: instruction,
      aspectRatio: ratio,
      count,
      signatureStyleSelection,
      provider: diagnostics.state === "connected" ? "codex" : "mock",
      favorite: false,
      createdAt: now,
      updatedAt: now
    };
    const updated = {
      ...project,
      mode,
      referenceAssetIds,
      selectedSubjectAssetId: selectedSubject?.id ?? null,
      referenceSnapshots: references,
      userInstruction: instruction,
      aspectRatio: ratio,
      count,
      signatureStyleSelection,
      updatedAt: now
    };
    if (!currentProject) {
      await saveProject(updated);
      setCurrentProject(updated);
      return updated;
    }
    return persistProjectUpdate(currentProject.id, (stored) => ({
      ...stored,
      mode,
      referenceAssetIds,
      selectedSubjectAssetId: selectedSubject?.id ?? null,
      referenceSnapshots: references,
      userInstruction: instruction,
      aspectRatio: ratio,
      count,
      signatureStyleSelection,
      updatedAt: now
    }));
  }

  function newTask(
    project: ProjectRecord,
    operation: TaskRecord["operation"],
    input: TaskRecord["input"],
    taskId: string = crypto.randomUUID(),
    retryOfTaskId: string | null = null
  ): TaskRecord {
    return {
      schemaVersion: "1.0.0",
      taskId,
      projectId: project.id,
      retryOfTaskId,
      generationEventId: null,
      generationEventIds: [],
      operation,
      status: "CREATED",
      startedAt: null,
      finishedAt: null,
      retryCount: 0,
      error: null,
      heartbeat: Date.now(),
      input
    };
  }

  function requireConnectedCreation(): boolean {
    if (canCreateWithRuntime(forceMock, diagnostics.state)) return true;
    afterAnalysisRef.current = "none";
    setLastRetryableTask(undefined);
    setErrorContext("connection");
    setError("CONNECTION_REQUIRED");
    setStage("error");
    return false;
  }

  async function runAnalyze(
    parentGenerationId = pendingParentGenerationId,
    retryTask?: TaskRecord,
    sourceOverride?: AssetRecord
  ) {
    if (!reference && !retryTask && !sourceOverride) return;
    if (!requireConnectedCreation()) return;
    cancelRef.current = false;
    setError("");
    setErrorContext("analysis");
    setStage("analyzing");
    const traceStartedAt = Date.now();
    let cacheLookupMs: number | null = null;
    let analyzeMs: number | null = null;
    let compileMs: number | null = null;
    let task = retryTask;
    try {
      const project = retryTask ? await getProject(retryTask.projectId) : await ensureProject(sourceOverride);
      const source = retryTask ? await getAsset(retryTask.input.sourceAssetId) : sourceOverride ?? reference;
      if (!project || !source) throw new Error("任务原始输入已不存在，无法继续尝试。");
      const references = retryTask?.input.references?.length
        ? retryTask.input.references
        : currentReferenceSnapshots(source, undefined);
      if (!task) {
        task = newTask(project, "ANALYSIS", {
          sourceAssetId: source.id,
          references,
          visualDNA: project.visualDNA ?? null,
          prompt: null,
          parameters: {
            aspectRatio: project.aspectRatio,
            count: project.count,
            userInstruction: project.userInstruction,
            providerParameters: diagnostics.state === "connected"
              ? runtimeProviderParameters(diagnostics)
              : {}
          },
          parentGenerationId
        });
        await saveTaskRecord(task);
      }
      activeTaskRef.current = task;
      setActiveTask(task);
      const updateStatus = async (status: "UPLOADING" | "ANALYZING") => {
        if (task!.status !== status) task = await saveTransition(task!, status);
      };
      if (["CREATED", "RETRYING"].includes(task.status)) {
        task = await saveTransition(task, "UPLOADING");
      }
      if (diagnostics.state !== "connected") {
        task = await saveTransition(task, "ANALYZING");
      }
      const analyzerVersion = "domain-intelligence-joint-v2";
      const cacheKey = analysisCacheKey(source.hash, "joint", analyzerVersion);
      const cacheStartedAt = performance.now();
      const cached = retryTask ? undefined : await getAnalysisCache(cacheKey);
      cacheLookupMs = performance.now() - cacheStartedAt;
      const analyzeStartedAt = performance.now();
      const domainResult = cached?.result ?? (diagnostics.state === "connected"
        ? await analyzeDomainNative(source.blob, task.taskId, updateStatus)
        : {
            visualDNA: await analyzeMock(source.hash),
            domainProfile: {
              ...createMigrationDomainProfile(),
              confidence: 0.5,
              observedSignals: ["离线预览无法可靠识别领域"],
              profileVersion: "photography-mock-v1",
              source: "auto" as const
            }
          });
      analyzeMs = cached ? 0 : performance.now() - analyzeStartedAt;
      if (cached) {
        await putAnalysisCache({ ...cached, lastUsedAt: Date.now() });
      } else {
        const now = Date.now();
        await putAnalysisCache({
          schemaVersion: "1.0.0",
          key: cacheKey,
          sourceImageHash: source.hash,
          analysisMode: "joint",
          analyzerVersion,
          result: domainResult,
          createdAt: now,
          lastUsedAt: now
        });
      }
      if (cancelRef.current) throw new Error("CANCELLED");
      const parameters = task.input.parameters!;
      const analyzedDNA = applyReferencesToDNA(project.visualDNA
        ? reviseVisualDNA(project.visualDNA, domainResult.visualDNA, Date.now())
        : domainResult.visualDNA, references);
      const analyzedDomain = domainResult.domainProfile;
      const compileStartedAt = performance.now();
      const compiledPrompt = compilePrompt({
        visualDNA: analyzedDNA,
        domainProfile: analyzedDomain,
        userInstruction: "",
        aspectRatio: parameters.aspectRatio,
        references: promptReferences(references)
      });
      compileMs = performance.now() - compileStartedAt;
      const explicitSubject = project.selectedSubjectAssetId
        ? subjectAssets.find((subject) => subject.id === project.selectedSubjectAssetId)
        : undefined;
      const compatibleSubjectId = explicitSubject?.id ?? selectLastCompatibleSubjectId(
        analyzedDomain.domain,
        projects,
        subjectAssets
      );
      const compatibleSubject = compatibleSubjectId
        ? subjectAssets.find((subject) => subject.id === compatibleSubjectId)
        : undefined;
      const updated = {
        ...project,
        selectedSubjectAssetId: compatibleSubject?.id ?? null,
        referenceSnapshots: references,
        referenceAssetIds: [...new Set(references.map((item) => item.assetId))],
        visualDNA: analyzedDNA,
        domainProfile: analyzedDomain,
        compiledPrompt,
        updatedAt: Date.now()
      };
      const revision = createVisualDNARevision({
        id: crypto.randomUUID(),
        projectId: project.id,
        dna: analyzedDNA,
        previousDNA: project.visualDNA ?? null,
        origin: "analysis",
        createdAt: analyzedDNA.updatedAt
      });
      const savedProject = await saveProjectRevision(updated, revision);
      task = await saveTransition({
        ...task,
        input: { ...task.input, domainProfile: analyzedDomain }
      }, "READY");
      activeTaskRef.current = undefined;
      setDna(analyzedDNA);
      setDomainProfile(analyzedDomain);
      setSelectedSubject(compatibleSubject);
      setAutoSelectedSubjectName(!explicitSubject && compatibleSubject ? compatibleSubject.name : "");
      setConfirmedReferencePrompt("");
      setPromptConfirmed(false);
      setSignatureStyleSelection(null);
      setFinalPromptCopied(false);
      setFinalPromptCopyError(false);
      setDnaHistory(await listVisualDNARevisions(project.id));
      setCurrentProject(savedProject);
      setStage("ready");
      const traceCompletedAt = Date.now();
      await savePerformanceTrace(createPerformanceTrace({
        id: crypto.randomUUID(),
        taskId: task.taskId,
        projectId: project.id,
        operation: "analysis",
        startedAt: traceStartedAt,
        completedAt: traceCompletedAt,
        cacheHit: Boolean(cached),
        stages: {
          cacheLookupMs,
          analyzeMs,
          compileMs,
          persistenceMs: Math.max(0, traceCompletedAt - traceStartedAt -
            (cacheLookupMs ?? 0) - (analyzeMs ?? 0) - (compileMs ?? 0))
        }
      }));
      const completionIntent = afterAnalysisRef.current;
      afterAnalysisRef.current = "none";
      if (completionIntent === "set") await beginCreationSet(
        updated,
        analyzedDNA,
        analyzedDomain,
        pendingGridLayoutRef.current?.count ?? requestedSetCount,
        pendingGridLayoutRef.current
      );
      else if (completionIntent === "single") {
        await requestGenerate(updated, analyzedDNA, parentGenerationId);
      }
      pendingGridLayoutRef.current = null;
    } catch (cause) {
      if (task && !["READY", "FAILED", "CANCELLED"].includes(task.status)) {
        const cancelled = cancelRef.current || (cause instanceof Error && cause.message === "CANCELLED");
        task = await saveTransition(task, cancelled ? "CANCELLED" : "FAILED", cancelled ? null : {
          code: "ANALYSIS_FAILED",
          message: cause instanceof Error ? cause.message : "参考图分析失败。",
          retryable: true
        });
      }
      if (task?.status === "FAILED") {
        setLastRetryableTask(task);
        setInterruptedTasks((items) => [task!, ...items.filter((item) => item.taskId !== task!.taskId)]);
      }
      activeTaskRef.current = undefined;
      setCancelling(false);
      if (task?.status === "CANCELLED") {
        setToast("已取消，图片和要求仍然保留");
        setStage("idle");
      } else {
        setStage("error");
        setErrorContext("analysis");
        setError(cause instanceof Error ? cause.message : "参考图暂时没有分析成功，输入和图片已保留。");
      }
    }
  }

  async function runGenerate(
    project = currentProject,
    currentDna = dna,
    parentGenerationId: string | null = pendingParentGenerationId,
    retryTask?: TaskRecord,
    preferenceInstruction = "",
    selectGeneratedAsFinal = true,
    promptOverride = ""
  ) {
    if (singleRunInFlightRef.current) {
      setToast("生成已开始，请稍候");
      return;
    }
    singleRunInFlightRef.current = true;
    try {
      const execute = () => runGenerateUnlocked(
        project,
        currentDna,
        parentGenerationId,
        retryTask,
        preferenceInstruction,
        selectGeneratedAsFinal,
        promptOverride
      );
      const projectId = retryTask?.projectId ?? project?.id;
      if (!("locks" in navigator) || !projectId) return await execute();
      let acquired = false;
      await navigator.locks.request(
        `visualforge:project:${projectId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          acquired = true;
          await execute();
        }
      );
      if (!acquired) setToast("另一窗口正在生成这个作品，请在该窗口查看进度");
    } finally {
      singleRunInFlightRef.current = false;
    }
  }

  async function runGenerateUnlocked(
    project = currentProject,
    currentDna = dna,
    parentGenerationId: string | null = pendingParentGenerationId,
    retryTask?: TaskRecord,
    preferenceInstruction = "",
    selectGeneratedAsFinal = true,
    promptOverride = ""
  ) {
    const traceStartedAt = Date.now();
    if (!requireConnectedCreation()) return;
    if (diagnostics.state === "connected" && diagnostics.imagegen === false) {
      setErrorContext("generation");
      setError("IMAGEGEN_UNAVAILABLE");
      setStage("error");
      return;
    }
    const source = retryTask ? await getAsset(retryTask.input.sourceAssetId) : reference;
    const actualProject = retryTask ? await getProject(retryTask.projectId) : project;
    const baseDna = retryTask?.input.visualDNA ?? currentDna;
    if (!source || !actualProject || !baseDna) return;
    const references = retryTask?.input.references?.length
      ? retryTask.input.references
      : currentReferenceSnapshots(source);
    const actualDna = applyReferencesToDNA(baseDna, references);
    cancelRef.current = false;
    setError("");
    setErrorContext("generation");
    setSingleQualityReport(undefined);
    setSingleQualityAssetId(undefined);
    setStage("rendering");
    const parameters = retryTask?.input.parameters ?? {
      aspectRatio: ratio,
      count,
      userInstruction: instruction,
      providerParameters: diagnostics.state === "connected"
        ? runtimeProviderParameters(diagnostics)
        : {}
    };
    const confirmedInstruction = [parameters.userInstruction, preferenceInstruction].filter(Boolean).join("\n");
    const compileStartedAt = performance.now();
    const compiledPrompt = retryTask?.input.prompt ?? (promptOverride
      ? [promptOverride, preferenceInstruction].filter(Boolean).join("\n")
      : compilePrompt({
          visualDNA: actualDna,
          domainProfile: retryTask?.input.domainProfile ?? actualProject.domainProfile,
          userInstruction: confirmedInstruction,
          aspectRatio: parameters.aspectRatio,
          references: promptReferences(references)
        }));
    const compileMs = performance.now() - compileStartedAt;
    let task = retryTask ?? newTask(actualProject, "GENERATION", {
      sourceAssetId: source.id,
      references,
      visualDNA: actualDna,
      prompt: compiledPrompt,
      parameters,
      parentGenerationId,
      ...(actualProject.domainProfile ? { domainProfile: actualProject.domainProfile } : {})
    });
    await saveTaskRecord(task);
    const stopTaskHeartbeat = startTaskHeartbeat(task.taskId);
    activeTaskRef.current = task;
    setActiveTask(task);
    const persistCandidateBlobs = async (
      blobs: Blob[],
      outcome: { status: "COMPLETED" | "FAILED"; missing: number } = { status: "COMPLETED", missing: 0 }
    ) => {
      const normalized = await Promise.all(blobs.map(async (blob) => {
        if (cancelRef.current) throw new Error("CANCELLED");
        return normalizeImage(blob, "output", { type: "generated" });
      }));
      if (cancelRef.current) throw new Error("CANCELLED");
      const generated = normalized;
      const manifest = await createGenerationManifest({
        id: crypto.randomUUID(),
        projectId: actualProject.id,
        taskId: task.taskId,
        createdAt: task.startedAt ?? task.heartbeat,
        completedAt: Date.now(),
        source: {
          assetId: source.id,
          hash: source.hash,
          mimeType: source.mimeType,
          fileName: `source-${source.id}.${source.mimeType === "image/png" ? "png" : source.mimeType === "image/webp" ? "webp" : "jpg"}`
        },
        references,
        signatureStyleSelection: actualProject.signatureStyleSelection ?? null,
        domainProfile: task.input.domainProfile ?? actualProject.domainProfile,
        visualDNA: actualDna,
        prompt: compiledPrompt,
        model: diagnostics.state === "connected"
          ? { provider: "codex", name: "imagegen", version: null }
          : { provider: "mock", name: "styleforge-mock", version: "1" },
        parameters: {
          ...parameters,
          providerParameters: {
            ...parameters.providerParameters,
            requestedCount: parameters.count,
            receivedCount: generated.length,
            missingCount: Math.max(0, parameters.count - generated.length),
            partialGeneration: generated.length < parameters.count
          }
        },
        outputs: generated.map((asset) => ({
          assetId: asset.id,
          hash: asset.hash,
          mimeType: asset.mimeType,
          byteLength: asset.byteLength,
          fileName: `visualforge-${asset.id}.${asset.mimeType === "image/png" ? "png" : asset.mimeType === "image/webp" ? "webp" : "jpg"}`
        }))
      });
      const events = createGenerationEvents(manifest, {
        ids: generated.map(() => crypto.randomUUID()),
        parentGenerationId: task.input.parentGenerationId
      });
      const bundledTask = transitionTask({
        ...task,
        generationEventId: events[0]?.id ?? null,
        generationEventIds: events.map((event) => event.id),
        input: outcome.status === "FAILED" && task.input.parameters ? {
          ...task.input,
          parameters: {
            ...task.input.parameters,
            count: outcome.missing as 1 | 2 | 3 | 4,
            providerParameters: {
              ...task.input.parameters.providerParameters,
              requestedCount: parameters.count,
              receivedCount: generated.length,
              missingCount: outcome.missing,
              partialGeneration: true
            }
          }
        } : task.input
      }, outcome.status, Date.now(), outcome.status === "FAILED" ? {
        code: "GENERATION_INCOMPLETE",
        message: `已保留 ${generated.length} 张候选，仍缺少 ${outcome.missing} 张。`,
        retryable: true
      } : null);
      const updated: ProjectRecord = {
        ...actualProject,
        selectedSubjectAssetId: references.find((item) => item.subjectAsset)?.subjectAsset?.subjectAssetId ?? null,
        referenceSnapshots: references,
        referenceAssetIds: [...new Set(references.map((item) => item.assetId))],
        visualDNA: actualDna,
        compiledPrompt,
        outputAssetIds: appendGeneratedCandidates(
          actualProject.outputAssetIds,
          generated.map((asset) => asset.id),
          selectGeneratedAsFinal
        ),
        updatedAt: Date.now()
      };
      const saved = await saveGenerationBundle({
        assets: generated,
        manifest,
        events,
        project: updated,
        task: bundledTask
      });
      return {
        generated: saved.assets,
        events: saved.events,
        updated: saved.project,
        task: saved.task!
      };
    };
    let generationTimings: NativeGenerationTimingBreakdown | undefined;
    let imagegenMs = 0;
    let persistenceMs = 0;
    try {
      const updateStatus = async (status: "UPLOADING" | "GENERATING") => {
        if (task.status !== status) task = await saveTransition(task, status);
      };
      if (diagnostics.state !== "connected") {
        task = await saveTransition(task, "UPLOADING");
        task = await saveTransition(task, "GENERATING");
      }
      const nativeReferences = await Promise.all(references
        .filter((item) => item.role !== "composition")
        .filter((item, index, items) => items.findIndex((candidate) => candidate.assetId === item.assetId) === index)
        .map(async (item) => {
          const asset = item.assetId === source.id ? source : await getAsset(item.assetId);
          if (!asset) throw new Error(`参考资产 ${item.assetId} 已不存在，无法继续生成。`);
          return {
            blob: asset.blob,
            role: item.role,
            imagePurpose: item.role === "identity"
              ? item.subjectAsset?.imagePurposes?.[item.assetId]
              : undefined,
            sourceKind: item.sourceKind
          };
        }));
      const imagegenStartedAt = performance.now();
      const returnedBlobs = diagnostics.state === "connected"
        ? await generateNative(
            nativeReferences,
            compiledPrompt,
            parameters.count,
            task.taskId,
            updateStatus,
            (timings) => { generationTimings = timings; },
            (skill) => {
              Object.assign(parameters.providerParameters, runtimeProviderParameters(diagnostics, skill));
            }
          )
        : await Promise.all(Array.from({ length: parameters.count }, (_, index) =>
            createMockResult(source.blob, parameters.aspectRatio, index)));
      const blobs = returnedBlobs.slice(0, parameters.count);
      imagegenMs = performance.now() - imagegenStartedAt;
      const persistenceStartedAt = performance.now();
      if (cancelRef.current) throw new Error("CANCELLED");
      setStage("saving");
      const { generated, events, updated, task: completedTask } = await persistCandidateBlobs(blobs);
      persistenceMs = performance.now() - persistenceStartedAt;
      task = completedTask;
      activeTaskRef.current = task;
      setActiveTask(task);
      activeTaskRef.current = undefined;
      setPendingParentGenerationId(null);
      const revealResult = shouldRevealCompletedTask({
        route: routeRef.current,
        stage: stageRef.current,
        currentProjectId: currentProjectIdRef.current,
        completedProjectId: actualProject.id,
        activeCreationSetId: activeCreationSetIdRef.current
      });
      if (revealResult) {
        const allOutputs = await Promise.all(updated.outputAssetIds.map(getAsset));
        setOutputs(allOutputs.filter((asset): asset is AssetRecord => Boolean(asset)));
        setResultFocusAssetId(generated.at(-1)?.id);
        setGenerationEvents(await listGenerationEvents(actualProject.id));
        setCurrentProject(updated);
        setStage("complete");
      } else {
        setStage("complete");
        const nextNotifications = await persistTaskNotification({
          taskId: task.taskId,
          projectId: actualProject.id,
          title: actualProject.title,
          status: "completed",
          unread: true,
          createdAt: Date.now()
        });
        setTaskNotifications(nextNotifications);
      }
      await refreshProjects();
      const traceCompletedAt = Date.now();
      await savePerformanceTrace(createPerformanceTrace({
        id: crypto.randomUUID(),
        taskId: task.taskId,
        projectId: actualProject.id,
        operation: "generation",
        startedAt: traceStartedAt,
        completedAt: traceCompletedAt,
        stages: {
          compileMs,
          imagegenMs,
          persistenceMs,
          codexStartupMs: generationTimings?.codexStartupMs ?? null,
          referenceUploadMs: generationTimings?.referenceUploadMs ?? null,
          skillDiscoveryMs: generationTimings?.skillDiscoveryMs ?? null,
          generationTurnMs: generationTimings?.generationTurnMs ?? null,
          outputRegistrationMs: generationTimings?.outputRegistrationMs ?? null,
          outputReadMs: generationTimings?.outputReadMs ?? null,
          resultTransferMs: generationTimings?.resultTransferMs ?? null
        }
      }));
      const currentOutput = generated.at(-1);
      if (diagnostics.state === "connected" && currentOutput) {
        void runSingleQuality(
          currentOutput,
          updated,
          actualDna,
          events,
          references
        );
      }
    } catch (cause) {
      const cancelled = cancelRef.current || (cause instanceof Error && cause.message === "CANCELLED");
      let partialResult: Awaited<ReturnType<typeof persistCandidateBlobs>> | undefined;
      let failure = cause;
      if (!cancelled && cause instanceof NativeGenerationIncompleteError && cause.partialOutputs.length) {
        try {
          const persistenceStartedAt = performance.now();
          partialResult = await persistCandidateBlobs(cause.partialOutputs, {
            status: "FAILED",
            missing: cause.missing
          });
          persistenceMs = performance.now() - persistenceStartedAt;
          task = partialResult.task;
        } catch (partialFailure) {
          failure = partialFailure;
        }
      }
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
        task = await saveTransition(task, cancelled ? "CANCELLED" : "FAILED", cancelled ? null : {
          code: "GENERATION_FAILED",
          message: failure instanceof Error ? failure.message : "输入和分析结果已保留。",
          retryable: true
        });
      }
      if (task.status === "FAILED") {
        setLastRetryableTask(task);
        setInterruptedTasks((items) => [task, ...items.filter((item) => item.taskId !== task.taskId)]);
      }
      activeTaskRef.current = undefined;
      setCancelling(false);
      const revealFailure = shouldRevealCompletedTask({
        route: routeRef.current,
        stage: stageRef.current,
        currentProjectId: currentProjectIdRef.current,
        completedProjectId: actualProject.id,
        activeCreationSetId: activeCreationSetIdRef.current
      });
      if (revealFailure) {
        setStage(partialResult ? "complete" : cancelled ? "ready" : "error");
        if (partialResult) {
          const allOutputs = await Promise.all(partialResult.updated.outputAssetIds.map(getAsset));
          setOutputs(allOutputs.filter((asset): asset is AssetRecord => Boolean(asset)));
          setResultFocusAssetId(partialResult.generated.at(-1)?.id);
          setGenerationEvents(await listGenerationEvents(actualProject.id));
          setCurrentProject(partialResult.updated);
          setToast(`${partialResult.generated.length} 张候选已保留；其余未完成，可直接重试`);
        }
        if (cancelled) setToast("已取消，已完成内容仍然保留");
        if (!cancelled && !partialResult) {
          setErrorContext("generation");
          setError(failure instanceof Error ? failure.message : "本次生成没有完成，风格分析仍已保存。");
        }
      } else if (!cancelled) {
        const nextNotifications = await persistTaskNotification({
          taskId: task.taskId,
          projectId: actualProject.id,
          title: actualProject.title,
          status: partialResult ? "partial" : "failed",
          completedCount: partialResult?.generated.length,
          requestedCount: task.input.parameters?.count,
          unread: true,
          createdAt: Date.now()
        });
        setTaskNotifications(nextNotifications);
      }
    } finally {
      stopTaskHeartbeat();
    }
  }

  async function persistActiveCreationSet(next: CreationSet, reveal = true) {
    const saved = await saveCreationSet(next);
    syncCreationSetState(saved, reveal);
    return saved;
  }

  function syncCreationSetState(saved: CreationSet, reveal = true) {
    if (reveal) {
      activeCreationSetIdRef.current = saved.id;
      setActiveCreationSet(saved);
    }
    setCreationSets((sets) => [saved, ...sets.filter((item) => item.id !== saved.id)]);
  }

  async function persistCreationSetUpdate(
    id: string,
    transform: (current: CreationSet) => CreationSet,
    reveal = true
  ) {
    const saved = await updateCreationSet(id, transform);
    if (!saved) throw new Error("这组作品已在另一窗口删除。");
    syncCreationSetState(saved, reveal);
    return saved;
  }

  async function refineGridSemanticsInBackground(seed: CreationSet, source: AssetRecord) {
    const sourceGridLayout = seed.sourceGridLayout ?? seed.gridLayout ?? null;
    if (!sourceGridLayout || diagnostics.state !== "connected" || forceMock) return;
    const isViewing = () => routeRef.current === "create"
      && currentProjectIdRef.current === seed.projectId
      && activeCreationSetIdRef.current === seed.id;
    try {
      const result = await analyzeGridNative(
        source.blob,
        sourceGridLayout,
        `grid-semantics-${seed.id}`
      );
      if (result.sourceImageHash !== source.hash || result.cells.length !== seed.requestedCount) {
        throw new Error("精细分析结果与当前参考宫格不一致");
      }
      const cells = new Map(result.cells.map((cell) => [cell.index, { ...cell, source: "codex" as const }]));
      await persistCreationSetUpdate(seed.id, (latest) => ({
        ...latest,
        gridSemanticStatus: "enhanced",
        gridSemanticMessage: "已根据每格真实画面增强构图、景别、动作和情绪。",
        updatedAt: Date.now(),
        planItems: latest.planItems.map((item, index) => {
          const analysis = cells.get(index);
          if (!analysis || !item.gridCellReference || item.status !== "PENDING") return item;
          const refined = applyGridCellAnalysisToPlanItem(item, analysis, item.gridCellReference);
          return { ...refined, promptDelta: item.promptDelta };
        })
      }), isViewing());
      if (isViewing()) setToast("逐格细节已在后台增强，现有编辑内容已保留");
    } catch (cause) {
      await persistCreationSetUpdate(seed.id, (latest) => ({
        ...latest,
        gridSemanticStatus: "unavailable",
        gridSemanticMessage: "精细分析暂时未完成，已保留独立裁切和可编辑基础计划。",
        updatedAt: Date.now()
      }), isViewing()).catch(() => undefined);
      if (isViewing()) {
        setToast(cause instanceof Error
          ? `逐格精细分析未完成：${cause.message}。已继续使用基础计划。`
          : "逐格精细分析未完成，已继续使用基础计划。");
      }
    }
  }

  async function beginCreationSet(
    project = currentProject,
    visualDNA = dna,
    profile = domainProfile ?? currentProject?.domainProfile,
    requestedCount: 2 | 3 | 4 | 6 | 9 | 12 = requestedSetCount,
    gridLayout?: CreationSet["gridLayout"]
  ) {
    if (!requireConnectedCreation()) return;
    if (!requireConfirmedProductIdentityLock()) return;
    const source = reference ?? (project?.referenceAssetIds[0]
      ? await getAsset(project.referenceAssetIds[0])
      : undefined);
    if (!project || !visualDNA || !profile || !source) {
      afterAnalysisRef.current = "set";
      await runAnalyze();
      return;
    }
    const id = crypto.randomUUID();
    // 分析阶段的项目快照可能早于用户选择人物／商品；创建整组时必须按当前选择重建。
    const references = orderGenerationReferences(
      currentReferenceSnapshots(source, selectedSubject, "style_layout"),
      profile.domain
    );
    const subjectSnapshots = [...new Map(references
      .flatMap((item) => item.subjectAsset ? [[item.subjectAsset.subjectAssetId, item.subjectAsset] as const] : [])
    ).values()];
    const direction = createCreativeDirection({
      domain: profile.domain,
      visualDNA,
      domainProfile: profile,
      userIntent: instruction
    });
    const selectedStyle = project.signatureStyleSelection ?? signatureStyleSelection;
    const basePlanItems = createDirectedCreationSetPlan(profile.domain, requestedCount, direction);
    const styledPlanItems = selectedStyle
      ? applySignatureStyleToCreationPlan(basePlanItems, selectedStyle)
      : basePlanItems;
    let planItems = styledPlanItems.map((item) => ({ ...item, id: `${id}:${item.id}` }));
    if (gridLayout) {
      setStage("analyzing");
      setGridPlanningProgress(`正在理解 ${gridLayout.count} 个画面的构图、景别、动作和情绪…`);
      try {
        const cellBlobs = await cropGridCells(source.blob, gridLayout, (completed, total) => {
          setGridPlanningProgress(`正在裁切第 ${completed} / ${total} 个画面…`);
        });
        const normalizedCellAssets: AssetRecord[] = [];
        for (const [index] of planItems.entries()) {
          setGridPlanningProgress(`正在整理第 ${index + 1} / ${gridLayout.count} 个画面…`);
          const cellAsset = await normalizeImage(
            cellBlobs[index]!,
            "style_layout",
            source.source,
            1
          );
          normalizedCellAssets.push(cellAsset);
        }
        setGridPlanningProgress(`正在统一检查并保存 ${gridLayout.count} 个画面…`);
        const cellAssets = await saveAssets(normalizedCellAssets);
        setGridPlanningProgress(`正在建立 ${gridLayout.count} 个可编辑画面的基础计划…`);
        const cells = planItems.map((item, index) => ({
          index,
          composition: item.creativePlan.composition,
          shotScale: item.creativePlan.shotScale,
          action: item.creativePlan.actionPhase,
          emotion: item.creativePlan.emotion,
          source: "baseline" as const
        }));
        planItems = planItems.map((item, index) => {
          const analysis = cells[index];
          const asset = cellAssets[index];
          if (!analysis || !asset) throw new Error(`第 ${index + 1} 格准备失败`);
          return applyGridCellAnalysisToPlanItem(item, analysis, {
            assetId: asset.id,
            hash: asset.hash,
            mimeType: asset.mimeType,
            role: "composition",
            sourceKind: "original",
            subjectAsset: null
          });
        });
      } catch (cause) {
        setGridPlanningProgress(null);
        setStage("ready");
        setToast(cause instanceof Error
          ? `独立画面准备未完成：${cause.message}。请重试。`
          : "独立画面准备未完成，请重试。");
        return;
      }
    }
    const lockedVisualDNA: VisualDNA = {
      ...visualDNA,
      locks: {
        ...visualDNA.locks,
        identity: references.some((item) => item.role === "identity") ? "locked" : visualDNA.locks.identity,
        composition: "locked",
        camera: "locked",
        lighting: "locked",
        palette: "locked",
        material: "locked",
        texture: "locked",
        style: "locked"
      }
    };
    const transformationBlueprint = createTransformationBlueprint({
      domain: profile.domain,
      visualDNA: lockedVisualDNA,
      creativeDirection: direction,
      references: promptReferences(references)
    });
    const now = Date.now();
    const creationSet: CreationSet = {
      schemaVersion: "1.0.0",
      id,
      projectId: project.id,
      title: gridLayout
        ? `${subjectSnapshots[0]?.name ?? project.title} · 复刻${gridLayoutName(gridLayout.count)}`
        : profile.domain === "portrait" && subjectSnapshots[0]?.type === "person"
          ? `${subjectSnapshots[0].name} · 拍一套`
          : profile.domain === "product" && subjectSnapshots[0]?.type === "product"
            ? `${subjectSnapshots[0].name} · 广告套图`
            : `${project.title} · 生成一组`,
      domainProfile: profile,
      requestedCount,
      deliveryMode,
      sourceGridLayout: gridLayout ?? null,
      compositeLayout: deliveryMode === "independent"
        ? null
        : gridLayout ?? createGridLayout(requestedCount),
      gridLayout: gridLayout ?? null,
      gridSemanticStatus: gridLayout
        ? diagnostics.state === "connected" && !forceMock ? "refining" : "baseline"
        : undefined,
      gridSemanticMessage: gridLayout
        ? diagnostics.state === "connected" && !forceMock
          ? "基础计划已可编辑，正在后台增强每格真实语义。"
          : "当前使用独立裁切生成的基础逐格计划。"
        : undefined,
      userIntent: instruction,
      sharedVisualDNARevision: visualDNA.revision,
      sharedVisualDNASnapshot: lockedVisualDNA,
      sharedReferenceSnapshots: references,
      subjectAssetSnapshots: subjectSnapshots,
      sourceGenerationEventId: pendingParentGenerationId,
      transformationBlueprintSnapshot: transformationBlueprint,
      signatureStyleSelection: selectedStyle,
      sharedInvariants: [
        ...visualDNA.invariants,
        "待复刻画面的动作、表情、服装、道具、背景、构图和主体关系",
        "同一服装、妆发、场景、时间、天气、主光、曝光、色彩、材质和后期",
        ...(selectedStyle?.styleSnapshot.acceptance.observableSignals ?? []),
        ...subjectSnapshots.flatMap((snapshot) =>
          snapshot.productIdentityLock?.status === "confirmed"
            ? snapshot.productIdentityLock.invariants
            : snapshot.constraints)
      ],
      allowedVariations: ["第 1 张只替换主体身份或商品", "后续每张仅执行当前计划声明的最多两个相邻变化"],
      status: "PLANNING",
      completedCount: 0,
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
      qualityReport: null,
      planItems
    };
    const savedCreationSet = await persistActiveCreationSet(creationSet);
    pendingGridLayoutRef.current = null;
    setGridCreationPrepared(false);
    setGridPlanningProgress(null);
    setDetectedGrid(null);
    await loadCreationSetOutputs(savedCreationSet);
    setStage("ready");
    if (gridLayout && diagnostics.state === "connected" && !forceMock) {
      void refineGridSemanticsInBackground(savedCreationSet, source);
    }
  }

  async function transitionSetTask(
    task: TaskRecord,
    status: TaskRecord["status"],
    errorValue: TaskError | null = null
  ) {
    const next = transitionTask(task, status, Date.now(), errorValue);
    await saveTaskRecord(next);
    activeSetTaskIdRef.current = next.taskId;
    setActiveTask(next);
    return next;
  }

  async function executeCreationSetItem(
    creationSet: CreationSet,
    item: CreationSetPlanItem
  ) {
    if (!requireConnectedCreation()) throw new Error("需要先连接本地创作。");
    const sourceReference = creationSet.sharedReferenceSnapshots.find((candidate) => candidate.role === "style_layout")
      ?? creationSet.sharedReferenceSnapshots.find((candidate) => candidate.role === "style")
      ?? creationSet.sharedReferenceSnapshots[0];
    const source = sourceReference ? await getAsset(sourceReference.assetId) : undefined;
    const project = await getProject(creationSet.projectId);
    if (!source || !project) throw new Error("整组使用的原始参考图已不存在。");
    const itemIndex = creationSet.planItems.findIndex((candidate) => candidate.id === item.id);
    const persistedGridCellAsset = item.gridCellReference
      ? await getAsset(item.gridCellReference.assetId)
      : undefined;
    const sourceGridLayout = creationSet.sourceGridLayout ?? creationSet.gridLayout ?? null;
    const gridCellAsset = persistedGridCellAsset ?? (sourceGridLayout && itemIndex >= 0
      ? await saveAsset(await normalizeImage(
          await cropGridCell(source.blob, sourceGridLayout, itemIndex),
          "style_layout",
          source.source
        ))
      : undefined);
    const orderedSharedReferences = orderGenerationReferences(
      creationSet.sharedReferenceSnapshots,
      creationSet.domainProfile.domain
    );
    const baseItemReferences: GenerationReferenceSnapshot[] = gridCellAsset
      ? [...orderedSharedReferences, item.gridCellReference ?? {
          assetId: gridCellAsset.id,
          hash: gridCellAsset.hash,
          mimeType: gridCellAsset.mimeType,
          role: "composition",
          sourceKind: "original",
          subjectAsset: null
        }]
      : orderedSharedReferences;
    const retryBaseAsset = item.retryDirective
      ? await getAsset(item.retryDirective.sourceOutputAssetId)
      : undefined;
    if (item.retryDirective && !retryBaseAsset) {
      throw new Error("定向重试的原始候选已不存在，请从当前可见候选重新发起重试。");
    }
    const itemReferences: GenerationReferenceSnapshot[] = retryBaseAsset
      ? [{
          assetId: retryBaseAsset.id,
          hash: retryBaseAsset.hash,
          mimeType: retryBaseAsset.mimeType,
          role: "edit_base",
          sourceKind: "original",
          subjectAsset: null
        }, ...baseItemReferences]
      : baseItemReferences;
    const basePrompt = compileSetItemPrompt({
      visualDNA: creationSet.sharedVisualDNASnapshot,
      domainProfile: creationSet.domainProfile,
      planItem: item,
      transformationBlueprint: creationSet.transformationBlueprintSnapshot ?? undefined,
      userIntent: creationSet.userIntent,
      aspectRatio: project.aspectRatio,
      references: promptReferences(itemReferences),
      sharedInvariants: creationSet.sharedInvariants,
      allowedVariations: creationSet.allowedVariations
    });
      const prompt = item.retryDirective
      ? buildTargetedRetryPrompt(
          creationSet.signatureStyleSelection
            ? `${basePrompt}\n风格定向修复：${creationSet.signatureStyleSelection.styleSnapshot.critic.retryStrategy}\n必须保留：${creationSet.signatureStyleSelection.styleSnapshot.acceptance.observableSignals.join("；")}`
            : basePrompt,
          item.retryDirective.issueType,
          item.retryDirective.reason,
          creationSet.domainProfile.domain,
          {
            impact: item.retryDirective.impact,
            retryFocus: item.retryDirective.retryFocus,
            preserve: item.retryDirective.preserve
          },
          Math.max(1, item.outputCandidates.length)
        )
      : basePrompt;
    const itemPrompt = gridCellAsset
      ? `${prompt}\n宫格逐格参考：当前任务只对应原宫格第 ${itemIndex + 1} 格。必须以 composition 参考保持该格的主体关系、构图、动作与视觉重心，不得复制其他格。`
      : prompt;
    const parameters: NonNullable<TaskRecord["input"]["parameters"]> = {
      aspectRatio: project.aspectRatio,
      count: 1 as const,
      userInstruction: creationSet.userIntent,
      providerParameters: diagnostics.state === "connected"
        ? runtimeProviderParameters(diagnostics)
        : {}
    };
    let task = newTask(project, "GENERATION", {
      sourceAssetId: source.id,
      references: itemReferences,
      visualDNA: creationSet.sharedVisualDNASnapshot,
      prompt: itemPrompt,
      parameters,
      parentGenerationId: creationSet.sourceGenerationEventId,
      setId: creationSet.id,
      planItemId: item.id,
      domainProfile: creationSet.domainProfile
    }, item.taskId ?? crypto.randomUUID(), item.retryOfTaskId);
    await saveTaskRecord(task);
    const stopTaskHeartbeat = startTaskHeartbeat(task.taskId);
    activeSetTaskIdRef.current = task.taskId;
    setActiveTask(task);
    try {
      const updateStatus = async (status: "UPLOADING" | "GENERATING") => {
        if (task.status !== status) task = await transitionSetTask(task, status);
      };
      if (diagnostics.state !== "connected") {
        task = await transitionSetTask(task, "UPLOADING");
        task = await transitionSetTask(task, "GENERATING");
      }
      const nativeReferences = await Promise.all(itemReferences
        .filter((reference, index, items) =>
          items.findIndex((candidate) => candidate.assetId === reference.assetId) === index)
        .map(async (reference) => {
          const asset = await getAsset(reference.assetId);
          if (!asset) throw new Error(`原始参考资产 ${reference.assetId} 已不存在。`);
          return {
            blob: asset.blob,
            role: reference.role,
            imagePurpose: reference.role === "identity"
              ? reference.subjectAsset?.imagePurposes?.[reference.assetId]
              : undefined,
            sourceKind: reference.sourceKind
          };
        }));
      const [blob] = diagnostics.state === "connected"
        ? await generateNative(
            nativeReferences,
            itemPrompt,
            1,
            task.taskId,
            updateStatus,
            undefined,
            (skill) => {
              Object.assign(parameters.providerParameters, runtimeProviderParameters(diagnostics, skill));
            }
          )
        : [await createMockResult(source.blob, project.aspectRatio, item.order - 1)];
      if (!blob || setCancelRef.current) throw new Error("CANCELLED");
      const output = await normalizeImage(blob, "output", { type: "generated" });
      const manifest = await createGenerationManifest({
        id: crypto.randomUUID(),
        projectId: project.id,
        taskId: task.taskId,
        setId: creationSet.id,
        planItemId: item.id,
        domainProfile: creationSet.domainProfile,
        createdAt: task.startedAt ?? task.heartbeat,
        completedAt: Date.now(),
        source: {
          assetId: source.id,
          hash: source.hash,
          mimeType: source.mimeType,
          fileName: `source-${source.id}.${source.mimeType === "image/png" ? "png" : "jpg"}`
        },
        references: itemReferences,
        signatureStyleSelection: creationSet.signatureStyleSelection,
        visualDNA: creationSet.sharedVisualDNASnapshot,
        prompt: itemPrompt,
        model: diagnostics.state === "connected"
          ? { provider: "codex", name: "imagegen", version: null }
          : { provider: "mock", name: "styleforge-mock", version: "1" },
        parameters,
        outputs: [{
          assetId: output.id,
          hash: output.hash,
          mimeType: output.mimeType,
          byteLength: output.byteLength,
          fileName: `visualforge-${output.id}.${output.mimeType === "image/png" ? "png" : "jpg"}`
        }]
      });
      const events = createGenerationEvents(manifest, {
        ids: [crypto.randomUUID()],
        parentGenerationId: creationSet.sourceGenerationEventId
      });
      const event = events[0];
      if (!event) throw new Error("没有创建当前画面的生成事件。");
      const completedTask = transitionTask({
        ...task,
        generationEventId: event.id,
        generationEventIds: [event.id]
      }, "COMPLETED", Date.now(), null);
      const projectUpdate: ProjectRecord = {
        ...project,
        domainProfile: creationSet.domainProfile,
        outputAssetIds: [...project.outputAssetIds, output.id],
        updatedAt: Date.now()
      };
      await saveGenerationBundle({
        assets: [output],
        manifest,
        events: [event],
        project: projectUpdate,
        task: completedTask
      });
      task = completedTask;
      activeSetTaskIdRef.current = task.taskId;
      setActiveTask(task);
      activeSetTaskIdRef.current = undefined;
      setSetOutputAssets((assets) => new Map(assets).set(output.id, output));
      await refreshProjects();
      return {
        taskId: task.taskId,
        generationEventId: event.id,
        outputAssetId: output.id,
        outputSha256: output.hash,
        byteLength: output.byteLength,
        finalPrompt: itemPrompt
      };
    } catch (cause) {
      const cancelled = setCancelRef.current ||
        (cause instanceof Error && cause.message === "CANCELLED");
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) {
        task = await transitionSetTask(task, cancelled ? "CANCELLED" : "FAILED", cancelled ? null : {
          code: "GENERATION_FAILED",
          message: safeCreationSetErrorMessage(
            cause instanceof Error ? cause.message : String(cause)
          ),
          retryable: true
        });
      }
      activeSetTaskIdRef.current = undefined;
      throw cause;
    } finally {
      stopTaskHeartbeat();
    }
  }

  async function runActiveCreationSet(initial = activeCreationSet) {
    if (!initial) return;
    if (!requireConnectedCreation()) return;
    if (setRunInFlightRef.current) return;
    setRunInFlightRef.current = true;
    const execute = async (latest: CreationSet) => {
      setCancelRef.current = false;
      const generating = await persistCreationSetUpdate(latest.id, (current) => ({
        ...current,
        status: "GENERATING",
        qualityReport: null,
        updatedAt: Date.now()
      }));
    const completed = await runCreationSet(generating, {
      save: async (incoming) => {
        const saved = await updateCreationSet(incoming.id, (current) =>
          mergeCreationSetProgress(current, incoming));
        if (!saved) throw new Error("这组作品已在另一窗口删除。");
        return saved;
      },
      cancelled: () => setCancelRef.current,
      execute: executeCreationSetItem,
      qualityCheck: diagnostics.state === "connected" && generating.domainProfile.domain === "portrait"
        ? async (creationSet, item, result) => {
            const output = await getAsset(result.outputAssetId);
            if (!output) return { passed: false };
            const references = (await Promise.all(creationSet.sharedReferenceSnapshots.map(async (reference) => {
              const asset = await getAsset(reference.assetId);
              return asset ? {
                role: reference.role,
                imagePurpose: reference.role === "identity"
                  ? reference.subjectAsset?.imagePurposes?.[reference.assetId]
                  : undefined,
                blob: asset.blob
              } : null;
            }))).filter((reference): reference is {
              role: GenerationReferenceSnapshot["role"];
              imagePurpose: "face" | "full_body" | undefined;
              blob: Blob;
            } => Boolean(reference));
            const report = validateSetQualityReportItems(await checkCreationSetQualityNative([{
              itemId: item.id,
              planTitle: item.userFacingTitle,
              creativePlan: item.creativePlan,
              blob: output.blob
            }], creationSet.id, `quality-${result.taskId}`, {
              domain: creationSet.domainProfile.domain,
              references,
              sharedInvariants: creationSet.sharedInvariants,
              signatureStyle: creationSet.signatureStyleSelection
                ? buildSignatureStyleCriticContext(creationSet.signatureStyleSelection) : null
            }), [item.id]);
            const issue = report.issues.find((candidate) =>
              candidate.itemIds.includes(item.id)
              && isPortraitBlockingQualityIssue(candidate.type));
            return { passed: !issue, issue, report };
          }
        : undefined,
      onQualityCheckError: (item, _error) => {
        setToast(`第 ${item.order} 张已生成；自动质量检查未完成，可在结果页稍后检查。`);
      },
      createTaskId: () => crypto.randomUUID(),
      onChange: (next) => {
        if (activeCreationSetIdRef.current === next.id) {
          setActiveCreationSet(next);
        }
        setCreationSets((sets) => [next, ...sets.filter((item) => item.id !== next.id)]);
      }
    });
    let finalSet = completed;
    const isViewingCreationSet = (candidate: CreationSet) => routeRef.current === "create"
      && currentProjectIdRef.current === candidate.projectId
      && activeCreationSetIdRef.current === candidate.id;
    await loadCreationSetOutputs(completed, isViewingCreationSet(completed));
    if (diagnostics.state === "connected" && completed.completedCount > 1 && !setCancelRef.current) {
      finalSet = await runCreationSetQuality(completed) ?? completed;
    }
    await loadCreationSetOutputs(finalSet, isViewingCreationSet(finalSet));
    await refreshCreationSets();
    setActiveTask(undefined);
    setCancelling(false);
    const stillViewingSet = routeRef.current === "create"
      && currentProjectIdRef.current === finalSet.projectId
      && activeCreationSetIdRef.current === finalSet.id;
      if (!stillViewingSet) {
        const nextNotifications = await persistTaskNotification({
          taskId: `set:${finalSet.id}`,
          projectId: finalSet.projectId,
          creationSetId: finalSet.id,
          title: finalSet.title,
          status: finalSet.status === "COMPLETED"
            ? "completed"
            : finalSet.status === "CANCELLED"
              ? "cancelled"
              : finalSet.completedCount > 0 ? "partial" : "failed",
          completedCount: finalSet.completedCount,
          failedCount: finalSet.failedCount,
          requestedCount: finalSet.requestedCount,
          unread: true,
          createdAt: Date.now()
        });
        setTaskNotifications(nextNotifications);
      }
    };
    try {
      if (!("locks" in navigator)) {
        const latest = await getCreationSet(initial.id);
        if (!latest) {
          setToast("这组作品已在另一窗口删除");
          return;
        }
        await execute(latest);
        return;
      }
      let acquired = false;
      await navigator.locks.request(
        `visualforge:creation-set:${initial.id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          acquired = true;
          const latest = await getCreationSet(initial.id);
          if (!latest) {
            setToast("这组作品已在另一窗口删除");
            return;
          }
          await execute(latest);
        }
      );
      if (!acquired) setToast("另一窗口正在生成这组作品，请在该窗口查看进度");
    } finally {
      setRunInFlightRef.current = false;
    }
  }

  async function runCreationSetQuality(creationSet: CreationSet) {
    if (qualityCheckingSetId === creationSet.id) return undefined;
    setQualityCheckingSetId(creationSet.id);
    const checkedOutputByItem = new Map<string, string>();
    try {
      const reveal = routeRef.current === "create"
        && currentProjectIdRef.current === creationSet.projectId
        && activeCreationSetIdRef.current === creationSet.id;
      const completedAssets = await loadCreationSetOutputs(creationSet, reveal);
      const completedItems = creationSet.planItems.filter((item) =>
        item.status === "COMPLETED" && item.outputAssetId);
      for (const item of completedItems) checkedOutputByItem.set(item.id, item.outputAssetId!);
      const referenceAssets = (await Promise.all(creationSet.sharedReferenceSnapshots
        .filter((reference) => reference.role !== "identity" || reference.sourceKind !== "identity_board")
        .map(async (reference) => ({
          reference,
          asset: await getAsset(reference.assetId)
        })))).filter((entry): entry is {
        reference: GenerationReferenceSnapshot;
        asset: AssetRecord;
      } => Boolean(entry.asset));
      const qualityReport = validateSetQualityReportItems(await checkCreationSetQualityNative(
        completedItems.map((item) => ({
          itemId: item.id,
          planTitle: item.userFacingTitle,
          creativePlan: item.creativePlan,
          blob: completedAssets.get(item.outputAssetId!)?.blob
        })).filter((item): item is {
          itemId: string;
          planTitle: string;
          creativePlan: CreationSetPlanItem["creativePlan"];
          blob: Blob;
        } => Boolean(item.blob)),
        creationSet.id,
        crypto.randomUUID(),
        {
          domain: creationSet.domainProfile.domain,
          references: referenceAssets.map(({ reference: snapshot, asset }) => ({
            role: snapshot.role,
            imagePurpose: snapshot.role === "identity"
              ? snapshot.subjectAsset?.imagePurposes?.[snapshot.assetId]
              : undefined,
            blob: asset.blob
          })),
          sharedInvariants: creationSet.sharedInvariants,
          signatureStyle: creationSet.signatureStyleSelection
            ? buildSignatureStyleCriticContext(creationSet.signatureStyleSelection)
            : null
        }
      ), completedItems.map((item) => item.id));
      const signatures = await Promise.all(completedItems.map(async (item) => {
        const asset = completedAssets.get(item.outputAssetId!);
        return asset ? { itemId: item.id, ...(await imageDifferenceSignature(asset.blob)) } : null;
      }));
      const localIssues = [];
      for (let left = 0; left < signatures.length; left += 1) {
        for (let right = left + 1; right < signatures.length; right += 1) {
          const a = signatures[left];
          const b = signatures[right];
          if (!a || !b) continue;
          const hashDistance = hammingDistance(a.hash, b.hash);
          const pixelDifference = normalizedImageDifference(a.gray, b.gray);
          if (hashDistance <= 6 && pixelDifference <= 0.08) {
            localIssues.push({
              type: "near_duplicate" as const,
              severity: "warning" as const,
              itemIds: [a.itemId, b.itemId],
              message: `第 ${completedItems.find((item) => item.id === a.itemId)?.order} 张与第 ${completedItems.find((item) => item.id === b.itemId)?.order} 张局部近重复`,
              suggestion: `感知哈希距离 ${hashDistance}，归一化差异 ${pixelDifference.toFixed(3)}；建议按更大差异重试。`
            });
          }
        }
      }
      const mergedQualityReport = {
        ...qualityReport,
        issues: [...qualityReport.issues, ...localIssues],
        suggestedRetryItemIds: [...new Set([
          ...qualityReport.suggestedRetryItemIds,
          ...localIssues.flatMap((issue) => issue.itemIds)
        ])]
      };
      return await persistCreationSetUpdate(creationSet.id, (latest) => {
        const stableItemIds = new Set(latest.planItems.filter((item) =>
          item.status === "COMPLETED"
          && item.outputAssetId
          && checkedOutputByItem.get(item.id) === item.outputAssetId
        ).map((item) => item.id));
        if (!stableItemIds.size) return latest;
        const stableReport: SetQualityReport = {
          ...mergedQualityReport,
          checkedItemIds: mergedQualityReport.checkedItemIds.filter((id) => stableItemIds.has(id)),
          issues: mergedQualityReport.issues.flatMap((issue) => {
            const itemIds = issue.itemIds.filter((id) => stableItemIds.has(id));
            return itemIds.length ? [{ ...issue, itemIds }] : [];
          }),
          suggestedRetryItemIds: mergedQualityReport.suggestedRetryItemIds.filter((id) => stableItemIds.has(id))
        };
        return {
          ...latest,
          qualityReport: stableReport,
          planItems: latest.planItems.map((item) => {
            if (!stableItemIds.has(item.id)) return item;
            const issues = stableReport.issues.filter((issue) => issue.itemIds.includes(item.id));
            return {
              ...item,
              qualityStatus: issues.length ? "needs_repair" as const : "passed" as const,
              qualityMessage: issues.length
                ? issues.map((issue) => issue.message).join("；")
                : "质量检查已完成，未发现明显阻断问题。",
              error: issues.length ? {
                code: "NEEDS_REPAIR",
                message: issues.map((issue) => issue.message).join("；"),
                retryable: true
              } : item.error?.code === "QUALITY_CHECK_UNAVAILABLE" ? null : item.error
            };
          }),
          updatedAt: Date.now()
        };
      }, routeRef.current === "create"
        && currentProjectIdRef.current === creationSet.projectId
        && activeCreationSetIdRef.current === creationSet.id);
    } catch (cause) {
      const detail = safeCreationSetErrorMessage(
        cause instanceof Error ? cause.message : String(cause),
        "质量检查暂时不可用，可以稍后重试检查。"
      );
      await persistCreationSetUpdate(creationSet.id, (latest) => ({
          ...latest,
          planItems: latest.planItems.map((item) => item.status === "COMPLETED"
            && item.qualityStatus !== "passed"
            && checkedOutputByItem.get(item.id) === item.outputAssetId ? {
              ...item,
              qualityStatus: "unavailable" as const,
              qualityMessage: detail,
              error: {
                code: "QUALITY_CHECK_UNAVAILABLE",
                message: detail,
                retryable: true
              }
            } : item),
          updatedAt: Date.now()
        }), routeRef.current === "create"
          && currentProjectIdRef.current === creationSet.projectId
          && activeCreationSetIdRef.current === creationSet.id).catch(() => undefined);
      setToast("作品已保存；一致性检查暂时不可用，可稍后重试检查。");
      return undefined;
    } finally {
      setQualityCheckingSetId((current) => current === creationSet.id ? undefined : current);
    }
  }

  async function cancelActiveCreationSet() {
    setCancelRef.current = true;
    setCancelling(true);
    setToast("正在停止当前套图，已完成作品不会丢失");
    const taskId = activeSetTaskIdRef.current;
    if (taskId && diagnostics.state === "connected") {
      try {
        await cancelNativeTask(taskId);
      } catch {
        // Runner 会按本地取消标记停止后续项，已完成作品不受影响。
      }
    }
  }

  async function resumeActiveCreationSet() {
    if (!activeCreationSet) return;
    const resumed = await persistCreationSetUpdate(activeCreationSet.id, (current) =>
      resumeCreationSet(current, Date.now()));
    await runActiveCreationSet(resumed);
  }

  async function retryFailedCreationSetItems() {
    if (!activeCreationSet) return;
    const retried = await persistCreationSetUpdate(activeCreationSet.id, (current) =>
      retryFailedSetItems(current, Date.now()));
    await runActiveCreationSet(retried);
  }

  async function exportCreationSet(creationSet: CreationSet) {
    try {
      const assets = await loadCreationSetOutputs(creationSet);
      const blob = await createCreationSetZip(creationSet, assets);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${creationSet.title.replace(/[\\/:*?"<>|]/g, "-")}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setToast(`导出未完成：${cause instanceof Error ? cause.message : "请稍后重试。"}`);
    }
  }

  async function exportCreationSetGrid(creationSet: CreationSet, mimeType: "image/png" | "image/jpeg") {
    try {
      const assets = await loadCreationSetOutputs(creationSet);
      const blob = await createGridComposite(creationSet, assets, undefined, mimeType);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${creationSet.title.replace(/[\\/:*?"<>|]/g, "-")}-宫格.${mimeType === "image/png" ? "png" : "jpg"}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setToast(`宫格导出未完成：${cause instanceof Error ? cause.message : "请稍后重试。"}`);
    }
  }

  async function updateCreationSetDraft(
    transform: (creationSet: CreationSet) => CreationSet
  ) {
    if (!activeCreationSet) return;
    await persistCreationSetUpdate(activeCreationSet.id, transform);
  }

  async function renameActiveCreationSet(title: string) {
    if (!activeCreationSet) return;
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === activeCreationSet.title) return;
    await persistCreationSetUpdate(activeCreationSet.id, (current) => ({
      ...current,
      title: nextTitle,
      updatedAt: Date.now()
    }));
    setToast("套图名称已更新");
  }

  function startRequestedCreation(allowWithoutSubject = false) {
    if (!selectedSubject && !allowWithoutSubject) {
      subjectReminderReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setSubjectReminderOpen(true);
      window.requestAnimationFrame(() => {
        const reminder = document.getElementById("subject-reminder");
        reminder?.scrollIntoView({ behavior: "smooth", block: "center" });
        reminder?.querySelector<HTMLButtonElement>("button")?.focus();
      });
      return;
    }
    setSubjectReminderOpen(false);
    if (creationForm === "set") {
      if (dna && currentProject) void beginCreationSet(
        currentProject,
        dna,
        domainProfile ?? currentProject.domainProfile,
        pendingGridLayoutRef.current?.count ?? requestedSetCount,
        pendingGridLayoutRef.current ?? undefined
      );
      else { afterAnalysisRef.current = "set"; void runAnalyze(); }
    } else if (dna && currentProject) {
      void requestGenerate(currentProject, dna, pendingParentGenerationId, finalPrompt);
    } else {
      afterAnalysisRef.current = "single";
      void runAnalyze();
    }
  }

  async function changeCreationSetCount(requestedCount: 2 | 3 | 4 | 6 | 9 | 12) {
    if (!activeCreationSet) return;
    await persistCreationSetUpdate(activeCreationSet.id, (current) => {
      const direction = createCreativeDirection({
        domain: current.domainProfile.domain,
        visualDNA: current.sharedVisualDNASnapshot,
        domainProfile: current.domainProfile,
        userIntent: current.userIntent
      });
      const basePlanItems = createDirectedCreationSetPlan(
        current.domainProfile.domain,
        requestedCount,
        direction
      );
      const planItems = (current.signatureStyleSelection
        ? applySignatureStyleToCreationPlan(basePlanItems, current.signatureStyleSelection)
        : basePlanItems)
        .map((item) => ({ ...item, id: `${current.id}:${item.id}` }));
      return {
        ...current,
        requestedCount,
        compositeLayout: current.deliveryMode === "independent"
          ? null
          : createGridLayout(requestedCount),
        planItems,
        status: "PLANNING",
        completedCount: 0,
        failedCount: 0,
        qualityReport: null,
        updatedAt: Date.now()
      };
    });
  }

  async function retryCreationSetItem(itemId: string, issue?: SetQualityIssue) {
    if (!activeCreationSet) return;
    const prepared = await persistCreationSetUpdate(activeCreationSet.id, (current) => issue
      ? prepareTargetedRetry(current, itemId, issue, Date.now())
      : prepareCreationSetItemRetry(current, itemId, Date.now()));
    await runActiveCreationSet(prepared);
  }

  async function selectCreationSetOutput(itemId: string, outputAssetId: string) {
    if (!activeCreationSet) return;
    const selectedAsset = setOutputAssets.get(outputAssetId) ?? await getAsset(outputAssetId);
    if (!selectedAsset) {
      setToast("当前候选文件已不存在，无法设为最终作品");
      return;
    }
    const selectedAt = Date.now();
    await persistCreationSetUpdate(activeCreationSet.id, (current) => {
      const item = current.planItems.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error("没有找到要选定的画面。");
      const itemReport = item.qualityReport?.checkedItemIds.includes(item.id)
        ? item.qualityReport
        : null;
      const groupReport = current.qualityReport?.checkedItemIds.includes(item.id)
        ? current.qualityReport
        : null;
      const criticReport = itemReport ?? groupReport;
      const checked = outputAssetId === item.outputAssetId && Boolean(criticReport);
      return finalizeCreationSetOutput(current, {
        itemId,
        outputAssetId,
        outputSha256: selectedAsset.hash,
        byteLength: selectedAsset.byteLength,
        criticDisposition: checked ? "checked" : "skipped",
        criticReportId: criticReport ? `${current.id}:${criticReport.checkedAt}` : null,
        criticCheckedAt: criticReport?.checkedAt ?? null,
        selectedAt
      }, selectedAt);
    });
    setToast("已选为最终作品");
  }

  async function cloneCreationSet() {
    if (!activeCreationSet) return;
    const id = crypto.randomUUID();
    const now = Date.now();
    const clone: CreationSet = {
      ...activeCreationSet,
      id,
      title: `${activeCreationSet.title} · 新组`,
      sourceGenerationEventId: activeCreationSet.planItems.find((item) => item.generationEventId)?.generationEventId ?? activeCreationSet.sourceGenerationEventId,
      status: "PLANNING",
      completedCount: 0,
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
      qualityReport: null,
      planItems: (activeCreationSet.signatureStyleSelection
        ? applySignatureStyleToCreationPlan(createDirectedCreationSetPlan(
            activeCreationSet.domainProfile.domain,
            activeCreationSet.requestedCount,
            createCreativeDirection({
              domain: activeCreationSet.domainProfile.domain,
              visualDNA: activeCreationSet.sharedVisualDNASnapshot,
              domainProfile: activeCreationSet.domainProfile,
              userIntent: activeCreationSet.userIntent
            })
          ), activeCreationSet.signatureStyleSelection)
        : createDirectedCreationSetPlan(
        activeCreationSet.domainProfile.domain,
        activeCreationSet.requestedCount,
        createCreativeDirection({
          domain: activeCreationSet.domainProfile.domain,
          visualDNA: activeCreationSet.sharedVisualDNASnapshot,
          domainProfile: activeCreationSet.domainProfile,
          userIntent: activeCreationSet.userIntent
        })
      ))
        .map((item) => ({ ...item, id: `${id}:${item.id}` }))
    };
    await persistActiveCreationSet(clone);
    setSetOutputAssets(new Map());
  }

  async function replanCreationSet() {
    if (!activeCreationSet) return;
    const id = crypto.randomUUID();
    await persistCreationSetUpdate(activeCreationSet.id, (current) => {
      const direction = createCreativeDirection({
        domain: current.domainProfile.domain,
        visualDNA: current.sharedVisualDNASnapshot,
        domainProfile: current.domainProfile,
        userIntent: current.userIntent
      });
      const basePlanItems = createDirectedCreationSetPlan(
        current.domainProfile.domain,
        current.requestedCount,
        direction
      );
      const planItems = (current.signatureStyleSelection
        ? applySignatureStyleToCreationPlan(basePlanItems, current.signatureStyleSelection)
        : basePlanItems).map((item, index) => ({
        ...item,
        id: `${current.id}:${id}:${item.id}`,
        promptDelta: `${item.promptDelta}。替代计划 ${index + 1}：改变画面节奏，但不改变共享人物、主体和风格锚点。`
      }));
      return {
        ...current,
        planItems,
        status: "PLANNING",
        completedCount: 0,
        failedCount: 0,
        qualityReport: null,
        updatedAt: Date.now()
      };
    });
  }

  async function removeCreationSet(works: boolean) {
    if (!activeCreationSet) return;
    const confirmed = works
      ? confirm("删除这组套图及组内作品？人物、商品、参考图方法和其他作品不会删除。此操作无法撤销。")
      : confirm("删除这组套图记录？已生成图片会保留在作品中。");
    if (!confirmed) return;
    if (works) await deleteCreationSetWithWorks(activeCreationSet.id);
    else await deleteCreationSet(activeCreationSet.id);
    setActiveCreationSet(undefined);
    setSetOutputAssets(new Map());
    await Promise.all([refreshCreationSets(), refreshProjects()]);
    await navigate("library");
  }

  async function removeCreationSetFromLibrary(creationSet: CreationSet) {
    if (!confirm(`删除套图“${creationSet.title}”？已生成图片会保留在作品中。`)) return;
    await deleteCreationSet(creationSet.id);
    await Promise.all([refreshCreationSets(), refreshProjects()]);
    setToast("套图记录已删除，已生成图片仍保留");
  }

  async function requestGenerate(
    project = currentProject,
    currentDna = dna,
    parentGenerationId: string | null = pendingParentGenerationId,
    promptOverride = "",
    selectGeneratedAsFinal = true
  ) {
    if (!project || !currentDna) return;
    if (!requireConfirmedProductIdentityLock()) return;
    const summaries = preferenceSummaries.slice(0, 3);
    if (!summaries.length) {
      await runGenerate(project, currentDna, parentGenerationId, undefined, "", selectGeneratedAsFinal, promptOverride);
      return;
    }
    setPendingPreferenceGeneration({
      project,
      dna: currentDna,
      parentGenerationId,
      summaries,
      promptOverride,
      selectGeneratedAsFinal
    });
  }

  async function runSingleQuality(
    asset: AssetRecord,
    project = currentProject,
    currentDna = dna,
    eventRecords = generationEvents,
    referenceSnapshots?: GenerationReferenceSnapshot[]
  ) {
    if (!project || !currentDna || singleQualityChecking) return;
    setSingleQualityChecking(true);
    try {
      const profile = project.domainProfile ?? createMigrationDomainProfile();
      const direction = createCreativeDirection({
        domain: profile.domain,
        visualDNA: currentDna,
        domainProfile: profile,
        userIntent: project.userInstruction
      });
      const generationEvent = eventRecords.find((item) => item.outputAssetId === asset.id);
      const fallbackPlan = createDirectedCreationSetPlan(profile.domain, 4, direction);
      const plan = findCriticPlanItem(creationSets, generationEvent, asset.id) ??
        (project.signatureStyleSelection
          ? applySignatureStyleToCreationPlan(fallbackPlan, project.signatureStyleSelection)[0]
          : fallbackPlan[0]);
      if (!plan) throw new Error("无法准备当前作品的评审计划。");
      const snapshots = referenceSnapshots?.length
        ? referenceSnapshots
        : project.referenceSnapshots?.length
          ? project.referenceSnapshots
          : currentReferenceSnapshots(reference!);
      const references = (await Promise.all(snapshots
        .filter((snapshot) => snapshot.role !== "identity" || snapshot.sourceKind !== "identity_board")
        .map(async (snapshot) => ({
        role: snapshot.role,
        imagePurpose: snapshot.role === "identity"
          ? snapshot.subjectAsset?.imagePurposes?.[snapshot.assetId]
          : undefined,
        asset: await getAsset(snapshot.assetId)
      })))).filter((item): item is {
        role: GenerationReferenceSnapshot["role"];
        imagePurpose: "face" | "full_body" | undefined;
        asset: AssetRecord;
      } => Boolean(item.asset));
      const sharedInvariants = [
        "保持参考图的核心光线、构图逻辑和视觉气质",
        ...snapshots.flatMap((snapshot) => snapshot.subjectAsset?.constraints ?? [])
      ];
      const report = validateSetQualityReportItems(await checkCreationSetQualityNative(
        [{
          itemId: asset.id,
          planTitle: "当前作品",
          creativePlan: plan.creativePlan,
          blob: asset.blob
        }],
        project.id,
        crypto.randomUUID(),
        {
          domain: profile.domain,
          references: references.map(({ role, imagePurpose, asset: referenceAsset }) => ({
            role,
            imagePurpose,
            blob: referenceAsset.blob
          })),
          sharedInvariants: [
            ...sharedInvariants,
            ...(project.signatureStyleSelection?.styleSnapshot.acceptance.observableSignals ?? [])
          ],
          signatureStyle: project.signatureStyleSelection
            ? buildSignatureStyleCriticContext(project.signatureStyleSelection)
            : null
        }
      ), [asset.id]);
      setSingleQualityReport(report);
      setSingleQualityAssetId(asset.id);
    } catch (cause) {
      setToast(`作品已保存，评审暂时未完成：${cause instanceof Error ? cause.message : "未知错误"}`);
    } finally {
      setSingleQualityChecking(false);
    }
  }

  async function retrySingleWithIssue(
    asset: AssetRecord,
    event: GenerationEvent | undefined,
    issue: SetQualityIssue
  ) {
    if (!currentProject || !dna) return;
    const guidance = buildTargetedRetryPrompt(
      currentProject.signatureStyleSelection
        ? `风格定向修复：${currentProject.signatureStyleSelection.styleSnapshot.critic.retryStrategy}`
        : "定向修复当前单张",
      issue.type,
      issue.message,
      currentProject.domainProfile?.domain ?? "photography",
      {
        impact: issue.impact,
        retryFocus: issue.retryFocus ?? issue.suggestion,
        preserve: issue.preserve
      },
      1
    );
    await runGenerate(currentProject, dna, event?.id ?? null, undefined, guidance, false);
  }

  async function selectProjectOutput(asset: AssetRecord) {
    if (!currentProject || !currentProject.outputAssetIds.includes(asset.id)) return;
    const event = generationEvents.find((item) => item.outputAssetId === asset.id);
    if (!event) {
      setToast("当前作品缺少生成记录，暂时不能设为最终版本");
      return;
    }
    const updated = await persistProjectUpdate(currentProject.id, (stored) => ({
      ...stored,
      finalSelection: createProjectFinalSelection(
        asset,
        event,
        singleQualityReport,
        singleQualityAssetId,
        Date.now()
      ),
      updatedAt: Date.now()
    }));
    const ordered = await Promise.all(updated.outputAssetIds.map(getAsset));
    setOutputs(ordered.filter((item): item is AssetRecord => Boolean(item)));
    setSingleQualityReport(undefined);
    setSingleQualityAssetId(undefined);
    setToast("已选为最终版本");
    await refreshProjects();
  }

  async function resolvePendingPreference(decision: "applied" | "ignored") {
    const pending = pendingPreferenceGeneration;
    if (!pending) return;
    setPendingPreferenceGeneration(undefined);
    await runGenerate(
      pending.project,
      pending.dna,
      pending.parentGenerationId,
      undefined,
      resolvePreferenceSuggestion(pending.summaries, decision),
      pending.selectGeneratedAsFinal,
      pending.promptOverride
    );
  }

  async function retryTask(task: TaskRecord) {
    const [source, project] = await Promise.all([
      getAsset(task.input.sourceAssetId),
      getProject(task.projectId)
    ]);
    const retryDna = task.input.visualDNA ?? project?.visualDNA;
    if (!source || (task.operation !== "ANALYSIS" && (!project || !retryDna))) {
      setLastRetryableTask(undefined);
      setErrorContext(!source ? "image" : task.operation === "ANALYSIS" ? "analysis" : "generation");
      setError(!source
        ? "原参考图已不存在，请重新添加参考图后再试。"
        : !project
          ? "这条创作记录已不存在，请返回作品重新开始。"
          : "这条记录缺少已保存的参考图分析，请回到参考图重新分析。");
      setStage("error");
      return;
    }
    if (source) setRefs({ style_layout: { ...source, role: "style_layout" } });
    if (project) {
      setCurrentProject(project);
      setSignatureStyleSelection(project.signatureStyleSelection ?? null);
      setInstruction(task.input.parameters?.userInstruction ?? project.userInstruction);
      setRatio(task.input.parameters?.aspectRatio ?? project.aspectRatio);
      const retryCount = task.input.parameters?.count;
      setCount(retryCount === 3 ? project.count : retryCount ?? project.count);
      setDna(task.input.visualDNA ?? project.visualDNA);
    }
    const next = createRetryTask(task, crypto.randomUUID(), Date.now());
    await saveTaskRecord(next);
    setActiveTask(next);
    setInterruptedTasks((items) => items.filter((item) => item.taskId !== task.taskId));
    setLastRetryableTask(undefined);
    if (task.operation === "ANALYSIS") {
      await runAnalyze(task.input.parentGenerationId, next, source);
    } else {
      await runGenerate(project, retryDna, task.input.parentGenerationId, next);
    }
  }

  async function dismissInterruptedTaskReminder(taskId: string) {
    const next = new Set(dismissedRetryTaskIds).add(taskId);
    setDismissedRetryTaskIds(next);
    await chrome.storage.local.set({ [DISMISSED_RETRY_TASKS_KEY]: [...next] });
    setInterruptedTasks((items) => items.filter((item) => item.taskId !== taskId));
  }

  async function cancel() {
    const task = activeTaskRef.current;
    if (!task) {
      setErrorContext("cancel");
      setError("当前没有可取消的任务。");
      setStage("error");
      return;
    }
    cancelRef.current = true;
    setCancelling(true);
    setToast("正在取消当前任务，图片和要求会保留");
    if (diagnostics.state !== "connected") {
      const cancelled = transitionTask(task, "CANCELLED", Date.now());
      await saveTaskRecord(cancelled);
      activeTaskRef.current = undefined;
      setActiveTask(cancelled);
      setCancelling(false);
      setStage("ready");
      setToast("已取消，图片和要求仍然保留");
      return;
    }
    if (diagnostics.state === "connected") {
      try {
        const result = await cancelNativeTask(task.taskId);
        if (!result.cancelled) {
          cancelRef.current = false;
          setCancelling(false);
          setErrorContext("cancel");
          setError(result.message);
          setStage("error");
        }
      } catch (cause) {
        cancelRef.current = false;
        setCancelling(false);
        setErrorContext("cancel");
        setError(cause instanceof Error ? cause.message : "取消请求发送失败。");
        setStage("error");
      }
    }
  }

  function leaveErrorState() {
    setError("");
    setErrorContext("generic");
    setLastRetryableTask(undefined);
    setStage(dna ? "ready" : "idle");
  }

  function chooseReplacementImage() {
    setError("");
    setErrorContext("generic");
    setStage("idle");
    window.requestAnimationFrame(() =>
      document.getElementById("styleforge-primary-image")?.click());
  }

  async function openProject(id: string, fromLibrary?: boolean) {
    currentProjectIdRef.current = id;
    activeCreationSetIdRef.current = undefined;
    const stored = await getProject(id);
    if (!stored) return;
    const project = stored.domainProfile ? stored : await persistProjectUpdate(stored.id, (current) => ({
      ...current,
      domainProfile: createMigrationDomainProfile(),
      updatedAt: Date.now()
    }));
    const referenceAssets = await Promise.all(project.referenceAssetIds.map(getAsset));
    const [events, projectCreationSets] = await Promise.all([
      listGenerationEvents(project.id),
      listCreationSets(project.id)
    ]);
    const activeCreationSetIds = new Set(projectCreationSets.map((creationSet) => creationSet.id));
    const standaloneEvents = events.filter((event) =>
      !event.setId || !activeCreationSetIds.has(event.setId));
    const containerCreationSet = standaloneEvents.length === 0
      ? [...projectCreationSets].sort((left, right) => right.updatedAt - left.updatedAt)[0]
      : undefined;
    if (containerCreationSet) {
      await openCreationSet(containerCreationSet.id, fromLibrary);
      return;
    }
    const visibleOutputAssetIds = activeCreationSetIds.size
      ? project.outputAssetIds.filter((assetId) =>
          standaloneEvents.some((event) => event.outputAssetId === assetId))
      : project.outputAssetIds;
    const outputAssets = await Promise.all(visibleOutputAssetIds.map(getAsset));
    setRefs(Object.fromEntries(referenceAssets.filter(Boolean).map((asset, index) => [
      index === 0 ? "style_layout" : asset!.role,
      index === 0 ? { ...asset!, role: "style_layout" as const } : asset!
    ])));
    setOutputs(outputAssets.filter(Boolean) as AssetRecord[]);
    setResultFocusAssetId(undefined);
    setGenerationEvents(standaloneEvents);
    setDnaHistory(await ensureVisualDNARevisions(project));
    setPendingParentGenerationId(null);
    setActiveCreationSet(undefined);
    setSetOutputAssets(new Map());
    setReturnToCreationSetId(undefined);
    setPendingPreferenceGeneration(undefined);
    setCurrentProject(project);
    if (fromLibrary !== undefined) setLibraryDetailOpen(fromLibrary);
    setSignatureStyleSelection(project.signatureStyleSelection ?? null);
    setSelectedSubject(project.selectedSubjectAssetId
      ? await getSubjectAsset(project.selectedSubjectAssetId) ?? undefined
      : undefined);
    setConfirmedReferencePrompt(project.outputAssetIds.length ? "" : project.compiledPrompt ?? "");
    setPromptConfirmed(Boolean(project.visualDNA && project.compiledPrompt && !project.outputAssetIds.length));
    setFinalPromptCopied(false);
    setFinalPromptCopyError(false);
    const runningTask = activeTaskRef.current?.projectId === project.id
      ? activeTaskRef.current
      : undefined;
    const retryableTask = !runningTask
      ? interruptedTasks.find((task) => task.projectId === project.id)
      : undefined;
    if (!runningTask) setActiveTask(undefined);
    setInstruction(project.userInstruction);
    setRatio(project.aspectRatio);
    setCount(project.count);
    setMode(project.mode === "analyze" ? "analyze" : "direct");
    setDna(project.visualDNA);
    setDomainProfile(project.domainProfile);
    if (retryableTask && !visibleOutputAssetIds.length) {
      setLastRetryableTask(retryableTask);
      setErrorContext(retryableTask.operation === "ANALYSIS" ? "analysis" : "generation");
      setError(retryableTask.error?.message ?? "上次创作没有完成，图片和要求仍然保留。");
      setStage("error");
    } else {
      setLastRetryableTask(retryableTask);
      setError("");
      setStage(runningTask && ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(runningTask.status)
        ? runningTask.operation === "ANALYSIS" ? "analyzing" : "rendering"
        : visibleOutputAssetIds.length ? "complete" : project.visualDNA ? "ready" : "idle");
    }
    await navigate("create");
  }

  async function openCreationSet(id: string, fromLibrary?: boolean) {
    const creationSet = await getCreationSet(id);
    if (!creationSet) return;
    routeRef.current = "create";
    currentProjectIdRef.current = creationSet.projectId;
    activeCreationSetIdRef.current = creationSet.id;
    setActiveCreationSet(creationSet);
    if (fromLibrary !== undefined) setLibraryDetailOpen(fromLibrary);
    await loadCreationSetOutputs(creationSet);
    const project = await getProject(creationSet.projectId);
    if (project) {
      const referenceAssets = await Promise.all(project.referenceAssetIds.map(getAsset));
      setRefs(Object.fromEntries(referenceAssets.filter(Boolean).map((asset, index) => [
        index === 0 ? "style_layout" : asset!.role,
        index === 0 ? { ...asset!, role: "style_layout" as const } : asset!
      ])));
      setCurrentProject(project);
      setSignatureStyleSelection(creationSet.signatureStyleSelection ?? project.signatureStyleSelection ?? null);
      setDna(creationSet.sharedVisualDNASnapshot);
      setDomainProfile(creationSet.domainProfile);
    }
    await navigate("create");
  }

  async function changeDomain(domain: Domain) {
    const current = domainProfile ?? currentProject?.domainProfile;
    if (!current) return;
    const overridden = overrideDomainProfile(current, domain);
    setDomainProfile(overridden);
    if (currentProject) {
      await persistProjectUpdate(currentProject.id, (stored) => ({
        ...stored,
        domainProfile: overridden,
        updatedAt: Date.now()
      }));
    }
  }

  async function renameProject(project: ProjectRecord, title: string) {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === project.title) return;
    await persistProjectUpdate(project.id, (stored) => ({
      ...stored,
      title: nextTitle,
      updatedAt: Date.now()
    }));
    await refreshProjects();
    setToast("作品名称已更新");
  }

  async function removeProject(project: ProjectRecord) {
    if (!confirm(`删除作品“${project.title}”？对应单图和创作记录将从本机删除，此操作无法撤销。`)) return;
    await deleteStandaloneProjectWorks(project.id);
    await Promise.all([refreshProjects(), refreshPreferenceSummaries()]);
    if (currentProject?.id === project.id) {
      setCurrentProject(undefined);
      setOutputs([]);
      setGenerationEvents([]);
      setDnaHistory([]);
      setStage("idle");
      setLibraryDetailOpen(false);
      await navigate("library");
    }
    setToast("作品已删除");
  }

  async function exportAsset(asset: AssetRecord) {
    if (currentProject?.finalSelection) {
      try {
        await verifyProjectFinalAsset(asset, currentProject.finalSelection);
      } catch (cause) {
        setToast(cause instanceof Error ? cause.message : "最终作品文件校验失败");
        return;
      }
    }
    const url = URL.createObjectURL(asset.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `visualforge-${asset.id.slice(0, 8)}.${asset.mimeType === "image/png" ? "png" : "jpg"}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function startNew() {
    if (activeTaskRef.current &&
      ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(activeTaskRef.current.status)) {
      setToast("当前创作仍在处理中，请先查看或取消当前任务");
      return;
    }
    setRefs({});
    setInstruction("");
    setMode("direct");
    setRatio(settingsValue.defaultAspectRatio);
    setCount(settingsValue.defaultCount);
    setCreationForm("single");
    setRequestedSetCount(4);
    setDeliveryMode("both");
    setDna(undefined);
    setDomainProfile(undefined);
    setSignatureStyleSelection(null);
    setConfirmedReferencePrompt("");
    setPromptConfirmed(false);
    setFinalPromptCopied(false);
    setFinalPromptCopyError(false);
    setOutputs([]);
    setResultFocusAssetId(undefined);
    setGenerationEvents([]);
    setDnaHistory([]);
    setPendingParentGenerationId(null);
    setCurrentProject(undefined);
    setActiveCreationSet(undefined);
    setDetectedGrid(null);
    pendingGridLayoutRef.current = null;
    setGridCreationPrepared(false);
    setGridPlanningProgress(null);
    setSetOutputAssets(new Map());
    setReturnToCreationSetId(undefined);
    setStage("idle");
    setError("");
    setErrorContext("generic");
    setLastRetryableTask(undefined);
    setActiveTask(undefined);
    setCancelling(false);
    setCapturePreview(undefined);
    setSelectedSubject(undefined);
    setAutoSelectedSubjectName("");
    setSubjectPickerOpen(false);
    setSubjectReminderOpen(false);
    setSubjectEditor(undefined);
    setLibraryDetailOpen(false);
    void navigate("create");
  }

  function openCreateHome() {
    if (activeCreationSet?.status === "GENERATING" || activeTaskRef.current &&
      ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(activeTaskRef.current.status)) {
      returnToCurrentTask();
      return;
    }
    if (libraryDetailOpen || ["complete", "error"].includes(stage) || activeCreationSet) {
      startNew();
      return;
    }
    void navigate("create");
  }

  function returnToCurrentTask() {
    if (activeCreationSet?.status === "GENERATING") {
      void navigate("create");
      return;
    }
    const task = activeTaskRef.current ?? activeTask;
    if (task) void openProject(task.projectId);
    else void navigate("create");
  }

  function handleNavigationKey(event: KeyboardEvent<HTMLButtonElement>, current: Route) {
    const routes: Route[] = ["create", "library"];
    const currentIndex = routes.indexOf(current);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % routes.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + routes.length) % routes.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? routes.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = routes[nextIndex]!;
    const navigation = next === "create" && libraryDetailOpen
      ? (startNew(), Promise.resolve())
      : navigate(next);
    void navigation.then(() => {
      document.querySelector<HTMLButtonElement>(`[data-route="${next}"]`)?.focus();
    });
  }

  function handleLibraryKindKey(event: KeyboardEvent<HTMLButtonElement>, current: LibraryKind) {
    const kinds: LibraryKind[] = ["works", "people", "subjects"];
    const currentIndex = kinds.indexOf(current);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % kinds.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + kinds.length) % kinds.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? kinds.length - 1
            : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = kinds[nextIndex]!;
    setLibraryKind(next);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-library-kind="${next}"]`)?.focus());
  }

  const showLibraryTools = projects.length + creationSets.length >= 6;
  const normalizedWorkSearch = search.trim().toLowerCase();
  const hasActiveWorkSearch = showLibraryTools && Boolean(normalizedWorkSearch);
  const setOutputIdsByProject = useMemo(() => {
    const outputIds = new Map<string, Set<string>>();
    creationSets.forEach((creationSet) => {
      const setOutputIds = outputIds.get(creationSet.projectId) ?? new Set<string>();
      creationSet.planItems.forEach((item) => {
        if (item.outputAssetId) setOutputIds.add(item.outputAssetId);
        item.outputCandidates.forEach((candidate) => setOutputIds.add(candidate.outputAssetId));
      });
      outputIds.set(creationSet.projectId, setOutputIds);
    });
    return outputIds;
  }, [creationSets]);
  const standaloneProjects = useMemo(() => projects.filter((project) => {
    const setOutputIds = setOutputIdsByProject.get(project.id);
    return !setOutputIds || project.outputAssetIds.some((assetId) => !setOutputIds.has(assetId));
  }), [projects, setOutputIdsByProject]);
  const standaloneOutputAssetIds = (project: ProjectRecord) => {
    const setOutputIds = setOutputIdsByProject.get(project.id);
    return setOutputIds
      ? project.outputAssetIds.filter((assetId) => !setOutputIds.has(assetId))
      : project.outputAssetIds;
  };
  const filteredProjects = useMemo(() => {
    return standaloneProjects.filter((project) => {
      const matches = !hasActiveWorkSearch || `${project.title} ${project.userInstruction} ${project.visualDNA?.summary ?? ""}`.toLowerCase().includes(normalizedWorkSearch);
      return matches;
    });
  }, [standaloneProjects, hasActiveWorkSearch, normalizedWorkSearch]);
  const filteredCreationSets = useMemo(() => creationSets.filter((creationSet) =>
    !hasActiveWorkSearch || `${creationSet.title} ${creationSet.userIntent} ${creationSet.domainProfile.domain} ${creationSet.subjectAssetSnapshots.map((item) => item.name).join(" ")}`
      .toLowerCase().includes(normalizedWorkSearch)
  ), [creationSets, hasActiveWorkSearch, normalizedWorkSearch]);
  const filteredWorkEntries = useMemo(() => [
    ...filteredProjects.map((project) => ({ kind: "project" as const, updatedAt: project.updatedAt, project })),
    ...filteredCreationSets.map((creationSet) => ({ kind: "set" as const, updatedAt: creationSet.updatedAt, creationSet }))
  ].sort((left, right) => right.updatedAt - left.updatedAt), [filteredCreationSets, filteredProjects]);
  const recentCreationTarget = useMemo(
    () => selectMostRecentCreationTarget(standaloneProjects, creationSets),
    [creationSets, standaloneProjects]
  );
  const recentProject = recentCreationTarget?.kind === "project"
    ? projects.find((project) => project.id === recentCreationTarget.id)
    : undefined;
  const recentCreationSet = recentCreationTarget?.kind === "set"
    ? creationSets.find((creationSet) => creationSet.id === recentCreationTarget.id)
    : undefined;
  const retryableTaskByProject = useMemo(() => new Map([...interruptedTasks].reverse().map((task) =>
    [task.projectId, task] as const)), [interruptedTasks]);
  const resultRetryableTask = currentProject
    ? lastRetryableTask ?? retryableTaskByProject.get(currentProject.id)
    : undefined;
  const createRecoveryTasks = useMemo(() => interruptedTasks.slice(0, 3), [interruptedTasks]);
  const hasRunningTask = Boolean(activeTask &&
    ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(activeTask.status))
    || activeCreationSet?.status === "GENERATING";
  const hasCurrentTask = hasRunningTask;
  const runningTaskLabel = activeCreationSet?.status === "GENERATING"
    ? `正在创作 ${activeCreationSet.completedCount}/${activeCreationSet.requestedCount}`
    : activeTask?.operation === "ANALYSIS"
      ? "正在理解参考图"
      : "正在生成图片";
  const taskPresentation = useMemo(() => activeTask
    ? presentTaskLifecycle(activeTask.operation, activeTask.status, stage === "saving" ? "saving" : null)
    : undefined, [activeTask, stage]);
  const activeCandidateCount = activeTask?.input.parameters?.count ?? count;
  const visibleError = useMemo(
    () => presentUserError(errorContext, error, captureErrorMethod),
    [captureErrorMethod, error, errorContext]
  );
  const connectionIssue = useMemo(
    () => connectionGuidance(diagnostics.state),
    [diagnostics.state]
  );
  const referencePrompt = useMemo(() => {
    if (!dna || !reference) return "";
    const references = currentReferenceSnapshots(reference, undefined);
    return compilePrompt({
      visualDNA: applyReferencesToDNA(dna, references),
      domainProfile,
      userInstruction: "",
      aspectRatio: ratio,
      references: promptReferences(references)
    });
  }, [dna, reference, domainProfile, ratio]);
  const compiledFinalPrompt = useMemo(() => {
    if (!dna || !reference) return "";
    const references = currentReferenceSnapshots(reference);
    return compilePrompt({
      visualDNA: applyReferencesToDNA(dna, references),
      domainProfile,
      userInstruction: instruction,
      aspectRatio: ratio,
      references: promptReferences(references)
    });
  }, [dna, reference, selectedSubject, subjectImages, domainProfile, instruction, ratio]);
  const finalPrompt = useMemo(() => composeFinalPrompt(
    referencePrompt,
    confirmedReferencePrompt || referencePrompt,
    compiledFinalPrompt
  ), [compiledFinalPrompt, confirmedReferencePrompt, referencePrompt]);
  const busy = ["analyzing", "rendering", "saving"].includes(stage);
  const visibleTaskNotification = taskNotifications.find((notification) =>
    notification.unread && !deferredNotificationTokens.has(taskNotificationToken(notification)));
  const visibleTaskNotificationCopy = visibleTaskNotification
    ? taskNotificationCopy(visibleTaskNotification)
    : undefined;

  if (!hydrated) {
    return <div className="app-loading"><LoaderCircle className="spinner" size={22} /><span>正在恢复本地数据…</span></div>;
  }
  if (hydrationError) {
    return (
      <main className="recovery-page" role="alert" aria-labelledby="hydration-error-title">
        <p className="eyebrow">VisualForge · 本地恢复</p>
        <h1 id="hydration-error-title">本地数据恢复未完成</h1>
        <p>作品仍保存在本机，没有被删除。请先重试；若问题持续，可从设置页导出或清理异常数据。</p>
        <div className="recovery-actions">
          <button type="button" className="primary" onClick={retryHydration}>重试恢复</button>
          <button type="button" onClick={() => {
            setHydrationError(undefined);
            setRoute("settings");
          }}>打开设置</button>
        </div>
        <details><summary>错误详情</summary><pre>{hydrationError}</pre></details>
      </main>
    );
  }
  return (
    <div
      className={`app ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault(); setDragging(false);
        const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
        if (file) void addImage(file, "style_layout");
      }}
    >
      <header>
        <div className="brand-row">
          <span className="brand-lockup">
            <img src="/icon/32.png" alt="" aria-hidden="true" />
            <strong>VisualForge</strong>
          </span>
          <div className="brand-actions">
            {hasRunningTask
              ? <button type="button" className="connection task-indicator" onClick={returnToCurrentTask}>
                  <LoaderCircle className="spinner" size={13} />{runningTaskLabel}
                </button>
              : <span className="connection"><i className={diagnostics.state === "connected" ? "online" : ""} />{forceMock ? "测试预览" : diagnostics.label}</span>}
            <button type="button" className="icon-button settings-trigger" aria-label="打开设置" onClick={() => void navigate("settings")}><Settings size={17} /></button>
          </div>
        </div>
        {route !== "settings" && (
          <nav role="tablist" aria-label="主导航">
            <button type="button" role="tab" data-route="create" aria-controls={subjectEditor && route === "create" ? "subject-editor-panel" : "create-panel"} aria-selected={route === "create"} tabIndex={route === "create" ? 0 : -1} className={route === "create" ? "active" : ""} onKeyDown={(event) => handleNavigationKey(event, "create")} onClick={openCreateHome}><Palette size={16} aria-hidden="true" />创作</button>
            <button type="button" role="tab" data-route="library" aria-controls={subjectEditor && route === "library" ? "subject-editor-panel" : "library-panel"} aria-selected={route === "library"} tabIndex={route === "library" ? 0 : -1} className={route === "library" ? "active" : ""} onKeyDown={(event) => handleNavigationKey(event, "library")} onClick={() => void navigate("library")}><Library size={16} aria-hidden="true" />作品{taskNotifications.some((item) => item.unread) && <i className="unread-dot" aria-label="有新作品" />}</button>
          </nav>
        )}
      </header>

      <main>
        {integrityIssues.length > 0 && (
          <section className="integrity-notice" role="status" aria-live="polite">
            <CircleAlert size={18} aria-hidden="true" />
            <div className="integrity-notice-copy">
              <strong>已隔离 {integrityIssues.length} 条异常记录</strong>
              <p>其余作品已正常恢复；异常记录仍保留在本机，VisualForge 不会自动删除。</p>
            </div>
            <div className="integrity-notice-actions" aria-label="异常记录处理">
              <button type="button" onClick={downloadIntegrityDiagnostic}>下载诊断 JSON</button>
              <button type="button" className="secondary" onClick={retryHydration}>重新检查</button>
              <button type="button" className="text-button" onClick={() => void navigate("settings")}>打开数据与隐私设置</button>
            </div>
          </section>
        )}
        {visibleTaskNotification && (
          <section className="task-notification" role="status">
            <span><strong>{visibleTaskNotificationCopy?.title}</strong><small>{visibleTaskNotificationCopy?.detail}</small></span>
            <button type="button" onClick={async () => {
              const notification = visibleTaskNotification;
              const next = taskNotifications.map((item) => item.taskId === notification.taskId
                ? { ...item, unread: false } : item);
              await chrome.storage.local.set({ [TASK_NOTIFICATIONS_KEY]: next });
              setTaskNotifications(next);
              if (notification.creationSetId) await openCreationSet(notification.creationSetId, true);
              else await openProject(notification.projectId, true);
            }}>立即查看</button>
            <button type="button" className="secondary" onClick={() => {
              setDeferredNotificationTokens((tokens) => new Set(tokens).add(taskNotificationToken(visibleTaskNotification)));
            }}>稍后</button>
          </section>
        )}
        {!forceMock && diagnosticsChecked && (diagnostics.state !== "connected" || diagnostics.imagegen === false) && (
          <section className="connection-banner" role="status">
            <CircleAlert size={17} aria-hidden="true" />
            <span>
              <strong>创作连接尚未就绪</strong>
              <small>仍可浏览作品和添加参考图；分析与生成前需要先完成连接。</small>
            </span>
            <button type="button" onClick={() => void navigate("settings")}>去连接</button>
          </section>
        )}
        {subjectEditor && (
          <div id="subject-editor-panel" role="tabpanel" aria-label="主体编辑">
            <SubjectAssetEditor
              initial={subjectEditor.asset}
              initialType={subjectEditor.initialType}
              initialImages={(subjectEditor.asset?.imageIds ?? [])
                .map((id) => subjectImages.get(id))
                .filter((image): image is AssetRecord => Boolean(image))}
              onSave={(draft) => saveSubjectDraft(draft, subjectEditor.asset)}
              onCancel={closeSubjectEditor}
              onDelete={subjectEditor.asset ? () => void removeSubjectAssetRecord(subjectEditor.asset!) : undefined}
              identityBoardImage={subjectEditor.asset?.identityBoard
                ? subjectImages.get(subjectEditor.asset.identityBoard.assetId)
                : undefined}
              identityBoardBusy={identityBoardBusy}
              onGenerateIdentityBoard={subjectEditor.asset
                ? () => generateIdentityBoard(subjectEditor.asset!)
                : undefined}
              onConfirmIdentityBoard={subjectEditor.asset
                ? () => setIdentityBoardStatus(subjectEditor.asset!, "confirmed")
                : undefined}
              onDisableIdentityBoard={subjectEditor.asset
                ? () => setIdentityBoardStatus(subjectEditor.asset!, "disabled")
                : undefined}
              onEnableIdentityBoard={subjectEditor.asset
                ? () => setIdentityBoardStatus(subjectEditor.asset!, "confirmed")
                : undefined}
              onDeleteIdentityBoard={subjectEditor.asset
                ? () => deleteIdentityBoard(subjectEditor.asset!)
                : undefined}
              onConfirmProductIdentityLock={subjectEditor.asset
                ? async () => { await setProductIdentityLockStatus(subjectEditor.asset!, "confirmed"); }
                : undefined}
              onDisableProductIdentityLock={subjectEditor.asset
                ? async () => { await setProductIdentityLockStatus(subjectEditor.asset!, "disabled"); }
                : undefined}
              onEnableProductIdentityLock={subjectEditor.asset
                ? async () => { await setProductIdentityLockStatus(subjectEditor.asset!, "confirmed"); }
                : undefined}
            />
          </div>
        )}
        {!subjectEditor && route === "create" && (
          <div className="page create-page" id="create-panel" role="tabpanel" aria-label="创作">
            {activeCreationSet ? (
              <CreationSetView
                creationSet={activeCreationSet}
                assets={setOutputAssets}
                onTitleChange={(title) => renameActiveCreationSet(title)}
                onIntentChange={(userIntent) => void updateCreationSetDraft((set) => ({
                  ...set, userIntent, updatedAt: Date.now()
                }))}
                onCountChange={(value) => void changeCreationSetCount(value)}
                onCompositeLayoutChange={(compositeLayout) => void persistCreationSetUpdate(
                  activeCreationSet.id,
                  (current) => ({ ...current, compositeLayout, updatedAt: Date.now() })
                )}
                onPlanItemChange={(id, promptDelta) => void updateCreationSetDraft((set) => ({
                  ...set,
                  planItems: set.planItems.map((item) => item.id === id ? { ...item, promptDelta } : item),
                  updatedAt: Date.now()
                }))}
                onReplan={() => void replanCreationSet()}
                onStart={() => void runActiveCreationSet()}
                onCancel={() => void cancelActiveCreationSet()}
                cancelling={cancelling}
                onResume={() => void resumeActiveCreationSet()}
                onRetryFailed={() => void retryFailedCreationSetItems()}
                onRetryItem={(id, issue) => void retryCreationSetItem(id, issue)}
                onExportAll={() => void exportCreationSet(activeCreationSet)}
                onExportGrid={(mimeType) => void exportCreationSetGrid(activeCreationSet, mimeType)}
                onCheckQuality={() => void runCreationSetQuality(activeCreationSet)}
                qualityChecking={qualityCheckingSetId === activeCreationSet.id}
                onSelectOutput={(itemId, assetId) => void selectCreationSetOutput(itemId, assetId)}
                onBack={() => {
                  if (activeCreationSet.status !== "GENERATING") setActiveCreationSet(undefined);
                  void navigate("library");
                }}
                onClone={() => void cloneCreationSet()}
                onDeleteGroup={() => void removeCreationSet(false)}
                onDeleteGroupAndWorks={() => void removeCreationSet(true)}
              />
            ) : (<>
            {stage === "idle" && !reference && recentCreationTarget && (
              recentCreationTarget.kind === "set" && recentCreationSet
                ? <RecentCreationCard
                    target={{ kind: "set", creationSet: recentCreationSet }}
                    onOpen={() => void openCreationSet(recentCreationTarget.id, false)}
                    onDelete={() => void removeCreationSetFromLibrary(recentCreationSet)}
                  />
                : recentProject
                  ? <RecentCreationCard
                      target={{ kind: "project", project: recentProject }}
                      onOpen={() => void openProject(recentCreationTarget.id, false)}
                      onDelete={() => void removeProject(recentProject)}
                    />
                  : null
            )}
            {stage !== "complete" && !busy && stage !== "error" && capturePreview && (
              <CapturePreviewCard
                preview={capturePreview}
                onConfirm={() => {
                  void addImage(capturePreview.blob, "style_layout", capturePreview.source)
                    .then((asset) => { if (asset) setCapturePreview(undefined); });
                }}
                onCancel={() => setCapturePreview(undefined)}
              />
            )}
            {gridPlanningProgress && !activeCreationSet && (
              <section className="grid-planning-progress" role="status" aria-live="polite">
                <LoaderCircle className="spinner" size={22} aria-hidden="true" />
                <div>
                  <strong>{gridPlanningProgress}</strong>
                  <p>完成后会直接进入本页的套图规划，不需要去作品页继续。</p>
                  <small>正在本机准备独立画面，无需等待远程逐格分析。</small>
                </div>
              </section>
            )}
            {stage !== "complete" && !busy && stage !== "error" && <ImageSlot
              asset={reference}
              role="style_layout"
              onPick={(file) => void addImage(file, "style_layout")}
              onRemove={() => removeImage("style_layout")}
              onEnableWebCapture={() => void enableCurrentSiteCapture()}
              onPasteClipboard={pasteReferenceFromClipboard}
              onCaptureArea={() => void requestAreaCapture()}
              webCaptureStatus={webCaptureStatus}
              webCaptureEnabled={settingsValue.hoverCaptureEnabled}
              webCaptureBusy={webCaptureBusy}
            />}
            {stage !== "complete" && !busy && !gridCreationPrepared && detectedGrid?.count === 3 && reference && (
              <section className="grid-detection" aria-label="三宫格识别结果">
                <div><strong>{detectedGrid.confidence < 0.7
                  ? "这张图可能是三宫格，请确认"
                  : "检测到这是一组三宫格作品"}</strong><p>{detectedGrid.confidence < 0.7
                    ? "目前只依据图片比例判断；确认后才会拆成三个画面。"
                    : "VisualForge 会理解三个画面，并按照相同排版生成你的版本。"}</p></div>
                <div className="grid-detection-actions">
                  <button type="button" className="primary grid-direct-action" onClick={() => {
                    prepareDetectedGridCreation(detectedGrid);
                  }}>直接按三宫格复刻</button>
                  <button type="button" className="grid-subject-action" onClick={() => {
                    prepareDetectedGridCreation(detectedGrid);
                    setSubjectPickerOpen(true);
                  }}><ImagePlus size={15} aria-hidden="true" />换成我的再复刻</button>
                  <button type="button" onClick={() => { setDetectedGrid(null); pendingGridLayoutRef.current = null; }}>作为单张创作</button>
                </div>
                <details><summary>调整画面边界</summary>
                  <p>先选择排列，再按参考图微调每条分隔线。</p>
                  <GridBoundaryPreview asset={reference} layout={detectedGrid} />
                  <div className="grid-layout-options" role="group" aria-label="切换排列">
                    <strong>切换排列</strong>
                    {gridLayoutAlternatives(3).map((layout) => (
                      <button
                        type="button"
                        key={`${layout.columns}-${layout.rows}`}
                        aria-pressed={detectedGrid.columns === layout.columns && detectedGrid.rows === layout.rows}
                        onClick={() => applyDetectedGridLayout(layout)}
                      >{layout.columns} 列 × {layout.rows} 行</button>
                    ))}
                  </div>
                  {detectedGrid.columnStops.map((stop, index) => <label key={`column-${index}`}>
                    竖向分隔线 {index + 1}
                    <input type="range" min="0.08" max="0.92" step="0.01" value={stop}
                      onChange={(event) => adjustGridStop("columnStops", index, Number(event.target.value))} />
                  </label>)}
                  {detectedGrid.rowStops.map((stop, index) => <label key={`row-${index}`}>
                    横向分隔线 {index + 1}
                    <input type="range" min="0.08" max="0.92" step="0.01" value={stop}
                      onChange={(event) => adjustGridStop("rowStops", index, Number(event.target.value))} />
                  </label>)}
                </details>
              </section>
            )}
            {stage !== "complete" && !busy && !gridCreationPrepared && detectedGrid && detectedGrid.count !== 3 && reference && (
              <section className="grid-detection" aria-label="宫格识别结果">
                <div><strong>检测到{gridLayoutName(detectedGrid.count)}</strong><p>将按原图的 {detectedGrid.count} 个位置分别生成，再按相同顺序拼回一张成图。</p></div>
                <div className="grid-detection-actions">
                  <button type="button" className="primary grid-direct-action" onClick={() => {
                    prepareDetectedGridCreation(detectedGrid);
                  }}>直接复刻这张{gridLayoutName(detectedGrid.count)}</button>
                  <button type="button" className="grid-subject-action" onClick={() => {
                    prepareDetectedGridCreation(detectedGrid);
                    setSubjectPickerOpen(true);
                  }}><ImagePlus size={15} aria-hidden="true" />换成我的再复刻</button>
                  <button type="button" onClick={() => { setDetectedGrid(null); pendingGridLayoutRef.current = null; }}>作为单张创作</button>
                </div>
                <details><summary>调整画面边界</summary>
                  <p>按参考图微调有限分隔线，不会改变画面数量和顺序。</p>
                  <GridBoundaryPreview asset={reference} layout={detectedGrid} />
                  {gridLayoutAlternatives(detectedGrid.count).length > 1 && (
                    <div className="grid-layout-options" role="group" aria-label="切换排列">
                      <strong>切换排列</strong>
                      {gridLayoutAlternatives(detectedGrid.count).map((layout) => (
                        <button
                          type="button"
                          key={`${layout.columns}-${layout.rows}`}
                          aria-pressed={detectedGrid.columns === layout.columns && detectedGrid.rows === layout.rows}
                          onClick={() => applyDetectedGridLayout(layout)}
                        >{layout.columns} 列 × {layout.rows} 行</button>
                      ))}
                    </div>
                  )}
                  {detectedGrid.columnStops.map((stop, index) => <label key={`column-${index}`}>
                    竖向分隔线 {index + 1}
                    <input type="range" min="0.08" max="0.92" step="0.01" value={stop}
                      onChange={(event) => adjustGridStop("columnStops", index, Number(event.target.value))} />
                  </label>)}
                  {detectedGrid.rowStops.map((stop, index) => <label key={`row-${index}`}>
                    横向分隔线 {index + 1}
                    <input type="range" min="0.08" max="0.92" step="0.01" value={stop}
                      onChange={(event) => adjustGridStop("rowStops", index, Number(event.target.value))} />
                  </label>)}
                </details>
              </section>
            )}
            {gridCreationPrepared && detectedGrid && stage !== "complete" && !busy && (
              <section className="grid-prepared" aria-label="宫格创作下一步">
                <Check size={18} aria-hidden="true" />
                <div>
                  <strong>{gridLayoutName(detectedGrid.count)}排版已准备 · 共 {detectedGrid.count} 个画面</strong>
                  <p>下一步可换成你的人物或商品；也可以不替换，直接复刻这张宫格图。</p>
                  <button type="button" className="text-button" onClick={() => setGridCreationPrepared(false)}>重新查看并调整裁切</button>
                </div>
              </section>
            )}
            {dna && !gridCreationPrepared && stage !== "complete" && !["analyzing", "rendering", "saving"].includes(stage) && mode === "analyze" && (
              <section className="reverse-prompt-step" aria-labelledby="reverse-prompt-title">
                <div className="section-heading">
                  <span id="reverse-prompt-title">参考图已经理解</span>
                  <small>先确认，再换成你的主体</small>
                </div>
                <StyleBreakdown
                  dna={dna}
                  prompt={referencePrompt}
                  expanded
                  confirmed={promptConfirmed}
                  subjectType={selectedSubject?.type}
                  initialSelection={signatureStyleSelection}
                  onConfirm={(editedPrompt, selection) => {
                    setConfirmedReferencePrompt(editedPrompt);
                    setPromptConfirmed(true);
                    setSignatureStyleSelection(selection);
                    if (currentProject) {
                      const updated = {
                        ...currentProject,
                        compiledPrompt: editedPrompt,
                        signatureStyleSelection: selection,
                        updatedAt: Date.now()
                      };
                      setCurrentProject(updated);
                      void persistProjectUpdate(currentProject.id, (stored) => ({
                        ...stored,
                        compiledPrompt: editedPrompt,
                        signatureStyleSelection: selection,
                        updatedAt: Date.now()
                      })).catch(() => setToast("作品设置未保存，请重试"));
                    }
                    focusSubjectStep();
                  }}
                />
                <details className="advanced"><summary>精细调整与专业控制<ChevronDown size={15} /></summary>
                  <VisualDNAEditor dna={dna} domain={domainProfile?.domain} onCommit={commitVisualDNA} />
                </details>
              </section>
            )}
            {stage !== "complete" && !busy && stage !== "error" && reference && creationInputReady && (
              <section className="subject-step" aria-labelledby="subject-step-title">
                <div className="section-heading">
                  <span id="subject-step-title" tabIndex={-1}>换成我的</span>
                  <small>人物、商品、角色、宠物或物件</small>
                </div>
                <SubjectAssetPicker
                  assets={subjectAssets}
                  images={subjectImages}
                  selected={selectedSubject}
                  recommendedType={domainProfile?.domain === "portrait"
                    ? "person"
                    : domainProfile?.domain === "product"
                      ? "product"
                      : undefined}
                  open={subjectPickerOpen}
                  onOpen={() => setSubjectPickerOpen(true)}
                  onClose={() => setSubjectPickerOpen(false)}
                  onSelect={(asset) => void chooseSubjectAsset(asset)}
                  onRemove={() => void clearSubjectAsset()}
                  onEdit={(asset) => openSubjectEditor({ asset, initialType: asset.type })}
                  onCreate={(type) => openSubjectEditor({ initialType: type })}
                />
                {autoSelectedSubjectName && (
                  <p className="subject-auto-notice" role="status">
                    已沿用上次选择：<strong>{autoSelectedSubjectName}</strong>。你可以更换，或本次不替换。
                  </p>
                )}
              </section>
            )}
            {stage !== "complete" && !busy && stage !== "error" && reference && creationInputReady && (
              <>
                <label className="field">
                  <span>想怎么调整？（可留空）</span>
                  <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={placeholder} />
                </label>
                {dna && (
                  <section className="creation-confirmation" aria-label="本次创作确认">
                    <div className="section-heading">
                      <span>本次创作</span>
                      <small>生成前确认</small>
                    </div>
                    <dl>
                      <div><dt>灵感</dt><dd>{dna.summary}</dd></div>
                      <div><dt>换成</dt><dd>{selectedSubject ? `${selectedSubject.name} · ${subjectTypePresentation[selectedSubject.type].label}` : "不替换主体，直接创作"}</dd></div>
                      <div><dt>调整</dt><dd>{instruction.trim() || "保持参考图的主要视觉方法"}</dd></div>
                    </dl>
                    <details>
                      <summary>本次最终生成提示词<ChevronDown size={15} /></summary>
                      <textarea aria-label="本次最终生成提示词" value={finalPrompt} readOnly />
                      <button type="button" className="secondary prompt-copy" aria-live="polite" onClick={async () => {
                        setFinalPromptCopied(false);
                        setFinalPromptCopyError(false);
                        try {
                          await navigator.clipboard.writeText(finalPrompt);
                          setFinalPromptCopied(true);
                          window.setTimeout(() => setFinalPromptCopied(false), 1600);
                        } catch {
                          setFinalPromptCopyError(true);
                        }
                      }}>
                        {finalPromptCopied ? <Check size={14} /> : <Copy size={14} />}
                        {finalPromptCopyError ? "复制失败，请重试" : finalPromptCopied ? "最终提示词已复制" : "复制最终提示词"}
                      </button>
                    </details>
                  </section>
                )}
                <section className="creation-options" aria-label="生成规格">
                  {gridCreationPrepared && detectedGrid ? <>
                    <div className="grid-replication-summary">
                      <strong>复刻设置</strong>
                      <span>{detectedGrid.count} 个独立画面 → 1 张{gridLayoutName(detectedGrid.count)}成图</span>
                    </div>
                    <div className="grid-layout-choice" role="group" aria-label="宫格排版">
                      <span><strong>宫格排版</strong><small>默认保持参考图；生成前可切换成同数量的另一种排列。</small></span>
                      {gridLayoutAlternatives(detectedGrid.count).map((layout) => (
                        <button
                          type="button"
                          key={`${layout.columns}-${layout.rows}`}
                          aria-pressed={detectedGrid.columns === layout.columns && detectedGrid.rows === layout.rows}
                          className={detectedGrid.columns === layout.columns && detectedGrid.rows === layout.rows ? "active" : ""}
                          onClick={() => applyDetectedGridLayout(layout)}
                        >{gridLayoutOrientationLabel(layout)}</button>
                      ))}
                    </div>
                    <fieldset><legend>单格图片比例</legend>{ratioOptions.filter((option) => option !== "9:16").map((option) =>
                      <button type="button" aria-pressed={ratio === option} className={ratio === option ? "active" : ""} key={option} onClick={() => setRatio(option)}>{option}</button>)}</fieldset>
                    <fieldset className="delivery-options grid-delivery-options"><legend>最后保存</legend>
                      <button type="button" aria-pressed={deliveryMode === "grid"} className={deliveryMode === "grid" ? "active" : ""} onClick={() => setDeliveryMode("grid")}>只保存一张{gridLayoutName(detectedGrid.count)}成图</button>
                      <button type="button" aria-pressed={deliveryMode === "both"} className={deliveryMode === "both" ? "active" : ""} onClick={() => setDeliveryMode("both")}>{gridLayoutName(detectedGrid.count)}成图＋{detectedGrid.count} 张独立图</button>
                    </fieldset>
                  </> : <>
                    <div className="creation-form-options" role="group" aria-labelledby="creation-form-label">
                      <strong className="option-label" id="creation-form-label">作品形式</strong>
                      <button type="button" aria-pressed={creationForm === "single"} className={creationForm === "single" ? "active" : ""} onClick={() => setCreationForm("single")}>单张作品</button>
                      <button type="button" aria-pressed={creationForm === "set"} className={creationForm === "set" ? "active" : ""} onClick={() => setCreationForm("set")}>
                        {selectedSubject?.type === "person" ? "拍一套写真" : selectedSubject?.type === "product" ? "生成一组商品广告" : "生成一组作品"}
                      </button>
                    </div>
                    <fieldset><legend>图片比例</legend>{ratioOptions.filter((option) => option !== "9:16").map((option) =>
                      <button type="button" aria-pressed={ratio === option} className={ratio === option ? "active" : ""} key={option} onClick={() => setRatio(option)}>{option}</button>)}</fieldset>
                    {creationForm === "single" && <fieldset className="single-count-options"><legend>生成几个版本？</legend>
                      {([1, 2, 4] as const).map((value) => <button
                        type="button"
                        aria-pressed={count === value}
                        className={count === value ? "active" : ""}
                        key={value}
                        onClick={() => setCount(value)}
                      >{value} 张</button>)}
                      <p>{count === 1
                        ? "默认生成 1 张，完成后立即停止；质量检查不会自动追加图片。"
                        : `本次会生成 ${count} 个候选版本，完成后由你比较选择。`}</p>
                    </fieldset>}
                    {creationForm === "set" && <fieldset><legend>生成画面数</legend>{([2, 3, 4, 6, 9, 12] as const).map((value) =>
                      <button type="button" aria-pressed={requestedSetCount === value} className={requestedSetCount === value ? "active" : ""} key={value} onClick={() => setRequestedSetCount(value)}>{value}</button>)}</fieldset>}
                    {creationForm === "set" && <fieldset className="delivery-options"><legend>最终保存什么</legend>
                      <p>无论选哪种，系统都会先生成 {requestedSetCount} 个独立画面；这里只决定最后保存的文件。</p>
                      <button type="button" aria-pressed={deliveryMode === "independent"} className={deliveryMode === "independent" ? "active" : ""} onClick={() => setDeliveryMode("independent")}>只要 {requestedSetCount} 张独立图</button>
                      <button type="button" aria-pressed={deliveryMode === "grid"} className={deliveryMode === "grid" ? "active" : ""} onClick={() => setDeliveryMode("grid")}>只要一张{gridLayoutName(requestedSetCount)}成图</button>
                      <button type="button" aria-pressed={deliveryMode === "both"} className={deliveryMode === "both" ? "active" : ""} onClick={() => setDeliveryMode("both")}>两种都保存（推荐）</button>
                    </fieldset>}
                  </>}
                </section>
                {subjectReminderOpen && !selectedSubject && (
                  <section
                    id="subject-reminder"
                    className="subject-reminder"
                    role="alert"
                    aria-labelledby="subject-reminder-title"
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      setSubjectReminderOpen(false);
                      window.requestAnimationFrame(() => subjectReminderReturnFocusRef.current?.focus());
                    }}
                  >
                    <div>
                      <strong id="subject-reminder-title">尚未选择人物或商品</strong>
                      <p>这不是必选项。你可以先上传或选择“换成我的”，也可以明确使用原参考继续创作。</p>
                    </div>
                    <div>
                      <button type="button" onClick={() => {
                        setSubjectPickerOpen(true);
                        setSubjectReminderOpen(false);
                        focusSubjectStep();
                      }}>先选择人物或商品</button>
                      <button type="button" className="primary" onClick={() => startRequestedCreation(true)}>不替换，继续生成</button>
                    </div>
                  </section>
                )}
                {!subjectReminderOpen && <button type="button" className="primary create-primary" aria-label={creationForm === "single" ? singleGenerationLabel(count) : gridCreationPrepared && detectedGrid ? `开始生成这张${gridLayoutName(detectedGrid.count)}` : `生成 ${requestedSetCount} 张`} onClick={() => startRequestedCreation()}>{creationForm === "single" ? singleGenerationLabel(count) : gridCreationPrepared && detectedGrid
                    ? `开始生成这张${gridLayoutName(detectedGrid.count)}` : selectedSubject?.type === "person"
                      ? `生成 ${requestedSetCount} 张写真` : `生成 ${requestedSetCount} 张作品`}</button>}
                <details className="advanced"><summary>精细调整与专业控制<ChevronDown size={15} /></summary>
                  <DomainHint profile={domainProfile} expanded onChange={(domain) => void changeDomain(domain)} />
                  <p>系统会自动理解参考图，并在生成时保持你选择的人物身份或商品结构。</p>
                </details>
              </>
            )}

            {taskPresentation && ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(taskPresentation.status) && (
              <section className="progress-state">
                {reference && <TaskReferencePreview asset={reference} />}
                <LoaderCircle className="spinner" size={24} />
                <strong role="status" aria-live="polite" aria-atomic="true">{taskPresentation.label}</strong>
                <ol className="steps">
                  {taskPresentation.steps.map((step) => (
                    <li key={step.status} className={step.state}>
                      <i /><span>{step.label}</span>
                    </li>
                  ))}
                </ol>
                <small>可以前往作品页查看进度。关闭侧边栏会暂停当前连接，重新打开后可继续。</small>
                <small className="progress-time-guidance">{activeTask?.operation === "ANALYSIS"
                  ? "参考图分析通常需要 1～3 分钟，最长等待 15 分钟。"
                  : `本次生成 ${activeCandidateCount} 张；通常每张需要 2～8 分钟，整次最多等待 20 分钟；已返回图片会立即保存。`}</small>
                <time aria-hidden="true">{elapsedSeconds < 60 ? `已等待 ${elapsedSeconds} 秒` : `已等待 ${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`}</time>
                <div className="progress-actions">
                  <button type="button" onClick={() => void navigate("library")}>查看作品进度</button>
                  <button type="button" className="text-button" disabled={cancelling} onClick={cancel}>{cancelling ? "正在取消…" : "取消"}</button>
                </div>
              </section>
            )}

            {createRecoveryTasks.length > 0 && (
              <section className="recovery-state" aria-label="未完成的创作">
                <div className="section-heading">
                  <span>上次创作没有完成</span>
                  <small>{createRecoveryTasks.length} 个</small>
                </div>
                {createRecoveryTasks.map((task) => (
                  <div className="recovery-task" key={task.taskId}>
                    <span>
                      <strong>{task.operation === "ANALYSIS"
                        ? task.status === "FAILED" ? "参考图分析失败" : "参考图分析已中断"
                        : task.status === "FAILED" ? "作品生成失败" : "作品生成已中断"}</strong>
                      <small>{task.error ? retryTaskUserMessage(task) : new Date(task.heartbeat).toLocaleString("zh-CN")}</small>
                    </span>
                    <div>
                      <button onClick={() => void retryTask(task)}><RefreshCw size={14} />{task.status === "FAILED" ? "重试" : "继续"}</button>
                      <button className="text-button" title="保留任务和审计记录，只隐藏这条提醒" onClick={() => void dismissInterruptedTaskReminder(task.taskId)}>隐藏提醒</button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {stage === "error" && (
              <section className="error-state" role="alert" aria-labelledby="creation-error-title" ref={errorStateRef} tabIndex={-1}>
                {reference && <TaskReferencePreview asset={reference} />}
                <CircleAlert size={20} aria-hidden="true" /><div>
                  <strong id="creation-error-title">{visibleError.title}</strong>
                  <p>{visibleError.reason}</p>
                  <small>{visibleError.solution}</small>
                  <div className="error-actions">
                    {lastRetryableTask
                      ? <>
                        <button type="button" onClick={() => void retryTask(lastRetryableTask)}><RefreshCw size={14} aria-hidden="true" />再试一次</button>
                        <button type="button" onClick={() => void navigate("settings")}>检查连接</button>
                      </>
                      : errorContext === "connection"
                        ? <button type="button" onClick={() => void navigate("settings")}>连接本地创作</button>
                        : errorContext === "capture"
                          ? <button type="button" onClick={() => void requestAreaCapture()}>
                            <ImagePlus size={14} aria-hidden="true" />框选当前网页
                          </button>
                          : errorContext === "image" && (
                          <button type="button" onClick={chooseReplacementImage}>
                            <Upload size={14} aria-hidden="true" />重新选择图片
                          </button>
                          )}
                    <button type="button" onClick={leaveErrorState}>返回创作</button>
                  </div>
                  {error && <details className="error-details"><summary>技术详情</summary><pre>{error}</pre></details>}
                </div>
              </section>
            )}
            {pendingPreferenceGeneration && (
              <PreferenceSuggestion
                summaries={pendingPreferenceGeneration.summaries}
                onApply={() => resolvePendingPreference("applied")}
                onIgnore={() => resolvePendingPreference("ignored")}
              />
            )}
            {stage === "complete" && currentProject && (
              <>
              {resultRetryableTask && (
                <section className="result-recovery" role="alert">
                  <CircleAlert size={18} aria-hidden="true" />
                  <div>
                    <strong>已有作品已保留，最近一次追加生成没有完成</strong>
                    <p>{retryTaskUserMessage(resultRetryableTask)}</p>
                    <span>
                      <button type="button" className="secondary" onClick={() => void retryTask(resultRetryableTask)}>再试一次</button>
                      <button type="button" className="text-button" onClick={leaveErrorState}>返回创作</button>
                    </span>
                  </div>
                </section>
              )}
              <ResultView
                assets={outputs}
                events={generationEvents}
                project={currentProject}
                dnaHistory={dnaHistory}
                task={activeTask}
                onEdit={async (asset, event) => {
                  setLibraryDetailOpen(false);
                  const editingReference = { ...asset, role: "style_layout" as const };
                  const updated = await persistProjectUpdate(currentProject.id, (stored) => ({
                    ...stored,
                    mode: "edit" as const,
                    referenceAssetIds: [asset.id],
                    updatedAt: Date.now()
                  }));
                  setRefs({ style_layout: editingReference });
                  setCurrentProject(updated);
                  setPendingParentGenerationId(event?.id ?? null);
                  setMode("analyze");
                  setInstruction("");
                  setPromptConfirmed(false);
                  setStage("idle");
                  setPendingAutoAnalysis({ asset: editingReference, intent: "use-style" });
                }}
                onRegenerate={(_asset, event) => {
                  setLibraryDetailOpen(false);
                  void requestGenerate(
                    currentProject,
                    dna,
                    event?.id ?? null,
                    event?.prompt ?? currentProject.compiledPrompt ?? "",
                    false
                  );
                }}
                onCreateSet={() => {
                  setLibraryDetailOpen(false);
                  void beginCreationSet();
                }}
                onBack={() => void navigate("library")}
                onBackToSet={returnToCreationSetId ? () => void openCreationSet(returnToCreationSetId) : undefined}
                onDomainChange={(domain) => void changeDomain(domain)}
                onExport={exportAsset}
                onRestoreDNA={restoreDNA}
                onCommitDNA={commitVisualDNA}
                qualityReport={singleQualityReport}
                qualityReportAssetId={singleQualityAssetId}
                qualityChecking={singleQualityChecking}
                onCheckQuality={diagnostics.state === "connected" ? (asset) => void runSingleQuality(asset) : undefined}
                onTargetedRetry={(asset, event, issue) => void retrySingleWithIssue(asset, event, issue)}
                onSelectFinal={(asset) => void selectProjectOutput(asset)}
                onRename={(title) => renameProject(currentProject, title)}
                onDelete={() => removeProject(currentProject)}
                focusAssetId={resultFocusAssetId}
              />
              </>
            )}
            </>)}
          </div>
        )}

        {!subjectEditor && route === "library" && (
          <div className="page library-page" id="library-panel" role="tabpanel" aria-label="作品">
            <div className="page-title"><div><h1>作品</h1><p>{libraryKind === "works" ? (filteredWorkEntries.length ? `${filteredWorkEntries.length} 个创作记录` : hasActiveWorkSearch ? "当前搜索没有匹配结果" : "生成结果会自动保存在这里") : "人物、商品、角色、宠物和物件都保存在本机"}</p></div><button className="secondary" onClick={hasCurrentTask ? returnToCurrentTask : startNew}>{hasCurrentTask ? "查看当前任务" : "新建创作"}</button></div>
            <div className="library-kinds" role="tablist" aria-label="作品类型">
              <button type="button" role="tab" id="library-works-tab" data-library-kind="works" aria-controls="library-works-panel" aria-selected={libraryKind === "works"} tabIndex={libraryKind === "works" ? 0 : -1} className={libraryKind === "works" ? "active" : ""} onKeyDown={(event) => handleLibraryKindKey(event, "works")} onClick={() => setLibraryKind("works")}>作品</button>
              <button type="button" role="tab" id="library-people-tab" data-library-kind="people" aria-controls="library-people-panel" aria-selected={libraryKind === "people"} tabIndex={libraryKind === "people" ? 0 : -1} className={libraryKind === "people" ? "active" : ""} onKeyDown={(event) => handleLibraryKindKey(event, "people")} onClick={() => setLibraryKind("people")}>人物</button>
              <button type="button" role="tab" id="library-subjects-tab" data-library-kind="subjects" aria-controls="library-subjects-panel" aria-selected={libraryKind === "subjects"} tabIndex={libraryKind === "subjects" ? 0 : -1} className={libraryKind === "subjects" ? "active" : ""} onKeyDown={(event) => handleLibraryKindKey(event, "subjects")} onClick={() => setLibraryKind("subjects")}>其他主体</button>
            </div>
            <div id={`library-${libraryKind}-panel`} role="tabpanel" aria-labelledby={`library-${libraryKind}-tab`}>
            {libraryKind === "works" && showLibraryTools && <>
              <input className="search" aria-label="搜索作品" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索图片、风格或要求…" />
            </>}
            {libraryKind === "works" && (!filteredWorkEntries.length ? (
              hasActiveWorkSearch
                ? <div className="library-empty"><Library size={28} /><strong>没有匹配作品</strong><p>换个关键词，或清除搜索查看全部作品。</p><button type="button" onClick={() => setSearch("")}>清除搜索</button></div>
                : <div className="library-empty"><Library size={28} /><strong>作品库还是空的</strong><p>完成一次创作后，参考图方法和生成结果都会留在本机。</p><button onClick={openCreateHome}>开始第一次创作</button></div>
            ) : (
              <div className="project-grid">
                {filteredWorkEntries.map((entry) => entry.kind === "set"
                  ? <CreationSetCardLoader
                      key={`set-${entry.creationSet.id}`}
                      creationSet={entry.creationSet}
                      onOpen={() => void openCreationSet(entry.creationSet.id, true)}
                      onDelete={() => void removeCreationSetFromLibrary(entry.creationSet)}
                    />
                  : <ProjectCard
                      key={`project-${entry.project.id}`}
                      project={entry.project}
                      outputAssetIds={standaloneOutputAssetIds(entry.project)}
                      status={activeTask?.projectId === entry.project.id
                        ? activeTask.status
                        : retryableTaskByProject.get(entry.project.id)?.status}
                      onOpen={() => void openProject(entry.project.id, true)}
                      onRename={(title) => renameProject(entry.project, title)}
                      onDelete={() => void removeProject(entry.project)}
                    />)}
              </div>
            ))}
            {libraryKind !== "works" && (
              <div className="subject-library-grid">
                {subjectAssets
                  .filter((asset) => libraryKind === "people" ? asset.type === "person" : asset.type !== "person")
                  .map((asset) => (
                    <SubjectAssetLibraryCard
                      key={asset.id}
                      asset={asset}
                      image={subjectImages.get(asset.primaryImageId)}
                      onUse={() => void useSubjectAsset(asset)}
                      onEdit={() => openSubjectEditor({ asset, initialType: asset.type })}
                    />
                  ))}
                {!subjectAssets.some((asset) => libraryKind === "people" ? asset.type === "person" : asset.type !== "person") && (
                  <div className="library-empty"><ImagePlus size={28} /><strong>{libraryKind === "people" ? "还没有人物" : "还没有其他主体"}</strong><p>创建后可在任意风格参考图中再次使用。</p><button onClick={() => openSubjectEditor({ initialType: libraryKind === "people" ? "person" : "product" })}>立即创建</button></div>
                )}
              </div>
            )}
            </div>
          </div>
        )}

        {!subjectEditor && route === "settings" && (
          <div className="page settings-page">
            <div className="page-title"><div><h1>设置</h1><p>连接、默认值与本地数据</p></div><button type="button" className="secondary" onClick={() => void navigate(settingsValue.lastRoute)}>返回</button></div>
            <section className="settings-section">
              <h2>本地创作连接</h2>
              {connectionIssue ? (
                <div className="connection-issue" role="status">
                  <CircleAlert size={18} aria-hidden="true" />
                  <div><strong>{connectionIssue.title}</strong><p>{connectionIssue.reason}</p><small>{connectionIssue.solution}</small></div>
                </div>
              ) : (
                <div className="diagnostic"><i className="online" /><span><strong>{diagnostics.label}</strong><small>{diagnostics.detail ?? "已可使用真实 Codex 分析与生成"}</small></span></div>
              )}
              {connectionIssue && (
                <>
                <a className="primary connection-download" href={NATIVE_HOST_DOWNLOAD.url} target="_blank" rel="noreferrer">下载适合本机的连接组件</a>
                <details className="connection-setup">
                  <summary>查看安装与恢复步骤</summary>
                  <ol>
                    <li>打开 VisualForge 产品包。</li>
                    <li>运行其中的安装文件，按系统提示完成连接。</li>
                    <li>确认 Codex 已登录，然后返回这里点击“重新检测”。</li>
                  </ol>
                  <p>安装不会要求 API Key；作品与人物资料仍只保存在本机。</p>
                </details>
                </>
              )}
              <button type="button" className="secondary" onClick={async () => { setDiagnostics({ state: "error", label: "正在检测…" }); setDiagnostics(await diagnoseNative()); }}>重新检测</button>
            </section>
            <section className="settings-section">
              <h2>默认生成</h2>
              <label className="setting-row"><span><strong>比例</strong><small>默认 3:4，适合移动端人像与商品；可按用途修改。</small></span><select value={settingsValue.defaultAspectRatio} onChange={(event) => void persistSettingsChange({ ...settingsValue, defaultAspectRatio: event.target.value as AspectRatio })}>{ratioOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="setting-row"><span><strong>单张默认生成</strong><small>创建单张作品时预选的版本数；生成前仍可修改，默认 1 张。</small></span><select value={settingsValue.defaultCount} onChange={(event) => void persistSettingsChange({ ...settingsValue, defaultCount: Number(event.target.value) as 1 | 2 | 4 })}>{[1, 2, 4].map((option) => <option key={option}>{option}</option>)}</select></label>
            </section>
            <section className="settings-section">
              <h2>网页图片按钮</h2>
              <label className="setting-row">
                <span><strong>在网页图片上显示 VisualForge</strong><small>安装后默认在 HTTPS 网页图片上显示 VisualForge；不需要时可在这里关闭。</small></span>
                 <input type="checkbox" checked={settingsValue.hoverCaptureEnabled} onChange={(event) => {
                   const hoverCaptureEnabled = event.target.checked;
                   const next = { ...settingsValue, hoverCaptureEnabled };
                   void persistSettingsChange(next, async (value) => {
                     await chrome.storage.local.set({ hoverCaptureEnabled: value.hoverCaptureEnabled });
                     await applyHoverSettingToOpenTabs(chrome, value.hoverCaptureEnabled);
                     setWebCaptureStatus(value.hoverCaptureEnabled
                       ? "网页图片按钮已开启。回到 HTTPS 网页后会自动显示。"
                       : "网页图片按钮已关闭。点击创作页入口可重新开启。");
                     setToast(value.hoverCaptureEnabled ? "网页图片按钮已开启" : "网页图片按钮已关闭");
                   });
                 }} />
              </label>
            </section>
            <PreferenceCenter
              summaries={preferenceSummaries}
              events={preferenceEvents}
              onDelete={removePreferenceSummary}
              onReset={resetPreferenceSummaries}
            />
            <section className="settings-section">
              <h2>隐私</h2>
              <label className="setting-row"><span><strong>保存来源网址</strong><small>网页取图时随作品保存在本机</small></span><input type="checkbox" checked={settingsValue.saveSourceUrl} onChange={(event) => void persistSettingsChange({ ...settingsValue, saveSourceUrl: event.target.checked })} /></label>
              <p className="privacy-note">图片、分析和参数默认保存在本机浏览器中；只有你主动分析或生成时，所选内容才会交给当前登录的 Codex／OpenAI 处理。VisualForge 不读取或保存 Codex 登录凭据。</p>
              <button className="danger-link" disabled={hasRunningTask} onClick={async () => {
                if (hasRunningTask) return;
                if (confirm("确定清空作品、项目、设置、待处理图片，以及 Native Host 临时图片、任务缓存和 Codex 路径配置吗？此操作无法撤销；扩展和连接组件本身会保留。")) {
                  const hostPromise = forceMock ? Promise.resolve("skipped" as const) : purgeAllUserData();
                  const [hostOutcome, browserOutcome] = await Promise.allSettled([
                    hostPromise,
                    Promise.all([
                      clearAllBrowserData(),
                      applyHoverSettingToOpenTabs(chrome, false)
                    ])
                  ]);
                  const result = summarizeDataClearResult({
                    browser: browserOutcome.status === "fulfilled" ? "cleared" : "failed",
                    host: hostOutcome.status === "rejected"
                      ? "failed"
                      : hostOutcome.value === "skipped" ? "skipped" : "cleared"
                  });
                  if (browserOutcome.status === "fulfilled") {
                    window.dispatchEvent(new CustomEvent("visualforge:data-cleared", {
                      detail: { message: result.message }
                    }));
                  } else {
                    setToast(result.message);
                  }
                }
              }}>{hasRunningTask ? "创作完成后可清空本地数据" : "清空全部本地数据"}</button>
            </section>
            <section className="settings-section uninstall-section">
              <h2>卸载</h2>
              <p>卸载后将停止分析和生成；浏览器里的作品、人物和设置会保留。需要彻底删除时，请先使用上方“清空全部本地数据”。</p>
              <button type="button" className="danger-link" disabled={hasRunningTask || uninstallingHost} onClick={async () => {
                if (hasRunningTask || uninstallingHost) return;
                if (!confirm("确定卸载本地连接组件吗？浏览器里的作品、人物和设置会保留，之后仍可重新安装。")) return;
                setUninstallingHost(true);
                try {
                  if (!forceMock) await uninstallNativeHost();
                  setDiagnostics({
                    state: "host-missing",
                    label: "本地连接组件已卸载",
                    detail: "作品和设置仍保留。需要时可重新安装。"
                  });
                  setDiagnosticsChecked(true);
                  setToast("本地连接组件已卸载，作品仍保留");
                } catch {
                  setToast("卸载没有完成，请重新打开安装包并运行 Uninstall.command");
                } finally {
                  setUninstallingHost(false);
                }
              }}>{hasRunningTask
                ? "创作完成后可卸载"
                : uninstallingHost ? "正在卸载…" : "卸载本地连接组件"}</button>
            </section>
            <section className="settings-section about"><h2>关于</h2><p>VisualForge {chrome.runtime.getManifest().version} · Apache-2.0</p><p>把喜欢的图片方法变成你的作品</p></section>
          </div>
        )}
      </main>

      {dragging && <div className="drop-overlay"><Upload size={28} /><strong>松开放入参考图</strong></div>}
      {toast === "已移除作品 · 点击撤销"
        ? <button type="button" className="toast" aria-label="撤销删除作品" onClick={() => (window as Window & { __undoDelete?: () => void }).__undoDelete?.()}>{toast}</button>
        : toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </div>
  );
}

function ProjectCard({ project, outputAssetIds, status, onOpen, onRename, onDelete }: {
  project: ProjectRecord;
  outputAssetIds: string[];
  status?: TaskRecord["status"];
  onOpen: () => void;
  onRename: (title: string) => void | Promise<void>;
  onDelete: () => void;
}) {
  const [asset, setAsset] = useState<AssetRecord>();
  const coverAssetId = outputAssetIds.at(-1) ?? project.referenceAssetIds[0] ?? "";
  useEffect(() => {
    void getAsset(coverAssetId).then(setAsset);
  }, [coverAssetId]);
  const url = useObjectUrl(asset?.thumbnailBlob);
  return (
    <article className="project-card">
      <button className="project-image" onClick={onOpen}>{url ? <img src={url} alt={project.title} /> : <span><LoaderCircle size={20} /></span>}</button>
      <div>
        <ProjectNameEditor project={project} onRename={onRename} />
        <small>{status && ["CREATED", "UPLOADING", "ANALYZING", "GENERATING", "RETRYING"].includes(status)
          ? "正在后台处理"
          : status === "FAILED" ? "生成失败，可重试"
            : status === "INTERRUPTED" ? "生成中断，可继续"
              : outputAssetIds.length ? "单张作品" : "尚未完成"} · {new Date(project.updatedAt).toLocaleDateString("zh-CN")}</small>
      </div>
      <div className="project-actions">
        <button className="icon-button" aria-label="删除作品" title="删除" onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </article>
  );
}

function CreationSetCardLoader({
  creationSet,
  onOpen,
  onDelete
}: {
  creationSet: CreationSet;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [cover, setCover] = useState<AssetRecord>();
  useEffect(() => {
    const item = creationSet.planItems.find((candidate) =>
      candidate.selectedOutputAssetId ?? candidate.outputAssetId);
    const assetId = item?.selectedOutputAssetId ?? item?.outputAssetId;
    if (assetId) void getAsset(assetId).then(setCover);
  }, [creationSet]);
  return <CreationSetCard creationSet={creationSet} cover={cover} onOpen={onOpen} onDelete={onDelete} />;
}
