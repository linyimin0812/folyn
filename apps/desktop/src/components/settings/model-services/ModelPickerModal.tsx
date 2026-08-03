import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, SquarePen } from 'lucide-react';
import type { Capability, Model } from '@/services/modelRegistry/types';
import {
  familyGroup,
  ModelAvatar,
  CapabilityPills,
  modelOptionTitle,
} from './helpers';

// ── Model picker modal (HTML-styled) ────────────────────────────
const CATEGORY_TABS: { id: 'all' | Capability; labelKey: string }[] = [
  { id: 'all', labelKey: 'settings:models.filterAll' },
  { id: 'reasoning', labelKey: 'settings:models.capability.reasoning' },
  { id: 'vision', labelKey: 'settings:models.capability.vision' },
  { id: 'web-search', labelKey: 'settings:models.capability.web-search' },
  { id: 'function-call', labelKey: 'settings:models.capability.function-call' },
];

type PickerCategory = 'all' | Capability;

export function ModelPickerModal({
  providerName,
  models,
  selectedId,
  selectedIds,
  fetchStatus,
  fetchError,
  onClose,
  onSelect,
  onRefresh,
  onEditCapabilities,
}: {
  providerName: string;
  models: readonly Model[];
  selectedId: string;
  selectedIds: readonly string[];
  fetchStatus: string;
  fetchError: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onEditCapabilities: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PickerCategory>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // ponytail: native keydown — no new dep, ESC closes.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // ponytail: auto-fetch on open when list is empty — matches HTML design
  // where the in-modal refresh button is the fetch trigger. Run once per
  // mount; deps intentionally empty.
  // Always refetch on open — user expects clicking "获取模型" to trigger a
  // fresh request, not just reuse cached results. Mount-only; deps empty.
  useEffect(() => {
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = models.filter((m) => {
      const haystack = (m.displayName ?? m.id).toLowerCase();
      if (q && !haystack.includes(q) && !m.id.toLowerCase().includes(q)) return false;
      if (category !== 'all' && !m.capabilities.includes(category)) return false;
      return true;
    });
    const map = new Map<string, Model[]>();
    for (const m of filtered) {
      const g = m.group ?? familyGroup(m.id);
      const arr = map.get(g) ?? [];
      arr.push(m);
      map.set(g, arr);
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
  }, [models, search, category]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-panel rounded-2xl w-full max-w-[780px] h-[90vh] flex flex-col overflow-hidden relative"
        style={{ boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.05)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — pinned */}
        <div className="flex justify-between items-center px-6 pt-6 pb-4 shrink-0">
          <h2 className="text-xl font-bold text-t1">{providerName}</h2>
          <button
            type="button"
            aria-label={t('settings:models.picker.close')}
            title={t('settings:models.picker.close')}
            onClick={onClose}
            className="text-t3 p-1 rounded-md hover:bg-hov hover:text-t1 transition"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search row — pinned, antd Compact style (input + primary button) */}
        <div className="flex px-6 pb-3 shrink-0">
          <div className="relative flex-1">
            <svg
              className="absolute left-[10px] top-1/2 -translate-y-1/2 text-t3"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={t('settings:models.picker.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-[32px] pl-[30px] pr-[12px] border border-brd border-r-0 rounded-l-md text-[13px] text-t1 bg-inp outline-none focus:border-[var(--acc)]"
              style={{ fontFamily: 'inherit' }}
              autoFocus
            />
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={fetchStatus === 'loading'}
            className="shrink-0 h-[32px] px-3 rounded-r-md border border-brd text-white text-[13px] font-medium flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90"
            style={{ background: 'var(--acc, #3a6ef0)' }}
          >
            {fetchStatus === 'loading' ? (
              <>
                <Loader2 size={13} className="animate-spin" />
                {t('settings:models.picker.refreshing')}
              </>
            ) : (
              t('settings:models.picker.refresh')
            )}
          </button>
        </div>

        {/* Category tabs — pinned */}
        <div className="flex gap-6 border-b border-brd px-6 pb-2 shrink-0 overflow-x-auto">
          {CATEGORY_TABS.map((tab) => {
            const active = category === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => setCategory(tab.id)}
                className={`text-sm cursor-pointer pb-2.5 font-medium relative whitespace-nowrap select-none ${
                  active ? 'font-semibold text-[var(--green)]' : 'text-t2'
                }`}
              >
                {t(tab.labelKey)}
                {active && (
                  <span
                    className="absolute -bottom-px left-0 right-0 rounded-sm"
                    style={{ height: 2, background: 'var(--green, #22a863)' }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Groups — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {fetchStatus === 'error' && fetchError && (
            <div className="text-[12.5px] break-all mb-3" style={{ color: 'var(--red, #f06a6a)' }}>
              {fetchError}
            </div>
          )}
          <div className="flex flex-col gap-3">
            {groups.length === 0 ? (
              <div className="text-sm text-t3 italic py-4 text-center">
                {fetchStatus === 'loading'
                  ? t('settings:models.fetchModels.fetching')
                  : t('settings:models.fetchModels.empty')}
              </div>
            ) : (
              groups.map((g) => {
                const isCollapsed = collapsed.has(g.name);
                return (
                  <div key={g.name} className="bg-surf2 rounded-xl overflow-hidden">
                    {/* Group header — click to toggle collapse */}
                    <div
                      className="px-4 py-2.5 flex items-center justify-between select-none cursor-pointer hover:bg-hov transition-colors"
                      onClick={() => setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.name)) next.delete(g.name);
                        else next.add(g.name);
                        return next;
                      })}
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className={`text-t3 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                        <span className="text-[13px] font-bold text-t1">{g.name}</span>
                        <span
                          className="text-[11px] font-semibold px-[6px] py-px rounded-full leading-tight"
                          style={{ background: 'var(--gdim, #dcf5e8)', color: 'var(--green, #22a863)' }}
                        >
                          {g.items.length}
                        </span>
                      </div>
                    </div>
                    {/* Group body — hidden when collapsed */}
                    {!isCollapsed && (
                      <div className="bg-panel px-4">
                        {g.items.map((m, idx) => {
                          const isSelected = selectedIds.includes(m.id);
                          const isActive = m.id === selectedId;
                          return (
                            <div
                              key={m.id}
                              title={modelOptionTitle(m)}
                              className={`flex items-center justify-between py-3.5 ${
                                idx < g.items.length - 1 ? 'border-b border-brd' : ''
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <ModelAvatar id={m.id} />
                                <span
                                  className={`text-[length:calc(var(--ui-font-size)-2px)] font-ui truncate ${
                                    isActive
                                      ? 'font-bold text-[var(--green)]'
                                      : isSelected
                                        ? 'font-semibold text-[var(--green)]'
                                        : 'font-semibold text-t1'
                                  }`}
                                >
                                  {m.displayName ?? m.id}
                                </span>
                              </div>
                              <div className="flex items-center gap-[18px] shrink-0">
                                <CapabilityPills capabilities={m.capabilities} />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onEditCapabilities(m.id);
                                  }}
                                  title={t('settings:models.editCapabilities.tooltip')}
                                  className="text-t3 hover:text-t1 transition-colors"
                                >
                                  <SquarePen size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onSelect(m.id)}
                                  title={isSelected ? t('settings:models.picker.remove') : t('settings:models.picker.select')}
                                  className={
                                    isSelected
                                      ? 'text-[var(--green)] hover:opacity-80'
                                      : 'text-t1 hover:text-[var(--green)]'
                                  }
                                >
                                  {isSelected ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                  ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="12" y1="5" x2="12" y2="19" />
                                      <line x1="5" y1="12" x2="19" y2="12" />
                                    </svg>
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Loading overlay — centered spinner while fetching */}
        {fetchStatus === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/60 z-10 pointer-events-none">
            <Loader2 size={32} className="animate-spin text-t3" />
          </div>
        )}
      </div>
    </div>
  );
}
