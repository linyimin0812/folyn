import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TabBar } from './TabBar';
import type { FileTab } from '@/store/editorStore';

vi.mock('@/components/file-types/web/WebViewer', () => ({
  hideWebviewsForOverlay: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn(),
}));

vi.mock('@tauri-apps/api/path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tauri-apps/api/path')>();
  return { ...actual, homeDir: vi.fn().mockResolvedValue('/Users/test') };
});

function tab(id: string, name: string, overrides: Partial<FileTab> = {}): FileTab {
  return {
    id,
    name,
    path: name,
    content: '',
    isDirty: false,
    fileType: 'markdown',
    activity: 'files',
    ...overrides,
  };
}

function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '所有打开的文件' }));
  return screen.getByTestId('tab-list-panel');
}

afterEach(() => cleanup());

describe('TabBar tab list panel', () => {
  it('opens the in-editor panel from the dropdown icon', () => {
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md', { isDirty: true })]}
        activeTabId="a"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    expect(screen.queryByTestId('tab-list-panel')).toBeNull();
    const panel = openPanel();
    expect(within(panel).getByText('a.md')).toBeTruthy();
    expect(within(panel).getByText('b.md')).toBeTruthy();
    expect(within(panel).getByLabelText('关闭列表')).toBeTruthy();
  });

  it('closes the panel from its close button', () => {
    render(
      <TabBar
        tabs={[tab('a', 'a.md')]}
        activeTabId="a"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    const panel = openPanel();
    fireEvent.click(within(panel).getByLabelText('关闭列表'));
    expect(screen.queryByTestId('tab-list-panel')).toBeNull();
  });

  it('selects a tab from the panel and closes it', () => {
    const onSelectTab = vi.fn();
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md')]}
        activeTabId="a"
        mruOrder={[]}
        onSelectTab={onSelectTab}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    const panel = openPanel();
    fireEvent.click(within(panel).getByText('b.md'));
    expect(onSelectTab).toHaveBeenCalledWith('b');
    expect(screen.queryByTestId('tab-list-panel')).toBeNull();
  });

  it('closes a single tab from the panel without closing the panel', () => {
    const onCloseTab = vi.fn();
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md')]}
        activeTabId="a"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={onCloseTab}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    const panel = openPanel();
    const row = within(panel).getByText('b.md').closest('[role="menuitem"]');
    fireEvent.click(within(row as HTMLElement).getByLabelText('关闭文件'));
    expect(onCloseTab).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('tab-list-panel')).toBeTruthy();
  });

  it('closes every tab from the panel footer', () => {
    const onCloseTab = vi.fn();
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md')]}
        activeTabId="a"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={onCloseTab}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    const panel = openPanel();
    fireEvent.click(within(panel).getByText('关闭所有标签页'));
    expect(onCloseTab).toHaveBeenNthCalledWith(1, 'a');
    expect(onCloseTab).toHaveBeenNthCalledWith(2, 'b');
    expect(screen.queryByTestId('tab-list-panel')).toBeNull();
  });
});

describe('TabBar external file indicator', () => {
  it('shows the external-file icon after external tab names (main row + list)', () => {
    render(
      <TabBar
        tabs={[
          tab('ext', 'foo.md', { path: '/Users/test/foo.md' }),
          tab('vault', 'bar.md', { path: 'notes/bar.md' }),
        ]}
        activeTabId="ext"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    // Main tab row: only the external tab gets the icon.
    const externalTab = screen.getByText('foo.md').closest('div');
    expect(within(externalTab as HTMLElement).getByLabelText('打开所在文件夹')).toBeTruthy();
    const vaultTab = screen.getByText('bar.md').closest('div');
    expect(within(vaultTab as HTMLElement).queryByLabelText('打开所在文件夹')).toBeNull();

    // Dropdown list: same behavior.
    const panel = openPanel();
    const extRow = within(panel).getByText('foo.md').closest('[role="menuitem"]');
    expect(within(extRow as HTMLElement).getByLabelText('打开所在文件夹')).toBeTruthy();
    const vaultRow = within(panel).getByText('bar.md').closest('[role="menuitem"]');
    expect(within(vaultRow as HTMLElement).queryByLabelText('打开所在文件夹')).toBeNull();
  });
});


describe('TabBar external folder click', () => {
  it('opens the containing folder when the external icon is clicked', async () => {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    render(
      <TabBar
        tabs={[tab('ext', 'foo.md', { path: '/Users/test/docs/foo.md' })]}
        activeTabId="ext"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText('打开所在文件夹'));
    await vi.waitFor(() => {
      expect(vi.mocked(openPath)).toHaveBeenCalledWith('/Users/test/docs');
    });
  });

  it('resolves ~/ external paths to the home directory before opening', async () => {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    render(
      <TabBar
        tabs={[tab('ext', 'foo.md', { path: '~/docs/foo.md' })]}
        activeTabId="ext"
        mruOrder={[]}
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText('打开所在文件夹'));
    await vi.waitFor(() => {
      expect(vi.mocked(openPath)).toHaveBeenCalledWith('/Users/test/docs');
    });
  });

  it('does not select the tab when the external icon is clicked', () => {
    const onSelectTab = vi.fn();
    render(
      <TabBar
        tabs={[tab('ext', 'foo.md', { path: '/Users/test/foo.md' })]}
        activeTabId="ext"
        mruOrder={[]}
        onSelectTab={onSelectTab}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText('打开所在文件夹'));
    expect(onSelectTab).not.toHaveBeenCalled();
  });
});

describe('TabBar multi-tab reading (spec 6.2)', () => {
  it('orders the switch list by MRU, not by tab-array order', () => {
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md'), tab('c', 'c.md')]}
        mruOrder={['c', 'a', 'b']}
        activeTabId="c"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );
    const panel = openPanel();
    const rows = within(panel).getAllByRole('menuitem');
    const names = rows.map((r) => within(r).getByText(/\.md/).textContent);
    expect(names).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('filters the switch list by query across name and section', () => {
    render(
      <TabBar
        tabs={[
          tab('a', 'a.md', { readingHeading: { line: 3, text: '安装指南' } }),
          tab('b', 'b.md', { readingHeading: { line: 9, text: '进阶用法' } }),
        ]}
        mruOrder={['a', 'b']}
        activeTabId="a"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );
    const panel = openPanel();
    fireEvent.change(within(panel).getByPlaceholderText(/搜索标签页/), { target: { value: '进阶' } });
    expect(within(panel).queryByText('a.md')).toBeNull();
    expect(within(panel).getByText('b.md')).toBeTruthy();
    expect(within(panel).getByText('§ 进阶用法')).toBeTruthy();
  });

  it('pins a tab from the context menu and hides its close affordance', () => {
    const onTogglePin = vi.fn();
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md')]}
        mruOrder={['a', 'b']}
        activeTabId="a"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={onTogglePin}
      />,
    );
    fireEvent.contextMenu(screen.getByText('b.md'));
    fireEvent.click(screen.getByText('固定标签页'));
    expect(onTogglePin).toHaveBeenCalledWith('b');
  });

  it('renders a pinned tab with a pin icon and no ✕ close', () => {
    render(
      <TabBar
        tabs={[tab('a', 'a.md', { pinned: true }), tab('b', 'b.md')]}
        mruOrder={['a', 'b']}
        activeTabId="a"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );
    const pinned = screen.getByText('a.md').closest('[data-tab-id]');
    expect(within(pinned as HTMLElement).getByLabelText('取消固定')).toBeTruthy();
    // The pinned tab strip entry has no plain ✕ button (unpinned does).
    expect(within(pinned as HTMLElement).queryByText('✕')).toBeNull();
    const unpinned = screen.getByText('b.md').closest('[data-tab-id]');
    expect(within(unpinned as HTMLElement).getByText('✕')).toBeTruthy();
  });

  it('labels duplicate tabs of one document with instance suffixes', () => {
    render(
      <TabBar
        tabs={[
          tab('v:guide.md', 'guide.md', { path: 'guide.md' }),
          tab('v:guide.md~2', 'guide.md', { path: 'guide.md' }),
        ]}
        mruOrder={['v:guide.md', 'v:guide.md~2']}
        activeTabId="v:guide.md"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );
    const panel = openPanel();
    expect(within(panel).getByText('~2')).toBeTruthy();
  });

  it('close-others from the context menu only calls for non-pinned siblings', () => {
    const onCloseOthers = vi.fn();
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md'), tab('c', 'c.md', { pinned: true })]}
        mruOrder={['a', 'b', 'c']}
        activeTabId="a"
        onSelectTab={() => {}}
        onCloseTab={() => {}}
        onCloseOthers={onCloseOthers}
        onTogglePin={() => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByText('a.md'));
    fireEvent.click(screen.getByText('关闭其他标签页'));
    expect(onCloseOthers).toHaveBeenCalledWith('a');
  });

  it('close-all protects pinned tabs', () => {
    const onCloseTab = vi.fn();
    render(
      <TabBar
        tabs={[tab('a', 'a.md'), tab('b', 'b.md', { pinned: true })]}
        mruOrder={['a', 'b']}
        activeTabId="a"
        onSelectTab={() => {}}
        onCloseTab={onCloseTab}
        onCloseOthers={() => {}}
        onTogglePin={() => {}}
      />,
    );
    const panel = openPanel();
    fireEvent.click(within(panel).getByText('关闭所有标签页'));
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith('a');
  });
});
