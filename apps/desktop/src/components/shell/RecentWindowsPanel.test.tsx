// RecentWindowsPanel 测试（spec 6.4）。
//
// 断言面：列表渲染（名称/最近文档/标签数）、搜索过滤、恢复动作、
// 单条清除、全部清除、空态、页脚注记。windowSessionService 全 mock
// （组件测的是呈现与交互编排，会话模型有自己的单测）。
// locale 走 setup 的 zh —— 文案断言用中文。

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { RecentWindowsPanel } from './RecentWindowsPanel';
import { useRecentWindowsStore, __resetRecentWindowsStore } from '@/store/recentWindowsStore';
import type { WindowSessionRecord } from '@/services/windowSessionService';

const restoreSessionMock = vi.fn(async () => {});
const clearSessionRecordMock = vi.fn(async () => {});
const clearAllClosedSessionsMock = vi.fn(async () => {});
const listClosedSessionsMock = vi.fn(async () => [] as WindowSessionRecord[]);

vi.mock('@/services/windowSessionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/windowSessionService')>();
  return {
    ...actual,
    listClosedSessions: (...args: []) => listClosedSessionsMock(...args),
    restoreSession: (...args: [string]) => restoreSessionMock(...args),
    clearSessionRecord: (...args: [string]) => clearSessionRecordMock(...args),
    clearAllClosedSessions: (...args: []) => clearAllClosedSessionsMock(...args),
  };
});

function record(overrides: Partial<WindowSessionRecord> & { id: string }): WindowSessionRecord {
  return {
    kind: 'research',
    name: '研究 1',
    createdAt: 1000,
    lastActiveAt: Date.now() - 5 * 60000,
    open: false,
    closedAt: Date.now() - 60000,
    vaultId: null,
    tabCount: 3,
    lastDocName: '笔记.md',
    lastDocPath: '/v/笔记.md',
    lastHeading: null,
    geometry: null,
    ...overrides,
  };
}

function openPanel() {
  useRecentWindowsStore.getState().open();
}

beforeEach(() => {
  __resetRecentWindowsStore();
  restoreSessionMock.mockClear();
  clearSessionRecordMock.mockClear();
  clearAllClosedSessionsMock.mockClear();
  listClosedSessionsMock.mockReset();
  listClosedSessionsMock.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  __resetRecentWindowsStore();
});

describe('RecentWindowsPanel', () => {
  it('面板关闭时不渲染', () => {
    render(<RecentWindowsPanel />);
    expect(screen.queryByTestId('recent-windows-panel')).toBeNull();
  });

  it('空列表显示空态文案', async () => {
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => {
      expect(screen.getByTestId('recent-windows-empty').textContent).toContain('没有最近关闭的研究窗口');
    });
  });

  it('渲染记录：名称 / 最近文档 / 标签数', async () => {
    listClosedSessionsMock.mockResolvedValue([
      record({ id: 'r-1', name: '研究 2', tabCount: 5, lastDocName: '调研.md' }),
    ]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => {
      expect(screen.getByText('研究 2')).toBeTruthy();
    });
    expect(screen.getByText(/调研\.md/)).toBeTruthy();
    expect(screen.getByText(/5 个标签页/)).toBeTruthy();
    expect(screen.getByText(/5 分钟前/)).toBeTruthy();
  });

  it('搜索按名称与最近文档过滤', async () => {
    listClosedSessionsMock.mockResolvedValue([
      record({ id: 'r-1', name: '研究 A', lastDocName: 'alpha.md' }),
      record({ id: 'r-2', name: '研究 B', lastDocName: 'beta.md' }),
    ]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByText('研究 A')).toBeTruthy());

    fireEvent.change(screen.getByTestId('recent-windows-search'), { target: { value: 'beta' } });
    expect(screen.queryByText('研究 A')).toBeNull();
    expect(screen.getByText('研究 B')).toBeTruthy();

    fireEvent.change(screen.getByTestId('recent-windows-search'), { target: { value: '研究 A' } });
    expect(screen.getByText('研究 A')).toBeTruthy();
  });

  it('点击条目 → restoreSession(id) 且面板关闭', async () => {
    listClosedSessionsMock.mockResolvedValue([record({ id: 'r-1', name: '研究 A' })]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByText('研究 A')).toBeTruthy());

    fireEvent.click(screen.getByText('研究 A'));
    await waitFor(() => expect(restoreSessionMock).toHaveBeenCalledWith('r-1'));
    expect(useRecentWindowsStore.getState().isOpen).toBe(false);
  });

  it('单条清除：不触发恢复，列表移除该条', async () => {
    listClosedSessionsMock.mockResolvedValue([
      record({ id: 'r-1', name: '研究 A' }),
      record({ id: 'r-2', name: '研究 B' }),
    ]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByText('研究 A')).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText('从列表清除')[0]);
    await waitFor(() => expect(clearSessionRecordMock).toHaveBeenCalledWith('r-1'));
    expect(restoreSessionMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('研究 A')).toBeNull());
    expect(screen.getByText('研究 B')).toBeTruthy();
  });

  it('全部清除：清空列表', async () => {
    listClosedSessionsMock.mockResolvedValue([
      record({ id: 'r-1', name: '研究 A' }),
      record({ id: 'r-2', name: '研究 B' }),
    ]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByText('研究 A')).toBeTruthy());

    fireEvent.click(screen.getByTestId('recent-clear-all'));
    await waitFor(() => expect(clearAllClosedSessionsMock).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('recent-windows-empty')).toBeTruthy());
  });

  it('页脚注记明示「不删除文件」', async () => {
    listClosedSessionsMock.mockResolvedValue([record({ id: 'r-1' })]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByText('研究 1')).toBeTruthy());
    expect(screen.getByText(/不删除任何 Vault 文件/)).toBeTruthy();
  });

  it('点击遮罩关闭面板', async () => {
    listClosedSessionsMock.mockResolvedValue([record({ id: 'r-1' })]);
    render(<RecentWindowsPanel />);
    openPanel();
    await waitFor(() => expect(screen.getByText('研究 1')).toBeTruthy());
    fireEvent.mouseDown(screen.getByTestId('recent-windows-overlay'));
    expect(useRecentWindowsStore.getState().isOpen).toBe(false);
  });
});
