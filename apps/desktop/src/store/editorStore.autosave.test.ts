import { describe, it, expect, beforeEach, vi } from 'vitest';

const { scheduleAutoSave } = vi.hoisted(() => ({ scheduleAutoSave: vi.fn() }));

vi.mock('./editorAutoSave', () => ({
  scheduleAutoSave,
  flushAllAutoSaves: vi.fn(),
}));

import { useEditorStore } from './editorStore';
import { useEditorPrefsStore } from './editorPrefsStore';

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useEditorPrefsStore.setState({ autoSave: true });
  scheduleAutoSave.mockClear();
});

describe('updateTabContent — autoSave gating', () => {
  it('schedules debounced save when autoSave is on', () => {
    useEditorStore.setState({
      tabs: [{ id: 't1', name: 'a.md', path: 'a.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' }],
      activeTabId: 't1',
    });

    useEditorStore.getState().updateTabContent('t1', 'edited');

    expect(scheduleAutoSave).toHaveBeenCalledTimes(1);
    expect(scheduleAutoSave).toHaveBeenCalledWith('t1', expect.any(Function));
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });

  it('does NOT schedule save when autoSave is off — dirty dot must persist', () => {
    useEditorPrefsStore.setState({ autoSave: false });
    useEditorStore.setState({
      tabs: [{ id: 't1', name: 'a.md', path: 'a.md', content: '', isDirty: false, fileType: 'markdown', activity: 'files' }],
      activeTabId: 't1',
    });

    useEditorStore.getState().updateTabContent('t1', 'edited');

    expect(scheduleAutoSave).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });
});
