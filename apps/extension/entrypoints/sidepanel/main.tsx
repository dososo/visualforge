import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { applyHoverSettingToOpenTabs } from "../../lib/site-permissions";
import "./style.css";

const CONSENT_KEY = "visualForgeDataConsentV1";

function ConsentGate({ onAccepted, notice }: { onAccepted: () => void; notice?: string }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const accept = async () => {
    setSaving(true);
    setSaveError(false);
    try {
      await chrome.storage.local.set({
        [CONSENT_KEY]: { version: 1, acceptedAt: Date.now() },
        hoverCaptureEnabled: true
      });
      await applyHoverSettingToOpenTabs(chrome, true);
      onAccepted();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="consent-page" aria-labelledby="consent-title">
      <div className="consent-mark" aria-hidden="true">V</div>
      <p className="eyebrow">VisualForge · 首次使用</p>
      <h1 id="consent-title">开始前，确认数据如何使用</h1>
      <p className="consent-lead">VisualForge 只为“把喜欢的图片变成你的作品”处理你主动选择的内容。</p>
      {notice && <p className="consent-cleanup-notice" role="status">{notice}</p>}
      <ul>
        <li><strong>网页识别</strong><span>同意后在 HTTPS 网页本地识别图片位置，用来显示 VisualForge 按钮。</span></li>
        <li><strong>捕获与保存</strong><span>点击后，所选图片、来源页面、你的要求和作品默认保存在本机。</span></li>
        <li><strong>分析与生成</strong><span>所选图片和提示词会通过本机连接交给当前登录的 Codex／OpenAI 处理。</span></li>
        <li><strong>你的控制</strong><span>可关闭网页按钮、停止保存来源，并删除单项或清空全部本地数据。</span></li>
      </ul>
      <button type="button" className="primary consent-accept" disabled={saving} onClick={() => void accept()}>
        {saving ? "正在启用…" : "同意并开始使用"}
      </button>
      {saveError && <p role="alert">未能保存设置。请确认 Chrome 仍允许使用此扩展，然后重试。</p>}
      <p className="consent-footnote">选择“同意”即允许以上用途。VisualForge 不出售数据，不读取 Codex 凭据，也不会在同意前扫描网页图片。</p>
    </main>
  );
}

function Root() {
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [AppComponent, setAppComponent] = useState<React.ComponentType | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [consentLoadError, setConsentLoadError] = useState(false);
  const [consentLoadAttempt, setConsentLoadAttempt] = useState(0);
  const [cleanupNotice, setCleanupNotice] = useState<string>();
  React.useEffect(() => {
    const handleDataCleared = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setCleanupNotice(detail?.message ?? "浏览器数据已清空");
      setAppComponent(null);
      setAccepted(false);
    };
    window.addEventListener("visualforge:data-cleared", handleDataCleared);
    return () => window.removeEventListener("visualforge:data-cleared", handleDataCleared);
  }, []);
  React.useEffect(() => {
    let cancelled = false;
    void chrome.storage.local.get(CONSENT_KEY).then((stored) => {
      if (cancelled) return;
      const consent = stored[CONSENT_KEY] as { version?: number } | undefined;
      setAccepted(consent?.version === 1);
    }).catch(() => {
      if (!cancelled) setConsentLoadError(true);
    });
    return () => { cancelled = true; };
  }, [consentLoadAttempt]);
  const retryConsentLoad = () => {
    setAccepted(null);
    setConsentLoadError(false);
    setConsentLoadAttempt((attempt) => attempt + 1);
  };
  React.useEffect(() => {
    if (!accepted || AppComponent || loadError) return;
    void import("./App").then(
      ({ App }) => setAppComponent(() => App),
      () => setLoadError(true)
    );
  }, [accepted, AppComponent, loadError]);
  if (consentLoadError) {
    return (
      <main className="recovery-page" role="alert">
        <p className="eyebrow">VisualForge</p>
        <h1>无法读取本地设置</h1>
        <p>作品没有被删除。请重试；若仍失败，请重新打开侧边栏并检查 Chrome 扩展存储是否可用。</p>
        <button type="button" className="primary" onClick={retryConsentLoad}>重新读取</button>
      </main>
    );
  }
  if (accepted === null) return <div className="app-boot" role="status">正在打开 VisualForge…</div>;
  if (!accepted) return <ConsentGate notice={cleanupNotice} onAccepted={() => {
    setCleanupNotice(undefined);
    setAccepted(true);
  }} />;
  if (loadError) {
    return (
      <main className="recovery-page" role="alert">
        <p className="eyebrow">VisualForge</p>
        <h1>扩展已更新，请重新打开侧边栏</h1>
        <p>当前页面仍在使用旧文件。重新打开后，作品和设置会继续保留。</p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>重新打开</button>
      </main>
    );
  }
  return AppComponent ? <AppComponent /> : <div className="app-boot" role="status">正在打开 VisualForge…</div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Root /></React.StrictMode>);
