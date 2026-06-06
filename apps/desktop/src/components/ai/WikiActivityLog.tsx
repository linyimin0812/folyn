import { useEffect, useRef } from 'react';
import { useWikiStore } from '@/store/wikiStore';

const TYPE_INDICATOR: Record<string, string> = {
  info: '●',
  success: '✓',
  error: '✗',
  step: '▸',
};

export function WikiActivityLog() {
  const activityLog = useWikiStore((s) => s.activityLog);
  const isIngesting = useWikiStore((s) => s.isIngesting);
  const isLinting = useWikiStore((s) => s.isLinting);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activityLog]);

  if (activityLog.length === 0 && !isIngesting && !isLinting) return null;

  const isActive = isIngesting || isLinting;

  return (
    <div className="wiki-activity">
      <div className="wiki-activity-header">
        {isActive && <span className="wiki-activity-pulse" />}
        <span>{isActive ? '处理中...' : '操作日志'}</span>
        {!isActive && activityLog.length > 0 && (
          <button
            className="wiki-activity-clear"
            onClick={() => useWikiStore.getState().clearActivityLog()}
          >
            清除
          </button>
        )}
      </div>
      <div className="wiki-activity-list">
        {activityLog.map((entry) => (
          <div key={entry.id} className={`wiki-activity-item ${entry.type}`}>
            <span className="wiki-activity-icon">{TYPE_INDICATOR[entry.type]}</span>
            <span className="wiki-activity-msg">{entry.message}</span>
            <span className="wiki-activity-time">
              {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        ))}
        {isActive && (
          <div className="wiki-activity-item step">
            <span className="wiki-activity-spinner" />
            <span className="wiki-activity-msg">{isIngesting ? '正在处理...' : '正在检查...'}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
