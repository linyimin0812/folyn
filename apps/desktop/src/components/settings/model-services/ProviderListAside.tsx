/**
 * Left aside of ModelServicesSettings — search + scrollable
 * provider list + add-custom button. Pure code motion out of the main
 * file; no behavior change.
 */

import { useTranslation } from 'react-i18next';
import { SquarePen, Trash2 } from 'lucide-react';
import {
  isCustomProvider,
  providerDisplayName,
  type ProviderEntry,
} from '@/services/providers/catalog';
import { Avatar } from './helpers';

interface ProviderListAsideProps {
  search: string;
  onSearch: (q: string) => void;
  filtered: readonly ProviderEntry[];
  chatProvider: string;
  providerSettings: Record<string, { enabled?: boolean }>;
  onSelectProvider: (id: string) => void;
  onEditCustom: (id: string) => void;
  onDeleteCustom: (id: string) => void;
  onAddCustom: () => void;
}

export function ProviderListAside({
  search,
  onSearch,
  filtered,
  chatProvider,
  providerSettings,
  onSelectProvider,
  onEditCustom,
  onDeleteCustom,
  onAddCustom,
}: ProviderListAsideProps) {
  const { t } = useTranslation();

  return (
    <aside className="w-[300px] shrink-0 flex flex-col border border-brd rounded-md bg-panel overflow-hidden">
      <div className="p-2 border-b border-brd">
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder={t('settings:models.searchPlaceholder')}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="fi2 w-full h-[30px] py-1 pl-2.5 pr-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1.5 px-1.5 min-h-0 relative">
        {filtered.length === 0 ? (
          <div className="text-[10.5px] text-t3 italic px-2 py-3 text-center">{t('settings:models.searchPlaceholder')}</div>
        ) : (
          filtered.map((p) => {
            const isActive = p.id === chatProvider;
            const isEnabled = providerSettings[p.id]?.enabled === true;
            return (
              <div
                key={p.id}
                className={`group flex items-center gap-1.5 h-[40px] px-1.5 py-1.5 rounded-md cursor-pointer transition-colors duration-100 ${isActive ? 'bg-accdim' : 'hover:bg-hov'}`}
                onClick={() => onSelectProvider(p.id)}
              >
                <Avatar entry={p} t={t} />
                <span className={`flex-1 truncate text-[length:calc(var(--ui-font-size)-2px)] font-ui ${isActive ? 'text-acc font-semibold' : 'text-t2'}`}>
                  {providerDisplayName(p, t)}
                </span>
                {isCustomProvider(p) && (
                  <button
                    type="button"
                    title={t('settings:models.editCustom')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditCustom(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-t3 hover:text-t1 transition-opacity"
                  >
                    <SquarePen size={11} />
                  </button>
                )}
                {isCustomProvider(p) && (
                  <button
                    type="button"
                    title={t('settings:models.deleteCustom')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteCustom(p.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-t3 hover:text-[#f06a6a] transition-opacity"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
                {isEnabled && (
                  <span className="text-[9px] font-bold px-1.5 h-[16px] inline-flex items-center rounded-full text-white" style={{ background: 'var(--green, #22a863)' }}>
                    {t('settings:models.activeBadge')}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="p-2 border-t border-brd">
        <button
          type="button"
          onClick={onAddCustom}
          className="w-full h-[28px] flex items-center justify-center gap-1 rounded-md text-[11px] font-ui border border-dashed border-brd2 text-t2 hover:border-acc hover:text-acc transition-colors duration-100 bg-transparent"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14"></path>
            <path d="M12 5v14"></path>
          </svg>
          {t('settings:models.addCustom')}
        </button>
      </div>
    </aside>
  );
}
