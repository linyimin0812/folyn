import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContainerRegistry,
  registerBuiltinExtensions,
  calloutExtension,
  tabsExtension,
  tabExtension,
} from '../index';
import type { ContainerCategory, ContainerExtension } from './ContainerExtension';

const VALID_CATEGORIES: ContainerCategory[] = ['layout', 'media', 'ai', 'data', 'custom'];

/**
 * Contract checker mirroring the shape ContainerExtension consumers rely on.
 * The registry itself does not validate, so this documents the contract.
 */
function isValidExtension(p: unknown): p is ContainerExtension {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    o.name.length > 0 &&
    typeof o.icon === 'string' &&
    typeof o.label === 'string' &&
    typeof o.category === 'string' &&
    VALID_CATEGORIES.includes(o.category as ContainerCategory) &&
    typeof o.component === 'function' &&
    typeof o.template === 'string' &&
    o.template.includes(':::')
  );
}

describe('ContainerExtension contract — built-in extensions', () => {
  let registry: ContainerRegistry;

  beforeEach(() => {
    registry = ContainerRegistry.getInstance();
    for (const p of registry.getAll()) registry.unregister(p.name);
    registerBuiltinExtensions();
  });

  it('every registered extension satisfies the contract', () => {
    const extensions = registry.getAll();
    expect(extensions.length).toBeGreaterThanOrEqual(10);
    for (const extension of extensions) {
      expect(isValidExtension(extension)).toBe(true);
    }
  });

  it('every extension name is unique within the registry', () => {
    const names = registry.getAll().map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('ContainerExtension contract — validator rejects malformed shapes', () => {
  it('rejects non-objects', () => {
    expect(isValidExtension(null)).toBe(false);
    expect(isValidExtension(undefined)).toBe(false);
    expect(isValidExtension('callout')).toBe(false);
  });

  it('rejects a extension with an empty name', () => {
    expect(
      isValidExtension({ name: '', icon: 'x', label: 'x', category: 'custom', component: () => null, template: ':::x\n:::' }),
    ).toBe(false);
  });

  it('rejects a extension with a non-function component', () => {
    expect(
      isValidExtension({ name: 'x', icon: 'x', label: 'x', category: 'custom', component: 'nope', template: ':::x\n:::' }),
    ).toBe(false);
  });

  it('rejects a extension with an invalid category', () => {
    expect(
      isValidExtension({ name: 'x', icon: 'x', label: 'x', category: 'bogus', component: () => null, template: ':::x\n:::' }),
    ).toBe(false);
  });

  it('rejects a extension whose template is missing the directive syntax', () => {
    expect(
      isValidExtension({ name: 'x', icon: 'x', label: 'x', category: 'custom', component: () => null, template: 'no directive here' }),
    ).toBe(false);
  });
});

describe('calloutExtension', () => {
  it('exposes the expected identity and template', () => {
    expect(calloutExtension.name).toBe('callout');
    expect(calloutExtension.category).toBe('layout');
    expect(calloutExtension.template.startsWith(':::callout')).toBe(true);
    expect(calloutExtension.template.trim().endsWith(':::')).toBe(true);
    expect(calloutExtension.description).toBeDefined();
    expect(typeof calloutExtension.component).toBe('function');
  });

  it('is registered through registerBuiltinExtensions', () => {
    expect(ContainerRegistry.getInstance().get('callout')).toBe(calloutExtension);
  });
});

describe('tabsExtension / tabExtension', () => {
  it('exposes distinct names with layout category', () => {
    expect(tabsExtension.name).toBe('tabs');
    expect(tabExtension.name).toBe('tab');
    expect(tabsExtension.category).toBe('layout');
    expect(tabExtension.category).toBe('layout');
  });

  it('templates use the matching directive', () => {
    expect(tabsExtension.template.includes('::::tabs')).toBe(true);
    expect(tabExtension.template.startsWith(':::tab')).toBe(true);
  });

  it('both are registered through registerBuiltinExtensions', () => {
    const registry = ContainerRegistry.getInstance();
    expect(registry.get('tabs')).toBe(tabsExtension);
    expect(registry.get('tab')).toBe(tabExtension);
  });
});
