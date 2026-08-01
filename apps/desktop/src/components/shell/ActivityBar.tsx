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
 * The daily / study / settings page-nav buttons stay hardcoded (Decision Q3:
 * page-nav data-driving is out of scope). Settings is pinned to the bottom via
 * a `flex-1` spacer.
 *
 * Active-state rules:
 * - Panel button: `active` when `activePanel === id` AND not on a page-nav
 *   page (schedule/study) — mirrors the pre-PR2 `!onPage && ...` gate.
 * - Page-nav button: `active` when `currentPage === 'schedule'|'study'`.
 */

import { useState } from 'react';
import { Settings } from 'lucide-react';
import { useNavStore } from '@/store/navStore';
import { useVisiblePanels } from '@/store/featurePanelStore';
import { useVaultStore } from '@/store/vaultStore';
import { useTranslation } from 'react-i18next';
import { GitPanel } from '@/components/git/GitPanel';
import githubIcon from '@/assets/icons/github.svg';

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
  const [gitOpen, setGitOpen] = useState(false);

  // Git icon only for GitHub-type vaults (clone-backed local git repo).
  const isGithubVault = currentVault?.providerType === 'github';

  const onSchedule = currentPage === 'schedule';
  const onStudy = currentPage === 'study';
  const onPage = onSchedule || onStudy;

  // Visible panels sorted by (order, registration seq). The store selector
  // returns a useShallow-stabilized array — re-renders only on real content
  // change (no infinite loop on the empty path: EMPTY_PANELS constant).
  const visiblePanels = useVisiblePanels();

  return (
    <div className="activity-bar">
      {visiblePanels.map((p) => (
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
      ))}

      <button
        className={`activity-icon ${onSchedule ? 'active' : ''}`}
        onClick={() => setCurrentPage('schedule')}
        title={t('shell:nav.schedule')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </button>

      <button
        className={`activity-icon ${onStudy ? 'active' : ''}`}
        onClick={() => setCurrentPage('study')}
        title={t('shell:nav.study')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 10L12 5 2 10l10 5 10-5z" />
          <path d="M6 12v5c0 1 2.5 3 6 3s6-2 6-3v-5" />
        </svg>
      </button>

      <div className="flex-1" />

      {isGithubVault && (
        <>
          <button
            className="activity-icon"
            onClick={() => setGitOpen(true)}
            title={t('shell:nav.git')}
          >
            <img src={githubIcon} alt="" width="18" height="18" />
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
