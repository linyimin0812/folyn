import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { storageClient } from '@/utils/storageClient';
import { useAppearanceStore } from './appearanceStore';
import { useEditorPrefsStore } from './editorPrefsStore';
import { useVaultConfigStore } from './vaultConfigStore';
import { useAiConfigStore } from './aiConfigStore';
import { usePrefsStore, DEFAULT_SHORTCUTS } from './prefsStore';
import { usePetStore } from './petStore';
import { useScheduleStore } from './scheduleStore';
import { loadSettings, hydrateAllStores, persistNow } from './settingsPersistence';
import { PET_SIZE_VERSION } from '@/components/pet/petPosition';

beforeEach(() => {
  storageClient.__resetForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Reset every new store to its module defaults so a test starts clean. */
function resetAllDefaults() {
  useAppearanceStore.setState({
    theme: 'light', fontSize: 14, lineHeight: 1.7, showAiPanel: true,
    showStatusBar: true, showHiddenFiles: true, enableWikiPanel: true,
    enableClipsPanel: true, enableAnalyzePanel: true, enableDailyPanel: true,
    excludePatterns:
      'node_modules\n.git\n.DS_Store\ndist\n.next\n.quill-tmp\n__wiki__\n__clips__\n__reports__\n__daily__\n__study__\n__schedule__\n__analyze__',
    linkOpenMode: 'external', vaultName: 'my-vault',
  }, false);
  useEditorPrefsStore.setState({
    editorFont: 'DM Mono', editorFontSize: 13, tabSize: 4, wrapColumn: 80,
    showLineNumbers: true, syntaxHighlight: true, autoSave: true, spellCheck: false,
  }, false);
  useVaultConfigStore.setState({
    vaultPath: '~/Documents/quill/my-notes', imagePath: 'assets/images/',
    docExtension: '.md', watchFileChanges: true, trashOnDelete: true,
  }, false);
  useAiConfigStore.setState({
    cliAdapter: 'claude', cliPath: 'claude', chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-6', chatApiKey: '', chatBaseUrl: '',
  }, false);
  usePrefsStore.setState({
    dailyNotesDir: '__daily__', dailyNoteDateFormat: 'YYYY-MM-DD',
    fileTemplates: { md: '# {{title}}\n\n' }, shortcuts: [...DEFAULT_SHORTCUTS],
  }, false);
  usePetStore.setState({
    petModeEnabled: false, petPositionX: -1, petPositionY: -1,
    petPanelX: -1, petPanelY: -1, petPanelWidth: -1, petPanelHeight: -1,
    petPanelSizeVersion: 0, petPosVersion: 1, petIconSource: 'builtin',
    petIconPath: '', petSizeVersion: 0, petSize: '100', notificationForm: 'bubble',
  }, false);
}

describe('settingsPersistence round-trip', () => {
  beforeEach(resetAllDefaults);

  it('mutate → persist → reload restores every store', async () => {
    // Mutate a field in each store via the dedicated setter.
    useAppearanceStore.getState().setVaultName('rt-vault');
    useEditorPrefsStore.getState().setTabSize(2);
    useVaultConfigStore.getState().setDocExtension('.org');
    useAiConfigStore.getState().setChatModel('rt-model');
    usePrefsStore.getState().setDailyNoteDateFormat('DD/MM');
    usePetStore.getState().setPetSize('150');

    // Flush the debounced persist.
    vi.advanceTimersByTime(400);

    // Reload from storageClient into a fresh (reset) set of stores.
    resetAllDefaults();
    await loadSettings();

    expect(useAppearanceStore.getState().vaultName).toBe('rt-vault');
    expect(useEditorPrefsStore.getState().tabSize).toBe(2);
    expect(useVaultConfigStore.getState().docExtension).toBe('.org');
    expect(useAiConfigStore.getState().chatModel).toBe('rt-model');
    expect(usePrefsStore.getState().dailyNoteDateFormat).toBe('DD/MM');
    expect(usePetStore.getState().petSize).toBe('150');
  });

  it('missing fields keep defaults on load', async () => {
    // Persist only one field.
    useEditorPrefsStore.getState().setTabSize(8);
    vi.advanceTimersByTime(400);

    resetAllDefaults();
    await loadSettings();

    // The one mutated field round-trips.
    expect(useEditorPrefsStore.getState().tabSize).toBe(8);
    // Everything else stays at defaults.
    expect(useAppearanceStore.getState().vaultName).toBe('my-vault');
  });

  it('null blob (first launch) loads nothing without throwing', async () => {
    const blob = await loadSettings();
    expect(blob).toBeNull();
    // Stores stay at defaults.
    expect(useAppearanceStore.getState().theme).toBe('light');
  });
});

describe('settingsPersistence fan-out from legacy settings:all blob', () => {
  beforeEach(resetAllDefaults);

  it('dispatches a full legacy blob to the right stores', () => {
    // A blob shaped exactly like the legacy settingsStore would persist.
    const legacyBlob: Record<string, unknown> = {
      theme: 'dark',
      fontSize: 18,
      lineHeight: 2,
      showAiPanel: false,
      showStatusBar: false,
      showHiddenFiles: false,
      enableWikiPanel: false,
      enableClipsPanel: false,
      enableAnalyzePanel: false,
      enableDailyPanel: false,
      excludePatterns: 'node_modules\n__wiki__',
      linkOpenMode: 'internal',
      vaultName: 'legacy-vault',
      editorFont: 'JetBrains Mono',
      editorFontSize: 16,
      tabSize: 2,
      wrapColumn: 100,
      showLineNumbers: false,
      syntaxHighlight: false,
      autoSave: false,
      spellCheck: true,
      vaultPath: '/legacy/vault',
      imagePath: '/legacy/img',
      docExtension: '.txt',
      watchFileChanges: false,
      trashOnDelete: false,
      cliAdapter: 'gemini',
      cliPath: '/bin/gemini',
      chatProvider: 'openai',
      chatModel: 'gpt-4o',
      chatApiKey: 'sk-legacy',
      chatBaseUrl: 'https://api.legacy',
      dailyNotesDir: '__daily__',
      dailyNoteDateFormat: 'MM-DD',
      fileTemplates: { md: '# {{title}}\n' },
      shortcuts: DEFAULT_SHORTCUTS.map((s) => ({ ...s })),
      boardColumns: [
        { id: 'todo', name: '待办', color: 'var(--t3)' },
        { id: 'done', name: '已完成', color: 'var(--green)', isDone: true },
      ],
      petModeEnabled: true,
      petPositionX: 250,
      petPositionY: 350,
      petPanelX: 10,
      petPanelY: 20,
      petPanelWidth: 440,
      petPanelHeight: 620,
      petPanelSizeVersion: 1,
      petPosVersion: 1,
      petIconSource: 'custom',
      petIconPath: '/abs/pet.png',
      petSizeVersion: 3, // matches PET_SIZE_VERSION
      petSize: '150',
      notificationForm: 'corner',
    };

    hydrateAllStores(legacyBlob);

    // Appearance
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(useAppearanceStore.getState().fontSize).toBe(18);
    expect(useAppearanceStore.getState().showAiPanel).toBe(false);
    expect(useAppearanceStore.getState().linkOpenMode).toBe('internal');
    expect(useAppearanceStore.getState().vaultName).toBe('legacy-vault');
    // backfill applied
    expect(useAppearanceStore.getState().excludePatterns.split('\n')).toContain('__analyze__');

    // Editor prefs
    expect(useEditorPrefsStore.getState().editorFont).toBe('JetBrains Mono');
    expect(useEditorPrefsStore.getState().tabSize).toBe(2);
    expect(useEditorPrefsStore.getState().spellCheck).toBe(true);

    // Vault config
    expect(useVaultConfigStore.getState().vaultPath).toBe('/legacy/vault');
    expect(useVaultConfigStore.getState().docExtension).toBe('.txt');

    // AI config
    expect(useAiConfigStore.getState().cliAdapter).toBe('gemini');
    expect(useAiConfigStore.getState().chatProvider).toBe('openai');
    // ponytail: chatApiKey is now a flat mirror of providerSettings[chatProvider],
    // loaded by loadFromDisk() (not hydrate). The legacy flat key is migrated
    // to providerSettings.openai.apiKey on the next loadFromDisk() call.
    expect(useAiConfigStore.getState().chatApiKey).toBe('');

    // Prefs
    expect(usePrefsStore.getState().dailyNoteDateFormat).toBe('MM-DD');

    // Pet
    expect(usePetStore.getState().petModeEnabled).toBe(true);
    expect(usePetStore.getState().petPositionX).toBe(250);
    expect(usePetStore.getState().petIconSource).toBe('custom');
    expect(usePetStore.getState().petSize).toBe('150');
    expect(usePetStore.getState().notificationForm).toBe('corner');

    // scheduleStore boardColumns
    expect(useScheduleStore.getState().boardColumns.length).toBe(2);
    expect(useScheduleStore.getState().boardColumns[1].isDone).toBe(true);
  });

  it('applies every migration to a pre-split blob (old user restart = zero-perception)', () => {
    // A blob exactly as an old user's settingsStore would have written before
    // the split: pre-migration values that the hydrate path must fix up.
    const oldBlob: Record<string, unknown> = {
      theme: 'dark',
      excludePatterns: 'node_modules\n.git\n__wiki__', // missing later built-in dirs
      vaultName: 'old-vault',
      // dailyNotesDir at the pre-__daily__ default → must migrate to __daily__.
      dailyNotesDir: 'daily',
      // Shortcuts persisted before togglePetPanel was added → backfill appends it.
      shortcuts: DEFAULT_SHORTCUTS.filter((s) => s.id !== 'togglePetPanel').map((s) => ({ ...s })),
      // boardColumns missing an isDone column → falls back to defaults.
      boardColumns: [{ id: 'only', name: '只此一列', color: 'var(--t3)' }],
      // Pre-fix positions saved as PHYSICAL px (petPosVersion !== 1) → discard.
      petPosVersion: 0,
      petPositionX: 999,
      petPositionY: 888,
      petPanelX: 777,
      petPanelY: 666,
      // Pre-versioning pet size (mismatches PET_SIZE_VERSION) → discard pet pos.
      petSizeVersion: 0,
      // Invalid enum values → coerce to defaults.
      petIconSource: 'bogus',
      petIconPath: '/stale',
      petSize: 'enormous',
      notificationForm: 'bogus',
    };

    hydrateAllStores(oldBlob);

    // appearanceStore: backfill appended every missing built-in dir.
    const excludeLines = useAppearanceStore.getState().excludePatterns.split('\n');
    expect(excludeLines).toContain('__study__');
    expect(excludeLines).toContain('__schedule__');
    expect(excludeLines).toContain('__analyze__');
    expect(useAppearanceStore.getState().vaultName).toBe('old-vault');

    // prefsStore: dailyNotesDir migrated; togglePetPanel backfilled.
    expect(usePrefsStore.getState().dailyNotesDir).toBe('__daily__');
    const scIds = usePrefsStore.getState().shortcuts.map((s) => s.id);
    expect(scIds).toContain('togglePetPanel');
    expect(scIds.length).toBe(DEFAULT_SHORTCUTS.length);

    // scheduleStore: invalid boardColumns → DEFAULT_BOARD_COLUMNS with an isDone.
    const cols = useScheduleStore.getState().boardColumns;
    expect(cols.length).toBeGreaterThan(1);
    expect(cols.some((c) => c.isDone)).toBe(true);

    // petStore: stale physical-px positions discarded; invalid enums coerced.
    const pet = usePetStore.getState();
    expect(pet.petPositionX).toBe(-1);
    expect(pet.petPositionY).toBe(-1);
    expect(pet.petPanelX).toBe(-1);
    expect(pet.petPanelY).toBe(-1);
    expect(pet.petPosVersion).toBe(1);
    expect(pet.petSizeVersion).toBe(PET_SIZE_VERSION);
    expect(pet.petIconSource).toBe('builtin');
    expect(pet.petIconPath).toBe('');
    expect(['50', '75', '100', '125', '150']).toContain(pet.petSize);
    expect(pet.notificationForm).toBe('bubble');
  });
});

describe('settingsPersistence single writer', () => {
  beforeEach(resetAllDefaults);

  it('writes each slice to its own file via storageClient.set(slice.name, ...)', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAppearanceStore.getState().setVaultName('a');
    useEditorPrefsStore.getState().setTabSize(2);
    usePetStore.getState().setPetSize('150');
    vi.advanceTimersByTime(400);
    // One debounced flush → one storageClient.set call per slice.
    const calls = new Map(setSpy.mock.calls.map(([k, v]) => [k as string, v]));
    expect(calls.get('appearance')?.vaultName).toBe('a');
    expect(calls.get('editorPrefs')?.tabSize).toBe(2);
    expect(calls.get('pet')?.petSize).toBe('150');
    // Slices are isolated — appearance's payload carries no editorPrefs or pet keys.
    expect(calls.get('appearance')?.tabSize).toBeUndefined();
    expect(calls.get('editorPrefs')?.petSize).toBeUndefined();
    setSpy.mockRestore();
  });

  it('changing one appearance field writes only the appearance slice, not every slice', () => {
    // ponytail: per-slice persist closure — a setter in slice X must write
    // ONLY slice X's file. The old global schedulePersist() looped every
    // registered slice on every setter, so setVaultName('x') scheduled
    // storageClient.set for all 9 slices (appearance + prefs + editorPrefs
    // + pet + voice + vault + schedule + modelRegistry + aiConfig). The
    // bound closure cuts that to one. This test fails if the per-slice
    // persist contract regresses (e.g. someone reverts to a global loop).
    const setSpy = vi.spyOn(storageClient, 'set');
    useAppearanceStore.getState().setVaultName('solo');
    vi.advanceTimersByTime(400);
    const sliceNames = setSpy.mock.calls.map(([k]) => k as string);
    expect(sliceNames).toEqual(['appearance']);
    setSpy.mockRestore();
  });
});

describe('settingsPersistence flush-on-quit', () => {
  beforeEach(resetAllDefaults);

  it('persistNow writes through without waiting for the 300ms debounce', async () => {
    // Mutate a field WITHOUT advancing the debounce timer — simulates the
    // user changing a setting and quitting within 300ms.
    useAppearanceStore.getState().setVaultName('quit-flush');
    // persistNow must cancel the pending debounce + write to disk now.
    await persistNow();
    // Reset store + cache, reload — the value must round-trip even though
    // the 300ms debounce never fired.
    storageClient.__resetForTesting();
    useAppearanceStore.setState({ vaultName: 'my-vault' }, false);
    await loadSettings();
    expect(useAppearanceStore.getState().vaultName).toBe('quit-flush');
  });
});

