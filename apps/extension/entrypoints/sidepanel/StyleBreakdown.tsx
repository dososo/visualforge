import { Check, Copy, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SignatureStyleCategory, SignatureStyleSelection, SubjectAssetType, VisualDNA } from "@styleforge/contracts";
import {
  applySignatureStyleToPrompt,
  createSignatureStyleSelection,
  listSignatureStyles,
  recommendSignatureStyles
} from "@styleforge/core";

const stylePreviewModules = import.meta.glob(
  "../../assets/signature-style-previews/styles/*.png",
  { eager: true, query: "?url", import: "default" }
) as Record<string, string>;

const stylePreviewById = Object.fromEntries(
  Object.entries(stylePreviewModules).map(([path, url]) => [
    path.split("/").pop()!.replace(/\.png$/, ""),
    url
  ])
) as Record<string, string>;

export function StyleBreakdown({
  dna,
  prompt,
  expanded,
  confirmed,
  subjectType,
  initialSelection,
  onConfirm
}: {
  dna: VisualDNA;
  prompt: string;
  expanded: boolean;
  confirmed: boolean;
  subjectType?: SubjectAssetType;
  initialSelection?: SignatureStyleSelection | null;
  onConfirm: (prompt: string, selection: SignatureStyleSelection | null) => void;
}) {
  const [draftPrompt, setDraftPrompt] = useState(prompt);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const allStyles = useMemo(() => listSignatureStyles(), []);
  const currentDomain = subjectType === "person" ? "portrait"
    : subjectType === "product" ? "product"
      : subjectType === "pet" ? "photography"
        : dna.domain === "other" ? "photography" : dna.domain;
  const applicableStyles = useMemo(
    () => allStyles.filter((style) => style.suitableDomains.includes(currentDomain)),
    [allStyles, currentDomain]
  );
  const recommendations = useMemo(
    () => recommendSignatureStyles({ ...dna, domain: currentDomain }),
    [currentDomain, dna]
  );
  const libraryStyles = applicableStyles;
  const categories = useMemo(
    () => [...new Set(libraryStyles.map((style) => style.category))] as SignatureStyleCategory[],
    [libraryStyles]
  );
  const [styleMode, setStyleMode] = useState<"original" | "blend">(
    initialSelection ? "blend" : "original"
  );
  const [selectedStyleId, setSelectedStyleId] = useState(
    initialSelection?.styleId ?? recommendations[0]?.style.id ?? ""
  );
  const [activeCategory, setActiveCategory] = useState<SignatureStyleCategory>(
    initialSelection?.styleSnapshot.category ?? recommendations[0]?.style.category ?? categories[0]!
  );
  const [browseAll, setBrowseAll] = useState(Boolean(initialSelection));
  const selectedStyle = allStyles.find((style) => style.id === selectedStyleId)
    ?? recommendations[0]?.style;
  const visibleStyles = libraryStyles.filter((style) => style.category === activeCategory);
  useEffect(() => {
    setStyleMode(initialSelection ? "blend" : "original");
    setSelectedStyleId(initialSelection?.styleId ?? recommendations[0]?.style.id ?? "");
    setActiveCategory(initialSelection?.styleSnapshot.category ?? recommendations[0]?.style.category ?? allStyles[0]!.category);
    setBrowseAll(Boolean(initialSelection));
    setDraftPrompt(prompt);
    setCopied(false);
    setCopyError(false);
  }, [prompt, recommendations, initialSelection, allStyles]);
  useEffect(() => {
    if (!categories.includes(activeCategory)) setActiveCategory(categories[0]!);
  }, [activeCategory, categories]);
  const selectStyle = (styleId: string) => {
    setSelectedStyleId(styleId);
    const style = allStyles.find((item) => item.id === styleId);
    if (style) {
      setStyleMode("blend");
      setDraftPrompt(applySignatureStyleToPrompt(prompt, style, "blend", currentDomain));
    }
  };
  const confirmPrompt = () => {
    const recommendation = recommendations.find((item) => item.style.id === selectedStyle?.id);
    const selection = styleMode !== "original" && selectedStyle
      ? createSignatureStyleSelection(
          selectedStyle,
          styleMode,
          recommendation?.reason ?? `用户从完整风格库主动选择「${selectedStyle.name}」`
        )
      : null;
    onConfirm(draftPrompt.trim(), selection);
  };
  const visibleFacts = useMemo(() => [
    `主体：${dna.subject.description}`,
    dna.subject.action ? `动作：${dna.subject.action}` : "",
    dna.subject.environment ? `场景：${dna.subject.environment}` : "",
    `构图：${dna.composition.shotType}，${dna.composition.subjectPlacement}，${dna.composition.negativeSpace}`,
    `光线：${dna.lighting.direction}，${dna.lighting.quality}，${dna.lighting.contrast}`,
    `色彩：${dna.palette.dominantColors.join("、")}，${dna.palette.temperature}，${dna.palette.saturation}`,
    dna.material.types.length ? `材质：${dna.material.types.join("、")}，${dna.material.finish}` : ""
  ].filter(Boolean), [dna]);
  const visualInferences = useMemo(() => [
    `近似镜头感：${dna.camera.lens}；${dna.camera.focalLength}`,
    `透视与景深推测：${dna.camera.perspective}；${dna.camera.depthOfField}`,
    `情绪推测：${dna.mood.emotionalTone}；${dna.mood.atmosphere}`
  ], [dna]);
  const copy = async () => {
    setCopied(false);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(draftPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError(true);
    }
  };
  return (
    <section className="style-breakdown" aria-label="这张图的创作方法">
      <div className="section-heading"><span>这张图的创作方法</span><small>已分析</small></div>
      <h3>为什么这张图有吸引力</h3>
      <p className="style-summary">{dna.summary}</p>
      <details key={confirmed ? "confirmed" : "draft"} open={expanded && !confirmed} className="reverse-prompt-editor">
        <summary>{confirmed ? "创作提示词已确认 · 查看或修改" : "可复用的创作提示词"}</summary>
        <p className="analysis-boundary">这是根据当前图片整理出的创作方法。你可以直接使用，也可以修改后继续。</p>
        <textarea
          aria-label="可编辑的创作提示词"
          value={draftPrompt}
          onChange={(event) => setDraftPrompt(event.target.value)}
        />
        <div className="breakdown-actions">
          <button type="button" aria-live="polite" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copyError ? "复制失败，请重试" : copied ? "已复制" : "复制完整提示词"}</button>
          <button type="button" disabled={!draftPrompt.trim()} onClick={confirmPrompt}>
            <Sparkles size={14} />{confirmed ? "保存修改" : "确认这个创作方向"}
          </button>
        </div>
      </details>
      <details className="style-more-adjustments">
        <summary>更多调整</summary>
      <details>
        <summary>查看保留、替换与分析细节</summary>
        <dl>
          <div><dt>保留什么</dt><dd>{[...dna.invariants, ...dna.constraints.preserve].join("；") || "主要视觉语言"}</dd></div>
          <div><dt>换成什么</dt><dd>{dna.variables.join("；") || "主体内容与场景细节"}</dd></div>
          <div><dt>避免什么</dt><dd>{dna.constraints.avoid.join("；") || "无关物件与错误文字"}</dd></div>
        </dl>
        <details>
          <summary>查看专业分析</summary>
          <h3>图片中明确可见</h3>
          <ul>{visibleFacts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
          <h3>视觉推测</h3>
          <p className="analysis-boundary">以下镜头、透视和情绪判断只能作为近似创作方向，不代表原图真实器材或拍摄参数。</p>
          <ul>{visualInferences.map((inference) => <li key={inference}>{inference}</li>)}</ul>
        </details>
      </details>
      <details className="signature-recommendations" aria-label="VisualForge 风格推荐">
        <summary>换个方向</summary>
        <div className="direction-default">
          <strong>创作方向：保持参考图的感觉</strong>
          <p>保留参考图的构图、光线和氛围。</p>
          <button type="button" aria-pressed={styleMode === "original"} onClick={() => {
            setStyleMode("original");
            setDraftPrompt(prompt);
          }}>保持参考图</button>
        </div>
        <p className="analysis-boundary">参考图决定基础感觉；VisualForge 方向只在你主动选择时调整构图、光线和叙事，不会替换你的人物或商品。</p>
        <div className="section-heading"><span>适合当前{subjectType === "person" ? "人物" : subjectType === "product" ? "商品" : subjectType === "pet" ? "宠物" : "主体"}的方向</span><small>先显示最适合的方向</small></div>
        <div className="signature-style-options">
          {recommendations.filter((item) => item.style.suitableDomains.includes(currentDomain)).slice(0, 6).map((item, index) => (
            <label key={item.style.id} className={styleMode !== "original" && item.style.id === selectedStyle?.id ? "is-selected" : ""}>
              <input
                type="radio"
                name="signature-style"
                checked={styleMode !== "original" && item.style.id === selectedStyle?.id}
                onChange={() => selectStyle(item.style.id)}
              />
              <span>
                <strong>{item.style.name}</strong>
                <small>{item.evidence === "direct" ? (index === 0 ? "有直接依据 · 主要方向" : "有直接依据 · 备选方向") : "探索方向"}</small>
                <p>{item.reason}</p>
                <details>
                  <summary>为什么推荐</summary>
                  <b>原图已有：</b>{item.existingFeatures.join("；")}
                  <br /><b>可以强化：</b>{item.strengthen.join("；")}
                  <br /><b>不适合强加：</b>{item.avoidAdding.join("；")}
                </details>
              </span>
            </label>
          ))}
        </div>
        {styleMode !== "original" && selectedStyle && (
          <p className="signature-selection-status" role="status">
            已加入「{selectedStyle.name}」，原图的主体关系与关键视觉方法仍会保留。
          </p>
        )}
        <button type="button" className="style-library-toggle" onClick={() => setBrowseAll((value) => !value)}>
          {browseAll ? "收起更多方向" : subjectType === "person" ? "更多人物风格" : subjectType === "product" ? "更多商品风格" : subjectType === "pet" ? "更多宠物风格" : "更多适合的风格"}
        </button>
        {browseAll && <section className="signature-style-library" aria-label="完整风格库">
          <div className="signature-library-scope"><span>只显示适合最终主体的方向。</span></div>
          <div className="signature-category-tabs" role="group" aria-label="按风格类别筛选">
            {categories.map((category) => (
              <button
                type="button"
                aria-pressed={activeCategory === category}
                className={activeCategory === category ? "is-active" : ""}
                key={category}
                onClick={() => setActiveCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
          <div className="signature-style-grid">
            {visibleStyles.map((style) => (
              <button
                type="button"
                key={style.id}
                className={styleMode !== "original" && selectedStyle?.id === style.id ? "is-selected" : ""}
                onClick={() => selectStyle(style.id)}
                aria-pressed={styleMode !== "original" && selectedStyle?.id === style.id}
              >
                <i
                  className="signature-style-preview"
                  aria-hidden="true"
                  style={{
                    backgroundImage: `url(${stylePreviewById[style.id]})`
                  }}
                />
                <span><b>{style.name}</b><small>{style.signature.code}</small></span>
                <strong>{style.signature.memoryAnchor}</strong>
                <p>{style.summary}</p>
              </button>
            ))}
          </div>
          {selectedStyle && <details className="signature-recipe">
            <summary>查看「{selectedStyle.name}」的 VisualForge 原创组合方法</summary>
            <dl>
              <div><dt>最适合</dt><dd>{selectedStyle.application.bestFor.join("、")}</dd></div>
              <div><dt>主要变化</dt><dd>{selectedStyle.application.recreate.join("；")}</dd></div>
              <div><dt>必须保留</dt><dd>{selectedStyle.application.preserve.join("；")}</dd></div>
              <div><dt>不适合</dt><dd>{selectedStyle.unsuitableFor.join("；")}</dd></div>
              <div><dt>主导规则</dt><dd>{selectedStyle.recipe.dominantRule}</dd></div>
              <div><dt>反向约束</dt><dd>{selectedStyle.recipe.counterRule}</dd></div>
              <div><dt>视觉张力</dt><dd>{selectedStyle.recipe.visualTension}</dd></div>
              <div><dt>四图叙事</dt><dd>{selectedStyle.fourShotSet.map((shot) => `${shot.order}. ${shot.role}：${shot.direction}`).join("；")}</dd></div>
            </dl>
          </details>}
        </section>}
      </details>
      </details>
    </section>
  );
}
