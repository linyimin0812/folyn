import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the store so the test doesn't pull in the heavy module graph
// (provider catalog → open-color JSON) which fails under Node ESM strict
// mode without a json import attribute. We only need getFeatureAdapter +
// useAiConfigStore.getState; both are stubbed here.
const storeState = { cliAdapter: 'claude', featureCliAdapter: {} as Record<string, string> };
vi.mock('@/store/aiConfigStore', () => ({
  useAiConfigStore: { getState: () => storeState },
  getFeatureAdapter: (feature: string) => storeState.featureCliAdapter[feature] || storeState.cliAdapter,
}));

// Mock the adapter factory so no real adapter is constructed.
vi.mock('@mochi/cli-adapter', () => {
  const adapters = new Map<string, { id: string }>();
  return {
    createAdapter: (id: string) => {
      let a = adapters.get(id);
      if (!a) { a = { id }; adapters.set(id, a); }
      return a;
    },
  };
});

// Import AFTER vi.mock so the mocked modules are used.
const { getAdapterForSession, sessionAdapters } = await import('./adapterManager');

describe('getAdapterForSession', () => {
  beforeEach(() => {
    sessionAdapters.clear();
    storeState.cliAdapter = 'claude';
    storeState.featureCliAdapter = {};
  });

  it('uses global cliAdapter when no feature is provided', () => {
    const a = getAdapterForSession('s1');
    expect(a.id).toBe('claude');
  });

  it('uses feature-specific override when feature is provided', () => {
    storeState.featureCliAdapter = { wiki: 'pi' };
    const a = getAdapterForSession('s1', 'wiki');
    expect(a.id).toBe('pi');
  });

  it('falls back to global when feature has no override', () => {
    const a = getAdapterForSession('s1', 'wiki');
    expect(a.id).toBe('claude');
  });

  it('invalidates cached adapter when feature adapter changes', () => {
    const first = getAdapterForSession('s1', 'wiki');
    expect(first.id).toBe('claude');
    storeState.featureCliAdapter = { wiki: 'pi' };
    const second = getAdapterForSession('s1', 'wiki');
    expect(second.id).toBe('pi');
  });
});
