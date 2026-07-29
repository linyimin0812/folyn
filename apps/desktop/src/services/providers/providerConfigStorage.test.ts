import { describe, it, expect } from 'vitest';
import { migrateLegacyBlob } from './providerConfigStorage';
import type { CustomProvider, ProviderConfig, ManualModel } from '@/store/aiConfigStore';

describe('migrateLegacyBlob', () => {
  it('returns empty blobs for empty input', () => {
    const result = migrateLegacyBlob({});
    expect(result.customerProviders).toEqual({});
    expect(result.providerSettings).toEqual({});
  });

  it('migrates a custom provider: displayName→name, category→defaultChatEndpoint, apiKeyUrl→metadata.website.apiKey, baseUrl→settings', () => {
    const custom: CustomProvider[] = [{
      id: 'custom-abc',
      displayName: 'My Custom',
      baseUrl: 'https://my.api/v1',
      apiKeyUrl: 'https://my.api/keys',
      category: 'anthropic',
      createdAt: 1,
    }];
    const result = migrateLegacyBlob({ customProviders: custom });
    expect(result.customerProviders['custom-abc']).toEqual({
      id: 'custom-abc',
      name: 'My Custom',
      defaultChatEndpoint: 'anthropic-messages',
      metadata: { website: { apiKey: 'https://my.api/keys' } },
    });
    expect(result.providerSettings['custom-abc']).toMatchObject({
      id: 'custom-abc',
      baseUrl: 'https://my.api/v1',
      apiKey: '',
      enabled: false,
      customProvider: true,
    });
  });

  it('defensively coerces unknown category values to openai-chat-completions', () => {
    const custom = [{
      id: 'x', displayName: 'X', baseUrl: '', apiKeyUrl: null,
      category: 'openai-response', // legacy typo
      createdAt: 1,
    } as unknown as CustomProvider];
    const result = migrateLegacyBlob({ customProviders: custom });
    expect(result.customerProviders.x.defaultChatEndpoint).toBe('openai-responses');

    const unknown = [{
      id: 'y', displayName: 'Y', baseUrl: '', apiKeyUrl: null,
      category: 'some-bogus-value' as unknown as CustomProvider['category'],
      createdAt: 1,
    } as unknown as CustomProvider];
    const result2 = migrateLegacyBlob({ customProviders: unknown });
    expect(result2.customerProviders.y.defaultChatEndpoint).toBe('openai-chat-completions');
  });

  it('maps legacy category values to the right endpoint keys', () => {
    const cases: Array<[CustomProvider['category'], string]> = [
      ['openai', 'openai-chat-completions'],
      ['openai-responses', 'openai-responses'],
      ['gemini', 'google-generate-content'],
      ['anthropic', 'anthropic-messages'],
      ['azure-openai', 'openai-chat-completions'],
      ['new-api', 'openai-chat-completions'],
      ['ollama', 'ollama'],
    ];
    for (const [cat, expected] of cases) {
      const result = migrateLegacyBlob({
        customProviders: [{
          id: 'p', displayName: 'P', baseUrl: '', apiKeyUrl: null,
          category: cat, createdAt: 1,
        }],
      });
      expect(result.customerProviders.p.defaultChatEndpoint).toBe(expected);
    }
  });

  it('migrates bundled providerConfigs with azure fields packed into extra', () => {
    const cfg: ProviderConfig = {
      apiKey: 'sk-x',
      baseUrl: 'https://x',
      azureDeploymentId: 'dep-1',
      azureApiVersion: '2024-02-15',
      thinkingBudget: 2048,
    };
    const result = migrateLegacyBlob({ providerConfigs: { 'azure-openai': cfg } });
    const settings = result.providerSettings['azure-openai'];
    expect(settings).toMatchObject({
      id: 'azure-openai',
      apiKey: 'sk-x',
      baseUrl: 'https://x',
      enabled: false,
      customProvider: false,
    });
    expect(settings.extra).toEqual({
      azureDeploymentId: 'dep-1',
      azureApiVersion: '2024-02-15',
      thinkingBudget: 2048,
    });
  });

  it('skips empty azure fields when packing extra', () => {
    const cfg: ProviderConfig = {
      apiKey: 'k', baseUrl: '', azureDeploymentId: '',
      azureApiVersion: '', thinkingBudget: null,
    };
    const result = migrateLegacyBlob({ providerConfigs: { openai: cfg } });
    expect(result.providerSettings.openai.extra).toEqual({});
  });

  it('migrates manualModels to selectedModelIds per provider (id only)', () => {
    const mm: ManualModel[] = [
      { id: 'gpt-5', displayName: 'GPT-5', group: 'openai', createdAt: 1 },
      { id: 'gpt-4o', displayName: 'GPT-4o', group: 'openai', createdAt: 2 },
    ];
    const result = migrateLegacyBlob({ manualModels: { openai: mm } });
    expect(result.providerSettings.openai.selectedModelIds).toEqual(['gpt-5', 'gpt-4o']);
  });

  it('carries enabled flag from enabledProviders', () => {
    const result = migrateLegacyBlob({
      enabledProviders: { anthropic: true, openai: false },
    });
    expect(result.providerSettings.anthropic.enabled).toBe(true);
    expect(result.providerSettings.openai.enabled).toBe(false);
  });

  it('seeds a settings entry for enabled providers that had no config slot (e.g. Ollama)', () => {
    const result = migrateLegacyBlob({
      enabledProviders: { ollama: true },
    });
    expect(result.providerSettings.ollama).toMatchObject({
      id: 'ollama',
      baseUrl: '',
      apiKey: '',
      enabled: true,
      customProvider: false,
      selectedModelIds: [],
      extra: {},
    });
  });

  it('does not double-seed custom providers (config slot + custom def merge)', () => {
    const custom: CustomProvider[] = [{
      id: 'custom-1', displayName: 'C1', baseUrl: 'https://c1',
      apiKeyUrl: null, category: 'openai', createdAt: 1,
    }];
    const cfg: ProviderConfig = {
      apiKey: 'k', baseUrl: 'override', azureDeploymentId: '',
      azureApiVersion: '', thinkingBudget: null,
    };
    const result = migrateLegacyBlob({
      customProviders: custom,
      providerConfigs: { 'custom-1': cfg },
    });
    // Custom def seeds the entry; providerConfig's apiKey is merged in.
    expect(Object.keys(result.providerSettings)).toEqual(['custom-1']);
    expect(result.providerSettings['custom-1'].apiKey).toBe('k');
    expect(result.providerSettings['custom-1'].baseUrl).toBe('https://c1');
    expect(result.providerSettings['custom-1'].customProvider).toBe(true);
  });
});
