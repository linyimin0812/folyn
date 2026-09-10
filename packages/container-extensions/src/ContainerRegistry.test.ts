import { describe, it, expect, beforeEach } from 'vitest';
import { ContainerRegistry, registerBuiltinExtensions } from '../index';
import type { ContainerExtension } from './ContainerExtension';

function makeExtension(name: string, category: ContainerExtension['category'] = 'custom'): ContainerExtension {
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
    // Clean state: unregister any extensions we might register.
    for (const p of registry.getAll()) registry.unregister(p.name);
  });

  it('registers and retrieves a extension by name', () => {
    const p = makeExtension('foo');
    registry.register(p);
    expect(registry.get('foo')).toBe(p);
    expect(registry.has('foo')).toBe(true);
  });

  it('returns undefined for unknown names', () => {
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.has('nope')).toBe(false);
  });

  it('register replaces an existing extension with the same name', () => {
    registry.register(makeExtension('dup'));
    const updated = makeExtension('dup');
    updated.label = 'Updated';
    registry.register(updated);
    expect(registry.get('dup')?.label).toBe('Updated');
  });

  it('unregister removes a extension and returns true', () => {
    registry.register(makeExtension('bye'));
    expect(registry.unregister('bye')).toBe(true);
    expect(registry.has('bye')).toBe(false);
  });

  it('unregister returns false for unknown names', () => {
    expect(registry.unregister('never')).toBe(false);
  });
});

describe('ContainerRegistry.getAll / getByCategory', () => {
  let registry: ContainerRegistry;

  beforeEach(() => {
    registry = ContainerRegistry.getInstance();
    for (const p of registry.getAll()) registry.unregister(p.name);
  });

  it('getAll returns all registered extensions', () => {
    registry.register(makeExtension('a'));
    registry.register(makeExtension('b'));
    expect(registry.getAll().map((p) => p.name).sort()).toEqual(['a', 'b']);
  });

  it('getByCategory filters by category', () => {
    registry.register(makeExtension('layout-1', 'layout'));
    registry.register(makeExtension('media-1', 'media'));
    registry.register(makeExtension('layout-2', 'layout'));
    expect(registry.getByCategory('layout').map((p) => p.name).sort()).toEqual(['layout-1', 'layout-2']);
  });
});

describe('registerBuiltinExtensions', () => {
  it('registers the built-in extension set (callout, tabs, mermaid, etc.)', () => {
    // Clean registry first.
    const registry = ContainerRegistry.getInstance();
    for (const p of registry.getAll()) registry.unregister(p.name);
    registerBuiltinExtensions();
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
    registerBuiltinExtensions();
    expect(registry.getAll().length).toBe(before);
  });
});
