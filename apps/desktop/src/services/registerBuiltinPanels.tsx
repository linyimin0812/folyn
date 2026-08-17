/**
 * Register the 4 built-in sidebar panels (files/wiki/clips/analyze)
 * into {@link useFeaturePanelStore} and wire the visibility + active-panel sync
 * that makes the data-driven ActivityBar/Sidebar behave identically to the
 * pre-PR2 hardcoded version.
 *
 * Called once at app start (mirrors `registerBuiltinPlugins` /
 * `registerBuiltinCommands`). Idempotent — a module-level guard skips re-runs.
 *
 * Sync contract (PR2 reconciliation of editorStore.activePanel vs
 * featurePanelStore.activePanelId):
 *
 *   editorStore.activePanel is the persisted source of truth (it's also what
 *   WorkArea reads to filter tabs by `t.activity === activePanel`).
 *   featurePanelStore.activePanelId mirrors it for the UI (ActivityBar active
 *   button + Sidebar which-component-to-render). The mirror is a one-way
 *   editorStore → featurePanelStore subscription: every setActivePanel call
 *   (from ActivityBar click, ⌘P gotoPanel, the enable-flag fallback, or
 *   startup hydration) propagates here. featurePanelStore.setActive stays a
 *   pure setter (no editorStore coupling) so the store and its PR1 tests stay
 *   leaf-testable.
 *
 * Fallback rules:
 * - Startup: if editorStore.activePanel isn't a registered+visible panel
 *   (e.g. a persisted plugin panel id whose plugin hasn't loaded yet, or an
 *   uninstalled plugin), re-route to 'files'.
 * - Enable-flag toggle: if the active panel's flag flips to false (e.g.
 *   enableWikiPanel off while wiki is active), re-route to 'files'. Replaces
 *   the 4 hardcoded conditionals that lived in App.tsx pre-PR2.
 */

import type { ReactNode } from 'react';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { FilesPanel } from '@/components/sidebar/FilesPanel';
import { WikiFileTree } from '@/components/sidebar/WikiFileTree';
import { ClipsPanel } from '@/components/sidebar/ClipsPanel';
import { AnalysisPanel } from '@/components/sidebar/AnalysisPanel';
import { AnalyzeIcon as AnalyzeIconComponent } from '@/components/icons/AnalyzeIcon';
import { ClipsIcon as ClipsIconComponent } from '@/components/icons/ClipsIcon';
import { WikiIcon as WikiIconComponent } from '@/components/icons/WikiIcon';

// ── Built-in icons (reuse the exact SVGs from the pre-PR2 ActivityBar) ──────────
const FilesIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 7V17a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);
const WikiIcon: ReactNode = <WikiIconComponent size={18} />;
const ClipsIcon: ReactNode = <ClipsIconComponent size={18} />;
const AnalyzeIcon: ReactNode = <AnalyzeIconComponent size={18} />;

let wired = false;

export function registerBuiltinPanels(): () => void {
  if (wired) return () => {};
  wired = true;

  const fps = useFeaturePanelStore.getState();
  const ap = useAppearanceStore.getState();

  // ponytail: order for Wiki/Clips/Analyze is their enabledAt timestamp
  // (Date.now() of the false→true transition). Files stays at 0 so it's
  // always first. When enabledAt is undefined (panel disabled, or pre-
  // migration old user with no recorded timestamp), fall back to the
  // base order 10/20/30 — sort still stable, just not time-ordered.
  const orderFor = (id: 'wiki' | 'clips' | 'analyze', base: number) => {
    const ts = id === 'wiki' ? ap.enabledAtWiki : id === 'clips' ? ap.enabledAtClips : ap.enabledAtAnalyze;
    return ts ?? base;
  };

  // ── Register the 5 built-ins ──
  // files is always visible; the other 4 bind visibility to their appearanceStore
  // enable flag (captured at registration time; the subscription below keeps
  // them in sync if hydration or a settings toggle changes a flag later).
  fps.register({
    id: 'files',
    title: '文件',
    icon: FilesIcon,
    component: FilesPanel,
    order: 0,
    visible: true,
    builtin: true,
  });
  fps.register({
    id: 'wiki',
    title: 'Wiki',
    icon: WikiIcon,
    component: WikiFileTree,
    order: orderFor('wiki', 10),
    visible: ap.enableWikiPanel,
    builtin: true,
  });
  fps.register({
    id: 'clips',
    title: 'Clips',
    icon: ClipsIcon,
    component: ClipsPanel,
    order: orderFor('clips', 20),
    visible: ap.enableClipsPanel,
    builtin: true,
  });
  fps.register({
    id: 'analyze',
    title: '项目分析',
    icon: AnalyzeIcon,
    component: AnalysisPanel,
    order: orderFor('analyze', 30),
    visible: ap.enableAnalyzePanel,
    builtin: true,
  });

  // ── appearanceStore enable flags → featurePanelStore visibility + order ──
  // On any appearanceStore change, for each of the 3 flag-bound panels:
  // - if the flag changed, push the new visibility to the store
  // - if the flag flipped to true, also refresh the panel's order from the
  //   (just-updated) enabledAt timestamp so it lands at the end of the
  //   ActivityBar, matching the "I just turned this on" mental model
  // - if the just-hidden panel was the active one, re-route to 'files'
  //   (the editorStore→featurePanelStore mirror subscription below propagates it)
  const unsubAppearance = useAppearanceStore.subscribe((state, prev) => {
    const checks: Array<[string, boolean, boolean, number | undefined, number | undefined]> = [
      ['wiki', state.enableWikiPanel, prev.enableWikiPanel, state.enabledAtWiki, prev.enabledAtWiki],
      ['clips', state.enableClipsPanel, prev.enableClipsPanel, state.enabledAtClips, prev.enabledAtClips],
      ['analyze', state.enableAnalyzePanel, prev.enableAnalyzePanel, state.enabledAtAnalyze, prev.enabledAtAnalyze],
    ];
    for (const [id, cur, prevFlag, curTs, prevTs] of checks) {
      if (cur === prevFlag && curTs === prevTs) continue;
      const store = useFeaturePanelStore.getState();
      store.setVisible(id, cur);
      if (cur) {
        // order: enabledAt if we have one, else keep current (initial base)
        const base = id === 'wiki' ? 10 : id === 'clips' ? 20 : 30;
        store.setOrder(id, curTs ?? base);
      }
      if (!cur && useEditorStore.getState().activePanel === id) {
        useEditorStore.getState().setActivePanel('files');
      }
    }
  });

  // ── editorStore.activePanel → featurePanelStore.activePanelId (mirror) ──
  // One-way sync: the UI's activePanelId follows the editor source of truth.
  // Validates the id exists AND is visible; if not (uninstalled plugin panel,
  // or a panel hidden by an enable flag) it re-routes to 'files', which
  // re-fires this subscription with a valid id and converges.
  const mirrorActive = (id: string | null) => {
    const store = useFeaturePanelStore.getState();
    const valid = id !== null && store.panels.some((p) => p.id === id && p.visible);
    if (valid) {
      store.setActive(id);
    } else if (id !== 'files') {
      // Invalid active panel — fall back to 'files'. setActivePanel fires the
      // subscription again with 'files', which then mirrors cleanly.
      useEditorStore.getState().setActivePanel('files');
    } else {
      // id is 'files' but somehow not registered (test/edge env) — clear.
      store.setActive(null);
    }
  };

  const unsubEditor = useEditorStore.subscribe((state, prev) => {
    if (state.activePanel !== prev.activePanel) {
      mirrorActive(state.activePanel);
    }
  });

  // Initial sync — editorStore.activePanel defaults to 'files' (no
  // persistence today; see editorStore.ts — only viewMode is persisted). The
  // call still covers the case where a future change persists activePanel.
  mirrorActive(useEditorStore.getState().activePanel);

  // Dispose: tears down the two subscriptions and resets the `wired` guard so
  // tests can re-invoke `registerBuiltinPanels`. Production never calls this
  // — the panels/subscriptions live for the app session.
  return () => {
    unsubAppearance();
    unsubEditor();
    wired = false;
  };
}
