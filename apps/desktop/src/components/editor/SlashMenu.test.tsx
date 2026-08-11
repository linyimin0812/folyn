/**
 * Tests for the SlashMenu container icon dispatcher.
 *
 * Verifies the three accepted `ContainerContribution.icon` shapes render
 * correctly: inline-SVG (IconFromSvg), emoji (plain text), and empty fallback.
 * The `.svg` file-path resolution is covered in
 * `contributionAdapters.test.ts` (host-side resolve at activate); here we
 * assert the registry's resolved string renders as the right element.
 *
 * Also covers menu-level behavior: plugins hidden from the `/` menu
 * (`ai-result`, `plugin-error-demo`) are not rendered, and the active item
 * resets to the first entry every time the menu reopens (no stale selection).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
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
    const item = container.querySelector('.slash-menu-item');
    expect(item).not.toBeNull();
    expect(item!.querySelector('svg')).not.toBeNull();
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
    const item = container.querySelector('.slash-menu-item');
    expect(item).not.toBeNull();
    expect(item!.querySelector('svg')).toBeNull();
    expect(item!.textContent).toContain('💡');
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
    const item = container.querySelector('.slash-menu-item');
    expect(item).not.toBeNull();
    expect(item!.querySelector('svg')).toBeNull();
  });
});

describe('SlashMenu hidden plugins', () => {
  it('excludes ai-result and plugin-error-demo from the rendered menu', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makePlugin({ name: 'ai-result', label: 'AI 结果', category: 'ai' }));
    cr.register(makePlugin({ name: 'plugin-error-demo', label: '错误隔离自检', category: 'data' }));
    cr.register(makePlugin({ name: 'callout', label: '提示框', category: 'layout' }));

    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    const items = container.querySelectorAll('.slash-menu-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('提示框');
    expect(container.textContent).not.toContain('AI 结果');
    expect(container.textContent).not.toContain('错误隔离自检');
  });
});

describe('SlashMenu selection reset', () => {
  it('resets to the first item when the menu reopens with the same filter', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makePlugin({ name: 'one', label: 'One' }));
    cr.register(makePlugin({ name: 'two', label: 'Two' }));
    cr.register(makePlugin({ name: 'three', label: 'Three' }));

    const props = {
      visible: true,
      filter: '',
      position: { top: 0, left: 0 },
      onSelect: () => {},
      onClose: () => {},
    };
    const { container, rerender } = render(<SlashMenu {...props} />);

    // Move the selection to the last item (as if the user hovered/arrowed).
    const items = container.querySelectorAll('.slash-menu-item');
    fireEvent.mouseEnter(items[2]!);
    expect(items[2]!.className).toContain('active');

    // Close then reopen with the same filter — the selection must reset to the
    // first item instead of remembering the previous one.
    rerender(<SlashMenu {...props} visible={false} />);
    rerender(<SlashMenu {...props} />);

    const reopenedItems = container.querySelectorAll('.slash-menu-item');
    expect(reopenedItems[0]!.className).toContain('active');
    expect(reopenedItems[2]!.className).not.toContain('active');
  });
});
describe('SlashMenu IME composition', () => {
  it('ignores Enter while an IME composition is active (no selection)', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makePlugin({ name: 'callout', label: '提示框' }));
    const onSelect = vi.fn();
    render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    // Pinyin IME confirms composition with Enter; the keydown carries
    // isComposing=true and must pass through to the editor untouched.
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'isComposing', { value: true });
    document.dispatchEvent(ev);

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects the active item with Enter when not composing', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makePlugin({ name: 'callout', label: '提示框' }));
    const onSelect = vi.fn();
    render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe('SlashMenu WKWebView composition ordering', () => {
  it('ignores the Enter that confirms a composition (fires after compositionend with isComposing=false)', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makePlugin({ name: 'callout', label: '提示框' }));
    const onSelect = vi.fn();
    render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    // WKWebView: compositionend fires, then the confirming Enter keydown
    // arrives with isComposing=false. The menu must still let it through.
    document.dispatchEvent(new Event('compositionstart'));
    document.dispatchEvent(new Event('compositionend'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores keys while a document-level composition is active even if the event flag is missing', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makePlugin({ name: 'callout', label: '提示框' }));
    const onSelect = vi.fn();
    render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    document.dispatchEvent(new Event('compositionstart'));
    // Some WKWebView keydowns during composition don't set isComposing.
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onSelect).not.toHaveBeenCalled();
  });
});
