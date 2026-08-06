import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import type { UserPreferenceSummary } from "@styleforge/contracts";

export function PreferenceSuggestion({ summaries, onApply, onIgnore }: {
  summaries: UserPreferenceSummary[];
  onApply: () => void | Promise<void>;
  onIgnore: () => void | Promise<void>;
}) {
  const firstAction = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstAction.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    firstAction.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="preference-suggestion" aria-label="生成前偏好建议">
      <div className="section-heading">
        <span><Sparkles size={15} />最近偏好</span>
        <small>仅在确认后用于本次生成</small>
      </div>
      <p>根据你在本机保存的真实修改记录，发现以下重复选择：</p>
      <ul>
        {summaries.map((summary) => (
          <li key={`${summary.dimension}:${summary.field}`}>
            <strong>{summary.explanation}</strong>
            <small>{summary.sampleCount} 个样本 · 置信度 {Math.round(summary.confidence * 100)}%</small>
          </li>
        ))}
      </ul>
      <div className="preference-actions">
        <button ref={firstAction} className="primary" aria-label="应用偏好建议" onClick={() => void onApply()}>应用</button>
        <button className="secondary" aria-label="忽略偏好建议" onClick={() => void onIgnore()}>忽略</button>
      </div>
    </section>
  );
}
