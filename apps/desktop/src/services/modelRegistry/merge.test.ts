import { describe, it, expect } from 'vitest';
import {
  mergeProviderModelsWithRegistry,
  isVisionModel,
  isReasoningModel,
  isWebSearchModel,
  isFunctionCallingModel,
  hasCapability,
} from './merge';
import type { Model } from './types';

function model(partial: Partial<Model> & Pick<Model, 'id'>): Model {
  return {
    providerId: 'test-provider',
    capabilities: [],
    inputModalities: ['text'],
    ...partial,
  };
}

describe('mergeProviderModelsWithRegistry', () => {
  const catalog: Model[] = [
    model({ id: 'gpt-4o', capabilities: ['vision', 'reasoning'], pricing: { inputPerMtok: 2.5 } }),
    model({ id: 'gpt-4o-mini', capabilities: ['vision'] }),
    model({ id: 'o1-preview', capabilities: ['reasoning', 'function-call'] }),
  ];

  it('enriches remote ids found in catalog', () => {
    const out = mergeProviderModelsWithRegistry(['gpt-4o', 'gpt-4o-mini'], catalog, 'openai');
    expect(out).toHaveLength(2);
    expect(out[0].capabilities).toEqual(['vision', 'reasoning']);
    expect(out[0].pricing?.inputPerMtok).toBe(2.5);
    expect(out[1].capabilities).toEqual(['vision']);
  });

  it('synthesizes minimal Model when remote id not in catalog', () => {
    const out = mergeProviderModelsWithRegistry(['newly-released-model'], catalog, 'openai');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('newly-released-model');
    expect(out[0].capabilities).toEqual([]);
    expect(out[0].pricing).toBeUndefined();
  });

  it('omits catalog entries not in remote list', () => {
    const out = mergeProviderModelsWithRegistry(['gpt-4o'], catalog, 'openai');
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('gpt-4o');
  });

  it('handles empty remote list', () => {
    expect(mergeProviderModelsWithRegistry([], catalog, 'openai')).toEqual([]);
  });

  it('handles all-remote-missing-from-catalog', () => {
    const out = mergeProviderModelsWithRegistry(['x', 'y', 'z'], [], 'openai');
    expect(out).toHaveLength(3);
    expect(out.every((m) => m.capabilities.length === 0)).toBe(true);
  });

  it('preserves remote order even when catalog order differs', () => {
    const out = mergeProviderModelsWithRegistry(['o1-preview', 'gpt-4o', 'gpt-4o-mini'], catalog, 'openai');
    expect(out.map((m) => m.id)).toEqual(['o1-preview', 'gpt-4o', 'gpt-4o-mini']);
  });

  it('remote id appearing twice stays twice (no dedup)', () => {
    const out = mergeProviderModelsWithRegistry(['gpt-4o', 'gpt-4o'], catalog, 'openai');
    expect(out).toHaveLength(2);
  });
});

describe('capability functions', () => {
  describe('isVisionModel', () => {
    it('true when vision capability present', () => {
      expect(isVisionModel(model({ id: 'x', capabilities: ['vision'] }))).toBe(true);
    });
    it('true when inputModalities includes image (even without capability)', () => {
      expect(isVisionModel(model({ id: 'x', capabilities: [], inputModalities: ['text', 'image'] }))).toBe(true);
    });
    it('false when neither', () => {
      expect(isVisionModel(model({ id: 'x', capabilities: [], inputModalities: ['text'] }))).toBe(false);
    });
  });

  describe('isReasoningModel', () => {
    it('true when reasoning capability', () => {
      expect(isReasoningModel(model({ id: 'x', capabilities: ['reasoning'] }))).toBe(true);
    });
    it('false otherwise', () => {
      expect(isReasoningModel(model({ id: 'x', capabilities: ['vision'] }))).toBe(false);
    });
  });

  describe('isWebSearchModel', () => {
    it('true when web-search capability', () => {
      expect(isWebSearchModel(model({ id: 'x', capabilities: ['web-search'] }))).toBe(true);
    });
    it('false otherwise', () => {
      expect(isWebSearchModel(model({ id: 'x', capabilities: [] }))).toBe(false);
    });
  });

  describe('isFunctionCallingModel', () => {
    it('true when function-call capability', () => {
      expect(isFunctionCallingModel(model({ id: 'x', capabilities: ['function-call'] }))).toBe(true);
    });
    it('false otherwise', () => {
      expect(isFunctionCallingModel(model({ id: 'x', capabilities: [] }))).toBe(false);
    });
  });

  describe('hasCapability', () => {
    it('true when capability present', () => {
      expect(hasCapability(model({ id: 'x', capabilities: ['vision', 'reasoning'] }), 'vision')).toBe(true);
      expect(hasCapability(model({ id: 'x', capabilities: ['vision', 'reasoning'] }), 'reasoning')).toBe(true);
    });
    it('false when capability missing', () => {
      expect(hasCapability(model({ id: 'x', capabilities: ['vision'] }), 'reasoning')).toBe(false);
    });
  });
});

// Table-driven: a matrix of capability/modality → function expectation.
describe('capability function matrix', () => {
  const cases: Array<{
    name: string;
    caps: Model['capabilities'];
    modalities?: string[];
    expectVision: boolean;
    expectReasoning: boolean;
    expectWeb: boolean;
    expectFn: boolean;
  }> = [
    { name: 'text-only chat', caps: [], modalities: ['text'], expectVision: false, expectReasoning: false, expectWeb: false, expectFn: false },
    { name: 'vision via cap', caps: ['vision'], modalities: ['text'], expectVision: true, expectReasoning: false, expectWeb: false, expectFn: false },
    { name: 'vision via modality', caps: [], modalities: ['text', 'image'], expectVision: true, expectReasoning: false, expectWeb: false, expectFn: false },
    { name: 'reasoning', caps: ['reasoning'], expectVision: false, expectReasoning: true, expectWeb: false, expectFn: false },
    { name: 'web search', caps: ['web-search'], expectVision: false, expectReasoning: false, expectWeb: true, expectFn: false },
    { name: 'function call', caps: ['function-call'], expectVision: false, expectReasoning: false, expectWeb: false, expectFn: true },
    { name: 'all caps', caps: ['vision', 'reasoning', 'web-search', 'function-call'], modalities: ['text', 'image'], expectVision: true, expectReasoning: true, expectWeb: true, expectFn: true },
  ];

  for (const c of cases) {
    it(`${c.name}: caps=${JSON.stringify(c.caps)} modalities=${JSON.stringify(c.modalities ?? ['text'])}`, () => {
      const m = model({ id: 'x', capabilities: c.caps, inputModalities: c.modalities ?? ['text'] });
      expect(isVisionModel(m)).toBe(c.expectVision);
      expect(isReasoningModel(m)).toBe(c.expectReasoning);
      expect(isWebSearchModel(m)).toBe(c.expectWeb);
      expect(isFunctionCallingModel(m)).toBe(c.expectFn);
    });
  }
});
