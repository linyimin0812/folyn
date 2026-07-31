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

// ── Built-in icons (reuse the exact SVGs from the pre-PR2 ActivityBar) ──────────
const FilesIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 7V17a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);
const WikiIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);
const ClipsIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M5 3v18l7-4 7 4V3H5z" />
  </svg>
);
const AnalyzeIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 01-.437-.437C3 20.24 3 19.96 3 19.4V3" />
    <path d="M7 14l4-4 4 4 6-6" />
  </svg>
);

let wired = false;

export function registerBuiltinPanels(): () => void {
  if (wired) return () => {};
  wired = true;

  const fps = useFeaturePanelStore.getState();
  const ap = useAppearanceStore.getState();

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
    order: 10,
    visible: ap.enableWikiPanel,
    builtin: true,
  });
  fps.register({
    id: 'clips',
    title: 'Clips',
    icon: ClipsIcon,
    component: ClipsPanel,
    order: 20,
    visible: ap.enableClipsPanel,
    builtin: true,
  });
  fps.register({
    id: 'analyze',
    title: '项目分析',
    icon: AnalyzeIcon,
    component: AnalysisPanel,
    order: 30,
    visible: ap.enableAnalyzePanel,
    builtin: true,
  });

  // ── appearanceStore enable flags → featurePanelStore visibility ──
  // On any appearanceStore change, for each of the 3 flag-bound panels: if the
  // flag changed, push the new visibility to the store. If the just-hidden
  // panel was the active one, re-route the active panel to 'files' (the
  // editorStore→featurePanelStore mirror subscription below propagates it).
  const unsubAppearance = useAppearanceStore.subscribe((state, prev) => {
    const checks: Array<[string, boolean, boolean]> = [
      ['wiki', state.enableWikiPanel, prev.enableWikiPanel],
      ['clips', state.enableClipsPanel, prev.enableClipsPanel],
      ['analyze', state.enableAnalyzePanel, prev.enableAnalyzePanel],
    ];
    for (const [id, cur, prevFlag] of checks) {
      if (cur === prevFlag) continue;
      useFeaturePanelStore.getState().setVisible(id, cur);
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
