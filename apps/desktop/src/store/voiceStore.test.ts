import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useVoiceStore, DEFAULT_POLISH_PROMPT, PERSIST_KEYS_VOICE } from './voiceStore';
import { storageClient } from '@/utils/storageClient';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
  useVoiceStore.setState({
    polishPrompt: DEFAULT_POLISH_PROMPT,
    autoPolish: true,
    saveSource: false,
    sourceDir: '.voice_input',
    globalHotkey: '',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVoiceStore setters', () => {
  it('setPolishPrompt updates value', () => {
    useVoiceStore.getState().setPolishPrompt('润色一下');
    expect(useVoiceStore.getState().polishPrompt).toBe('润色一下');
  });

  it('setAutoPolish toggles the flag', () => {
    useVoiceStore.getState().setAutoPolish(false);
    expect(useVoiceStore.getState().autoPolish).toBe(false);
  });

  it('setSaveSource toggles the flag', () => {
    useVoiceStore.getState().setSaveSource(true);
    expect(useVoiceStore.getState().saveSource).toBe(true);
  });

  it('setSourceDir updates value', () => {
    useVoiceStore.getState().setSourceDir('voice/recordings');
    expect(useVoiceStore.getState().sourceDir).toBe('voice/recordings');
  });

  it('setGlobalHotkey updates value', () => {
    useVoiceStore.getState().setGlobalHotkey('Cmd+Shift+V');
    expect(useVoiceStore.getState().globalHotkey).toBe('Cmd+Shift+V');
  });
});

describe('useVoiceStore.hydrate', () => {
  it('applies well-typed fields from a persisted blob', () => {
    useVoiceStore.getState().hydrate({
      polishPrompt: '自定义润色',
      autoPolish: false,
      saveSource: true,
      sourceDir: 'audio/voice',
      globalHotkey: 'Cmd+Shift+V',
    });
    const s = useVoiceStore.getState();
    expect(s.polishPrompt).toBe('自定义润色');
    expect(s.autoPolish).toBe(false);
    expect(s.saveSource).toBe(true);
    expect(s.sourceDir).toBe('audio/voice');
    expect(s.globalHotkey).toBe('Cmd+Shift+V');
  });

  it('ignores wrong-typed entries and keeps defaults', () => {
    // A corrupted blob must not crash or pollute the store. Type guards in
    // hydrate are the only defense; settingsPersistence doesn't validate.
    useVoiceStore.getState().hydrate({
      polishPrompt: 123, // wrong type
      autoPolish: 'yes', // wrong type
      saveSource: 'true', // wrong type
      sourceDir: null, // wrong type
      globalHotkey: {}, // wrong type
    });
    const s = useVoiceStore.getState();
    expect(s.polishPrompt).toBe(DEFAULT_POLISH_PROMPT);
    expect(s.autoPolish).toBe(true);
    expect(s.saveSource).toBe(false);
    expect(s.sourceDir).toBe('.voice_input');
    expect(s.globalHotkey).toBe('');
  });

  it('partial blob leaves unspecified fields at defaults', () => {
    useVoiceStore.getState().hydrate({ autoPolish: false });
    const s = useVoiceStore.getState();
    expect(s.autoPolish).toBe(false);
    expect(s.polishPrompt).toBe(DEFAULT_POLISH_PROMPT);
    expect(s.saveSource).toBe(false);
  });

  it('empty blob is a no-op', () => {
    useVoiceStore.getState().hydrate({});
    const s = useVoiceStore.getState();
    expect(s.polishPrompt).toBe(DEFAULT_POLISH_PROMPT);
    expect(s.autoPolish).toBe(true);
  });
});

describe('PERSIST_KEYS_VOICE', () => {
  it('declares exactly the fields that voiceStore owns', () => {
    // Drift here = silent data loss (a field changes in memory but is never
    // written to the settings:all blob). Lock the contract.
    expect([...PERSIST_KEYS_VOICE]).toEqual([
      'polishPrompt',
      'autoPolish',
      'saveSource',
      'sourceDir',
      'globalHotkey',
    ]);
  });
});
