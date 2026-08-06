import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Pencil, Trash2, X } from "lucide-react";
import type {
  AssetRecord,
  SubjectAsset,
  SubjectAssetType,
  SubjectQualityReport
} from "@styleforge/contracts";
import {
  subjectTypeLabels,
  subjectTypeOrder,
  subjectTypePresentation
} from "./subject-presentation";

export { subjectTypeLabels } from "./subject-presentation";

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

export function SubjectAssetThumb({ image, alt }: { image?: AssetRecord; alt: string }) {
  const url = useObjectUrl(image?.thumbnailBlob);
  return url ? <img src={url} alt={alt} /> : <span className="subject-thumb-empty"><ImagePlus size={18} /></span>;
}

export function subjectPickerTypeGroups(recommendedType?: SubjectAssetType) {
  const primary = recommendedType
    ? [recommendedType]
    : (["person", "product"] satisfies SubjectAssetType[]);
  return {
    primary,
    other: subjectTypeOrder.filter((type) => !primary.includes(type))
  };
}

export function prioritizeSubjectAssets(
  assets: SubjectAsset[],
  recommendedType?: SubjectAssetType
) {
  if (!recommendedType) return assets;
  return [
    ...assets.filter((asset) => asset.type === recommendedType),
    ...assets.filter((asset) => asset.type !== recommendedType)
  ];
}

export function subjectReferenceUsageLabel(asset: SubjectAsset) {
  const photoLabel = asset.type === "person" ? "身份照片" : `${subjectTypeLabels[asset.type]}照片`;
  return asset.imageIds.length === 1
    ? `1 张${photoLabel}用于生成`
    : `${asset.imageIds.length} 张${photoLabel}全部用于生成`;
}

export function SubjectAssetPicker({
  assets,
  images,
  selected,
  recommendedType,
  open,
  onOpen,
  onClose,
  onSelect,
  onRemove,
  onEdit,
  onCreate
}: {
  assets: SubjectAsset[];
  images: Map<string, AssetRecord>;
  selected?: SubjectAsset;
  recommendedType?: SubjectAssetType;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (asset: SubjectAsset) => void;
  onRemove: () => void;
  onEdit: (asset: SubjectAsset) => void;
  onCreate: (type: SubjectAssetType) => void;
}) {
  const orderedAssets = prioritizeSubjectAssets(assets, recommendedType);
  const typeGroups = subjectPickerTypeGroups(recommendedType);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    const shouldRestoreFocus = wasOpen.current && !open;
    wasOpen.current = open;
    if (!open && !shouldRestoreFocus) return;
    const focusFrame = window.requestAnimationFrame(() => {
      if (open) pickerPanelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      else pickerTriggerRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open]);
  return (
    <section className="subject-picker">
      {selected ? (
        <div className="selected-subject" aria-label="已选替换对象">
        <SubjectAssetThumb image={images.get(selected.primaryImageId)} alt={selected.name} />
        <span><strong>{selected.name}</strong><small>{subjectTypeLabels[selected.type]} · {subjectReferenceUsageLabel(selected)}</small></span>
        <div className="selected-subject-actions">
          <button
            ref={pickerTriggerRef}
            type="button"
            className="text-button"
            aria-expanded={open}
            aria-controls="subject-picker-options"
            onClick={open ? onClose : onOpen}
          >{open ? "关闭选择" : "更换"}</button>
          <button type="button" className="text-button" onClick={() => onEdit(selected)}>编辑素材</button>
          <button type="button" className="icon-button" aria-label="移除当前主体" onClick={onRemove}><X size={16} /></button>
        </div>
        </div>
      ) : (
        <button
          ref={pickerTriggerRef}
          type="button"
          className="subject-picker-trigger"
          aria-expanded={open}
          aria-controls="subject-picker-options"
          onClick={open ? onClose : onOpen}
        >
          <ImagePlus size={18} />选择要换成谁或什么
        </button>
      )}
      {open && (
        <div
          ref={pickerPanelRef}
          id="subject-picker-options"
          className="subject-picker-panel"
          role="region"
          aria-label="选择要换成谁或什么"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
          }}
        >
          {assets.length > 0 && <>
            <div className="section-heading">
              <span>最近使用</span>
              <small>{recommendedType ? `优先显示${subjectTypeLabels[recommendedType]}` : `${assets.length} 个`}</small>
            </div>
            <div className="subject-picker-list">
              {orderedAssets.slice(0, 8).map((asset, index) => (
                <button type="button" key={asset.id} onClick={() => onSelect(asset)} aria-label={`使用${asset.name}（${subjectTypeLabels[asset.type]}）`}>
                  <SubjectAssetThumb image={images.get(asset.primaryImageId)} alt="" />
                  <span>
                    <strong>{asset.name}</strong>
                    <small>{subjectTypeLabels[asset.type]}{recommendedType === asset.type && index === 0 ? " · 推荐" : ""}</small>
                  </span>
                </button>
              ))}
            </div>
          </>}
          <div className="subject-create-actions">
            {typeGroups.primary.map((type) => (
              <button type="button" key={type} onClick={() => onCreate(type)}>
                {subjectTypePresentation[type].createTitle}
              </button>
            ))}
          </div>
          <details>
            <summary>添加其他对象</summary>
            <div className="subject-create-actions">
              {typeGroups.other.map((type) => (
                <button type="button" key={type} onClick={() => onCreate(type)}>
                  {subjectTypePresentation[type].createTitle}
                </button>
              ))}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

export interface SubjectAssetDraft {
  name: string;
  type: SubjectAssetType;
  photos: Array<AssetRecord | File>;
  primaryIndex: number;
  photoPurposes: Array<"face" | "full_body">;
}

export interface IdentityBoardPanelProps {
  subject: SubjectAsset;
  image?: AssetRecord;
  busy?: boolean;
  onGenerate?: () => void | Promise<void>;
  onConfirm?: () => void | Promise<void>;
  onDisable?: () => void | Promise<void>;
  onEnable?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

export function IdentityBoardPanel({
  subject,
  image,
  busy = false,
  onGenerate,
  onConfirm,
  onDisable,
  onEnable,
  onDelete
}: IdentityBoardPanelProps) {
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const board = subject.identityBoard;
  const unavailable = busy || working;
  const run = async (action?: () => void | Promise<void>) => {
    if (!action || unavailable) return;
    setWorking(true);
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "人物基准图操作失败，请重试。");
    } finally {
      setWorking(false);
    }
  };
  const remove = () => {
    if (!onDelete || unavailable) return;
    if (!window.confirm("删除人物基准图后，人物卡中的原始照片会完整保留。历史作品仍保留当时使用的引用记录。确定删除吗？")) return;
    void run(onDelete);
  };

  return (
    <section className="quality-report" aria-labelledby={`identity-board-${subject.id}`}>
      <div className="section-heading">
        <span id={`identity-board-${subject.id}`}>人物基准图</span>
        <small>{board ? board.status === "draft" ? "等待确认" : board.status === "confirmed" ? "已确认" : "已停用" : "可选"}</small>
      </div>
      {!board ? (
        <>
          <p>生成一张中性、清晰的身份参考，帮助多种风格下保持人物。原始照片始终是最高可信来源。</p>
          <button type="button" disabled={unavailable || !onGenerate} onClick={() => void run(onGenerate)}>
            {unavailable ? "正在生成…" : "生成人物基准图"}
          </button>
        </>
      ) : (
        <>
          <div className="subject-photo-grid">
            <article className="subject-photo">
              <SubjectAssetThumb image={image} alt={`${subject.name}的人物基准图，AI 生成`} />
              <button type="button" className="subject-primary" disabled>AI 生成</button>
            </article>
          </div>
          <p>
            {board.status === "draft"
              ? "请先预览人物是否仍然像本人；确认后才会用于新创作。"
              : board.status === "confirmed"
                ? "这张图只供你人工核对人物稳定性；新创作仍只使用原始上传照片，避免 AI 图反向污染本人特征。"
                : "这张基准图已停用，新创作只使用原始人物照片。"}
          </p>
          <div className="subject-editor-actions">
            {board.status === "draft" && (
              <button type="button" className="primary" disabled={unavailable || !onConfirm} onClick={() => void run(onConfirm)}>
                确认使用
              </button>
            )}
            {board.status === "confirmed" && (
              <button type="button" disabled={unavailable || !onDisable} onClick={() => void run(onDisable)}>停用</button>
            )}
            {board.status === "disabled" && (
              <button type="button" className="primary" disabled={unavailable || !onEnable} onClick={() => void run(onEnable)}>
                重新启用
              </button>
            )}
            <button type="button" disabled={unavailable || !onGenerate} onClick={() => void run(onGenerate)}>
              {unavailable ? "正在处理…" : "重新生成"}
            </button>
            <button type="button" className="danger-link" disabled={unavailable || !onDelete} onClick={remove}>
              <Trash2 size={14} />删除基准图
            </button>
          </div>
        </>
      )}
      {actionError && <p className="subject-editor-error" role="alert">{actionError}</p>}
    </section>
  );
}

function ProductIdentityLockPanel({
  subject,
  onConfirm,
  onDisable,
  onEnable
}: {
  subject: SubjectAsset;
  onConfirm?: () => void | Promise<void>;
  onDisable?: () => void | Promise<void>;
  onEnable?: () => void | Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");
  const lock = subject.productIdentityLock;
  if (!lock) return null;
  const run = async (action?: () => void | Promise<void>) => {
    if (!action || working) return;
    setWorking(true);
    setActionError("");
    try {
      await action();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "商品身份锁操作失败，请重试。");
    } finally {
      setWorking(false);
    }
  };
  return (
    <section className="quality-report" aria-labelledby={`product-lock-${subject.id}`}>
      <div className="section-heading">
        <span id={`product-lock-${subject.id}`}>商品身份锁</span>
        <small>{lock.status === "draft" ? "等待确认" : lock.status === "confirmed" ? "已锁定" : "已停用"}</small>
      </div>
      <p>{lock.imageHashes.length} 张商品参考图将作为身份依据。换图后必须重新确认，不会沿用旧锁。</p>
      <ul>{lock.invariants.map((invariant) => <li key={invariant}>{invariant}</li>)}</ul>
      <div className="subject-editor-actions">
        {lock.status === "draft" && (
          <button type="button" className="primary" disabled={working || !onConfirm} onClick={() => void run(onConfirm)}>
            确认锁定商品
          </button>
        )}
        {lock.status === "confirmed" && (
          <button type="button" disabled={working || !onDisable} onClick={() => void run(onDisable)}>停用身份锁</button>
        )}
        {lock.status === "disabled" && (
          <button type="button" className="primary" disabled={working || !onEnable} onClick={() => void run(onEnable)}>
            重新启用
          </button>
        )}
      </div>
      {actionError && <p className="subject-editor-error" role="alert">{actionError}</p>}
    </section>
  );
}

export function SubjectAssetEditor({
  initial,
  initialImages,
  initialType,
  onSave,
  onCancel,
  onDelete,
  identityBoardImage,
  identityBoardBusy,
  onGenerateIdentityBoard,
  onConfirmIdentityBoard,
  onDisableIdentityBoard,
  onEnableIdentityBoard,
  onDeleteIdentityBoard,
  onConfirmProductIdentityLock,
  onDisableProductIdentityLock,
  onEnableProductIdentityLock
}: {
  initial?: SubjectAsset;
  initialImages: AssetRecord[];
  initialType: SubjectAssetType;
  onSave: (draft: SubjectAssetDraft) => Promise<{ saved: boolean; report: SubjectQualityReport | null }>;
  onCancel: () => void;
  onDelete?: () => void;
  identityBoardImage?: AssetRecord;
  identityBoardBusy?: boolean;
  onGenerateIdentityBoard?: () => void | Promise<void>;
  onConfirmIdentityBoard?: () => void | Promise<void>;
  onDisableIdentityBoard?: () => void | Promise<void>;
  onEnableIdentityBoard?: () => void | Promise<void>;
  onDeleteIdentityBoard?: () => void | Promise<void>;
  onConfirmProductIdentityLock?: () => void | Promise<void>;
  onDisableProductIdentityLock?: () => void | Promise<void>;
  onEnableProductIdentityLock?: () => void | Promise<void>;
}) {
  const addInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<SubjectAssetType>(initial?.type ?? initialType);
  const [photos, setPhotos] = useState<Array<AssetRecord | File>>(initialImages);
  const [primaryIndex, setPrimaryIndex] = useState(Math.max(0, initialImages.findIndex((image) => image.id === initial?.primaryImageId)));
  const [photoPurposes, setPhotoPurposes] = useState<Array<"face" | "full_body">>(initialImages.map((image) =>
    initial?.imagePurposes?.[image.id] ?? "face"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<SubjectQualityReport | null>(initial?.qualityReport ?? null);
  const presentation = subjectTypePresentation[type];

  const addFiles = (files: File[]) => {
    const available = Math.max(0, 5 - photos.length);
    setPhotos((current) => [...current, ...files].slice(0, 5));
    setPhotoPurposes((current) => [...current, ...files.slice(0, available).map(() => "face" as const)]);
  };
  const remove = (index: number) => {
    setPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index));
    setPhotoPurposes((current) => current.filter((_, photoIndex) => photoIndex !== index));
    setPrimaryIndex((current) => current === index ? 0 : current > index ? current - 1 : current);
    setReport(null);
  };
  const replace = (index: number, file?: File) => {
    if (!file) return;
    setPhotos((current) => current.map((photo, photoIndex) => photoIndex === index ? file : photo));
    setReport(null);
  };
  const submit = async () => {
    if (!name.trim()) return setError("请输入名称。");
    if (!photos.length) return setError(presentation.emptyMediaError);
    setSaving(true);
    setError("");
    try {
      const result = await onSave({
        name: name.trim(),
        type,
        photos,
        primaryIndex,
        photoPurposes
      });
      setReport(result.report);
      if (result.saved) onCancel();
      else setError(presentation.saveFailure);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="subject-editor" aria-labelledby="subject-editor-title">
      <div className="subject-editor-header">
        <div>
          <h1 id="subject-editor-title">{initial ? presentation.editTitle : presentation.createTitle}</h1>
          <p>{presentation.description}</p>
        </div>
        <button type="button" className="icon-button" aria-label="关闭编辑" onClick={onCancel}><X size={18} /></button>
      </div>
      <label className="field"><span>名称</span><input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={presentation.namePlaceholder} /></label>
      <label className="field"><span>{initial ? "类型（保存后不可更改）" : "类型"}</span><select value={type} disabled={Boolean(initial)} onChange={(event) => {
        setType(event.target.value as SubjectAssetType);
        setError("");
        setReport(null);
      }}>
        {subjectTypeOrder.map((value) => <option key={value} value={value}>{subjectTypeLabels[value]}</option>)}
      </select></label>
      <div className="subject-photo-heading"><span>{presentation.mediaLabel}</span><small>{photos.length} / 5</small></div>
      <div className="subject-photo-grid">
        {photos.map((photo, index) => (
          <PhotoEditor
            key={photo instanceof File ? `${photo.name}-${photo.lastModified}-${index}` : photo.id}
            photo={photo}
            primary={index === primaryIndex}
            onPrimary={() => setPrimaryIndex(index)}
            onReplace={(file) => replace(index, file)}
            onRemove={() => remove(index)}
            subjectLabel={presentation.label}
            purpose={photoPurposes[index] ?? "face"}
            onPurposeChange={(purpose) => setPhotoPurposes((current) => current.map((value, photoIndex) =>
              photoIndex === index ? purpose : value))}
          />
        ))}
        {photos.length < 5 && <button type="button" className="subject-photo-add" onClick={() => addInput.current?.click()}><ImagePlus size={20} /><span>{presentation.addMediaLabel}</span></button>}
      </div>
      <input ref={addInput} hidden multiple type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => addFiles(Array.from(event.target.files ?? []))} />
      {type === "person" && !photoPurposes.includes("full_body") && (
        <p className="subject-hint">当前可以锁定面部。想保持身材和腿部比例，请再添加一张自然站立的全身照。</p>
      )}
      {type === "product" && <p className="subject-hint">确认商品身份后，每次生成都会保持原始图片特征、外形比例、关键结构和材质；Logo 与文字仍受模型能力限制。</p>}
      {report && <QualityReport report={report} />}
      {initial?.type === "person" && (
        <IdentityBoardPanel
          subject={initial}
          image={identityBoardImage}
          busy={identityBoardBusy}
          onGenerate={onGenerateIdentityBoard}
          onConfirm={onConfirmIdentityBoard}
          onDisable={onDisableIdentityBoard}
          onEnable={onEnableIdentityBoard}
          onDelete={onDeleteIdentityBoard}
        />
      )}
      {initial?.type === "product" && (
        <ProductIdentityLockPanel
          subject={initial}
          onConfirm={onConfirmProductIdentityLock}
          onDisable={onDisableProductIdentityLock}
          onEnable={onEnableProductIdentityLock}
        />
      )}
      {error && <p className="subject-editor-error" role="alert">{error}</p>}
      <div className="subject-editor-actions">
        <button type="button" className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "正在保存…" : "保存"}</button>
        <button type="button" onClick={onCancel}>取消</button>
        {onDelete && <button type="button" className="danger-link" onClick={onDelete}><Trash2 size={14} />从主体库移除{presentation.label}</button>}
      </div>
    </section>
  );
}

function PhotoEditor({ photo, primary, onPrimary, onReplace, onRemove, subjectLabel, purpose, onPurposeChange }: {
  photo: AssetRecord | File;
  primary: boolean;
  onPrimary: () => void;
  onReplace: (file?: File) => void;
  onRemove: () => void;
  subjectLabel: string;
  purpose: "face" | "full_body";
  onPurposeChange: (purpose: "face" | "full_body") => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const blob = photo instanceof File ? photo : photo.thumbnailBlob;
  const url = useObjectUrl(blob);
  const primaryLabel = subjectLabel === "人物" ? "身份主照片" : `${subjectLabel}主照片`;
  const setPrimaryLabel = subjectLabel === "人物" ? "设为身份主照片" : `设为${subjectLabel}主照片`;
  return (
    <article className={`subject-photo ${primary ? "primary-photo" : ""}`}>
      <img src={url} alt={`${subjectLabel}照片${primary ? `，${primaryLabel}` : ""}`} />
      <button type="button" className="subject-primary" aria-pressed={primary} onClick={onPrimary}>{primary ? <><Check size={13} />{primaryLabel}</> : setPrimaryLabel}</button>
      <select aria-label="照片用途" value={purpose} onChange={(event) => onPurposeChange(event.target.value as "face" | "full_body")}>
        <option value="face">面部参考</option>
        <option value="full_body">全身参考</option>
      </select>
      <div>
        <button type="button" aria-label="替换照片" onClick={() => input.current?.click()}><Pencil size={13} /></button>
        <button type="button" aria-label="删除照片" onClick={onRemove}><Trash2 size={13} /></button>
      </div>
      <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onReplace(event.target.files?.[0])} />
    </article>
  );
}

function QualityReport({ report }: { report: SubjectQualityReport }) {
  const problems = report.images.flatMap((image, index) =>
    Object.values(image.checks)
      .filter((check) => check.status !== "pass")
      .map((check) => ({ ...check, index: index + 1 })));
  return (
    <details className="quality-report" open={report.overall !== "pass"}>
      <summary><span>照片参考建议</span><small>{report.overall === "pass" ? "未发现明显问题" : "仅供参考"}</small></summary>
      {!problems.length && <p>照片参考检查未发现明显问题。</p>}
      {problems.map((problem, index) => <p key={`${problem.index}-${index}`}>
        <strong>照片 {problem.index}：{problem.message}</strong>
        {problem.suggestion && <small>{problem.suggestion}</small>}
        {problem.status === "unconfirmed" && <em>无法确认</em>}
      </p>)}
      {report.sameIdentity.status !== "pass" && <p><strong>多图一致性：{report.sameIdentity.message}</strong>{report.sameIdentity.suggestion && <small>{report.sameIdentity.suggestion}</small>}</p>}
    </details>
  );
}

export function SubjectAssetLibraryCard({
  asset,
  image,
  onUse,
  onEdit
}: {
  asset: SubjectAsset;
  image?: AssetRecord;
  onUse: () => void;
  onEdit: () => void;
}) {
  return (
    <article className="subject-library-card">
      <button type="button" className="subject-library-image" onClick={onEdit}><SubjectAssetThumb image={image} alt={asset.name} /></button>
      <div><strong>{asset.name}</strong><small>{subjectTypeLabels[asset.type]} · {asset.imageIds.length} 张照片</small></div>
      <div><button type="button" onClick={onUse}>再次使用</button><button type="button" className="icon-button" aria-label={`编辑${asset.name}`} onClick={onEdit}><Pencil size={14} /></button></div>
    </article>
  );
}
