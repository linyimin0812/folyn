// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { LinkPreviewPopover, __clearLinkPreviewCache } from './LinkPreviewPopover';
import { useLinkPreviewStore, __resetLinkPreviewTimers } from './linkPreviewStore';
import { PreviewActiveContext } from './PreviewActiveContext';

// readFileByRoute is dynamically imported — mock the whole service module.
const readFileByRoute = vi.fn();
vi.mock('@/services/editorIoService', () => ({ readFileByRoute: (p: string) => readFileByRoute(p) }));

const TARGET_MD = [
  '# 目标文档',
  '',
  '这里是目标文档的开头。',
  '',
  '## 安装指南',
  '',
  '```js',
  'npm install',
  '```',
  '',
  '- 第一步',
  '- 第二步',
].join('\n');

const RECT = { left: 100, right: 200, top: 100, bottom: 120 };

function openFor(path = 'docs/target.md', fragment?: string) {
  act(() => {
    useLinkPreviewStore.getState().close();
    useLinkPreviewStore.setState({ target: { path, fragment }, anchorRect: RECT, open: true });
  });
}

function mount(active = true) {
  return render(
    createElement(PreviewActiveContext.Provider, { value: active }, createElement(LinkPreviewPopover)),
  );
}

describe('LinkPreviewPopover', () => {
  beforeEach(() => {
    readFileByRoute.mockReset().mockResolvedValue(TARGET_MD);
    __clearLinkPreviewCache();
    __resetLinkPreviewTimers();
    useLinkPreviewStore.setState({ open: false, target: null, anchorRect: null, token: 0 });
  });
  afterEach(() => {
    __resetLinkPreviewTimers();
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders nothing until the store opens', () => {
    const { container } = mount();
    expect(container.innerHTML).toBe('');
    expect(document.querySelector('.md-link-pop')).toBeNull();
  });

  it('shows name, path, section and a rendered excerpt (code + list)', async () => {
    mount();
    openFor('docs/target.md', '安装指南');
    await waitFor(() => expect(document.querySelector('.md-link-pop-body pre')).not.toBeNull());
    expect(document.querySelector('.md-link-pop-title')!.textContent).toBe('target.md');
    expect(document.querySelector('.md-link-pop-path')!.textContent).toBe('docs');
    expect(document.querySelector('.md-link-pop-section')!.textContent).toContain('安装指南');
    expect(document.querySelector('.md-link-pop-section')!.textContent).toContain('第 5 行');
    // code block rendered with its content
    expect(document.querySelector('.md-link-pop-body pre')!.textContent).toContain('npm install');
    // list rendered
    const items = Array.from(document.querySelectorAll('.md-link-pop-body li'));
    expect(items.map((li) => li.textContent)).toEqual(['第一步', '第二步']);
  });

  it('portals to document.body, positioned below the anchor by inline coords', async () => {
    mount();
    openFor('docs/target.md');
    await waitFor(() => expect(document.querySelector('.md-link-pop')).not.toBeNull());
    const pop = document.querySelector('.md-link-pop') as HTMLElement;
    expect(pop.parentElement).toBe(document.body);
    expect(pop.style.top).toBe(`${RECT.bottom + 8}px`);
    expect(pop.style.left).toBe(`${RECT.left}px`);
  });

  it('shows the loading state, then error on a failed read', async () => {
    readFileByRoute.mockRejectedValueOnce(new Error('nope'));
    mount();
    openFor('docs/missing.md');
    expect(document.querySelector('.md-link-pop-loading')!.textContent).toContain('读取中');
    await waitFor(() => expect(document.querySelector('.md-link-pop-error')).not.toBeNull());
    expect(document.querySelector('.md-link-pop-error')!.textContent).toContain('无法读取目标文件');
  });

  it('renders links in the excerpt as inert text (no navigation surface)', async () => {
    readFileByRoute.mockResolvedValue('跳 [某链接](other.md) 试试');
    mount();
    openFor('docs/target.md');
    await waitFor(() => expect(document.querySelector('.md-pop-dead-link')).not.toBeNull());
    expect(document.querySelector('.md-link-pop-body a')).toBeNull();
  });

  it('caches reads: a second open of the same path does not re-read', async () => {
    mount();
    openFor('docs/target.md', '安装指南');
    await waitFor(() => expect(document.querySelector('.md-link-pop-body pre')).not.toBeNull());
    readFileByRoute.mockClear();
    openFor('docs/target.md');
    await waitFor(() => expect(document.querySelector('.md-link-pop-title')).not.toBeNull());
    expect(readFileByRoute).not.toHaveBeenCalled();
  });

  it('Esc closes it and swallows the event for other handlers', async () => {
    mount();
    openFor('docs/target.md');
    await waitFor(() => expect(document.querySelector('.md-link-pop')).not.toBeNull());
    const alsoFired = vi.fn();
    document.addEventListener('keydown', alsoFired);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(document.querySelector('.md-link-pop')).toBeNull();
    expect(alsoFired).not.toHaveBeenCalled();
    document.removeEventListener('keydown', alsoFired);
  });

  it('a wheel outside the popover closes it; inside it does not', async () => {
    mount();
    openFor('docs/target.md');
    await waitFor(() => expect(document.querySelector('.md-link-pop')).not.toBeNull());
    const pop = document.querySelector('.md-link-pop') as HTMLElement;
    await act(async () => {
      fireEvent.wheel(pop, { deltaY: 10 });
    });
    expect(document.querySelector('.md-link-pop')).not.toBeNull();
    await act(async () => {
      fireEvent.wheel(document.body, { deltaY: 10 });
    });
    expect(document.querySelector('.md-link-pop')).toBeNull();
  });

  it('unmounts when the pane goes inactive (parked pane never floats it)', async () => {
    const { rerender } = mount();
    openFor('docs/target.md');
    await waitFor(() => expect(document.querySelector('.md-link-pop')).not.toBeNull());
    rerender(
      createElement(PreviewActiveContext.Provider, { value: false }, createElement(LinkPreviewPopover)),
    );
    expect(document.querySelector('.md-link-pop')).toBeNull();
  });

  it('never touches the navigation history (no follow/pushPosition calls)', async () => {
    const follow = vi.fn();
    const pushPosition = vi.fn();
    const unsub = useLinkPreviewStore.subscribe(() => void 0);
    mount();
    openFor('docs/target.md', '安装指南');
    await waitFor(() => expect(document.querySelector('.md-link-pop-body pre')).not.toBeNull());
    // click inside the popover body (excerpt) — nothing navigates
    await act(async () => {
      fireEvent.pointerDown(document.querySelector('.md-link-pop-body') as HTMLElement, { button: 0 });
    });
    // the popover itself closed (outside-click semantics for body clicks),
    // but no navigation happened
    expect(follow).not.toHaveBeenCalled();
    expect(pushPosition).not.toHaveBeenCalled();
    unsub();
  });
});
