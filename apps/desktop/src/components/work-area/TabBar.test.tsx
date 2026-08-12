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
        onSelectTab={() => {}}
        onCloseTab={() => {}}
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
        onSelectTab={() => {}}
        onCloseTab={() => {}}
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
        onSelectTab={onSelectTab}
        onCloseTab={() => {}}
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
        onSelectTab={() => {}}
        onCloseTab={onCloseTab}
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
        onSelectTab={() => {}}
        onCloseTab={onCloseTab}
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
        onSelectTab={() => {}}
        onCloseTab={() => {}}
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
        onSelectTab={() => {}}
        onCloseTab={() => {}}
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
        onSelectTab={() => {}}
        onCloseTab={() => {}}
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
        onSelectTab={onSelectTab}
        onCloseTab={() => {}}
      />,
    );

    fireEvent.click(screen.getByLabelText('打开所在文件夹'));
    expect(onSelectTab).not.toHaveBeenCalled();
  });
});
