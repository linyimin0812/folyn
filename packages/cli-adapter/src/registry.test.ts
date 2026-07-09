import { describe, it, expect } from 'vitest';
import { createAdapter, listAdapters } from './registry';
import { ClaudeAdapter } from './claudeAdapter';

describe('listAdapters', () => {
  it('includes the built-in "claude" adapter with display metadata', () => {
    const all = listAdapters();
    const claude = all.find((a) => a.id === 'claude');
    expect(claude).toBeDefined();
    expect(claude?.displayName).toBe('Claude Code');
    expect(claude?.description).toContain('Anthropic');
  });
});

describe('createAdapter', () => {
  it('returns a ClaudeAdapter for "claude"', () => {
    const adapter = createAdapter('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
    expect(adapter.id).toBe('claude');
  });

  it('throws for an unknown id', () => {
    expect(() => createAdapter('does-not-exist')).toThrow(/not found/i);
  });
});
