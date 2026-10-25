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
import { MessagesSquare, BookOpen } from 'lucide-react';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { FilesPanel } from '@/components/sidebar/FilesPanel';
import { SessionsPanel } from '@/components/sessions/SessionsPanel';
import { KnowledgePanel } from '@/components/knowledge/KnowledgePanel';

// ── Built-in icons (reuse the exact SVGs from the pre-PR2 ActivityBar) ──────────
const FilesIcon: ReactNode = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
    <path d="M3 7V17a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
  </svg>
);

// Sessions panel (external conversation browsing) — MessagesSquare: two stacked
// bubbles read as "a collection of conversations" and stay distinct from the
// neighbors (folder, Activity pulse line, translation, gear). Same 18px /
// stroke-1.6 metrics as the files icon.
const SessionsIcon: ReactNode = <MessagesSquare size={18} strokeWidth={1.6} />;

// Knowledge panel — 知识库（收录范围 + 资料索引 + 主题知识页 + 检索问答，
// 见 .trellis/tasks/10-24-knowledge-base-v1 与 ADR-0005..0009）。
// BookOpen 与 files 的文件夹、sessions 的气泡都不同形，18px / stroke-1.6 同规格。
const KnowledgeIcon: ReactNode = <BookOpen size={18} strokeWidth={1.6} />;

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

  // knowledge — 知识库（ADR-0005..0009，切片 A）。order 10：files 之后、sessions 之前。
  fps.register({
    id: 'knowledge',
    title: '知识库',
    icon: KnowledgeIcon,
    component: KnowledgePanel,
    order: 10,
    visible: true,
    builtin: true,
  });

  // sessions — external conversation browsing + capture (Codex, Claude Code, pi).
  // Visibility follows the appearanceStore enable flag (Extensions settings
  // toggle); read at register time so a persisted `false` (hydrated later,
  // which fires the subscription below) still converges to hidden.
  fps.register({
    id: 'sessions',
    title: '会话',
    icon: SessionsIcon,
    component: SessionsPanel,
    order: 20,
    visible: useAppearanceStore.getState().enableSessionsPanel,
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

  // ── enableSessionsPanel flag → featurePanelStore visibility ──
  // The Extensions settings toggle (and the persisted-blob hydrate, which is
  // just a `set`) flips the appearanceStore flag; this subscription mirrors it
  // into the panel registry. Re-running mirrorActive afterwards applies the
  // general fallback rule: if sessions was the active panel and just became
  // invisible, the active panel re-routes to 'files'.
  const unsubSessions = useAppearanceStore.subscribe((state, prev) => {
    if (state.enableSessionsPanel === prev.enableSessionsPanel) return;
    useFeaturePanelStore.getState().setVisible('sessions', state.enableSessionsPanel);
    mirrorActive(useEditorStore.getState().activePanel);
  });

  // Dispose: tears down the subscriptions and resets the `wired` guard so
  // tests can re-invoke `registerBuiltinPanels`. Production never calls this
  // — the panels/subscriptions live for the app session.
  return () => {
    unsubEditor();
    unsubSessions();
    wired = false;
  };
}
