import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppearanceStore, backfillBuiltinExcludePatterns } from './appearanceStore';
import { storageClient } from '@/utils/storageClient';
import { markSettingsHydrated } from './settingsPersistence';

beforeEach(() => {
  storageClient.__resetForTesting();
  markSettingsHydrated();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function resetAppearanceDefaults() {
  useAppearanceStore.setState({
    theme: 'light',
    fontFamily: 'Sora',
    fontSize: 14,
    lineHeight: 1.7,
    showAiPanel: true,
    showStatusBar: true,
    showHiddenFiles: true,
    enableWikiPanel: true,
    enableClipsPanel: true,
    enableAnalyzePanel: true,
    excludePatterns:
      'node_modules\n.git\n.DS_Store\ndist\n.next\n.folyn-tmp\n__wiki__\n__clips__\n__reports__\n__daily__\n__schedule__\n__analyze__',
    linkOpenMode: 'external',
    vaultName: 'my-vault',
  });
}

describe('useAppearanceStore setters', () => {
  beforeEach(resetAppearanceDefaults);

  it('toggleTheme flips light/dark', () => {
    useAppearanceStore.getState().toggleTheme();
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    useAppearanceStore.getState().toggleTheme();
    expect(useAppearanceStore.getState().theme).toBe('light');
  });

  it('toggleTheme persists the new theme', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAppearanceStore.getState().toggleTheme();
    vi.advanceTimersByTime(400);
    expect(setSpy).toHaveBeenCalledTimes(1);
    const payload = setSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.theme).toBe('dark');
    setSpy.mockRestore();
  });

  it('setTheme applies explicit theme + data attr', () => {
    useAppearanceStore.getState().setTheme('dark');
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('setTheme("system") resolves via matchMedia', () => {
    useAppearanceStore.getState().setTheme('system');
    expect(useAppearanceStore.getState().theme).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });

  it('setFontSize updates state + CSS variable', () => {
    useAppearanceStore.getState().setFontSize(20);
    expect(useAppearanceStore.getState().fontSize).toBe(20);
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('20px');
  });

  it('setFontFamily updates state + CSS variable', () => {
    useAppearanceStore.getState().setFontFamily('Inter');
    expect(useAppearanceStore.getState().fontFamily).toBe('Inter');
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe("'Inter', sans-serif");
  });

  it('setVaultName updates state', () => {
    useAppearanceStore.getState().setVaultName('custom');
    expect(useAppearanceStore.getState().vaultName).toBe('custom');
  });

  it('setShowAiPanel updates state and persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAppearanceStore.getState().setShowAiPanel(false);
    expect(useAppearanceStore.getState().showAiPanel).toBe(false);
    vi.advanceTimersByTime(400);
    expect(setSpy).toHaveBeenCalled();
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.showAiPanel).toBe(false);
    setSpy.mockRestore();
  });

  it('setEnableWikiPanel stamps enabledAt on false→true, clears on true→false', () => {
    vi.setSystemTime(new Date('2026-08-18T00:00:00Z'));
    useAppearanceStore.setState({ enableWikiPanel: false, enabledAtWiki: undefined });
    useAppearanceStore.getState().setEnableWikiPanel(true);
    expect(useAppearanceStore.getState().enableWikiPanel).toBe(true);
    expect(useAppearanceStore.getState().enabledAtWiki).toBe(Date.parse('2026-08-18T00:00:00Z'));
    // Toggling true→true is idempotent (no timestamp refresh)
    vi.setSystemTime(new Date('2026-08-18T01:00:00Z'));
    useAppearanceStore.getState().setEnableWikiPanel(true);
    expect(useAppearanceStore.getState().enabledAtWiki).toBe(Date.parse('2026-08-18T00:00:00Z'));
    // Toggling true→false clears
    useAppearanceStore.getState().setEnableWikiPanel(false);
    expect(useAppearanceStore.getState().enableWikiPanel).toBe(false);
    expect(useAppearanceStore.getState().enabledAtWiki).toBeUndefined();
  });
});

describe('useAppearanceStore.hydrate', () => {
  beforeEach(resetAppearanceDefaults);

  it('applies scalar fields from the blob', () => {
    useAppearanceStore.getState().hydrate({
      theme: 'dark',
      fontFamily: 'Inter',
      fontSize: 18,
      vaultName: 'hydrated',
      linkOpenMode: 'internal',
      showStatusBar: false,
    });
    const s = useAppearanceStore.getState();
    expect(s.theme).toBe('dark');
    expect(s.fontFamily).toBe('Inter');
    expect(s.fontSize).toBe(18);
    expect(s.vaultName).toBe('hydrated');
    expect(s.linkOpenMode).toBe('internal');
    expect(s.showStatusBar).toBe(false);
  });

  it('backfills excludePatterns with built-in dirs', () => {
    useAppearanceStore.getState().hydrate({ excludePatterns: 'node_modules\n__wiki__' });
    const lines = useAppearanceStore.getState().excludePatterns.split('\n');
    expect(lines).toContain('node_modules');
    expect(lines).toContain('__wiki__');
    expect(lines).toContain('__schedule__');
    expect(lines).toContain('__analyze__');
  });

  it('applies theme + font side effects', () => {
    useAppearanceStore.getState().hydrate({ theme: 'dark', fontFamily: 'Inter', fontSize: 22 });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--font-ui')).toBe("'Inter', sans-serif");
    expect(document.documentElement.style.getPropertyValue('--ui-font-size')).toBe('22px');
  });

  it('missing fields keep defaults', () => {
    useAppearanceStore.getState().hydrate({ theme: 'light' });
    expect(useAppearanceStore.getState().fontSize).toBe(14);
  });
});

describe('backfillBuiltinExcludePatterns', () => {
  const BUILTIN_DIRS = [
    '__wiki__',
    '__clips__',
    '__reports__',
    '__daily__',
    '__schedule__',
    '__analyze__',
  ];

  it('leaves an already-complete persisted value unchanged (no duplication)', () => {
    const raw = BUILTIN_DIRS.join('\n');
    expect(backfillBuiltinExcludePatterns(raw)).toBe(raw);
  });

  it('preserves user-defined custom patterns without duplicating them', () => {
    const result = backfillBuiltinExcludePatterns('node_modules\n__wiki__');
    const lines = result.split('\n');
    expect(lines).toContain('node_modules');
    expect(lines).toContain('__wiki__');
    for (const d of BUILTIN_DIRS) {
      expect(lines).toContain(d);
    }
    expect(lines.filter((l) => l === 'node_modules').length).toBe(1);
  });
});
