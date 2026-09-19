/**
 * PetSearchRecents — the 最近使用 row under the pet-panel search box
 * (PRD 09-19-pet-search-recents, reworked to extensions).
 *
 * Renders one chip per recently used EXTENSION (plugin / builtin tool popup):
 * icon + display name, nothing else. Clicking a chip re-opens that tool via
 * the exact same path as a picked search result row (`emitOpenExtensionTool`:
 * `pet://menu-action open-extension-tool` → the main window's petHostRouter,
 * then the panel hides restoring the user's frontmost app).
 *
 * Mounted by PetPanelApp ONLY while focus sits inside the search area (input
 * or chip) — the focus gating lives in the parent; this component is purely
 * the row.
 *
 * Data:
 *  - `petStore.recentExtensionIds` — extension ids, MRU/deduped, recorded by
 *    the open paths (`toolWindowStore.open`, petHostRouter builtin:translation,
 *    the `action.open-inbox` command) in the MAIN window and mirrored here by
 *    the `pet://settings-updated` broadcast;
 *  - `extensionStore.rows` — same-realm rows (refreshed on mount, mirroring
 *    PetPanelSearchResults) to resolve each id's icon + display name
 *    (built-ins carry `nameKey`; third-party rows use `entry.name`).
 *  - `builtin:inbox` has NO extension row — it's a tool popup, not an
 *    on-disk extension — so its chip gets a static fallback (lucide Inbox
 *    icon + `pet:search.recentsInbox` label). Same treatment for any other
 *    id without a row: raw id as label, ExtensionIcon first-letter fallback.
 */

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Inbox } from 'lucide-react';
import { usePetStore } from '@/store/petStore';
import { useExtensionStore } from '@/store/extensionStore';
import { ExtensionIcon } from '@/components/settings/ExtensionsSettings';
import { emitOpenExtensionTool } from './PetPanelSearchResults';

/** Static fallbacks for builtin tool popups that have no extension row. */
const BUILTIN_TOOL_FALLBACKS: Record<
  string,
  { nameKey: string; icon: React.ReactNode }
> = {
  'builtin:inbox': { nameKey: 'pet:search.recentsInbox', icon: <Inbox size={14} /> },
};

interface PetSearchRecentsProps {
  /** Called on pointerdown so the parent (header drag region) can suppress
   *  the window drag — same contract as the search row's suppressDrag. */
  onPointerDown?: (e: React.PointerEvent) => void;
}

export function PetSearchRecents({ onPointerDown }: PetSearchRecentsProps) {
  const { t } = useTranslation();
  const recentExtensionIds = usePetStore((s) => s.recentExtensionIds);
  const rows = useExtensionStore((s) => s.rows);
  const refreshRows = useExtensionStore((s) => s.refresh);

  // Refresh rows once on mount (mirrors PetPanelSearchResults — the panel
  // window lives as long as the app; installs happen in the main window's
  // settings and the `extension://installed` listeners in App.tsx call
  // refresh there, not here).
  useEffect(() => {
    void refreshRows();
  }, [refreshRows]);

  if (recentExtensionIds.length === 0) return null;

  const pickChip = (extensionId: string) => {
    void emitOpenExtensionTool(extensionId);
  };

  return (
    <div
      className="pet-panel-search-recents"
      role="toolbar"
      aria-label={t('pet:search.recents')}
      onPointerDown={onPointerDown}
    >
      {recentExtensionIds.map((id) => {
        const row = rows.find((r) => r.entry.id === id);
        const fallback = BUILTIN_TOOL_FALLBACKS[id];
        const name = row
          ? row.nameKey
            ? t(row.nameKey)
            : row.entry.name
          : fallback
            ? t(fallback.nameKey)
            : id;
        return (
          <button
            key={id}
            type="button"
            className="pet-panel-search-chip"
            title={t('pet:search.recentsChip', { name })}
            onClick={() => pickChip(id)}
          >
            {row ? (
              <ExtensionIcon
                icon={row.icon}
                iconDark={row.iconDark}
                name={name}
                size={14}
              />
            ) : (
              (fallback?.icon ?? <ExtensionIcon icon={undefined} name={name} size={14} />)
            )}
            <span>{name}</span>
          </button>
        );
      })}
    </div>
  );
}
