import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContainerRegistry,
  registerBuiltinPlugins,
  calloutPlugin,
  tabsPlugin,
  tabPlugin,
} from '../index';
import type { ContainerCategory, ContainerPlugin } from './ContainerPlugin';

const VALID_CATEGORIES: ContainerCategory[] = ['layout', 'media', 'ai', 'data', 'custom'];

/**
 * Contract checker mirroring the shape ContainerPlugin consumers rely on.
 * The registry itself does not validate, so this documents the contract.
 */
function isValidPlugin(p: unknown): p is ContainerPlugin {
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

describe('ContainerPlugin contract — built-in plugins', () => {
  let registry: ContainerRegistry;

  beforeEach(() => {
    registry = ContainerRegistry.getInstance();
    for (const p of registry.getAll()) registry.unregister(p.name);
    registerBuiltinPlugins();
  });

  it('every registered plugin satisfies the contract', () => {
    const plugins = registry.getAll();
    expect(plugins.length).toBeGreaterThanOrEqual(10);
    for (const plugin of plugins) {
      expect(isValidPlugin(plugin)).toBe(true);
    }
  });

  it('every plugin name is unique within the registry', () => {
    const names = registry.getAll().map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('ContainerPlugin contract — validator rejects malformed shapes', () => {
  it('rejects non-objects', () => {
    expect(isValidPlugin(null)).toBe(false);
    expect(isValidPlugin(undefined)).toBe(false);
    expect(isValidPlugin('callout')).toBe(false);
  });

  it('rejects a plugin with an empty name', () => {
    expect(
      isValidPlugin({ name: '', icon: 'x', label: 'x', category: 'custom', component: () => null, template: ':::x\n:::' }),
    ).toBe(false);
  });

  it('rejects a plugin with a non-function component', () => {
    expect(
      isValidPlugin({ name: 'x', icon: 'x', label: 'x', category: 'custom', component: 'nope', template: ':::x\n:::' }),
    ).toBe(false);
  });

  it('rejects a plugin with an invalid category', () => {
    expect(
      isValidPlugin({ name: 'x', icon: 'x', label: 'x', category: 'bogus', component: () => null, template: ':::x\n:::' }),
    ).toBe(false);
  });

  it('rejects a plugin whose template is missing the directive syntax', () => {
    expect(
      isValidPlugin({ name: 'x', icon: 'x', label: 'x', category: 'custom', component: () => null, template: 'no directive here' }),
    ).toBe(false);
  });
});

describe('calloutPlugin', () => {
  it('exposes the expected identity and template', () => {
    expect(calloutPlugin.name).toBe('callout');
    expect(calloutPlugin.category).toBe('layout');
    expect(calloutPlugin.template.startsWith(':::callout')).toBe(true);
    expect(calloutPlugin.template.trim().endsWith(':::')).toBe(true);
    expect(calloutPlugin.description).toBeDefined();
    expect(typeof calloutPlugin.component).toBe('function');
  });

  it('is registered through registerBuiltinPlugins', () => {
    expect(ContainerRegistry.getInstance().get('callout')).toBe(calloutPlugin);
  });
});

describe('tabsPlugin / tabPlugin', () => {
  it('exposes distinct names with layout category', () => {
    expect(tabsPlugin.name).toBe('tabs');
    expect(tabPlugin.name).toBe('tab');
    expect(tabsPlugin.category).toBe('layout');
    expect(tabPlugin.category).toBe('layout');
  });

  it('templates use the matching directive', () => {
    expect(tabsPlugin.template.includes('::::tabs')).toBe(true);
    expect(tabPlugin.template.startsWith(':::tab')).toBe(true);
  });

  it('both are registered through registerBuiltinPlugins', () => {
    const registry = ContainerRegistry.getInstance();
    expect(registry.get('tabs')).toBe(tabsPlugin);
    expect(registry.get('tab')).toBe(tabPlugin);
  });
});
