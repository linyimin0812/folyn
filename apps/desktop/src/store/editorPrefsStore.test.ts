import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorPrefsStore } from './editorPrefsStore';
import { storageClient } from '@/utils/storageClient';
import { markSettingsHydrated } from './settingsPersistence';

beforeEach(() => {
  storageClient.__resetForTesting();
  markSettingsHydrated();
  vi.useFakeTimers();
  useEditorPrefsStore.setState({
    editorFont: 'DM Mono',
    editorFontSize: 13,
    tabSize: 4,
    wrapColumn: 80,
    showLineNumbers: true,
    syntaxHighlight: true,
    autoSave: true,
    spellCheck: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useEditorPrefsStore setters', () => {
  it('setTabSize updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useEditorPrefsStore.getState().setTabSize(2);
    expect(useEditorPrefsStore.getState().tabSize).toBe(2);
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.tabSize).toBe(2);
    setSpy.mockRestore();
  });

  it('setAutoSave updates', () => {
    useEditorPrefsStore.getState().setAutoSave(false);
    expect(useEditorPrefsStore.getState().autoSave).toBe(false);
  });

  it('setEditorFont updates', () => {
    useEditorPrefsStore.getState().setEditorFont('Fira Code');
    expect(useEditorPrefsStore.getState().editorFont).toBe('Fira Code');
  });
});

describe('useEditorPrefsStore.hydrate', () => {
  it('applies scalar fields from the blob', () => {
    useEditorPrefsStore.getState().hydrate({
      editorFont: 'JetBrains Mono',
      editorFontSize: 16,
      tabSize: 2,
      autoSave: false,
      spellCheck: true,
    });
    const s = useEditorPrefsStore.getState();
    expect(s.editorFont).toBe('JetBrains Mono');
    expect(s.editorFontSize).toBe(16);
    expect(s.tabSize).toBe(2);
    expect(s.autoSave).toBe(false);
    expect(s.spellCheck).toBe(true);
  });

  it('missing fields keep defaults', () => {
    useEditorPrefsStore.getState().hydrate({ tabSize: 8 });
    expect(useEditorPrefsStore.getState().editorFont).toBe('DM Mono');
    expect(useEditorPrefsStore.getState().tabSize).toBe(8);
  });
});
