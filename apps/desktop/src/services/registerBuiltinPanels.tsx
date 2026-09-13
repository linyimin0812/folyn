/**
 * Register the built-in files sidebar panel
 * into {@link useFeaturePanelStore} and wire the visibility + active-panel sync
 * that makes the data-driven ActivityBar/Sidebar behave identically to the
 * pre-PR2 hardcoded version.
 *
 * Called once at app start (mirrors `registerBuiltinExtensions` /
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
 *   (e.g. a persisted extension panel id whose extension hasn't loaded yet, or an
 *   uninstalled extension), re-route to 'files'.
 */

import type { ReactNode } from 'react';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';
import { FilesPanel } from '@/components/sidebar/FilesPanel';

// ── Built-in icons (reuse the exact SVGs from the pre-PR2 ActivityBar) ──────────
const FilesIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 7V17a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

let wired = false;

export function registerBuiltinPanels(): () => void {
  if (wired) return () => {};
  wired = true;

  const fps = useFeaturePanelStore.getState();

  // ── Register the built-ins ──
  // files is always visible.
  fps.register({
    id: 'files',
    title: '文件',
    icon: FilesIcon,
    component: FilesPanel,
    order: 0,
    visible: true,
    builtin: true,
  });

  // ── editorStore.activePanel → featurePanelStore.activePanelId (mirror) ──
  // One-way sync: the UI's activePanelId follows the editor source of truth.
  // Validates the id exists AND is visible; if not (uninstalled extension panel,
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

  // Dispose: tears down the subscription and resets the `wired` guard so
  // tests can re-invoke `registerBuiltinPanels`. Production never calls this
  // — the panels/subscriptions live for the app session.
  return () => {
    unsubEditor();
    wired = false;
  };
}
