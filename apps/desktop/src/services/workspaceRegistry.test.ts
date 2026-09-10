/**
 * Tests for the runtime Workspace registry (doc §7.1, §32).
 *
 * Contract: register → featurePanelStore has the entry (ActivityBar shows it);
 * dispose → entry removed (active → 'files' fallback). Doesn't render the
 * component — the registry's contract is store membership only.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import { workspaceApi } from './workspaceRegistry';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { useEditorStore } from '@/store/editorStore';

const NullPanel: ComponentType = () => null;

describe('workspaceRegistry', () => {
  beforeEach(() => {
    // Clear panels + seed 'files' as the fallback (production always has it).
    const s = useFeaturePanelStore.getState();
    for (const p of s.panels) s.unregister(p.id);
    s.register({
      id: 'files',
      title: 'Files',
      icon: null,
      component: NullPanel,
      order: 0,
      visible: true,
    });
    s.setActive('files');
    useEditorStore.setState({ activePanel: 'files' });
  });

  it('register adds a workspace to the store', () => {
    const before = useFeaturePanelStore.getState().panels.length;
    const d = workspaceApi.register({
      id: 'git',
      title: 'Git',
      icon: 'git-branch',
      view: NullPanel,
    });
    const after = useFeaturePanelStore.getState().panels;
    expect(after.length).toBe(before + 1);
    expect(after.find((p) => p.id === 'git')?.title).toBe('Git');
    d.dispose();
    expect(useFeaturePanelStore.getState().panels.some((p) => p.id === 'git')).toBe(false);
  });

  it('open/close/toggle switch the active panel', () => {
    const d = workspaceApi.register({ id: 'wiki2', title: 'Wiki2', view: NullPanel });
    workspaceApi.open('wiki2');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('wiki2');
    expect(useEditorStore.getState().activePanel).toBe('wiki2');
    workspaceApi.close('wiki2');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
    d.dispose();
  });

  it('register refuses a duplicate id', () => {
    const d1 = workspaceApi.register({ id: 'dup', title: 'Dup', view: NullPanel });
    const d2 = workspaceApi.register({ id: 'dup', title: 'Dup2', view: NullPanel });
    // Duplicate registration is a no-op (warned + refused).
    expect(useFeaturePanelStore.getState().panels.filter((p) => p.id === 'dup').length).toBe(1);
    d1.dispose();
    d2.dispose();
  });

  it('dispose falls back to files when the disposed workspace was active', () => {
    const d = workspaceApi.register({ id: 'tmp', title: 'Tmp', view: NullPanel });
    workspaceApi.open('tmp');
    expect(useFeaturePanelStore.getState().activePanelId).toBe('tmp');
    d.dispose();
    expect(useFeaturePanelStore.getState().activePanelId).toBe('files');
  });
});
