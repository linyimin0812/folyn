/**
 * Tests for the SlashMenu item rendering and interaction.
 *
 * Covers the icon dispatcher's three accepted `ContainerContribution.icon`
 * shapes (inline-SVG via IconFromSvg, emoji plain text, empty fallback —
 * the `.svg` file-path resolution lives in `contributionAdapters.test.ts`),
 * menu-level behavior (the `tab`/`step` sub-directives are hidden, selection
 * resets on reopen, IME keys pass through), and the basic markdown blocks:
 * they render in a leading `basic` group, filter case-insensitively across
 * name/label/description, and carry `cursorOffset` through `onSelect`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SlashMenu } from './SlashMenu';
import { ContainerRegistry } from '@folyn/container-extensions';
import type { ContainerExtension } from '@folyn/container-extensions';

// jsdom doesn't implement Element.scrollIntoView; SlashMenu's active-item
// scroll effect calls it. Ponyfill on the prototype for the duration of these
// tests so the effect doesn't crash render.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

function makeExtension(overrides: Partial<ContainerExtension> = {}): ContainerExtension {
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

/** The item rendered for the registered test container (label 'Test') —
 *  NOT one of the always-present basic blocks (they render first). */
function containerItem(root: HTMLElement): HTMLElement {
  const items = Array.from(root.querySelectorAll('.slash-menu-item'));
  const item = items.find((i) => i.textContent!.includes('Test'));
  expect(item).toBeDefined();
  return item!;
}

describe('SlashMenu container icon dispatcher', () => {
  it('renders an inline-SVG icon via IconFromSvg (not as literal text)', () => {
    const svg = '<svg width="16" height="16"><rect/></svg>';
    ContainerRegistry.getInstance().register(makeExtension({ icon: svg }));
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
    const item = containerItem(container);
    expect(item.querySelector('svg')).not.toBeNull();
  });

  it('renders an emoji icon as plain text (no IconFromSvg span)', () => {
    ContainerRegistry.getInstance().register(makeExtension({ icon: '💡' }));
    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    const item = containerItem(container);
    expect(item.querySelector('svg')).toBeNull();
    expect(item.textContent).toContain('💡');
  });

  it('renders an empty icon as an empty text span (fallback path, no crash)', () => {
    ContainerRegistry.getInstance().register(makeExtension({ icon: '' }));
    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );
    const item = containerItem(container);
    expect(item.querySelector('svg')).toBeNull();
  });
});

describe('SlashMenu hidden extensions', () => {
  it('excludes tab and step sub-directives from the rendered menu', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makeExtension({ name: 'tab', label: '标签项', category: 'layout' }));
    cr.register(makeExtension({ name: 'step', label: '步骤项', category: 'layout' }));
    cr.register(makeExtension({ name: 'callout', label: '提示框', category: 'layout' }));

    const { container } = render(
      <SlashMenu
        visible={true}
        filter=""
        position={{ top: 0, left: 0 }}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    // 7 basic markdown blocks + the one visible container.
    const items = container.querySelectorAll('.slash-menu-item');
    expect(items).toHaveLength(8);
    expect(container.textContent).toContain('提示框');
    expect(container.textContent).not.toContain('标签项');
    expect(container.textContent).not.toContain('步骤项');
  });
});

describe('SlashMenu basic markdown blocks', () => {
  it('renders the 7 basic blocks in a leading basic group, ahead of containers', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makeExtension({ name: 'callout', label: '提示框', category: 'layout' }));

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
    expect(items).toHaveLength(8);
    // The basic group comes first: heading1 … horizontal-rule, then callout.
    expect(items[0]!.textContent).toContain('一级标题');
    expect(items[1]!.textContent).toContain('二级标题');
    expect(items[4]!.textContent).toContain('代码块');
    expect(items[5]!.textContent).toContain('表格');
    expect(items[6]!.textContent).toContain('分隔线');
    expect(items[7]!.textContent).toContain('提示框');
    // The 基本 category header renders before the 布局 header.
    const text = container.textContent!;
    expect(text.indexOf('基础')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('基础')).toBeLessThan(text.indexOf('布局'));
  });

  it('filters case-insensitively across name, label, and description', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(
      makeExtension({
        name: 'callout',
        label: 'Callout',
        description: 'Fancy box',
        category: 'layout',
      }),
    );

    // Label match, case-insensitive (label 'Callout' vs query 'call').
    const { container: byLabel, rerender } = render(
      <SlashMenu visible={true} filter="call" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(byLabel.querySelectorAll('.slash-menu-item')).toHaveLength(1);
    expect(byLabel.textContent).toContain('Callout');

    // Description match, case-insensitive ('FANCY' vs 'Fancy box').
    rerender(
      <SlashMenu visible={true} filter="FANCY" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(byLabel.querySelectorAll('.slash-menu-item')).toHaveLength(1);

    // Basic-block name match ('heading1' — ASCII name behind the localized label).
    rerender(
      <SlashMenu visible={true} filter="HEADING1" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(byLabel.querySelectorAll('.slash-menu-item')).toHaveLength(1);
    expect(byLabel.textContent).toContain('一级标题');

    // Localized-label match (Chinese IME input after "/").
    rerender(
      <SlashMenu visible={true} filter="表格" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(byLabel.querySelectorAll('.slash-menu-item')).toHaveLength(1);
    expect(byLabel.textContent).toContain('表格');
  });

  it('matches "标题1"-style queries to the right heading level (token AND across name/label)', () => {
    const { container, rerender } = render(
      <SlashMenu visible={true} filter="标题" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    // 标题 alone: all three headings.
    expect(container.querySelectorAll('.slash-menu-item')).toHaveLength(3);

    // 标题1 → 一级标题 ONLY (label 一级标题 has 标题; name heading1 has 1).
    rerender(
      <SlashMenu visible={true} filter="标题1" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    let items = container.querySelectorAll('.slash-menu-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('一级标题');

    // 标题3 → 三级标题.
    rerender(
      <SlashMenu visible={true} filter="标题3" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    items = container.querySelectorAll('.slash-menu-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('三级标题');

    // 2级 → 二级标题 (digit token hits the name, 级 hits the label).
    rerender(
      <SlashMenu visible={true} filter="2级" position={{ top: 0, left: 0 }} onSelect={() => {}} onClose={() => {}} />,
    );
    items = container.querySelectorAll('.slash-menu-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain('二级标题');
  });

  it('Enter selects a basic block carrying template + cursorOffset', () => {
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
    // First item is heading1: template '# ' with no cursorOffset (cursor lands at end).
    const item = onSelect.mock.calls[0]![0] as { name: string; template: string; cursorOffset?: number };
    expect(item.name).toBe('heading1');
    expect(item.template).toBe('# ');
    expect(item.cursorOffset).toBeUndefined();
  });

  it('selecting the code block reports the inside-the-fences cursorOffset', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <SlashMenu
        visible={true}
        filter="代码块"
        position={{ top: 0, left: 0 }}
        onSelect={onSelect}
        onClose={() => {}}
      />,
    );

    const items = container.querySelectorAll('.slash-menu-item');
    expect(items).toHaveLength(1);
    fireEvent.click(items[0]!);

    expect(onSelect).toHaveBeenCalledTimes(1);
    const item = onSelect.mock.calls[0]![0] as { name: string; template: string; cursorOffset?: number };
    expect(item.name).toBe('code-block');
    expect(item.template).toBe('```\n\n```');
    // Cursor lands on the empty line between the fences (offset 4).
    expect(item.cursorOffset).toBe(4);
  });
});

describe('SlashMenu selection reset', () => {
  it('resets to the first item when the menu reopens with the same filter', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makeExtension({ name: 'one', label: 'One' }));
    cr.register(makeExtension({ name: 'two', label: 'Two' }));
    cr.register(makeExtension({ name: 'three', label: 'Three' }));

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
    cr.register(makeExtension({ name: 'callout', label: '提示框' }));
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

  it('ignores keys during a document-level composition even if the event flag is missing', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makeExtension({ name: 'callout', label: '提示框' }));
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

    // Some WKWebView keydowns during composition don't set isComposing, so
    // the menu tracks compositionstart/end on document.
    document.dispatchEvent(new Event('compositionstart'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects the active item with Enter when not composing', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makeExtension({ name: 'callout', label: '提示框' }));
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

  it('selects with Enter once the composition has ended (WKWebView confirming keydown)', () => {
    const cr = ContainerRegistry.getInstance();
    cr.register(makeExtension({ name: 'callout', label: '提示框' }));
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

    // The filter is mirrored live during composition, so once composition
    // ends the menu is ready and Enter may pick the highlighted item.
    document.dispatchEvent(new Event('compositionstart'));
    document.dispatchEvent(new Event('compositionend'));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
