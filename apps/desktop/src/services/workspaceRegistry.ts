/**
 * Runtime Workspace registry (doc §7.1, §32).
 *
 * The Phase-2 hook target for `ctx.ui.workspace` (Tool Extensions). Backed by
 * the existing `featurePanelStore` so the runtime `register()` path and the
 * declarative `contributes.features` path (featureAdapter) share one panel
 * backend + ActivityBar rendering. `register` returns a Disposable; open/close/
 * toggle route to the store's active-panel selector.
 *
 * Not wired into the loaders yet (Phase 2 — needs the ExtensionApi capability
 * injection). Real + testable now.
 */

import type { Disposable, WorkspaceApi, WorkspaceContribution } from 'folyn-extension-sdk';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';
import type { ComponentType } from 'react';
import { renderIcon } from '@/services/extension-host/featureAdapter';

/** A Workspace contribution whose `view` has been resolved to a component. */
export interface ResolvedWorkspaceContribution extends Omit<WorkspaceContribution, 'view'> {
  component: ComponentType;
  order: number;
}

function nextOrder(): number {
  const panels: Array<{ order: number }> = useFeaturePanelStore.getState().panels as Array<{ order: number }>;
  const maxOrder = panels.reduce((m: number, p: { order: number }) => Math.max(m, p.order), 0);
  return maxOrder + 10;
}

export const workspaceApi: WorkspaceApi = {
  register(contribution): Disposable {
    if (!contribution || !contribution.id) {
      throw new Error('WorkspaceContribution.id is required');
    }
    const store = useFeaturePanelStore.getState();
    // Collision guard: refuse if already registered.
    if (store.panels.some((p: { id: string }) => p.id === contribution.id)) {
      console.warn(`[workspace-registry] workspace "${contribution.id}" already registered — refused`);
      return { dispose: () => {} };
    }
    const component = contribution.view as ComponentType | undefined;
    if (!component) {
      throw new Error(`WorkspaceContribution "${contribution.id}" has no resolved view component`);
    }
    store.register({
      id: contribution.id,
      title: contribution.title,
      icon: contribution.icon ? renderIcon(contribution.icon) : null,
      component,
      order: contribution.order ?? nextOrder(),
      badge: contribution.badge,
      visible: true,
    });
    return {
      dispose: () => {
        const s = useFeaturePanelStore.getState();
        const wasActive = s.activePanelId === contribution.id;
        s.unregister(contribution.id);
        if (wasActive) {
          // Fall back to 'files' (always registered in production).
          s.setActive('files');
          useEditorStore.getState().setActivePanel('files');
        }
      },
    };
  },
  open(id) {
    useFeaturePanelStore.getState().setActive(id);
    useEditorStore.getState().setActivePanel(id);
  },
  close(id) {
    const s = useFeaturePanelStore.getState();
    if (s.activePanelId === id) {
      s.setActive('files');
      useEditorStore.getState().setActivePanel('files');
    }
  },
  toggle(id) {
    const s = useFeaturePanelStore.getState();
    if (s.activePanelId === id) {
      this.close(id);
    } else {
      this.open(id);
    }
  },
};
