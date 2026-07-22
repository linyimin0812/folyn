import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';

// Mock @tauri-apps/api/event (emit) — installed via vitest.workspace.ts alias.
import { emit } from '@tauri-apps/api/event';
// @tauri-apps/api/core invoke is mocked globally too.
import { invoke } from '@tauri-apps/api/core';

import { PetLauncher } from './PetLauncher';

// Mock the clip store so we don't pull in vault/clip-service machinery.
// `getState()` must return a STABLE object whose `clipUrl` mock can be
// reconfigured per-test (the component calls `useClipStore.getState().clipUrl`).
const clipUrlMock = vi.fn(async (url: string) => `__clips__/test/${url.slice(-4)}.md`);
vi.mock('@/store/clipStore', () => ({
  useClipStore: {
    getState: () => ({ clipUrl: clipUrlMock }),
  },
}));

const emitMock = emit as unknown as Mock;
const invokeMock = invoke as unknown as Mock;

beforeEach(() => {
  emitMock.mockClear();
  invokeMock.mockClear();
  emitMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue(undefined);
  clipUrlMock.mockClear();
  clipUrlMock.mockResolvedValue('__clips__/test/my-clip.md');
});

afterEach(() => {
  cleanup();
});

describe('PetLauncher', () => {
  it('renders all 6 launcher buttons', () => {
    render(<PetLauncher />);
    const labels = ['今日日记', '网页剪藏', '全局搜索', '命令面板', '显示主窗', '切换主题'];
    for (const label of labels) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // The removed buttons (new-note / disable-pet) are no longer rendered.
    expect(screen.queryByLabelText('新建笔记')).toBeNull();
    expect(screen.queryByLabelText('关闭宠物')).toBeNull();
  });

  it('emits pet://menu-action and hides the panel for main-window actions', async () => {
    render(<PetLauncher />);
    const btn = screen.getByLabelText('今日日记');
    await fireEvent.click(btn);
    await waitFor(() => expect(emitMock).toHaveBeenCalledTimes(1));
    expect(emitMock).toHaveBeenCalledWith('pet://menu-action', { action: 'daily-note' });
    expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide');
  });

  it('emits daily-note / global-search / command-palette / show-main / toggle-theme', async () => {
    render(<PetLauncher />);
    const cases: Array<[string, string]> = [
      ['今日日记', 'daily-note'],
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

  it('Clip from URL toggles the inline form (no emit, no hide)', async () => {
    render(<PetLauncher />);
    const clipBtn = screen.getByLabelText('网页剪藏');
    await fireEvent.click(clipBtn);
    // Form revealed (URL input visible).
    const input = screen.getByLabelText('URL to clip') as HTMLInputElement;
    expect(input).toBeTruthy();
    // No menu-action emit, no panel hide on toggle.
    expect(emitMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('Clip from URL form rejects empty URL', async () => {
    render(<PetLauncher />);
    await fireEvent.click(screen.getByLabelText('网页剪藏'));
    const form = screen.getByLabelText('URL to clip').closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => {
      expect(screen.getByText('请输入网址')).toBeTruthy();
    });
  });

  it('Clip from URL form submits and shows success feedback', async () => {
    clipUrlMock.mockClear();
    clipUrlMock.mockResolvedValue('__clips__/test/my-clip.md');

    render(<PetLauncher />);
    await fireEvent.click(screen.getByLabelText('网页剪藏'));
    const input = screen.getByLabelText('URL to clip') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com/page' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(clipUrlMock).toHaveBeenCalledWith('https://example.com/page', expect.any(Function));
    });
    await waitFor(() => {
      expect(screen.getByText(/已保存/)).toBeTruthy();
    });
  });

  it('Clip from URL form shows failure feedback on error', async () => {
    clipUrlMock.mockClear();
    clipUrlMock.mockRejectedValue(new Error('没有活跃的 vault'));

    render(<PetLauncher />);
    await fireEvent.click(screen.getByLabelText('网页剪藏'));
    const input = screen.getByLabelText('URL to clip') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://example.com/x' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => {
      expect(screen.getByText('没有活跃的 vault')).toBeTruthy();
    });
  });

  it('Clip form can be collapsed via the 收起 button', async () => {
    render(<PetLauncher />);
    await fireEvent.click(screen.getByLabelText('网页剪藏'));
    expect(screen.getByLabelText('URL to clip')).toBeTruthy();
    await fireEvent.click(screen.getByText('收起'));
    expect(screen.queryByLabelText('URL to clip')).toBeNull();
  });
});
