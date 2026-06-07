import { useEffect, useRef } from 'react';
import { useWikiStore } from '@/store/wikiStore';

const TYPE_INDICATOR: Record<string, string> = {
  info: '●',
  success: '✓',
  error: '✗',
  step: '▸',
};

const ICON_COLOR: Record<string, string> = {
  info: 'text-t3',
  success: 'text-[#22c55e]',
  error: 'text-[#ef4444]',
  step: 'text-acc',
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
    <div className="border-t border-brd shrink-0 max-h-[200px] flex flex-col">
      <div className="flex items-center gap-1.5 py-1.5 px-3 text-[11px] font-semibold text-t2 border-b border-brd">
        {isActive && <span className="wiki-activity-pulse" />}
        <span>{isActive ? '处理中...' : '操作日志'}</span>
        {!isActive && activityLog.length > 0 && (
          <button
            className="ml-auto bg-transparent border-none text-t3 text-[11px] cursor-pointer p-0 hover:text-t1"
            onClick={() => useWikiStore.getState().clearActivityLog()}
          >
            清除
          </button>
        )}
      </div>
      <div className="overflow-y-auto py-1 flex-1">
        {activityLog.map((entry) => (
          <div key={entry.id} className="flex items-start gap-1.5 py-0.5 px-3 text-[11px] leading-normal">
            <span className={`shrink-0 w-3 text-center text-[10px] mt-px ${ICON_COLOR[entry.type] || 'text-t3'}`}>{TYPE_INDICATOR[entry.type]}</span>
            <span className={`flex-1 min-w-0 truncate ${entry.type === 'error' ? 'text-[#ef4444]' : 'text-t2'}`}>{entry.message}</span>
            <span className="shrink-0 text-t4 text-[10px]">
              {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        ))}
        {isActive && (
          <div className="flex items-start gap-1.5 py-0.5 px-3 text-[11px] leading-normal">
            <span className="wiki-activity-spinner" />
            <span className="flex-1 min-w-0 truncate text-t2">{isIngesting ? '正在处理...' : '正在检查...'}</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
