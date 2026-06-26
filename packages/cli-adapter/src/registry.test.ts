import { describe, it, expect, beforeEach } from 'vitest';
import type { CliAdapter } from './types';
import { CliAdapterRegistry, registerBuiltinAdapters } from './registry';
import { ClaudeAdapter } from './claudeAdapter';

/** Minimal fake adapter so registry tests don't depend on ClaudeAdapter behavior. */
function makeFakeAdapter(
  id: string,
  displayName = `Fake ${id}`,
  description = `Fake description ${id}`,
): CliAdapter {
  return {
    id,
    displayName,
    description,
    start: async () => {},
    send: async () => {},
    stop: async () => {},
    isRunning: () => false,
    onEvent: () => {},
    offEvent: () => {},
  };
}

describe('CliAdapterRegistry singleton', () => {
  it('returns the same instance across calls', () => {
    expect(CliAdapterRegistry.getInstance()).toBe(CliAdapterRegistry.getInstance());
  });
});

describe('CliAdapterRegistry.register / create', () => {
  let registry: CliAdapterRegistry;

  beforeEach(() => {
    registry = CliAdapterRegistry.getInstance();
  });

  it('create returns the adapter produced by the registered factory', () => {
    const fake = makeFakeAdapter('fake-1');
    registry.register('fake-1', () => fake);
    expect(registry.create('fake-1')).toBe(fake);
  });

  it('create returns a fresh instance each time the factory runs', () => {
    let calls = 0;
    registry.register('factory-counter', () => {
      calls += 1;
      return makeFakeAdapter(`c-${calls}`);
    });
    const first = registry.create('factory-counter');
    const second = registry.create('factory-counter');
    expect(first).not.toBe(second);
    expect(calls).toBe(2);
  });

  it('throws an error mentioning the id when the id is unregistered', () => {
    expect(() => registry.create('never-registered')).toThrow(/never-registered/);
    expect(() => registry.create('never-registered')).toThrow(/not found/i);
  });

  it('register overwrites a previous factory for the same id (last wins)', () => {
    registry.register('overwrite', () => makeFakeAdapter('first'));
    registry.register('overwrite', () => makeFakeAdapter('second'));
    expect(registry.create('overwrite').id).toBe('second');
  });
});

describe('CliAdapterRegistry.getAll', () => {
  let registry: CliAdapterRegistry;

  beforeEach(() => {
    registry = CliAdapterRegistry.getInstance();
  });

  it('returns an entry per registered adapter with id/displayName/description', () => {
    registry.register('desc-a', () => makeFakeAdapter('a', 'Display A', 'Desc A'));
    const all = registry.getAll();
    const entry = all.find((e) => e.id === 'desc-a');
    expect(entry).toBeDefined();
    expect(entry?.displayName).toBe('Display A');
    expect(entry?.description).toBe('Desc A');
  });

  it('reflects newly registered adapters after registration', () => {
    const before = registry.getAll().length;
    registry.register('desc-b', () => makeFakeAdapter('b'));
    expect(registry.getAll().length).toBe(before + 1);
  });
});

describe('registerBuiltinAdapters', () => {
  it('registers the "claude" adapter factory', () => {
    registerBuiltinAdapters();
    const registry = CliAdapterRegistry.getInstance();
    expect(registry.create('claude')).toBeInstanceOf(ClaudeAdapter);
  });

  it('is idempotent — calling twice does not remove the claude registration', () => {
    registerBuiltinAdapters();
    registerBuiltinAdapters();
    const registry = CliAdapterRegistry.getInstance();
    expect(registry.create('claude')).toBeInstanceOf(ClaudeAdapter);
  });
});
