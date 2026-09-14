import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';

// Mock @tauri-apps/api/event (emit) — installed via vitest.workspace.ts alias.
import { emit } from '@tauri-apps/api/event';
// @tauri-apps/api/core invoke is mocked globally too.
import { invoke } from '@tauri-apps/api/core';

import { PetLauncher } from './PetLauncher';

const emitMock = emit as unknown as Mock;
const invokeMock = invoke as unknown as Mock;

beforeEach(() => {
  emitMock.mockClear();
  invokeMock.mockClear();
  emitMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('PetLauncher', () => {
  it('renders all 5 launcher buttons', () => {
    render(<PetLauncher />);
    const labels = ['今日日记', '全局搜索', '命令面板', '显示主窗', '切换主题'];
    for (const label of labels) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // The removed buttons (new-note / disable-pet) are no longer rendered.
    expect(screen.queryByLabelText('新建笔记')).toBeNull();
    expect(screen.queryByLabelText('关闭宠物')).toBeNull();
  });

  it('emits pet://menu-action and hides the panel for main-window actions', async () => {
    render(<PetLauncher />);
    const btn = screen.getByLabelText('全局搜索');
    await fireEvent.click(btn);
    await waitFor(() => expect(emitMock).toHaveBeenCalledTimes(1));
    expect(emitMock).toHaveBeenCalledWith('pet://menu-action', { action: 'global-search' });
    expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide');
  });

  it('emits global-search / command-palette / show-main / toggle-theme', async () => {
    render(<PetLauncher />);
    const cases: Array<[string, string]> = [
      ['全局搜索', 'global-search'],
      ['命令面板', 'command-palette'],
      ['显示主窗', 'show-main'],
      ['切换主题', 'toggle-theme'],
    ];
    for (const [label, action] of cases) {
      emitMock.mockClear();
      invokeMock.mockClear();
      await fireEvent.click(screen.getByLabelText(label));
      await waitFor(() => expect(emitMock).toHaveBeenCalledTimes(1));
      expect(emitMock).toHaveBeenCalledWith('pet://menu-action', { action });
      expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide');
    }
  });
});
