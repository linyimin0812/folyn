/**
 * Tests for the SlashMenu container icon dispatcher.
 *
 * Verifies the three accepted `ContainerContribution.icon` shapes render
 * correctly: inline-SVG (IconFromSvg), emoji (plain text), and empty fallback.
 * The `.svg` file-path resolution is covered in
 * `contributionAdapters.test.ts` (host-side resolve at activate); here we
 * assert the registry's resolved string renders as the right element.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SlashMenu } from './SlashMenu';
import { ContainerRegistry } from '@quill/container-plugins';
import type { ContainerPlugin } from '@quill/container-plugins';

// jsdom doesn't implement Element.scrollIntoView; SlashMenu's active-item
// scroll effect calls it. Ponyfill on the prototype for the duration of these
// tests so the effect doesn't crash render.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

function makePlugin(overrides: Partial<ContainerPlugin> = {}): ContainerPlugin {
  return {
    name: 'test-block',
    icon: '📦',
    label: 'Test',
    category: 'custom',
    component: (() => null) as never,
    template: ':::test-block\n:::',
    ...overrides,
  };
}

beforeEach(() => {
  const cr = ContainerRegistry.getInstance();
  for (const p of cr.getAll()) cr.unregister(p.name);
});

afterEach(() => {
  const cr = ContainerRegistry.getInstance();
  for (const p of cr.getAll()) cr.unregister(p.name);
  cleanup();
});

describe('SlashMenu container icon dispatcher', () => {
  it('renders an inline-SVG icon via IconFromSvg (not as literal text)', () => {
    const svg = '<svg width="16" height="16"><rect/></svg>';
    ContainerRegistry.getInstance().register(makePlugin({ icon: svg }));
    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    // IconFromSvg wraps the (size-injected) raw SVG in a <span> via
    // dangerouslySetInnerHTML — so the rendered DOM contains an <svg> child,
    // not the literal "<svg..." text node.
    const span = container.querySelector('.text-center');
    expect(span).not.toBeNull();
    expect(span!.querySelector('svg')).not.toBeNull();
  });

  it('renders an emoji icon as plain text (no IconFromSvg span)', () => {
    ContainerRegistry.getInstance().register(makePlugin({ icon: '💡' }));
    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    const span = container.querySelector('.text-center');
    expect(span).not.toBeNull();
    expect(span!.querySelector('svg')).toBeNull();
    expect(span!.textContent).toBe('💡');
  });

  it('renders an empty icon as an empty text span (fallback path, no crash)', () => {
    ContainerRegistry.getInstance().register(makePlugin({ icon: '' }));
    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    const span = container.querySelector('.text-center');
    expect(span).not.toBeNull();
    expect(span!.querySelector('svg')).toBeNull();
    expect(span!.textContent).toBe('');
  });
});
