import { describe, it, expect, beforeEach } from 'vitest';
import { CliAdapterRegistry, registerBuiltinAdapters } from './registry';
import { ClaudeAdapter } from './claudeAdapter';

describe('CliAdapterRegistry singleton', () => {
  it('returns the same instance across calls', () => {
    const a = CliAdapterRegistry.getInstance();
    const b = CliAdapterRegistry.getInstance();
    expect(a).toBe(b);
  });
});

describe('CliAdapterRegistry.register / create', () => {
  let registry: CliAdapterRegistry;

  beforeEach(() => {
    // Use a fresh instance by calling getInstance (singleton state persists
    // across tests; we register under unique ids to avoid collisions).
    registry = CliAdapterRegistry.getInstance();
  });

  it('creates an adapter from a registered factory', () => {
    registry.register('test-factory', () => new ClaudeAdapter());
    const adapter = registry.create('test-factory');
    expect(adapter.id).toBe('claude');
  });

  it('throws when creating an unregistered id', () => {
    expect(() => registry.create('does-not-exist')).toThrow(/not found/i);
  });
});

describe('CliAdapterRegistry.getAll', () => {
  it('returns id, displayName, description for each registered adapter', () => {
    const registry = CliAdapterRegistry.getInstance();
    registry.register('desc-test', () => new ClaudeAdapter());
    const all = registry.getAll();
    const entry = all.find((x) => x.id === 'desc-test');
    expect(entry).toBeDefined();
    expect(entry?.displayName).toBe('Claude Code');
    expect(entry?.description).toContain('Anthropic');
  });
});

describe('registerBuiltinAdapters', () => {
  it('registers the "claude" adapter', () => {
    registerBuiltinAdapters();
    const registry = CliAdapterRegistry.getInstance();
    const adapter = registry.create('claude');
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
  });
});

describe('ClaudeAdapter lifecycle (no spawn)', () => {
  it('starts with config and is not running until send', async () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.isRunning()).toBe(false);
    await adapter.start({ cliPath: 'claude', workingDir: '/tmp' });
    expect(adapter.isRunning()).toBe(false);
  });

  it('stop clears running flag', async () => {
    const adapter = new ClaudeAdapter();
    await adapter.start({ cliPath: 'claude', workingDir: '/tmp' });
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  it('send throws if not started', async () => {
    const adapter = new ClaudeAdapter();
    await expect(adapter.send('hi')).rejects.toThrow(/not started/i);
  });
});

describe('ClaudeAdapter event bus', () => {
  it('delivers events to registered handlers and removes them on offEvent', () => {
    const adapter = new ClaudeAdapter();
    const received: string[] = [];
    const handler = (e: { type: string }) => received.push(e.type);
    adapter.onEvent(handler);
    // Emit is protected; use a subclass trick to access it.
    (adapter as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'text' });
    (adapter as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'done' });
    expect(received).toEqual(['text', 'done']);
    adapter.offEvent(handler);
    (adapter as unknown as { emit: (e: { type: string }) => void }).emit({ type: 'error' });
    expect(received).toEqual(['text', 'done']);
  });
});
