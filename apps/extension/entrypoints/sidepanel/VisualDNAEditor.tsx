import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Lock, LockOpen, Plus, X } from "lucide-react";
import type { Domain, VisualDNA, VisualDNALocks } from "@styleforge/contracts";
import { reviseVisualDNA } from "@styleforge/core";

type GroupKey =
  | "subject" | "composition" | "camera" | "lighting" | "palette"
  | "material" | "texture" | "mood" | "style";
type LockKey = keyof VisualDNALocks;

const groupLabels: Record<GroupKey, string> = {
  subject: "主体",
  composition: "构图",
  camera: "镜头",
  lighting: "光线",
  palette: "色彩",
  material: "材质",
  texture: "纹理",
  mood: "情绪",
  style: "风格"
};

function Field({ label, value, onChange, multiline = false, type = "text" }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  multiline?: boolean;
  type?: "text" | "number";
}) {
  return (
    <label className="dna-field">
      <span>{label}</span>
      {multiline
        ? <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
        : <input aria-label={label} type={type} value={value} onChange={(event) => onChange(event.target.value)} />}
    </label>
  );
}

function ListField({ label, values, onChange }: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const value = input.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setInput("");
  };
  return (
    <div className="dna-list-field">
      <span>{label}</span>
      <div className="dna-chips">
        {values.map((value) => (
          <span key={value}>{value}<button aria-label={`移除${value}`} onClick={() => onChange(values.filter((item) => item !== value))}><X size={12} /></button></span>
        ))}
      </div>
      <div className="dna-list-add">
        <input
          aria-label={`添加${label}`}
          value={input}
          placeholder="输入后按回车"
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button aria-label={`确认添加${label}`} onClick={add}><Plus size={14} /></button>
      </div>
    </div>
  );
}

function Group({ name, summary, lock, open, onToggle, onLock, children }: {
  name: GroupKey;
  summary: string;
  lock?: VisualDNALocks[LockKey];
  open: boolean;
  onToggle: () => void;
  onLock?: () => void;
  children: ReactNode;
}) {
  const label = groupLabels[name];
  const panelId = `dna-${name}-fields`;
  return (
    <div className="dna-group" data-group={name}>
      <div className="dna-group-header">
        <button
          type="button"
          className="dna-group-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <span><strong>{label}</strong><small>{summary}</small></span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
        {lock && onLock && (
          <button
            type="button"
            className="dna-lock"
            aria-label={`${lock === "locked" ? "解锁" : "锁定"}${label}`}
            aria-pressed={lock === "locked"}
            onClick={onLock}
          >
            {lock === "locked" ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
            {lock === "locked" ? "已锁" : "可变"}
          </button>
        )}
      </div>
      {open && <div id={panelId} className="dna-group-fields">{children}</div>}
    </div>
  );
}

export function VisualDNAEditor({ dna, domain, onCommit }: {
  dna: VisualDNA;
  domain?: Domain;
  onCommit: (dna: VisualDNA) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(dna);
  const [openGroup, setOpenGroup] = useState<GroupKey | null>(null);
  useEffect(() => setDraft(dna), [dna]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(dna), [draft, dna]);
  const update = <K extends GroupKey>(key: K, value: VisualDNA[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const toggleLock = (key: LockKey) => setDraft((current) => ({
    ...current,
    locks: {
      ...current.locks,
      [key]: current.locks[key] === "locked" ? "unlocked" : "locked"
    }
  }));
  const groupProps = (name: GroupKey, summary: string, lockKey?: LockKey) => ({
    name,
    summary,
    open: openGroup === name,
    onToggle: () => setOpenGroup((current) => current === name ? null : name),
    ...(lockKey ? { lock: draft.locks[lockKey], onLock: () => toggleLock(lockKey) } : {})
  });

  return (
    <section className={`dna-panel domain-${domain ?? "photography"}`} aria-label="风格配方编辑器">
      <div className="section-heading">
        <span>参考图方法</span>
        <small>{dirty ? "有未保存修改" : `版本 ${dna.revision}`}</small>
      </div>
      <p className="dna-editor-summary">{draft.summary}</p>
      <div className="identity-lock">
        <span><strong>身份保持</strong><small>仅控制生成一致性，不建立人物档案</small></span>
        <button
          className="dna-lock"
          aria-label={`${draft.locks.identity === "locked" ? "解锁" : "锁定"}身份`}
          aria-pressed={draft.locks.identity === "locked"}
          onClick={() => toggleLock("identity")}
        >
          {draft.locks.identity === "locked" ? <Lock size={14} /> : <LockOpen size={14} />}
          {draft.locks.identity === "locked" ? "已锁" : "可变"}
        </button>
      </div>

      <div className="dna-groups">
      <Group {...groupProps("subject", draft.subject.description, "subject")}>
        <Field label="主体描述" value={draft.subject.description} multiline onChange={(value) => update("subject", { ...draft.subject, description: value })} />
        <Field label="主体数量" type="number" value={draft.subject.count} onChange={(value) => update("subject", { ...draft.subject, count: Math.max(0, Number(value) || 0) })} />
        <Field label="动作" value={draft.subject.action ?? ""} onChange={(value) => update("subject", { ...draft.subject, action: value || null })} />
        <Field label="环境" value={draft.subject.environment ?? ""} onChange={(value) => update("subject", { ...draft.subject, environment: value || null })} />
      </Group>
      <Group {...groupProps("composition", `${draft.composition.shotType} · ${draft.composition.subjectPlacement}`, "composition")}>
        <Field label="景别" value={draft.composition.shotType} onChange={(value) => update("composition", { ...draft.composition, shotType: value })} />
        <Field label="主体位置" value={draft.composition.subjectPlacement} onChange={(value) => update("composition", { ...draft.composition, subjectPlacement: value })} />
        <Field label="留白" value={draft.composition.negativeSpace} onChange={(value) => update("composition", { ...draft.composition, negativeSpace: value })} />
        <Field label="空间层次" value={draft.composition.depth} onChange={(value) => update("composition", { ...draft.composition, depth: value })} />
        <Field label="比例提示" value={draft.composition.aspectRatioHint ?? ""} onChange={(value) => update("composition", { ...draft.composition, aspectRatioHint: value || null })} />
      </Group>
      <Group {...groupProps("camera", `${draft.camera.angle} · ${draft.camera.lens}`, "camera")}>
        <Field label="机位角度" value={draft.camera.angle} onChange={(value) => update("camera", { ...draft.camera, angle: value })} />
        <Field label="镜头" value={draft.camera.lens} onChange={(value) => update("camera", { ...draft.camera, lens: value })} />
        <Field label="焦距" value={draft.camera.focalLength} onChange={(value) => update("camera", { ...draft.camera, focalLength: value })} />
        <Field label="拍摄距离" value={draft.camera.distance} onChange={(value) => update("camera", { ...draft.camera, distance: value })} />
        <Field label="景深" value={draft.camera.depthOfField} onChange={(value) => update("camera", { ...draft.camera, depthOfField: value })} />
        <Field label="透视" value={draft.camera.perspective} onChange={(value) => update("camera", { ...draft.camera, perspective: value })} />
      </Group>
      <Group {...groupProps("lighting", `${draft.lighting.direction} · ${draft.lighting.quality}`, "lighting")}>
        <Field label="光源" value={draft.lighting.source} onChange={(value) => update("lighting", { ...draft.lighting, source: value })} />
        <Field label="方向" value={draft.lighting.direction} onChange={(value) => update("lighting", { ...draft.lighting, direction: value })} />
        <Field label="光质" value={draft.lighting.quality} onChange={(value) => update("lighting", { ...draft.lighting, quality: value })} />
        <Field label="光线反差" value={draft.lighting.contrast} onChange={(value) => update("lighting", { ...draft.lighting, contrast: value })} />
        <Field label="高光表现" value={draft.lighting.highlightBehavior} onChange={(value) => update("lighting", { ...draft.lighting, highlightBehavior: value })} />
        <Field label="阴影表现" value={draft.lighting.shadowBehavior} onChange={(value) => update("lighting", { ...draft.lighting, shadowBehavior: value })} />
      </Group>
      <Group {...groupProps("palette", `${draft.palette.dominantColors.join(" · ")} · ${draft.palette.temperature}`, "palette")}>
        <ListField label="主色" values={draft.palette.dominantColors} onChange={(values) => values.length && update("palette", { ...draft.palette, dominantColors: values })} />
        <ListField label="点缀色" values={draft.palette.accentColors} onChange={(values) => update("palette", { ...draft.palette, accentColors: values })} />
        <Field label="饱和度" value={draft.palette.saturation} onChange={(value) => update("palette", { ...draft.palette, saturation: value })} />
        <Field label="色温" value={draft.palette.temperature} onChange={(value) => update("palette", { ...draft.palette, temperature: value })} />
        <Field label="色彩反差" value={draft.palette.contrast} onChange={(value) => update("palette", { ...draft.palette, contrast: value })} />
      </Group>
      <Group {...groupProps("material", `${draft.material.types.join(" · ")} · ${draft.material.finish}`, "material")}>
        <ListField label="材质类型" values={draft.material.types} onChange={(values) => update("material", { ...draft.material, types: values })} />
        <Field label="表面处理" value={draft.material.finish} onChange={(value) => update("material", { ...draft.material, finish: value })} />
        <Field label="反射程度" value={draft.material.reflectivity} onChange={(value) => update("material", { ...draft.material, reflectivity: value })} />
        <Field label="透光程度" value={draft.material.translucency} onChange={(value) => update("material", { ...draft.material, translucency: value })} />
      </Group>
      <Group {...groupProps("texture", `${draft.texture.medium} · ${draft.texture.surfaceDetail}`, "texture")}>
        <Field label="媒介" value={draft.texture.medium} onChange={(value) => update("texture", { ...draft.texture, medium: value })} />
        <Field label="颗粒" value={draft.texture.grain} onChange={(value) => update("texture", { ...draft.texture, grain: value })} />
        <Field label="清晰度" value={draft.texture.sharpness} onChange={(value) => update("texture", { ...draft.texture, sharpness: value })} />
        <Field label="表面细节" value={draft.texture.surfaceDetail} onChange={(value) => update("texture", { ...draft.texture, surfaceDetail: value })} />
      </Group>
      <Group {...groupProps("mood", `${draft.mood.keywords.join(" · ")} · ${draft.mood.atmosphere}`)}>
        <ListField label="情绪关键词" values={draft.mood.keywords} onChange={(values) => update("mood", { ...draft.mood, keywords: values })} />
        <Field label="情绪基调" value={draft.mood.emotionalTone} onChange={(value) => update("mood", { ...draft.mood, emotionalTone: value })} />
        <Field label="氛围" value={draft.mood.atmosphere} onChange={(value) => update("mood", { ...draft.mood, atmosphere: value })} />
      </Group>
      <Group {...groupProps("style", `${draft.style.keywords.join(" · ")} · ${draft.style.medium}`, "style")}>
        <ListField label="风格关键词" values={draft.style.keywords} onChange={(values) => update("style", { ...draft.style, keywords: values })} />
        <Field label="风格媒介" value={draft.style.medium} onChange={(value) => update("style", { ...draft.style, medium: value })} />
      </Group>
      </div>

      {dirty && (
        <div className="dna-save-bar">
          <button className="secondary" onClick={() => setDraft(dna)}>放弃修改</button>
          <button
            className="primary"
            aria-label={`保存为版本 ${dna.revision + 1}`}
            onClick={() => void onCommit(reviseVisualDNA(dna, draft, Date.now()))}
          >
            保存为版本 {dna.revision + 1}
          </button>
        </div>
      )}
    </section>
  );
}
