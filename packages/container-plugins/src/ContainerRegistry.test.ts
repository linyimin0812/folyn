import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerRegistry, registerBuiltinPlugins } from '../index';
import type { ContainerPlugin } from './ContainerPlugin';

function makePlugin(name: string, category: ContainerPlugin['category'] = 'custom'): ContainerPlugin {
  return {
    name,
    icon: '📍',
    label: name,
    category,
    component: () => null,
    template: `:::${name}\n\n:::`,
  };
}

describe('ContainerRegistry singleton', () => {
  it('returns the same instance across calls', () => {
    expect(ContainerRegistry.getInstance()).toBe(ContainerRegistry.getInstance());
  });
});

describe('ContainerRegistry.register / get / has / unregister', () => {
  let registry: ContainerRegistry;

  beforeEach(() => {
    registry = ContainerRegistry.getInstance();
    // Clean state: unregister any plugins we might register.
    for (const p of registry.getAll()) registry.unregister(p.name);
  });

  it('registers and retrieves a plugin by name', () => {
    const p = makePlugin('foo');
    registry.register(p);
    expect(registry.get('foo')).toBe(p);
    expect(registry.has('foo')).toBe(true);
  });

  it('returns undefined for unknown names', () => {
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
  });

  it('register replaces an existing plugin with the same name', () => {
    registry.register(makePlugin('dup'));
    const updated = makePlugin('dup');
    updated.label = 'Updated';
    registry.register(updated);
    expect(registry.get('dup')?.label).toBe('Updated');
  });

  it('unregister removes a plugin and returns true', () => {
    registry.register(makePlugin('bye'));
    expect(registry.unregister('bye')).toBe(true);
    expect(registry.has('bye')).toBe(false);
  });

  it('unregister returns false for unknown names', () => {
    expect(registry.unregister('never')).toBe(false);
  });
});

describe('ContainerRegistry.getAll / getByCategory / getCategories', () => {
  let registry: ContainerRegistry;

  beforeEach(() => {
    registry = ContainerRegistry.getInstance();
    for (const p of registry.getAll()) registry.unregister(p.name);
  });

  it('getAll returns all registered plugins', () => {
    registry.register(makePlugin('a'));
    registry.register(makePlugin('b'));
    expect(registry.getAll().map((p) => p.name).sort()).toEqual(['a', 'b']);
  });

  it('getByCategory filters by category', () => {
    registry.register(makePlugin('layout-1', 'layout'));
    registry.register(makePlugin('media-1', 'media'));
    registry.register(makePlugin('layout-2', 'layout'));
    expect(registry.getByCategory('layout').map((p) => p.name).sort()).toEqual(['layout-1', 'layout-2']);
  });

  it('getCategories returns unique categories with at least one plugin', () => {
    registry.register(makePlugin('a', 'layout'));
    registry.register(makePlugin('b', 'media'));
    registry.register(makePlugin('c', 'layout'));
    expect(registry.getCategories().sort()).toEqual(['layout', 'media']);
  });
});

describe('registerBuiltinPlugins', () => {
  it('registers the built-in plugin set (callout, tabs, mermaid, etc.)', () => {
    // Clean registry first.
    const registry = ContainerRegistry.getInstance();
    for (const p of registry.getAll()) registry.unregister(p.name);
    registerBuiltinPlugins();
    const names = registry.getAll().map((p) => p.name);
    expect(names).toContain('callout');
    expect(names).toContain('tabs');
    expect(names).toContain('tab');
    expect(names).toContain('mermaid');
    expect(names).toContain('card');
    expect(names).toContain('grid');
    expect(names).toContain('button');
    expect(names.length).toBeGreaterThanOrEqual(10);
  });

  it('is idempotent — does not duplicate registrations', () => {
    const registry = ContainerRegistry.getInstance();
    const before = registry.getAll().length;
    registerBuiltinPlugins();
    expect(registry.getAll().length).toBe(before);
  });
});
