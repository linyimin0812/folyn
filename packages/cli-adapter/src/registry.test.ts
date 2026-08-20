import { describe, it, expect } from 'vitest';
import { createAdapter, listAdapters } from './registry';
import { ClaudeAdapter } from './claudeAdapter';
import { OpencodeAdapter } from './opencodeAdapter';
import { PiAdapter } from './piAdapter';
import { QoderAdapter } from './qoderAdapter';

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

  it('includes "qoder" (intl) and "qoder-cn" (China) with distinct settings paths', () => {
    const all = listAdapters();
    const intl = all.find((a) => a.id === 'qoder');
    const cn = all.find((a) => a.id === 'qoder-cn');
    expect(intl).toBeDefined();
    expect(cn).toBeDefined();
    expect(intl?.displayName).toBe('Qoder');
    expect(cn?.displayName).toBe('Qoder (China)');
    expect(intl?.settingsFilePath).toBe('~/.qoder/settings.json');
    expect(cn?.settingsFilePath).toBe('~/.qodercn/settings.json');
  });

  it('includes "opencode" with jsonc settings path + schema template', () => {
    const oc = listAdapters().find((a) => a.id === 'opencode');
    expect(oc).toBeDefined();
    expect(oc?.displayName).toBe('opencode');
    expect(oc?.settingsFilePath).toBe('~/.config/opencode/opencode.jsonc');
    // ponytail: template carries the $schema line so editors validate the
    // user's config out of the box (opencode boots fine with just this).
    expect(oc?.settingsFileTemplate).toContain('"$schema": "https://opencode.ai/config.json"');
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

  it('returns a QoderAdapter for "qoder" (intl) and "qoder-cn" (China)', () => {
    const intl = createAdapter('qoder');
    expect(intl).toBeInstanceOf(QoderAdapter);
    expect(intl.id).toBe('qoder');

    const cn = createAdapter('qoder-cn');
    expect(cn).toBeInstanceOf(QoderAdapter);
    expect(cn.id).toBe('qoder-cn');
  });

  it('returns an OpencodeAdapter for "opencode"', () => {
    const adapter = createAdapter('opencode');
    expect(adapter).toBeInstanceOf(OpencodeAdapter);
    expect(adapter.id).toBe('opencode');
  });

  it('throws for an unknown id', () => {
    expect(() => createAdapter('does-not-exist')).toThrow(/not found/i);
  });
});
