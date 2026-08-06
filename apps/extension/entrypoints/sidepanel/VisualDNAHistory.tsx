import { ChevronDown, RotateCcw } from "lucide-react";
import type { VisualDNARevision } from "@styleforge/contracts";

function revisionSummary(record: VisualDNARevision) {
  if (record.origin === "analysis") return record.revision === 1 ? "原始分析" : "重新分析";
  if (record.origin === "restore") return `恢复 v${record.restoredFromRevision}`;
  if (record.origin === "backfill") return "已有版本";
  const dimensions = [...new Set(record.changes.map((change) => change.label))];
  return dimensions.length ? `修改${dimensions.join("、")}` : "已保存修改";
}

export function VisualDNAHistory({ records, currentRevision, onRestore }: {
  records: VisualDNARevision[];
  currentRevision: number;
  onRestore: (record: VisualDNARevision) => void | Promise<void>;
}) {
  if (!records.length) return null;
  return (
    <section className="dna-history" aria-label="参考图方法修改历史">
      <details>
        <summary>
          <span><strong>参考图方法修改历史</strong><small>{records.length} 个版本</small></span>
          <ChevronDown size={15} />
        </summary>
        <ol>
          {records.map((record) => {
            const current = record.revision === currentRevision;
            return (
              <li className="dna-history-item" key={record.id}>
                <div className="dna-history-title">
                  <strong>v{record.revision}</strong>
                  {current && <span>当前</span>}
                  <time dateTime={new Date(record.createdAt).toISOString()}>
                    {new Date(record.createdAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </time>
                </div>
                <p>{revisionSummary(record)}</p>
                {record.changes.length > 0 && (
                  <ul>
                    {record.changes.map((change) => (
                      <li key={change.dimension}>
                        <span>{change.label}</span>
                        <small>{change.before} → {change.after}</small>
                      </li>
                    ))}
                  </ul>
                )}
                {!current && (
                  <button
                    className="dna-restore"
                    aria-label={`恢复版本 ${record.revision}`}
                    onClick={() => void onRestore(record)}
                  >
                    <RotateCcw size={13} />恢复为新版本
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
