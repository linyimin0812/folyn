import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAiConfigStore, PERSIST_KEYS_AI_CONFIG, type ChatProvider } from './aiConfigStore';
import { storageClient } from '@/utils/storageClient';
import { providerConfigStorage } from '@/services/providers/providerConfigStorage';
import { PROVIDER_CATALOG, PROVIDER_IDS } from '@/services/providers/catalog';
import { rename, writeTextFile, exists, readTextFile } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';

const PROVIDER_CONFIG_MIGRATED_KEY = 'providerConfigMigratedV1';
const SETTINGS_STORAGE_KEY = 'settings:all';

// In-memory fs mock — `homeDir`/`appDataDir`/`join`/`exists`/`mkdir`/
// `readTextFile`/`writeTextFile`/`rename` all route through this Map.
const FS: Map<string, string> = new Map();
const FAKE_HOME = '/tmp/test-home';
const FAKE_APPDATA = '/tmp/test-appdata';

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => FAKE_HOME),
  appDataDir: vi.fn(async () => FAKE_APPDATA),
  join: vi.fn(async (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/+/g, '/')),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(async (p: string) => FS.has(p)),
  mkdir: vi.fn(async () => {}),
  readTextFile: vi.fn(async (p: string) => {
    if (!FS.has(p)) throw new Error(`ENOENT: ${p}`);
    return FS.get(p)!;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => { FS.set(p, c); }),
  rename: vi.fn(async (from: string, to: string) => {
    if (!FS.has(from)) throw new Error(`ENOENT: ${from}`);
    FS.set(to, FS.get(from)!);
    FS.delete(from);
  }),
}));

beforeEach(() => {
  storageClient.__resetForTesting();
  providerConfigStorage.__resetForTesting();
  FS.clear();
  vi.useFakeTimers();
  useAiConfigStore.setState({
    cliAdapter: 'claude',
    cliPath: 'claude',
    cliPaths: {},
    chatProvider: 'anthropic',
    chatModel: 'claude-sonnet-4-6',
    chatApiKey: '',
    chatBaseUrl: '',
    chatAzureDeploymentId: '',
    chatAzureApiVersion: '',
    chatThinkingBudget: 1024,
    customerProviders: {},
    providerSettings: {},
    manualModels: {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAiConfigStore setters', () => {
  it('setChatModel updates + persists', () => {
    const setSpy = vi.spyOn(storageClient, 'set');
    useAiConfigStore.getState().setChatModel('gpt-4o');
    expect(useAiConfigStore.getState().chatModel).toBe('gpt-4o');
    vi.advanceTimersByTime(400);
    const payload = setSpy.mock.calls[setSpy.mock.calls.length - 1][1] as Record<string, unknown>;
    expect(payload.chatModel).toBe('gpt-4o');
    setSpy.mockRestore();
  });

  it('setChatProvider updates', () => {
    useAiConfigStore.getState().setChatProvider('openai');
    expect(useAiConfigStore.getState().chatProvider).toBe('openai');
  });

  it('setChatApiKey updates', () => {
    useAiConfigStore.getState().setChatApiKey('sk-xxx');
    expect(useAiConfigStore.getState().chatApiKey).toBe('sk-xxx');
  });

  it('setChatAzureDeploymentId updates in-memory mirror + providerSettings extra', () => {
    useAiConfigStore.getState().setChatAzureDeploymentId('my-deploy');
    const s = useAiConfigStore.getState();
    expect(s.chatAzureDeploymentId).toBe('my-deploy');
    expect(s.providerSettings.anthropic?.extra.azureDeploymentId).toBe('my-deploy');
  });

  it('setChatAzureApiVersion updates', () => {
    useAiConfigStore.getState().setChatAzureApiVersion('2024-10-21');
    expect(useAiConfigStore.getState().chatAzureApiVersion).toBe('2024-10-21');
    expect(useAiConfigStore.getState().providerSettings.anthropic?.extra.azureApiVersion).toBe('2024-10-21');
  });

  it('setChatThinkingBudget updates', () => {
    useAiConfigStore.getState().setChatThinkingBudget(2048);
    expect(useAiConfigStore.getState().chatThinkingBudget).toBe(2048);
    expect(useAiConfigStore.getState().providerSettings.anthropic?.extra.thinkingBudget).toBe(2048);
    useAiConfigStore.getState().setChatThinkingBudget(null);
    expect(useAiConfigStore.getState().chatThinkingBudget).toBeNull();
  });
});

describe('useAiConfigStore.hydrate', () => {
  it('applies non-provider fields from the blob', () => {
    useAiConfigStore.getState().hydrate({
      cliAdapter: 'gemini',
      cliPath: '/usr/local/bin/gemini',
      chatProvider: 'openai',
      chatModel: 'gpt-4o',
    });
    const s = useAiConfigStore.getState();
    expect(s.cliAdapter).toBe('gemini');
    expect(s.cliPath).toBe('/usr/local/bin/gemini');
    expect(s.chatProvider).toBe('openai');
    expect(s.chatModel).toBe('gpt-4o');
  });

  it('coerces invalid chatProvider to default (keeps anthropic)', () => {
    useAiConfigStore.getState().hydrate({ chatProvider: 'bogus' });
    expect(useAiConfigStore.getState().chatProvider).toBe('anthropic');
  });

  it('missing fields keep defaults', () => {
    useAiConfigStore.getState().hydrate({ chatModel: 'gpt-4' });
    expect(useAiConfigStore.getState().cliAdapter).toBe('claude');
    expect(useAiConfigStore.getState().chatModel).toBe('gpt-4');
  });

  // The three old ids must hydrate verbatim, no migration.
  it('hydrates the three legacy ids verbatim', () => {
    for (const id of ['anthropic', 'openai', 'openai-compatible'] as const) {
      useAiConfigStore.setState({ chatProvider: 'anthropic' });
      useAiConfigStore.getState().hydrate({ chatProvider: id });
      expect(useAiConfigStore.getState().chatProvider).toBe(id);
    }
  });

  it.each(PROVIDER_CATALOG.map((p) => [p.id] as [string]))(
    'hydrates catalog id %s',
    (id) => {
      useAiConfigStore.setState({ chatProvider: 'anthropic' });
      useAiConfigStore.getState().hydrate({ chatProvider: id });
      expect(useAiConfigStore.getState().chatProvider).toBe(id as ChatProvider);
    },
  );

  it('PERSIST_KEYS_AI_CONFIG dropped legacy provider keys', () => {
    expect(PERSIST_KEYS_AI_CONFIG).not.toContain('providerConfigs');
    expect(PERSIST_KEYS_AI_CONFIG).not.toContain('customProviders');
    expect(PERSIST_KEYS_AI_CONFIG).not.toContain('enabledProviders');
    expect(PERSIST_KEYS_AI_CONFIG).not.toContain('chatApiKey');
    expect(PERSIST_KEYS_AI_CONFIG).not.toContain('chatAzureDeploymentId');
    expect(PERSIST_KEYS_AI_CONFIG).not.toContain('chatThinkingBudget');
  });

  it('PERSIST_KEYS_AI_CONFIG keeps manualModels', () => {
    expect(PERSIST_KEYS_AI_CONFIG).toContain('manualModels');
  });

  it('PROVIDER_IDS has 16 entries (14 rig + 2 compat)', () => {
    expect(PROVIDER_IDS).toHaveLength(16);
  });
});

// per-provider config slots (T06 reshaped): now providerSettings[id].
describe('useAiConfigStore per-provider config slots', () => {
  it('setChatApiKey writes into providerSettings[currentProvider]', () => {
    useAiConfigStore.getState().setChatApiKey('sk-abc');
    const s = useAiConfigStore.getState();
    expect(s.chatApiKey).toBe('sk-abc');
    expect(s.providerSettings.anthropic?.apiKey).toBe('sk-abc');
    expect(s.providerSettings.anthropic?.customProvider).toBe(false);
  });

  it('setChatProvider saves current slot, loads new slot', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    useAiConfigStore.getState().setChatProvider('openai');
    const afterSwitch = useAiConfigStore.getState();
    expect(afterSwitch.chatProvider).toBe('openai');
    expect(afterSwitch.providerSettings.anthropic?.apiKey).toBe('sk-anth');
    // New slot's flat mirror is empty (openai had no slot before)
    expect(afterSwitch.chatApiKey).toBe('');
  });

  it('switching back restores the saved slot', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    useAiConfigStore.getState().setChatBaseUrl('https://anthropic.example');
    useAiConfigStore.getState().setChatThinkingBudget(2048);
    useAiConfigStore.getState().setChatProvider('openai');
    useAiConfigStore.getState().setChatApiKey('sk-openai');
    useAiConfigStore.getState().setChatProvider('anthropic');
    const s = useAiConfigStore.getState();
    expect(s.chatApiKey).toBe('sk-anth');
    expect(s.chatBaseUrl).toBe('https://anthropic.example');
    expect(s.chatThinkingBudget).toBe(2048);
    expect(s.providerSettings.openai?.apiKey).toBe('sk-openai');
  });

  it('setChatThinkingBudget writes into the current slot extra', () => {
    useAiConfigStore.getState().setChatThinkingBudget(4096);
    expect(useAiConfigStore.getState().providerSettings.anthropic?.extra.thinkingBudget).toBe(4096);
  });

  it('configuredProviderIds returns providers with non-empty apiKey', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    useAiConfigStore.getState().setChatProvider('openai');
    useAiConfigStore.getState().setChatApiKey('sk-openai');
    const ids = useAiConfigStore.getState().configuredProviderIds();
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toHaveLength(2);
  });

  it('configuredProviderIds includes Ollama only when it has a slot or is current', () => {
    useAiConfigStore.getState().setChatApiKey('sk-anth');
    expect(useAiConfigStore.getState().configuredProviderIds()).toEqual(['anthropic']);
    useAiConfigStore.getState().setChatProvider('ollama');
    const ids = useAiConfigStore.getState().configuredProviderIds();
    expect(ids).toContain('ollama');
    expect(ids).toContain('anthropic');
  });
});

describe('useAiConfigStore.addSelectedModelId', () => {
  it('appends the id to providerSettings[id].selectedModelIds', () => {
    useAiConfigStore.getState().addSelectedModelId('anthropic', 'claude-sonnet-4-6');
    expect(useAiConfigStore.getState().providerSettings.anthropic?.selectedModelIds)
      .toEqual(['claude-sonnet-4-6']);
  });

  it('dedups on repeat select (preserves order)', () => {
    useAiConfigStore.getState().addSelectedModelId('anthropic', 'a');
    useAiConfigStore.getState().addSelectedModelId('anthropic', 'b');
    useAiConfigStore.getState().addSelectedModelId('anthropic', 'a');
    expect(useAiConfigStore.getState().providerSettings.anthropic?.selectedModelIds)
      .toEqual(['a', 'b']);
  });

  it('isolates per-provider (openai selection does not leak to anthropic)', () => {
    useAiConfigStore.getState().addSelectedModelId('anthropic', 'claude');
    useAiConfigStore.getState().addSelectedModelId('openai', 'gpt-4o');
    const s = useAiConfigStore.getState();
    expect(s.providerSettings.anthropic?.selectedModelIds).toEqual(['claude']);
    expect(s.providerSettings.openai?.selectedModelIds).toEqual(['gpt-4o']);
  });

  it('persists to ~/.quill/providers/settings.json', async () => {
    useAiConfigStore.getState().addSelectedModelId('anthropic', 'persisted-id');
    await providerConfigStorage.getProviderSettings();
    await providerConfigStorage.__flushForTesting();
    const base = await join(await homeDir(), '.quill', 'providers');
    const path = await join(base, 'settings.json');
    expect(await exists(path)).toBe(true);
    const onDisk = JSON.parse(await readTextFile(path));
    expect(onDisk.anthropic.selectedModelIds).toContain('persisted-id');
  });

  it('seeds customProvider=true for custom provider ids', () => {
    useAiConfigStore.getState().addCustomProvider({
      id: 'custom-1',
      name: 'C1',
      defaultChatEndpoint: 'anthropic-messages',
    });
    useAiConfigStore.getState().addSelectedModelId('custom-1', 'm1');
    expect(useAiConfigStore.getState().providerSettings['custom-1']?.customProvider)
      .toBe(true);
  });
});

describe('useAiConfigStore.removeSelectedModelId', () => {
  it('removes the middle id (preserves order, length drops by 1)', () => {
    const store = useAiConfigStore.getState();
    store.addSelectedModelId('anthropic', 'a');
    store.addSelectedModelId('anthropic', 'b');
    store.addSelectedModelId('anthropic', 'c');
    store.removeSelectedModelId('anthropic', 'b');
    expect(useAiConfigStore.getState().providerSettings.anthropic?.selectedModelIds)
      .toEqual(['a', 'c']);
  });

  it('no-ops on an absent id (list unchanged)', () => {
    const store = useAiConfigStore.getState();
    store.addSelectedModelId('anthropic', 'a');
    store.addSelectedModelId('anthropic', 'b');
    store.removeSelectedModelId('anthropic', 'not-there');
    expect(useAiConfigStore.getState().providerSettings.anthropic?.selectedModelIds)
      .toEqual(['a', 'b']);
  });

  it('isolates per-provider (removing from A does not touch B)', () => {
    const store = useAiConfigStore.getState();
    store.addSelectedModelId('anthropic', 'shared');
    store.addSelectedModelId('openai', 'shared');
    store.removeSelectedModelId('anthropic', 'shared');
    const s = useAiConfigStore.getState();
    expect(s.providerSettings.anthropic?.selectedModelIds).toEqual([]);
    expect(s.providerSettings.openai?.selectedModelIds).toEqual(['shared']);
  });

  it('persists removal to ~/.quill/providers/settings.json', async () => {
    const store = useAiConfigStore.getState();
    store.addSelectedModelId('anthropic', 'keep');
    store.addSelectedModelId('anthropic', 'drop');
    await providerConfigStorage.getProviderSettings();
    await providerConfigStorage.__flushForTesting();
    store.removeSelectedModelId('anthropic', 'drop');
    await providerConfigStorage.__flushForTesting();
    const base = await join(await homeDir(), '.quill', 'providers');
    const path = await join(base, 'settings.json');
    const onDisk = JSON.parse(await readTextFile(path));
    expect(onDisk.anthropic.selectedModelIds).toEqual(['keep']);
  });
});

describe('useAiConfigStore custom providers', () => {
  it('addCustomProvider creates an entry keyed by the supplied id', () => {
    const id = useAiConfigStore.getState().addCustomProvider({
      id: 'my-provider',
      name: 'My Provider',
      defaultChatEndpoint: 'openai-chat-completions',
    });
    expect(id).toBe('my-provider');
    const cp = useAiConfigStore.getState().customerProviders['my-provider'];
    expect(cp?.name).toBe('My Provider');
    expect(cp?.defaultChatEndpoint).toBe('openai-chat-completions');
  });

  it('addCustomProvider trims name; empty name defaults to "Custom"', () => {
    useAiConfigStore.getState().addCustomProvider({
      id: 'x',
      name: '  ',
      defaultChatEndpoint: 'openai-chat-completions',
    });
    expect(useAiConfigStore.getState().customerProviders.x?.name).toBe('Custom');
  });

  it('addCustomProvider seeds an empty settings entry with customProvider=true', () => {
    useAiConfigStore.getState().addCustomProvider({
      id: 'seeded',
      name: 'Seeded',
      defaultChatEndpoint: 'anthropic-messages',
    });
    const slot = useAiConfigStore.getState().providerSettings.seeded;
    expect(slot?.customProvider).toBe(true);
    expect(slot?.baseUrl).toBe('');
    expect(slot?.apiKey).toBe('');
    expect(slot?.selectedModelIds).toEqual([]);
  });

  it('addCustomProvider persists the def to ~/.quill/providers/customer/providers.json', async () => {
    useAiConfigStore.getState().addCustomProvider({
      id: 'disk-test',
      name: 'Disk',
      defaultChatEndpoint: 'openai-chat-completions',
    });
    // Drain microtasks so the void'd setCustomerProvider promise resolves
    // before we flush.
    await providerConfigStorage.getCustomerProviders();
    await providerConfigStorage.__flushForTesting();
    const base = await join(await homeDir(), '.quill', 'providers');
    const path = await join(base, 'customer', 'providers.json');
    expect(await exists(path)).toBe(true);
    const onDisk = JSON.parse(await readTextFile(path));
    expect(onDisk['disk-test']).toMatchObject({
      id: 'disk-test',
      name: 'Disk',
      defaultChatEndpoint: 'openai-chat-completions',
    });
  });

  it('updateCustomProvider patches fields without changing id', () => {
    useAiConfigStore.getState().addCustomProvider({
      id: 'u1',
      name: 'A',
      defaultChatEndpoint: 'openai-chat-completions',
    });
    useAiConfigStore.getState().updateCustomProvider('u1', { name: 'B' });
    const after = useAiConfigStore.getState().customerProviders.u1;
    expect(after?.name).toBe('B');
    expect(after?.id).toBe('u1');
  });

  it('removeCustomProvider deletes entry + settings slot', () => {
    useAiConfigStore.getState().addCustomProvider({
      id: 'r1',
      name: 'R1',
      defaultChatEndpoint: 'openai-chat-completions',
    });
    useAiConfigStore.getState().setProviderEnabled('r1', true);
    useAiConfigStore.getState().setChatProvider('r1' as ChatProvider);
    useAiConfigStore.getState().removeCustomProvider('r1');
    const s = useAiConfigStore.getState();
    expect(s.customerProviders.r1).toBeUndefined();
    expect(s.providerSettings.r1).toBeUndefined();
    // Removing the active chatProvider falls back to 'anthropic'.
    expect(s.chatProvider).toBe('anthropic');
  });

  it('removeCustomProvider is a no-op for an unknown id', () => {
    const before = Object.keys(useAiConfigStore.getState().customerProviders);
    useAiConfigStore.getState().removeCustomProvider('does-not-exist');
    expect(Object.keys(useAiConfigStore.getState().customerProviders)).toEqual(before);
  });

  it('setProviderEnabled toggles the flag in providerSettings[id].enabled', () => {
    useAiConfigStore.getState().setProviderEnabled('openai', true);
    expect(useAiConfigStore.getState().providerSettings.openai?.enabled).toBe(true);
    useAiConfigStore.getState().setProviderEnabled('openai', false);
    expect(useAiConfigStore.getState().providerSettings.openai?.enabled).toBe(false);
  });
});

describe('useAiConfigStore loadFromDisk migration', () => {
  it('returns empty state when no legacy blob and no disk files', async () => {
    await useAiConfigStore.getState().loadFromDisk();
    const s = useAiConfigStore.getState();
    expect(s.customerProviders).toEqual({});
    expect(s.providerSettings).toEqual({});
  });

  it('sets the migrated flag so subsequent loads skip migration', async () => {
    await useAiConfigStore.getState().loadFromDisk();
    const blob = await storageClient.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY);
    expect(blob?.[PROVIDER_CONFIG_MIGRATED_KEY]).toBe(true);
  });

  it('migrates legacy blob: writes new files + strips legacy keys from storage.json', async () => {
    // Seed storage.json with legacy provider config.
    await storageClient.set(SETTINGS_STORAGE_KEY, {
      chatProvider: 'openai',
      chatApiKey: 'sk-legacy',
      chatBaseUrl: 'https://legacy.example',
      customProviders: [{
        id: 'custom-1',
        displayName: 'C1',
        baseUrl: 'https://c1.example',
        apiKeyUrl: 'https://c1.example/keys',
        category: 'anthropic',
        createdAt: 1,
      }],
      enabledProviders: { 'custom-1': true, openai: true },
    });

    await useAiConfigStore.getState().loadFromDisk();
    const s = useAiConfigStore.getState();

    // Custom provider migrated to customerProviders with the new shape.
    expect(s.customerProviders['custom-1']).toMatchObject({
      id: 'custom-1',
      name: 'C1',
      defaultChatEndpoint: 'anthropic-messages',
      metadata: { website: { apiKey: 'https://c1.example/keys' } },
    });

    // Settings slot for the custom provider seeded with baseUrl + customProvider=true.
    expect(s.providerSettings['custom-1']).toMatchObject({
      id: 'custom-1',
      baseUrl: 'https://c1.example',
      enabled: true,
      customProvider: true,
    });

    // Bundled provider (openai) migrated with flat fields as top-level.
    expect(s.providerSettings.openai).toMatchObject({
      id: 'openai',
      apiKey: 'sk-legacy',
      baseUrl: 'https://legacy.example',
      enabled: true,
      customProvider: false,
    });

    // Legacy keys stripped from storage.json.
    const blob = await storageClient.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY);
    expect(blob?.customProviders).toBeUndefined();
    expect(blob?.enabledProviders).toBeUndefined();
    expect(blob?.chatApiKey).toBeUndefined();
    expect(blob?.[PROVIDER_CONFIG_MIGRATED_KEY]).toBe(true);

    // Files exist on disk.
    const base = await join(await homeDir(), '.quill', 'providers');
    expect(await exists(await join(base, 'customer', 'providers.json'))).toBe(true);
    expect(await exists(await join(base, 'settings.json'))).toBe(true);
  });

  it('does not re-migrate on second load (idempotent)', async () => {
    await storageClient.set(SETTINGS_STORAGE_KEY, {
      chatProvider: 'openai',
      customProviders: [{
        id: 'custom-1', displayName: 'C1', baseUrl: 'https://c1',
        apiKeyUrl: null, category: 'openai', createdAt: 1,
      }],
      enabledProviders: { 'custom-1': true },
    });
    await useAiConfigStore.getState().loadFromDisk();
    // Mutate disk after first migration to detect re-migration (which would
    // overwrite the mutation).
    await providerConfigStorage.__resetForTesting();
    // Re-read storage.json to get the post-migration blob.
    const blob = await storageClient.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY);
    expect(blob?.[PROVIDER_CONFIG_MIGRATED_KEY]).toBe(true);

    // Re-run — should skip migration entirely (legacy keys already gone).
    await useAiConfigStore.getState().loadFromDisk();
    const blob2 = await storageClient.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY);
    expect(blob2?.customProviders).toBeUndefined();
  });

  it('defensive migration: does not clobber existing disk data when flag is missing (Bug #2)', async () => {
    // Pre-seed ~/.quill/providers/settings.json with real user data.
    const realSlot = {
      id: 'anthropic',
      baseUrl: '',
      apiKey: 'sk-real',
      selectedModelIds: ['m1', 'm2'],
      enabled: false,
      customProvider: false,
      extra: {},
    };
    await providerConfigStorage.setProviderSettings('anthropic', realSlot);
    await providerConfigStorage.__flushForTesting();
    providerConfigStorage.__resetForTesting();

    // Empty legacy blob (no customProviders/providerConfigs/etc.) and no
    // migrated flag — simulates the state after a prior boot stripped the
    // flag via schedulePersist but left disk data intact.
    await storageClient.set(SETTINGS_STORAGE_KEY, { chatProvider: 'anthropic' });

    await useAiConfigStore.getState().loadFromDisk();

    // (a) On-disk settings file still has the real data (not overwritten
    //     with defaults).
    const diskSettings = await providerConfigStorage.getProviderSettings();
    expect(diskSettings.anthropic?.apiKey).toBe('sk-real');
    expect(diskSettings.anthropic?.selectedModelIds).toEqual(['m1', 'm2']);

    // (b) Migrated flag is set in storage.json so next boot skips migration.
    const blob = await storageClient.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY);
    expect(blob?.[PROVIDER_CONFIG_MIGRATED_KEY]).toBe(true);
  });
});

describe('per-adapter cliPath', () => {
  it('setCliPath writes the active cliPath AND cliPaths[active adapter]', () => {
    useAiConfigStore.getState().setCliPath('/usr/local/bin/claude');
    const s = useAiConfigStore.getState();
    expect(s.cliPath).toBe('/usr/local/bin/claude');
    expect(s.cliPaths.claude).toBe('/usr/local/bin/claude');
  });

  it('setCliAdapter swaps the active cliPath to the target adapter stored path', () => {
    useAiConfigStore.getState().setCliAdapter('pi');
    useAiConfigStore.getState().setCliPath('/Users/x/.nvm/.../bin/pi');
    expect(useAiConfigStore.getState().cliPath).toBe('/Users/x/.nvm/.../bin/pi');
    useAiConfigStore.getState().setCliAdapter('claude');
    expect(useAiConfigStore.getState().cliAdapter).toBe('claude');
    expect(useAiConfigStore.getState().cliPath).toBe('claude');
    useAiConfigStore.getState().setCliAdapter('pi');
    expect(useAiConfigStore.getState().cliPath).toBe('/Users/x/.nvm/.../bin/pi');
  });

  it('setCliAdapter preserves each adapter independently', () => {
    useAiConfigStore.getState().setCliAdapter('claude');
    useAiConfigStore.getState().setCliPath('/claude/bin');
    useAiConfigStore.getState().setCliAdapter('pi');
    useAiConfigStore.getState().setCliPath('/pi/bin');
    expect(useAiConfigStore.getState().cliPaths).toEqual({ claude: '/claude/bin', pi: '/pi/bin' });
    useAiConfigStore.getState().setCliAdapter('claude');
    expect(useAiConfigStore.getState().cliPath).toBe('/claude/bin');
    useAiConfigStore.getState().setCliAdapter('pi');
    expect(useAiConfigStore.getState().cliPath).toBe('/pi/bin');
  });

  it('hydrates a legacy single cliPath blob into cliPaths.claude', () => {
    useAiConfigStore.getState().hydrate({ cliPath: '/old/claude' });
    const s = useAiConfigStore.getState();
    expect(s.cliPath).toBe('/old/claude');
    expect(s.cliPaths.claude).toBe('/old/claude');
  });

  it('setCliPathFor writes a specific adapter slot and keeps the active mirror in sync', () => {
    useAiConfigStore.getState().setCliAdapter('pi');
    useAiConfigStore.getState().setCliPathFor('pi', '/pi/bin');
    expect(useAiConfigStore.getState().cliPaths.pi).toBe('/pi/bin');
    expect(useAiConfigStore.getState().cliPath).toBe('/pi/bin');
    useAiConfigStore.getState().setCliPathFor('claude', '/claude/bin');
    expect(useAiConfigStore.getState().cliPaths.claude).toBe('/claude/bin');
    expect(useAiConfigStore.getState().cliPath).toBe('/pi/bin');
  });
});

// Sanity: rename mock actually moves files so atomic-write works.
describe('providerConfigStorage atomic write (fs mock integration)', () => {
  it('writes to <path>.tmp then renames over the final path', async () => {
    const renameSpy = vi.mocked(rename);
    const writeSpy = vi.mocked(writeTextFile);
    await providerConfigStorage.setCustomerProvider({
      id: 'atomic',
      name: 'A',
      defaultChatEndpoint: 'openai-chat-completions',
    });
    await providerConfigStorage.__flushForTesting();
    const base = await join(await homeDir(), '.quill', 'providers');
    const finalPath = await join(base, 'customer', 'providers.json');
    // rename was called at least once with the .tmp → final move.
    const renameCalls = renameSpy.mock.calls.map((c) => `${c[0]} -> ${c[1]}`);
    expect(renameCalls.some((c) => c.includes('providers.json.tmp'))).toBe(true);
    expect(await exists(finalPath)).toBe(true);
    // mkdir was called to create the customer/ dir.
    expect(writeSpy).toHaveBeenCalled();
  });
});
