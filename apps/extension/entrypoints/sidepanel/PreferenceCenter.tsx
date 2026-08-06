import { useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import type { PreferenceEvent, UserPreferenceSummary } from "@styleforge/contracts";
import { buildPreferenceCenterItems, displayPreferenceValue } from "@styleforge/core";

const sourceLabels: Record<PreferenceEvent["source"], string> = {
  editor: "参考图方法编辑",
  lock: "锁定状态变化",
  restore: "版本恢复"
};

export function PreferenceCenter({ summaries, events, onDelete, onReset }: {
  summaries: UserPreferenceSummary[];
  events: PreferenceEvent[];
  onDelete: (summary: UserPreferenceSummary) => void | Promise<void>;
  onReset: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string>();
  const items = buildPreferenceCenterItems(summaries, events);
  return (
    <section className="settings-section preference-center" aria-label="本地视觉偏好">
      <div className="preference-center-heading">
        <div><h2>本地视觉偏好</h2><p>由本机真实编辑行为汇总，不会自动修改作品。</p></div>
        {items.length > 0 && (
          <button className="text-button danger-text" aria-label="清除全部偏好总结" onClick={() => void onReset()}>
            清除全部
          </button>
        )}
      </div>
      {!items.length ? (
        <div className="preference-center-empty">
          <strong>暂无稳定偏好</strong>
          <p>原始行为证据仍保存在本机；新的修改可以重新形成摘要。</p>
        </div>
      ) : (
        <div className="preference-center-list">
          {items.map(({ summary, evidence, sourceCounts }) => {
            const key = `${summary.dimension}:${summary.field}`;
            const isExpanded = expanded === key;
            const sources = (Object.entries(sourceCounts) as Array<[PreferenceEvent["source"], number]>)
              .map(([source, count]) => `${count} 次${sourceLabels[source]}`)
              .join(" · ");
            return (
              <article className="preference-center-card" key={key}>
                <div className="preference-center-title">
                  <strong>{summary.explanation}</strong>
                  <button
                    className="icon-button"
                    aria-label={`删除${summary.label}摘要`}
                    title="删除摘要"
                    onClick={() => void onDelete(summary)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="preference-center-stats">
                  <span>置信度 {Math.round(summary.confidence * 100)}%</span>
                  <span>{summary.sampleCount} 次真实行为</span>
                  <span>更新于 {new Date(summary.lastUpdated).toLocaleString("zh-CN")}</span>
                </div>
                <p className="preference-center-source">来源：{sources}</p>
                <button
                  className="preference-evidence-toggle"
                  aria-label={`查看${summary.label}证据`}
                  aria-expanded={isExpanded}
                  onClick={() => setExpanded(isExpanded ? undefined : key)}
                >
                  查看 {evidence.length} 条证据 <ChevronDown size={14} />
                </button>
                {isExpanded && (
                  <ol className="preference-evidence">
                    {evidence.map((event) => (
                      <li key={event.id}>
                        <div><span>之前</span><strong>{displayPreferenceValue(event.before)}</strong></div>
                        <div><span>之后</span><strong>{displayPreferenceValue(event.after)}</strong></div>
                        <small>{new Date(event.createdAt).toLocaleString("zh-CN")} · {sourceLabels[event.source]}</small>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
