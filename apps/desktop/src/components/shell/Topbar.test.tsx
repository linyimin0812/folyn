import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Topbar } from './Topbar';
import { useNavStore } from '@/store/navStore';
import { useTerminalStore } from '@/store/terminalStore';
import { useEditorViewStateStore } from '@/store/editorViewState';

vi.mock('@/components/editor/ExportMenu', () => ({
  ExportMenu: () => null,
}));
vi.mock('@/components/shell/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));
vi.mock('@/components/sidebar/SidebarActions', () => ({
  MoveDialog: () => null,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
}));

beforeEach(() => {
  useNavStore.setState({ currentPage: 'editor' });
  useTerminalStore.setState({ sessions: [], activeId: null });
  useEditorViewStateStore.setState({ terminalPanelVisible: false, terminalInRightDock: false });
});

afterEach(() => cleanup());

describe('Topbar terminal icon', () => {
  it('shows the terminal icon without the + menu', () => {
    render(<Topbar />);
    expect(screen.getByTitle('打开终端')).toBeTruthy();
    expect(screen.queryByTitle('新建终端或浏览器')).toBeNull();
  });

  it('creates a terminal session and opens the dock when none exists', () => {
    render(<Topbar />);
    fireEvent.click(screen.getByTitle('打开终端'));
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(true);
  });

  it('toggles the existing terminal panel without adding a session', () => {
    useTerminalStore.setState({
      sessions: [{ id: 'term-1', title: '终端 1', status: 'running', createdAt: 1 }],
      activeId: 'term-1',
    });
    useEditorViewStateStore.setState({ terminalPanelVisible: true });

    render(<Topbar />);
    fireEvent.click(screen.getByTitle('收起终端'));
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(false);

    fireEvent.click(screen.getByTitle('展开终端'));
    expect(useTerminalStore.getState().sessions).toHaveLength(1);
    expect(useEditorViewStateStore.getState().terminalPanelVisible).toBe(true);
  });
});
