import { describe, it, expect } from 'vitest';
import { extractLastJsonFence } from './extractLastJsonFence';

describe('extractLastJsonFence', () => {
  it('returns null when there is no json fence', () => {
    expect(extractLastJsonFence('just plain text, no fence')).toBeNull();
    expect(extractLastJsonFence('')).toBeNull();
  });

  it('returns null for non-json code fences', () => {
    const text = 'Here is some code:\n```ts\nconst x = 1;\n```\n';
    expect(extractLastJsonFence(text)).toBeNull();
  });

  it('extracts the contents of a single json fence', () => {
    const text = 'Here is the template:\n```json\n{"id":"a","name":"A"}\n```\n';
    expect(extractLastJsonFence(text)).toBe('{"id":"a","name":"A"}\n');
  });

  it('returns the LAST fence when multiple json fences exist', () => {
    const text =
      'Draft:\n```json\n{"id":"draft1"}\n```\n' +
      'Refined:\n```json\n{"id":"final"}\n```\n';
    expect(extractLastJsonFence(text)).toBe('{"id":"final"}\n');
  });

  it('still extracts when JSON inside the fence is malformed', () => {
    const text = '```json\n{not valid json\n```\n';
    expect(extractLastJsonFence(text)).toBe('{not valid json\n');
  });

  it('handles json fence with extra whitespace and no trailing newline', () => {
    const text = '```json\n   {"id":"x"}   ```';
    expect(extractLastJsonFence(text)).toBe('   {"id":"x"}   ');
  });

  it('does not match a fence that mentions json in prose but has no fence', () => {
    expect(extractLastJsonFence('I will return json now.')).toBeNull();
  });

  it('does not match a ts fence that contains the word json', () => {
    const text = '```ts\n// json-like\nconst x = 1;\n```';
    expect(extractLastJsonFence(text)).toBeNull();
  });
});
