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

  it('exposes a home-relative settingsFilePath + settingsFileTemplate per adapter', () => {
    const all = listAdapters();
    for (const a of all) {
      expect(a.settingsFilePath.startsWith('~')).toBe(true);
      expect(a.settingsFileTemplate.length).toBeGreaterThan(0);
    }
    const claude = all.find((a) => a.id === 'claude')!;
    expect(claude.settingsFilePath).toBe('~/.claude/settings.json');
    // Claude Code settings.json is a free-form object; `{}` is a valid starting point.
    expect(claude.settingsFileTemplate.trim()).toBe('{}');

    const pi = all.find((a) => a.id === 'pi')!;
    expect(pi.settingsFilePath).toBe('~/.pi/agent/models.json');
    // pi models.json shape: {"providers": {}} — minimal valid catalog.
    expect(JSON.parse(pi.settingsFileTemplate)).toEqual({ providers: {} });
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
