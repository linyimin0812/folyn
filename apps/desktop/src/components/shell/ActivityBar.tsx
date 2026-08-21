/**
 * Activity bar — the vertical icon strip on the far left of the editor.
 *
 * PR2 change: panel buttons are data-driven from {@link useVisiblePanels}
 * (`useFeaturePanelStore`) instead of hardcoded to the 5 built-ins. Each
 * visible panel entry renders one button; clicking calls `onPanelChange(id)`,
 * which App.tsx routes to `editorStore.setActivePanel` + `setCurrentPage`;
 * `registerBuiltinPanels`'s one-way editorStore→featurePanelStore subscription
 * then mirrors the new id so the active button + Sidebar follow.
 *
 * The daily / settings page-nav buttons stay hardcoded (Decision Q3:
 * page-nav data-driving is out of scope). Schedule is pinned to the top of
 * the bar (above the data-driven panel list) per the user's layout
 * preference. Settings is pinned to the bottom via a `flex-1` spacer.
 *
 * Active-state rules:
 * - Panel button: `active` when `activePanel === id` AND not on a page-nav
 *   page (schedule) — mirrors the pre-PR2 `!onPage && ...` gate.
 * - Page-nav button: `active` when `currentPage === 'schedule'`.
 */

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { useNavStore } from '@/store/navStore';
import { useVisiblePanels } from '@/store/featurePanelStore';
import { useVaultStore } from '@/store/vaultStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useTranslation } from 'react-i18next';
import { GitPanel } from '@/components/git/GitPanel';
import githubIcon from '@/assets/icons/github.svg';
import { ScheduleIcon } from '@/components/icons/ScheduleIcon';
import { TranslationIcon } from '@/components/icons/TranslationIcon';

/**
 * Active panel id. Widened to `string` in PR2 — plugin panels contribute
 * arbitrary ids (the old `'files'|'wiki'|'clips'|'analyze'|'calendar'` union
 * is no longer adequate). The 5 built-in ids remain reserved.
 */
export type ActivityPanel = string;

interface ActivityBarProps {
  /** The currently active panel id (mirrors featurePanelStore / editorStore). */
  activePanel: ActivityPanel;
  /** Click handler for panel buttons. Page-nav buttons use navStore directly. */
  onPanelChange: (panel: ActivityPanel) => void;
}

export function ActivityBar({ activePanel, onPanelChange }: ActivityBarProps) {
  const { t } = useTranslation();
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);
  const currentPage = useNavStore((s) => s.currentPage);
  const currentVault = useVaultStore((s) => s.currentVault);
  const enableSchedulePanel = useAppearanceStore((s) => s.enableSchedulePanel);
  const enableTranslationPanel = useAppearanceStore((s) => s.enableTranslationPanel);
  const [gitOpen, setGitOpen] = useState(false);

  // Git icon only for GitHub-type vaults (clone-backed local git repo).
  const isGithubVault = currentVault?.providerType === 'github';

  const onSchedule = currentPage === 'schedule';
  const onTranslation = currentPage === 'translation';
  const onPage = onSchedule || onTranslation;

  // Visible panels sorted by (order, registration seq). The store selector
  // returns a useShallow-stabilized array — re-renders only on real content
  // change (no infinite loop on the empty path: EMPTY_PANELS constant).
  // Files is the first entry (order=0); we slice it off and render it at the
  // very top of the bar, then Schedule, then the rest of the panels
  // (Wiki/Clips/Analyze when enabled, plus any plugin panels).
  const visiblePanels = useVisiblePanels();
  const [filesPanel, ...restPanels] = visiblePanels;

  const renderPanelButton = (p: typeof filesPanel) => (
    <button
      key={p.id}
      className={`activity-icon ${!onPage && activePanel === p.id ? 'active' : ''}`}
      onClick={() => onPanelChange(p.id)}
      title={p.title}
    >
      {p.icon}
      {p.badge !== undefined && p.badge !== '' && (
        <span
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 12,
            height: 12,
            padding: '0 2px',
            borderRadius: 6,
            background: 'var(--acc, #6366f1)',
            color: '#fff',
            fontSize: 9,
            lineHeight: '12px',
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {p.badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="activity-bar">
      {filesPanel && renderPanelButton(filesPanel)}

      {enableSchedulePanel && (
        <button
          className={`activity-icon ${onSchedule ? 'active' : ''}`}
          onClick={() => setCurrentPage('schedule')}
          title={t('shell:nav.schedule')}
        >
          <ScheduleIcon size={14} active={onSchedule} />
        </button>
      )}

      {enableTranslationPanel && (
        <button
          className={`activity-icon ${onTranslation ? 'active' : ''}`}
          onClick={() => setCurrentPage('translation')}
          title={t('shell:nav.translation')}
        >
          <TranslationIcon size={14} active={onTranslation} />
        </button>
      )}

      {restPanels.map(renderPanelButton)}

      <div className="flex-1" />

      {isGithubVault && (
        <>
          <button
            className="activity-icon"
            onClick={() => setGitOpen(true)}
            title={t('shell:nav.git')}
          >
            <img src={githubIcon} alt="" width="14" height="14" />
          </button>
          {gitOpen && <GitPanel onClose={() => setGitOpen(false)} />}
        </>
      )}

      <button
        className="activity-icon"
        onClick={() => setCurrentPage('settings')}
        title={t('shell:nav.settings')}
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
