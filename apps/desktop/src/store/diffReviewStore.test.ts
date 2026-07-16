import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDiffReviewStore } from './diffReviewStore';
import { useEditorStore } from './editorStore';

// updateTabContent is delegated to editorStore; spy on it so we can assert the
// delegation without re-implementing the tabs-map + autosave logic here.
let updateTabContentSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  useDiffReviewStore.setState({
    diffReviewMode: false,
    diffFilePath: null,
    diffOldContent: null,
    diffNewContent: null,
    externalContentVersion: 0,
  });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  updateTabContentSpy = vi
    .spyOn(useEditorStore.getState(), 'updateTabContent')
    .mockImplementation(() => {});
});

describe('useDiffReviewStore', () => {
  it('defaults match old editorStore (false/null/null/null/0)', () => {
    const s = useDiffReviewStore.getState();
    expect(s.diffReviewMode).toBe(false);
    expect(s.diffFilePath).toBeNull();
    expect(s.diffOldContent).toBeNull();
    expect(s.diffNewContent).toBeNull();
    expect(s.externalContentVersion).toBe(0);
  });

  it('enterDiffReview sets all diff fields', () => {
    useDiffReviewStore.getState().enterDiffReview('a.md', 'old', 'new');
    const s = useDiffReviewStore.getState();
    expect(s.diffReviewMode).toBe(true);
    expect(s.diffFilePath).toBe('a.md');
    expect(s.diffOldContent).toBe('old');
    expect(s.diffNewContent).toBe('new');
  });

  it('exitDiffReview resets all diff fields', () => {
    useDiffReviewStore.getState().enterDiffReview('a.md', 'old', 'new');
    useDiffReviewStore.getState().exitDiffReview();
    const s = useDiffReviewStore.getState();
    expect(s.diffReviewMode).toBe(false);
    expect(s.diffFilePath).toBeNull();
    expect(s.diffOldContent).toBeNull();
    expect(s.diffNewContent).toBeNull();
  });

  it('setContentExternal bumps externalContentVersion and delegates tab mutation', () => {
    const before = useDiffReviewStore.getState().externalContentVersion;
    useDiffReviewStore.getState().setContentExternal('t1', 'new content');
    expect(useDiffReviewStore.getState().externalContentVersion).toBe(before + 1);
    expect(updateTabContentSpy).toHaveBeenCalledWith('t1', 'new content');
  });

  it('setContentExternal bumps version on each call', () => {
    useDiffReviewStore.getState().setContentExternal('t1', 'a');
    useDiffReviewStore.getState().setContentExternal('t1', 'b');
    expect(useDiffReviewStore.getState().externalContentVersion).toBe(2);
  });
});
