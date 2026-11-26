// RecentWindowsPanel — 最近窗口列表（spec 6.4）。
//
// 只做「恢复入口」：列出关闭的研究窗口会话（名称 / 最近文档 / 标签数 /
// 相对时间），点击恢复（Rust 侧 create_research_window 已存在同 label
// 窗口则 focus），支持搜索、单条清除、全部清除。明确不做：项目管理、
// Vault 文件删除——清除只删会话记录，页脚有明示注记。
//
// 列表数据来自 windowSessionService.listClosedSessions()（getFresh 读，
// 跨窗口新鲜）。本窗口 open 着的会话不出现在列表里（会话互斥：open 的
// 会话由它的窗口持有，恢复入口只针对关闭的）。
//
// 样式复用 TabBar tab-list 面板的设计语言（bg-panel / border-brd /
// hover:bg-hov / text-t* + token 级 Tailwind）。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Clock } from 'lucide-react';
import { FileIcon } from '@/components/icons/FileIcon';
import { useRecentWindowsStore } from '@/store/recentWindowsStore';
import {
  listClosedSessions,
  restoreSession,
  clearSessionRecord,
  clearAllClosedSessions,
  type WindowSessionRecord,
} from '@/services/windowSessionService';

/** 「N 分钟前 / N 小时前 / N 天前」三档相对时间，够用且免拉日期库。 */
function relativeTime(ts: number, t: (k: string, opts: { count: number }) => string): string {
  const minutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (minutes < 1) return t('recent.minutesAgo', { count: 0 });
  if (minutes < 60) return t('recent.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('recent.hoursAgo', { count: hours });
  return t('recent.daysAgo', { count: Math.floor(hours / 24) });
}

interface PanelRow {
  record: WindowSessionRecord;
  tabCount: number;
  lastDocName: string | null;
  lastActiveLabel: string;
}

export function RecentWindowsPanel() {
  const { t } = useTranslation('shell');
  const isOpen = useRecentWindowsStore((s) => s.isOpen);
  const close = useRecentWindowsStore((s) => s.close);

  const [records, setRecords] = useState<WindowSessionRecord[]>([]);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const buildRow = useCallback(
    (record: WindowSessionRecord): PanelRow => ({
      record,
      tabCount: record.tabCount ?? 0,
      lastDocName: record.lastDocName ?? null,
      lastActiveLabel: record.lastActiveAt
        ? relativeTime(record.lastActiveAt, t)
        : '',
    }),
    [t],
  );

  // 打开时拉取关闭的会话列表（getFresh → 跨窗口新鲜值），并把查询词
  // 复位 + 聚焦搜索框。研究窗口打开后，会话变 open —— 本窗口的列表
  // 会自然排除它（listClosedSessions 过滤 open 记录），面板打开期间
  // 无需订阅实时刷新：恢复动作本身会关闭本面板。
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const list = await listClosedSessions();
      if (!cancelled) setRecords(list);
    })();
    setQuery('');
    requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => { cancelled = true; };
  }, [isOpen]);

  const rows = useMemo(() => records.map(buildRow), [records, buildRow]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const name = row.record.name.toLowerCase();
      const doc = row.lastDocName?.toLowerCase() ?? '';
      return name.includes(q) || doc.includes(q);
    });
  }, [rows, query]);

  if (!isOpen) return null;

  const handleRestore = async (record: WindowSessionRecord) => {
    close();
    await restoreSession(record.id);
  };

  const handleClearOne = async (id: string) => {
    await clearSessionRecord(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleClearAll = async () => {
    await clearAllClosedSessions();
    setRecords([]);
  };

  return (
    <div
      data-testid="recent-windows-overlay"
      className="fixed inset-0 z-[900] bg-black/45 backdrop-blur-[4px] flex items-center justify-center animate-[fadeIn_.15s]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        data-testid="recent-windows-panel"
        role="dialog"
        aria-label={t('recent.title')}
        className="w-[460px] max-w-[92vw] max-h-[70vh] flex flex-col overflow-hidden bg-panel border border-brd rounded-[14px] shadow-[0_20px_60px_rgba(0,0,0,.3)] animate-[slideUp_.2s]"
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-2 shrink-0">
          <Clock size={14} className="text-t3" />
          <h3 className="text-[15px] font-semibold text-t1 m-0">{t('recent.title')}</h3>
          <button
            type="button"
            className="ml-auto bg-transparent border-none text-t3 text-[16px] cursor-pointer px-[6px] py-1 rounded-[6px] hover:bg-hov hover:text-t1"
            onClick={close}
            aria-label={t('recent.closePanel')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 pb-2 shrink-0">
          <input
            ref={searchInputRef}
            data-testid="recent-windows-search"
            className="w-full h-[34px] px-3 rounded-[8px] border border-brd bg-inp text-t1 text-[13px] outline-none focus:border-acc placeholder:text-t4"
            placeholder={t('recent.searchPlaceholder')}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                close();
              }
            }}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 ? (
            <div data-testid="recent-windows-empty" className="px-3 py-8 text-center text-[12px] text-t3">
              {records.length === 0 ? t('recent.empty') : t('recent.noMatches')}
            </div>
          ) : (
            filtered.map((row) => (
              <div
                key={row.record.id}
                data-recent-id={row.record.id}
                role="button"
                tabIndex={0}
                className="group flex items-center gap-2.5 px-3 py-[9px] rounded-[8px] cursor-pointer text-[13px] transition-[background] duration-100 hover:bg-hov focus:bg-hov focus:outline-none"
                onClick={() => { void handleRestore(row.record); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { void handleRestore(row.record); }
                }}
              >
                {row.lastDocName && (
                  <span className="shrink-0 flex items-center">
                    <FileIcon filename={row.lastDocName} />
                  </span>
                )}
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="truncate text-t1 font-medium">{row.record.name}</span>
                  <span className="truncate text-t3 text-[11px]">
                    {row.lastDocName
                      ? `${row.lastDocName} · ${t('recent.tabCount', { count: row.tabCount })}`
                      : t('recent.noDocs')}
                  </span>
                </span>
                <span className="shrink-0 text-t4 text-[11px] whitespace-nowrap">
                  {row.lastActiveLabel}
                </span>
                <span
                  role="button"
                  aria-label={t('recent.clearOne')}
                  className="shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-[5px] text-t4 opacity-0 group-hover:opacity-100 hover:!opacity-100 hover:bg-hov hover:text-red transition-[opacity,background,color] duration-100 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleClearOne(row.record.id);
                  }}
                >
                  <X size={12} />
                </span>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-4 border-t border-brd shrink-0">
          <span className="text-[11px] text-t4 leading-snug">{t('recent.footerNote')}</span>
          {records.length > 0 && (
            <button
              type="button"
              data-testid="recent-clear-all"
              className="shrink-0 px-3 py-[5px] rounded-[8px] border border-brd bg-surf text-t2 text-[12px] cursor-pointer transition-[background,color] duration-100 hover:bg-hov hover:text-t1"
              onClick={() => { void handleClearAll(); }}
            >
              {t('recent.clearAll')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
