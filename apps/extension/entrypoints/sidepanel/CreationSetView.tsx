import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine, Check, CircleAlert, LoaderCircle, Pencil, RefreshCw, Trash2, X
} from "lucide-react";
import type {
  AssetRecord, CreationSet, CreationSetPlanItem, Domain, DomainProfile, GridLayout, SetQualityIssue
} from "@styleforge/contracts";
import {
  createCreativeDirection, createTransformationBlueprint, DOMAIN_LABELS
} from "@styleforge/core";
import { safeCreationSetErrorMessage } from "../../lib/creation-set-runner";
import {
  createGridComposite, resolveCompositeLayout, resolveSourceGridLayout
} from "../../lib/creation-set-export";
import { gridLayoutAlternatives } from "../../lib/grid-layout";

const statusLabels: Record<CreationSetPlanItem["status"], string> = {
  PENDING: "等待中",
  GENERATING: "正在生成",
  COMPLETED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断"
};

const setStatusLabels: Record<CreationSet["status"], string> = {
  PLANNING: "规划中",
  READY: "等待生成",
  GENERATING: "生成中",
  COMPLETED: "已完成",
  PARTIAL: "部分完成",
  FAILED: "生成失败",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断"
};

export function getCreationSetEmptyResultPresentation(
  status: CreationSet["status"]
): { title: string; detail: string; busy: boolean } {
  if (status === "GENERATING") return {
    title: "正在准备第一张",
    detail: "生成后会立即显示在这里",
    busy: true
  };
  if (status === "FAILED") return {
    title: "这一组尚无可用结果",
    detail: "全部画面生成失败，请使用下方按钮只重试失败项。",
    busy: false
  };
  if (status === "CANCELLED") return {
    title: "生成已停止，尚无结果",
    detail: "图片和计划仍已保留，可以继续未完成项。",
    busy: false
  };
  if (status === "INTERRUPTED") return {
    title: "生成已中断，尚无结果",
    detail: "图片和计划仍已保留，可以继续未完成项。",
    busy: false
  };
  return {
    title: "暂时没有生成结果",
    detail: "可根据下方状态继续或重试。",
    busy: false
  };
}

function qualityLabel(item: CreationSetPlanItem) {
  if (item.qualityStatus === "checking") return "已生成，正在检查";
  if (item.qualityStatus === "passed") return "质量检查已完成";
  if (item.qualityStatus === "needs_repair") return "检查发现问题";
  if (item.qualityStatus === "unavailable") return "已生成，质量检查未完成";
  if (item.status === "COMPLETED") return "已生成，尚未检查";
  return statusLabels[item.status];
}

type FinalSelectionProgressItem = Pick<
  CreationSetPlanItem,
  "status" | "selectedOutputAssetId" | "finalSelection"
>;

export function getCreationSetFinalSelectionProgress(
  items: FinalSelectionProgressItem[],
  requestedCount: number
) {
  const selectedCount = items.filter((item) =>
    item.status === "COMPLETED"
    && Boolean(item.selectedOutputAssetId)
    && item.finalSelection?.assetId === item.selectedOutputAssetId
  ).length;
  return {
    selectedCount,
    requiredCount: requestedCount,
    ready: requestedCount > 0 && selectedCount === requestedCount
  };
}

export function getCreationSetFinalSelectionWarning(
  qualityStatus: CreationSetPlanItem["qualityStatus"]
) {
  if (qualityStatus === "passed") return null;
  if (qualityStatus === "needs_repair") {
    return "AI 检查发现这张仍有问题。确定跳过修复并将它选为最终作品吗？";
  }
  return "这张作品还没有完成质量检查。确定跳过检查并将它选为最终作品吗？";
}

export function getGridCompositeProgress(
  items: CreationSetPlanItem[],
  availableAssetIds: ReadonlySet<string>
) {
  const readyCount = items.filter((item) => {
    const assetId = item.selectedOutputAssetId ?? item.outputAssetId ??
      item.outputCandidates.at(-1)?.outputAssetId;
    return Boolean(assetId && availableAssetIds.has(assetId));
  }).length;
  return {
    readyCount,
    ready: items.length > 0 && readyCount === items.length
  };
}

export function getGridCompositePresentation(input: {
  hasImage: boolean;
  error?: string;
  readyCount: number;
  requestedCount: number;
}) {
  if (input.hasImage) return {
    busy: false,
    title: "全部单张已按顺序合成",
    action: null
  };
  if (input.error) return {
    busy: false,
    title: "宫格合成暂不可用",
    action: "重新合成宫格"
  };
  return {
    busy: true,
    title: input.readyCount < input.requestedCount ? "单张完成后自动合成" : "正在合成最终宫格",
    action: null
  };
}

const gridLayoutNames = {
  2: "二宫格",
  3: "三宫格",
  4: "四宫格",
  6: "六宫格",
  9: "九宫格",
  12: "十二宫格"
} as const;

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

function useGridCompositePreview(creationSet: CreationSet, assets: Map<string, AssetRecord>) {
  const [preview, setPreview] = useState<{ blob?: Blob; error?: string }>({});
  const [retryToken, setRetryToken] = useState(0);
  const progress = getGridCompositeProgress(creationSet.planItems, new Set(assets.keys()));
  useEffect(() => {
    const compositeLayout = resolveCompositeLayout(creationSet);
    if (!compositeLayout || !progress.ready) {
      setPreview({});
      return;
    }
    let current = true;
    setPreview({});
    void createGridComposite(creationSet, assets, compositeLayout)
      .then((blob) => {
        if (current) setPreview({ blob });
      })
      .catch((error) => {
        if (current) setPreview({ error: error instanceof Error ? error.message : "宫格预览合成失败" });
      });
    return () => {
      current = false;
    };
  }, [assets, creationSet, progress.ready, retryToken]);
  return {
    ...preview,
    ...progress,
    retry: () => setRetryToken((token) => token + 1)
  };
}

function ReferenceThumbnail({ asset, alt, label }: {
  asset: AssetRecord;
  alt: string;
  label: string;
}) {
  const url = useObjectUrl(asset.thumbnailBlob ?? asset.blob);
  return <figure>
    <img src={url} alt={alt} />
    <figcaption>{label}</figcaption>
  </figure>;
}

function SetReferenceStrip({ creationSet, assets }: {
  creationSet: CreationSet;
  assets: Map<string, AssetRecord>;
}) {
  const sourceReference = creationSet.sharedReferenceSnapshots.find((reference) =>
    ["style", "style_layout", "composition", "color"].includes(reference.role));
  const sourceAsset = sourceReference ? assets.get(sourceReference.assetId) : undefined;
  const subjectReferences = creationSet.subjectAssetSnapshots.flatMap((snapshot) =>
    snapshot.images.map((image) => ({
      key: `${snapshot.subjectAssetId}:${image.assetId}`,
      asset: assets.get(image.assetId),
      label: snapshot.type === "person" ? "本次人物素材" : snapshot.type === "product" ? "本次商品素材" : "本次主体素材"
    })));
  if (!sourceAsset && !subjectReferences.some((reference) => reference.asset)) return null;
  return <section className="set-reference-strip" aria-label="本次参考">
    <div className="section-heading"><span>本次参考</span><small>待复刻画面与替换素材</small></div>
    <div>
      {sourceAsset && <ReferenceThumbnail asset={sourceAsset} alt="待复刻画面" label="待复刻画面" />}
      {subjectReferences.map((reference) => reference.asset && (
        <ReferenceThumbnail key={reference.key} asset={reference.asset} alt={reference.label} label={reference.label} />
      ))}
    </div>
  </section>;
}

export function DomainHint({
  profile,
  expanded = false,
  onChange
}: {
  profile?: DomainProfile;
  expanded?: boolean;
  onChange: (domain: Domain) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!profile) return null;
  const visible = expanded || profile.source === "user_override" ||
    profile.confidence === null || profile.confidence < 0.65;
  if (!visible) return null;
  return (
    <div className="domain-hint">
      <span>识别为：<strong>{DOMAIN_LABELS[profile.domain]}</strong></span>
      {editing ? (
        <select
          aria-label="更改领域"
          autoFocus
          value={profile.domain}
          onChange={(event) => {
            onChange(event.target.value as Domain);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
        >
          {Object.entries(DOMAIN_LABELS).map(([value, label]) =>
            <option key={value} value={value}>{label}</option>)}
        </select>
      ) : <button type="button" className="text-button" onClick={() => setEditing(true)}>更改</button>}
    </div>
  );
}

function SetOutput({
  item,
  asset,
  candidateAssets,
  onOpen,
  onRetry,
  onSelect
}: {
  item: CreationSetPlanItem;
  asset?: AssetRecord;
  candidateAssets: AssetRecord[];
  onOpen: (trigger: HTMLButtonElement) => void;
  onRetry: () => void;
  onSelect: (assetId: string) => void;
}) {
  const url = useObjectUrl(asset?.thumbnailBlob ?? asset?.blob);
  const selectedId = item.selectedOutputAssetId;
  const selectableAssets = candidateAssets.length ? candidateAssets : asset ? [asset] : [];
  return (
    <article className={`set-output ${item.status.toLowerCase()}`}>
      <button
        type="button"
        className="set-output-image"
        disabled={!asset}
        onClick={(event) => onOpen(event.currentTarget)}
        style={asset ? { aspectRatio: `${asset.width} / ${asset.height}` } : undefined}
      >
        {url ? <img src={url} alt={item.userFacingTitle} /> : item.status === "GENERATING"
          ? <LoaderCircle className="spinner" size={22} />
          : item.status === "FAILED" ? <CircleAlert size={22} /> : <span>{item.order}</span>}
      </button>
      <div>
        <strong>{item.userFacingTitle}</strong>
        <small>{qualityLabel(item)}</small>
      </div>
      {item.status === "FAILED" && <button type="button" className="text-button" onClick={onRetry}><RefreshCw size={13} />重试</button>}
      {item.error && <p>{safeCreationSetErrorMessage(item.error.message)}</p>}
      {selectableAssets.length === 1 && item.status === "COMPLETED" && (
        <button
          type="button"
          className="text-button set-single-final-action"
          aria-label={`选为第 ${item.order} 张最终版本`}
          aria-pressed={selectableAssets[0]!.id === selectedId}
          onClick={() => onSelect(selectableAssets[0]!.id)}
        >
          {selectableAssets[0]!.id === selectedId && <Check size={12} />}
          {selectableAssets[0]!.id === selectedId ? "已选为最终版本" : "选为最终版本"}
        </button>
      )}
      {selectableAssets.length > 1 && (
        <div className="set-candidates" aria-label={`${item.userFacingTitle}候选版本`}>
          {selectableAssets.map((candidate, index) => (
            <CandidateButton
              key={candidate.id}
              asset={candidate}
              label={index === 0 ? "首版" : `重试 ${index}`}
              selected={candidate.id === selectedId}
              onSelect={() => onSelect(candidate.id)}
            />
          ))}
        </div>
      )}
      {item.status === "COMPLETED" && <small className="final-selection">
        {selectedId ? <><Check size={12} />你已选定</> : "尚未选定最终版本"}
      </small>}
    </article>
  );
}

function CandidateButton({
  asset,
  label,
  selected,
  onSelect
}: {
  asset: AssetRecord;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const url = useObjectUrl(asset.thumbnailBlob ?? asset.blob);
  return (
    <button
      type="button"
      aria-label={`${label}，${selected ? "已选为最终版本" : "选为最终版本"}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <img src={url} alt="" />
      <span>{selected ? <Check size={11} /> : null}{label}</span>
    </button>
  );
}

function CurrentSetResult({
  item,
  asset,
  status,
  onOpen
}: {
  item?: CreationSetPlanItem;
  asset?: AssetRecord;
  status: CreationSet["status"];
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const url = useObjectUrl(asset?.blob);
  const checking = item?.qualityStatus === "checking";
  const empty = getCreationSetEmptyResultPresentation(status);
  return (
    <section className="set-current-result" aria-labelledby="set-current-result-title" aria-busy={!item && empty.busy}>
      <div className="section-heading">
        <span id="set-current-result-title">当前单张结果</span>
        <small>{item ? `第 ${item.order} 张` : setStatusLabels[status]}</small>
      </div>
      <button type="button" disabled={!asset} onClick={(event) => onOpen(event.currentTarget)}>
        {url
          ? <img src={url} alt={item?.userFacingTitle ?? "当前生成结果"} />
          : empty.busy
            ? <LoaderCircle className="spinner" size={24} />
            : <CircleAlert size={24} aria-hidden="true" />}
      </button>
      <div>
        <strong>{item?.userFacingTitle ?? empty.title}</strong>
        <span>{checking ? "已生成，正在检查" : item ? qualityLabel(item) : empty.detail}</span>
      </div>
    </section>
  );
}

function GridCompositeResult({
  blob,
  error,
  gridName,
  readyCount,
  requestedCount,
  layout,
  onLayoutChange,
  onRetryComposite
}: {
  blob?: Blob;
  error?: string;
  gridName: string;
  readyCount: number;
  requestedCount: number;
  layout: GridLayout;
  onLayoutChange: (layout: GridLayout) => void;
  onRetryComposite: () => void;
}) {
  const url = useObjectUrl(blob);
  const alternatives = gridLayoutAlternatives(layout.count);
  const presentation = getGridCompositePresentation({
    hasImage: Boolean(url),
    error,
    readyCount,
    requestedCount
  });
  return <section className="set-current-result grid-composite-result" aria-labelledby="grid-composite-title">
    <div className="section-heading">
      <span id="grid-composite-title">最终宫格 · {gridName}</span>
      <small>{url ? presentation.title : `可用单张 ${readyCount} / ${requestedCount}`}</small>
    </div>
    {alternatives.length > 1 && <fieldset className="grid-composite-layout-options">
      <legend>宫格方向</legend>
      {alternatives.map((candidate) => {
        const selected = candidate.columns === layout.columns && candidate.rows === layout.rows;
        return <button
          type="button"
          key={`${candidate.columns}x${candidate.rows}`}
          className={selected ? "active" : ""}
          aria-pressed={selected}
          onClick={() => onLayoutChange(candidate)}
        >{candidate.columns > candidate.rows ? "横向宫格" : "纵向宫格"}</button>;
      })}
    </fieldset>}
    {url
      ? <figure><img src={url} alt={`${gridName}合成预览`} /></figure>
      : error
        ? <div className="grid-composite-placeholder" role="alert">
            <CircleAlert size={22} />
            <strong>{presentation.title}</strong>
            <span>{error}</span>
            <button type="button" onClick={onRetryComposite}>{presentation.action}</button>
          </div>
        : <div className="grid-composite-placeholder" role="status">
            <LoaderCircle className={presentation.busy ? "spinner" : ""} size={22} />
            <strong>{presentation.title}</strong>
            <span>无需重新生成，切换方向只会在本地重新排版。</span>
          </div>}
    {url && <div><strong>完整{gridName}</strong><span>上方单张仍可逐张查看、选择和重试</span></div>}
  </section>;
}

function SetViewer({ asset, title, position, total, onPrevious, onNext, onModify, onClose }: {
  asset: AssetRecord;
  title: string;
  position: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onModify: () => void;
  onClose: () => void;
}) {
  const url = useObjectUrl(asset.blob);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ));
        const first = focusableElements[0];
        const last = focusableElements.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevious();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, onNext, onPrevious]);
  return <div ref={dialogRef} className="set-viewer" role="dialog" aria-modal="true" aria-labelledby="set-viewer-title" aria-describedby="set-viewer-position">
    <header><strong id="set-viewer-title"><span className="sr-only">套图查看器：</span>{title}</strong><span aria-hidden="true">{position}/{total}</span><button ref={closeButtonRef} type="button" aria-label="关闭查看器" onClick={onClose}><X size={18} /></button></header>
    <p id="set-viewer-position" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {`正在查看第 ${position} / ${total} 张：${title}`}
    </p>
    <div className="set-viewer-image"><img src={url} alt={title} /></div>
    <footer>
      <button type="button" disabled={position <= 1} onClick={onPrevious}>上一张</button>
      <button type="button" onClick={onModify}>重新生成这一张</button>
      <button type="button" disabled={position >= total} onClick={onNext}>下一张</button>
    </footer>
  </div>;
}

export function CreationSetView({
  creationSet,
  assets,
  onTitleChange,
  onIntentChange,
  onCountChange,
  onCompositeLayoutChange,
  onPlanItemChange,
  onReplan,
  onStart,
  onCancel,
  cancelling,
  onResume,
  onRetryFailed,
  onRetryItem,
  onExportAll,
  onExportGrid,
  onCheckQuality,
  qualityChecking,
  onSelectOutput,
  onBack,
  onClone,
  onDeleteGroup,
  onDeleteGroupAndWorks
}: {
  creationSet: CreationSet;
  assets: Map<string, AssetRecord>;
  onTitleChange: (title: string) => void | Promise<void>;
  onIntentChange: (intent: string) => void;
  onCountChange: (count: 2 | 3 | 4 | 6 | 9 | 12) => void;
  onCompositeLayoutChange: (layout: GridLayout) => void;
  onPlanItemChange: (id: string, promptDelta: string) => void;
  onReplan: () => void;
  onStart: () => void;
  onCancel: () => void;
  cancelling: boolean;
  onResume: () => void;
  onRetryFailed: () => void;
  onRetryItem: (id: string, issue?: SetQualityIssue) => void;
  onExportAll: () => void;
  onExportGrid: (mimeType: "image/png" | "image/jpeg") => void;
  onCheckQuality: () => void;
  qualityChecking: boolean;
  onSelectOutput: (itemId: string, assetId: string) => void;
  onBack: () => void;
  onClone: () => void;
  onDeleteGroup: () => void;
  onDeleteGroupAndWorks: () => void;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(creationSet.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState("");
  const scrollPosition = useRef(0);
  const viewerTrigger = useRef<HTMLButtonElement | null>(null);
  const titleTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setTitleDraft(creationSet.title), [creationSet.title]);
  const planning = ["PLANNING", "READY"].includes(creationSet.status);
  const active = creationSet.status === "GENERATING";
  const finalSelectionProgress = getCreationSetFinalSelectionProgress(
    creationSet.planItems,
    creationSet.requestedCount
  );
  const partialSelectionProgress = getCreationSetFinalSelectionProgress(
    creationSet.planItems,
    creationSet.completedCount
  );
  const partialDelivery = creationSet.completedCount < creationSet.requestedCount;
  const exportProgress = partialDelivery ? partialSelectionProgress : finalSelectionProgress;
  const exportRequirementId = `creation-set-export-requirement-${creationSet.id}`;
  const sourceGridLayout = resolveSourceGridLayout(creationSet);
  const compositeLayout = resolveCompositeLayout(creationSet);
  const gridName = compositeLayout ? gridLayoutNames[creationSet.requestedCount] : null;
  const gridComposite = useGridCompositePreview(creationSet, assets);
  const direction = createCreativeDirection({
    domain: creationSet.domainProfile.domain,
    visualDNA: creationSet.sharedVisualDNASnapshot,
    domainProfile: creationSet.domainProfile,
    userIntent: creationSet.userIntent
  });
  const blueprint = creationSet.transformationBlueprintSnapshot ?? createTransformationBlueprint({
    domain: creationSet.domainProfile.domain,
    visualDNA: creationSet.sharedVisualDNASnapshot,
    creativeDirection: direction,
    references: creationSet.sharedReferenceSnapshots.map((reference, index) => ({
      index: index + 1,
      role: reference.role,
      subjectType: reference.subjectAsset?.type,
      subjectName: reference.subjectAsset?.name
    }))
  });
  const productLock = creationSet.subjectAssetSnapshots.find((snapshot) =>
    snapshot.type === "product")?.productIdentityLock;
  const viewerItems = creationSet.planItems.flatMap((item) => {
    const assetId = item.selectedOutputAssetId ?? item.outputAssetId ?? item.outputCandidates.at(-1)?.outputAssetId;
    const asset = assetId ? assets.get(assetId) : undefined;
    return asset ? [{ item, asset }] : [];
  });
  const currentResult = [...viewerItems].sort((left, right) => {
    const leftCreatedAt = left.item.outputCandidates.at(-1)?.createdAt ?? left.item.order;
    const rightCreatedAt = right.item.outputCandidates.at(-1)?.createdAt ?? right.item.order;
    return leftCreatedAt - rightCreatedAt;
  }).at(-1);
  const currentResultIndex = currentResult
    ? viewerItems.findIndex((entry) => entry.item.id === currentResult.item.id)
    : -1;
  const openViewer = (index: number, trigger: HTMLButtonElement) => {
    scrollPosition.current = document.scrollingElement?.scrollTop ?? window.scrollY;
    viewerTrigger.current = trigger;
    setViewerIndex(index);
  };
  const closeViewer = () => {
    const trigger = viewerTrigger.current;
    viewerTrigger.current = null;
    setViewerIndex(null);
    window.requestAnimationFrame(() => {
      trigger?.focus();
      window.scrollTo({ top: scrollPosition.current });
    });
  };
  const finishTitleEditing = () => {
    setEditingTitle(false);
    window.requestAnimationFrame(() => titleTriggerRef.current?.focus());
  };
  const commitTitle = async () => {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleDraft(creationSet.title);
      setTitleError("");
      finishTitleEditing();
      return;
    }
    setSavingTitle(true);
    setTitleError("");
    try {
      await onTitleChange(nextTitle);
      finishTitleEditing();
    } catch {
      setTitleError("套图名称没有保存成功，请重试。");
    } finally {
      setSavingTitle(false);
    }
  };
  return (
    <section className="creation-set-view" aria-labelledby="creation-set-title">
      <div className="creation-set-header">
        <div>
          <button type="button" className="text-button" onClick={onBack}>返回作品</button>
          {editingTitle ? (
            <form className="creation-set-title-editor" aria-busy={savingTitle} onSubmit={(event) => {
              event.preventDefault();
              void commitTitle();
            }}>
              <input
                autoFocus
                aria-label={gridName ? "宫格作品名称" : "套图名称"}
                maxLength={40}
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setTitleDraft(creationSet.title);
                    setTitleError("");
                    finishTitleEditing();
                  }
                }}
              />
              <button type="submit" aria-label="保存套图名称" disabled={savingTitle}>
                {savingTitle ? "保存中…" : "保存"}
              </button>
              {titleError && <p className="creation-set-title-error" role="alert">{titleError}</p>}
            </form>
          ) : (
            <div className="creation-set-title-row">
              <h1 id="creation-set-title">{creationSet.title}</h1>
              <button
                ref={titleTriggerRef}
                type="button"
                className="creation-set-title-button"
                aria-label={gridName ? "修改宫格作品名称" : "修改套图名称"}
                onClick={() => {
                  setTitleError("");
                  setEditingTitle(true);
                }}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            </div>
          )}
          <p>{DOMAIN_LABELS[creationSet.domainProfile.domain]} · 已完成 {creationSet.completedCount} / {creationSet.requestedCount}</p>
        </div>
      </div>
      {productLock?.status === "confirmed" && (
        <p className="product-lock-state">
          <Check size={13} />商品身份已锁定 · {productLock.imageHashes.length} 张原始参考 · {productLock.invariants.length} 项不可变结构
        </p>
      )}
      <SetReferenceStrip creationSet={creationSet} assets={assets} />

      {planning ? (
        <>
          <label className="field">
            <span>这一组想表达什么？</span>
            <textarea value={creationSet.userIntent} onChange={(event) => onIntentChange(event.target.value)} placeholder="例如：同一人物在城市清晨完成一组安静但有变化的写真。" />
          </label>
          {sourceGridLayout ? (
            <p className="set-count-summary"><strong>已按参考宫格锁定 {creationSet.requestedCount} 个画面</strong><span>保持原图位置与顺序，不会变成普通套图。</span></p>
          ) : (
            <div className="set-count-summary">
              <strong>已确定 {creationSet.requestedCount} 个画面</strong>
              <span>下方计划与刚才选择的数量一致。</span>
              <details>
                <summary>修改画面数</summary>
                <fieldset className="set-count">
                  <legend className="sr-only">重新选择画面数</legend>
                  {([2, 3, 4, 6, 9, 12] as const).map((count) =>
                    <button type="button" key={count} aria-pressed={creationSet.requestedCount === count} className={creationSet.requestedCount === count ? "active" : ""} onClick={() => onCountChange(count)}>{count} 张</button>)}
                </fieldset>
              </details>
            </div>
          )}
          {sourceGridLayout && creationSet.gridSemanticStatus && (
            <p className={`grid-semantic-state ${creationSet.gridSemanticStatus}`} role="status">
              <strong>{creationSet.gridSemanticStatus === "refining"
                ? "基础计划已可用，正在后台增强逐格细节"
                : creationSet.gridSemanticStatus === "enhanced"
                  ? "逐格细节已根据真实画面增强"
                  : creationSet.gridSemanticStatus === "unavailable"
                    ? "精细分析未完成，继续使用基础计划"
                    : "当前使用可编辑的基础逐格计划"}</strong>
              <span>{creationSet.gridSemanticMessage}</span>
            </p>
          )}
          <div className="section-heading"><span>这一组将包含哪些画面？</span><small>{creationSet.requestedCount} 项</small></div>
          <ol className="set-plan-list">
            {creationSet.planItems.map((item) => (
              <li key={item.id} className={item.status === "CANCELLED" ? "removed" : ""}>
                <span>{item.order}</span>
                <div>
                  <strong>{item.userFacingTitle}</strong>
                  <small>{item.promptDelta.split("\n")[0]}</small>
                </div>
              </li>
            ))}
          </ol>
          <button type="button" className="primary set-start" disabled={!creationSet.planItems.some((item) => item.status === "PENDING")} onClick={onStart}>{sourceGridLayout ? "开始逐格生成" : "开始生成这一组"}</button>
          <details className="set-adjust">
            <summary>创作依据与调整</summary>
            <section className="creative-direction">
              <h2>整组创作方向</h2>
              <p>{direction.visualStory}</p>
              <dl>
                <div><dt>视觉主题</dt><dd>{direction.visualTheme}</dd></div>
                <div><dt>主体状态</dt><dd>{direction.subjectState}</dd></div>
                <div><dt>主体关系</dt><dd>{direction.subjectRelationship}</dd></div>
                <div><dt>镜头语言</dt><dd>{direction.cameraLanguage}</dd></div>
                <div><dt>情绪</dt><dd>{direction.emotionalTone}</dd></div>
              </dl>
            </section>
            <section className="transformation-blueprint">
              <h2>迁移方法</h2>
              {([
                ["保留什么", blueprint.preserve],
                ["替换什么", blueprint.replace],
                ["重新创造", blueprint.recreate],
                ["避免什么", blueprint.avoid]
              ] as const).map(([title, items]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ))}
            </section>
            {creationSet.planItems.filter((item) => item.status !== "CANCELLED").map((item) => (
              <label key={item.id}>
                <span>{item.userFacingTitle}</span>
                <textarea value={item.promptDelta} onChange={(event) => onPlanItemChange(item.id, event.target.value)} />
              </label>
            ))}
            <button type="button" onClick={onReplan}>{sourceGridLayout ? "重新生成逐格计划" : "重新生成整组计划"}</button>
          </details>
        </>
      ) : (
        <>
          <div className="set-progress" role="status" aria-live="polite">
            <strong>已完成 {creationSet.completedCount} / {creationSet.requestedCount}</strong>
            <span>{active
              ? `${sourceGridLayout ? "正在逐格生成" : "正在逐张生成"}第 ${Math.min(creationSet.completedCount + 1, creationSet.requestedCount)} / ${creationSet.requestedCount} 张；每张通常需要 2～8 分钟，最长等待 20 分钟，已完成内容会随时保留。`
              : qualityChecking
                ? "正在对照原始参考检查身份、结构与整组差异。"
                 : `已完成作品会一直保留 · 已选 ${finalSelectionProgress.selectedCount} 张最终版本`}</span>
          </div>
          <CurrentSetResult
            item={currentResult?.item}
            asset={currentResult?.asset}
            status={creationSet.status}
            onOpen={(trigger) => {
              if (currentResultIndex < 0) return;
              openViewer(currentResultIndex, trigger);
            }}
          />
          <div className="section-heading set-all-results-heading">
            <span>{sourceGridLayout ? "查看全部单格" : "查看全部单张"}</span>
            <small>{viewerItems.length} / {creationSet.requestedCount}</small>
          </div>
          <div className="creation-set-grid">
            {creationSet.planItems.map((item) => {
              const displayAssetId = item.selectedOutputAssetId ?? item.outputAssetId ??
                item.outputCandidates.at(-1)?.outputAssetId;
              return <SetOutput
                key={item.id}
                item={item}
                asset={displayAssetId ? assets.get(displayAssetId) : undefined}
                candidateAssets={item.outputCandidates
                  .map((candidate) => assets.get(candidate.outputAssetId))
                  .filter((asset): asset is AssetRecord => Boolean(asset))}
                onOpen={(trigger) => {
                  const index = viewerItems.findIndex((entry) => entry.item.id === item.id);
                  if (index < 0) return;
                  openViewer(index, trigger);
                }}
                onRetry={() => onRetryItem(item.id)}
                onSelect={(assetId) => {
                  const warning = getCreationSetFinalSelectionWarning(item.qualityStatus);
                  if (warning && !confirm(warning)) return;
                  onSelectOutput(item.id, assetId);
                }}
              />;
            })}
          </div>
          {gridName && compositeLayout && <GridCompositeResult
            blob={gridComposite.blob}
            error={gridComposite.error}
            gridName={gridName}
            readyCount={gridComposite.readyCount}
            requestedCount={creationSet.requestedCount}
            layout={compositeLayout}
            onLayoutChange={onCompositeLayoutChange}
            onRetryComposite={gridComposite.retry}
          />}
          {viewerIndex !== null && viewerItems[viewerIndex] && <SetViewer
            asset={viewerItems[viewerIndex]!.asset}
            title={viewerItems[viewerIndex]!.item.userFacingTitle}
            position={viewerIndex + 1}
            total={viewerItems.length}
            onPrevious={() => setViewerIndex((index) => index === null ? null : Math.max(0, index - 1))}
            onNext={() => setViewerIndex((index) => index === null ? null : Math.min(viewerItems.length - 1, index + 1))}
            onModify={() => {
              const itemId = viewerItems[viewerIndex]!.item.id;
              closeViewer();
              onRetryItem(itemId);
            }}
            onClose={closeViewer}
          />}
          {!active && creationSet.completedCount > 1 && (
            <section className="set-quality-guidance" role="status" aria-live="polite">
              <div>
                <strong>{creationSet.qualityReport
                  ? "整组一致性检查已完成"
                  : qualityChecking
                    ? "正在检查整组一致性"
                    : "尚未完成整组一致性检查"}</strong>
                <p>{creationSet.qualityReport
                  ? creationSet.qualityReport.summary
                  : "建议先检查人物、商品和画面之间是否一致。这是推荐步骤，不会阻止你人工选择最终版本。"}</p>
              </div>
              {!creationSet.qualityReport && (
                <button type="button" disabled={qualityChecking} onClick={onCheckQuality}>
                  {qualityChecking ? "正在检查…" : "检查整组一致性"}
                </button>
              )}
            </section>
          )}
          {creationSet.qualityReport && (
            <section className="set-quality">
              <h2>作品检查</h2>
              <p>{creationSet.qualityReport.summary}</p>
              {creationSet.qualityReport.issues.length
                ? <ul>{creationSet.qualityReport.issues.map((issue, index) =>
                    <li key={`${issue.type}-${index}`}>
                      <strong>{issue.message}</strong>
                      {issue.impact && <span><b>为什么影响作品：</b>{issue.impact}</span>}
                      {issue.retryFocus && <span><b>重试时强化：</b>{issue.retryFocus}</span>}
                      {(issue.preserve?.length ?? 0) > 0 && <span><b>必须保持：</b>{issue.preserve!.join("、")}</span>}
                      {issue.suggestion && <span>{issue.suggestion}</span>}
                      {issue.itemIds.map((itemId) => {
                        const item = creationSet.planItems.find((candidate) => candidate.id === itemId);
                        return item && (
                          <button key={itemId} type="button" onClick={() => onRetryItem(itemId, issue)}>
                            <RefreshCw size={13} />定向重试第 {item.order} 张
                          </button>
                        );
                      })}
                    </li>)}</ul>
                : <p>未发现需要特别提示的明显问题，视觉质量仍需人工检查。</p>}
            </section>
          )}
          {!active && creationSet.completedCount > 0 && (
            <p id={exportRequirementId} className="set-export-requirement" role="status">
              {exportProgress.ready
                ? `${partialDelivery ? "已完成的" : "全部"} ${exportProgress.requiredCount} 个画面都已选定最终版本，可以导出。`
                : `导出前，请为${partialDelivery ? "每个已完成" : "每个"}画面选定最终版本（已选 ${exportProgress.selectedCount} / ${exportProgress.requiredCount}）。`}
            </p>
          )}
          <div className="set-primary-actions">
            {active
              ? <button type="button" disabled={cancelling} onClick={onCancel}>{cancelling ? "正在停止…" : "停止生成"}</button>
              : creationSet.status === "INTERRUPTED" || creationSet.status === "CANCELLED"
                ? <button type="button" className="primary" onClick={onResume}>继续未完成项</button>
                : creationSet.failedCount > 0
                  ? <button type="button" className="primary" onClick={onRetryFailed}>只重试失败项</button>
                  : creationSet.completedCount > 0
                    ? creationSet.deliveryMode === "grid"
                      ? <button type="button" className="primary" aria-describedby={exportRequirementId} disabled={!finalSelectionProgress.ready} onClick={() => onExportGrid("image/png")}><ArrowDownToLine size={14} />导出宫格 PNG</button>
                      : <button type="button" className="primary" aria-describedby={exportRequirementId} disabled={!finalSelectionProgress.ready} onClick={onExportAll}><ArrowDownToLine size={14} />{creationSet.deliveryMode === "both" ? "导出全部文件" : "导出全部单张"}</button>
                    : null}
          </div>
          {!active && (
            <details className="set-more-actions">
              <summary>更多操作</summary>
              <div>
                {creationSet.completedCount > 0 && partialDelivery &&
                  <button type="button" aria-describedby={exportRequirementId} disabled={!partialSelectionProgress.ready} onClick={onExportAll}><ArrowDownToLine size={14} />导出已完成单张</button>}
                {creationSet.completedCount === creationSet.requestedCount && creationSet.deliveryMode !== "independent" && <>
                  {creationSet.deliveryMode !== "grid" && <button type="button" aria-describedby={exportRequirementId} disabled={!finalSelectionProgress.ready} onClick={() => onExportGrid("image/png")}><ArrowDownToLine size={14} />导出宫格 PNG</button>}
                  <button type="button" aria-describedby={exportRequirementId} disabled={!finalSelectionProgress.ready} onClick={() => onExportGrid("image/jpeg")}><ArrowDownToLine size={14} />导出宫格 JPEG</button>
                </>}
                <button type="button" onClick={onClone}>从当前组创建新组</button>
                <button type="button" onClick={onDeleteGroup}>仅删除分组</button>
                <button type="button" className="danger-link" onClick={onDeleteGroupAndWorks}>删除分组和组内作品</button>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

export function CreationSetCard({
  creationSet,
  cover,
  onOpen,
  onDelete
}: {
  creationSet: CreationSet;
  cover?: AssetRecord;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const url = useObjectUrl(cover?.thumbnailBlob ?? cover?.blob);
  return (
    <article className="project-card creation-set-card">
      <button type="button" className="project-image" onClick={onOpen}>
        {url ? <img src={url} alt={creationSet.title} /> : <span>{creationSet.requestedCount} 张</span>}
      </button>
      <div>
        <button type="button" className="project-title" onClick={onOpen}>{creationSet.title}</button>
        <small>
          {DOMAIN_LABELS[creationSet.domainProfile.domain]} · {creationSet.completedCount}/{creationSet.requestedCount}
          {creationSet.subjectAssetSnapshots[0] ? ` · ${creationSet.subjectAssetSnapshots[0].name}` : " · 风格参考"}
        </small>
      </div>
      <div className="creation-set-card-actions">
        <span className={`set-status-badge status-${creationSet.status.toLowerCase()}`}>
          {creationSet.status === "GENERATING" && <LoaderCircle className="spinner" size={12} aria-hidden="true" />}
          {setStatusLabels[creationSet.status]}
        </span>
        <button type="button" className="icon-button" aria-label="删除套图" title="删除套图" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}
