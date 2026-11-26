// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { FindBar } from './FindBar';

// The jump machinery (reveal + scroll + far-chunk mount watch) is covered by
// headingNav's own tests; the bar only delegates navigation to the host.
const onNavigate = vi.fn();

const CONTENT = [
  '# 标题一',       // 1
  '苹果第一',       // 2
  '苹果第二',       // 3
  '香蕉',          // 4
  ':::collapsible 折叠',  // 5
  '苹果隐藏',       // 6
  ':::',           // 7
].join('\n');

function mount(onClose = vi.fn()) {
  const utils = render(createElement(FindBar, { content: CONTENT, tabId: 'test-tab', onNavigate, onClose }));
  return { ...utils, onClose };
}

function type(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe('FindBar', () => {
  beforeEach(() => onNavigate.mockClear());
  // No vitest globals: RTL auto-cleanup never registers — unmount explicitly
  // or a leftover document-level Esc listener eats the next test's Esc.
  afterEach(cleanup);

  it('renders empty until a query is typed, then shows count and results', async () => {
    const { container } = mount();
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    expect(container.querySelector('.md-find-results')).toBeNull();
    type(input, '苹果');
    await waitFor(() => expect(container.querySelectorAll('.md-find-item').length).toBe(3));
    const count = container.querySelector('.md-find-count')!.textContent;
    expect(count).toContain('3');
  });

  it('shows section / container context per result', async () => {
    const { container } = mount();
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    type(input, '苹果隐藏');
    await waitFor(() => expect(container.querySelectorAll('.md-find-item').length).toBe(1));
    const ctx = container.querySelector('.md-find-ctx')!.textContent;
    expect(ctx).toContain('标题一');
    expect(ctx).toContain('折叠 · 折叠');
    expect(ctx).toContain('6 行');
    expect(ctx).toContain('含隐藏组件');
    // the match itself is highlighted via <mark>
    expect(container.querySelector('.md-find-line mark')!.textContent).toBe('苹果隐藏');
  });

  it('Enter steps forward through matches and jumps; Shift+Enter steps back', async () => {
    const { container } = mount();
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    type(input, '苹果');
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    onNavigate.mockClear();
    // first match auto-jumped at 0 — line 2
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    // second match = line 3
    expect(onNavigate).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(onNavigate).toHaveBeenLastCalledWith(2);
    const count = container.querySelector('.md-find-count')!.textContent;
    expect(count).toContain('1/3');
  });

  it('ArrowDown/ArrowUp step the same way', async () => {
    const { container } = mount();
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    type(input, '苹果');
    await waitFor(() => expect(container.querySelectorAll('.md-find-item').length).toBe(3));
    onNavigate.mockClear();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onNavigate).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onNavigate).toHaveBeenLastCalledWith(2);
  });

  it('clicking a result jumps to it and marks it current', async () => {
    const { container } = mount();
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    type(input, '苹果');
    await waitFor(() => expect(container.querySelectorAll('.md-find-item').length).toBe(3));
    onNavigate.mockClear();
    const items = Array.from(container.querySelectorAll('.md-find-item')) as HTMLElement[];
    fireEvent.click(items[2]); // line 6, inside the collapsible
    expect(onNavigate).toHaveBeenLastCalledWith(6);
    expect(items[2].classList.contains('is-current')).toBe(true);
    expect(container.querySelector('.md-find-count')!.textContent).toContain('3/3');
  });

  it('Esc closes via the document capture handler and stops propagation', async () => {
    const onClose = vi.fn();
    const { container } = mount(onClose);
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    const alsoFired = vi.fn();
    document.addEventListener('keydown', alsoFired);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' });
    });
    // capture handler on document runs before the input's bubble, closes the
    // bar, and swallows the event — a sibling document listener never fires.
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(alsoFired).not.toHaveBeenCalled();
    document.removeEventListener('keydown', alsoFired);
  });

  it('shows 无匹配 for a query that misses', async () => {
    const { container } = mount();
    const input = container.querySelector('.md-find-input') as HTMLInputElement;
    type(input, '不存在的词');
    await waitFor(() => expect(container.querySelector('.md-find-empty')).not.toBeNull());
    expect(container.querySelector('.md-find-results')).toBeNull();
  });
});

// local act import — jsdom needs it for state flushes after native dispatch
import { act } from 'react';
