import { describe, it, expect } from 'vitest';
import { createAdapter, listAdapters } from './registry';
import { ClaudeAdapter } from './claudeAdapter';
import { PiAdapter } from './piAdapter';

describe('listAdapters', () => {
  it('includes the built-in "claude" adapter with display metadata', () => {
    const all = listAdapters();
    const claude = all.find((a) => a.id === 'claude');
    expect(claude).toBeDefined();
    expect(claude?.displayName).toBe('Claude Code');
    expect(claude?.description).toContain('Anthropic');
  });

  it('includes the built-in "pi" adapter with display metadata', () => {
    const pi = listAdapters().find((a) => a.id === 'pi');
    expect(pi).toBeDefined();
    expect(pi?.displayName).toBe('Pi');
    expect(pi?.description.length).toBeGreaterThan(0);
  });
});

describe('createAdapter', () => {
  it('returns a ClaudeAdapter for "claude"', () => {
    const adapter = createAdapter('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
    expect(adapter.id).toBe('claude');
  });

  it('returns a PiAdapter for "pi"', () => {
    const adapter = createAdapter('pi');
    expect(adapter).toBeInstanceOf(PiAdapter);
    expect(adapter.id).toBe('pi');
  });

  it('throws for an unknown id', () => {
    expect(() => createAdapter('does-not-exist')).toThrow(/not found/i);
  });
});
