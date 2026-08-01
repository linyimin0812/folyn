import { describe, it, expect, beforeEach, vi } from 'vitest';

// Tauri APIs are aliased to vi.fn mocks via vitest.workspace.ts.
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { useNavStore } from '@/store/navStore';
import { usePetStore } from '@/store/petStore';
import { useSearchStore } from '@/store/searchStore';
import { useCommandPaletteStore } from '@/store/commandPaletteStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useAiStore } from '@/store/aiStore';
import * as editorIoService from '@/services/editorIoService';
import { routePetMenuAction, routePetBubbleAction } from './petHostRouter';
import type { PetBubbleActionEvent } from '@/components/pet/PetBubbleApp';

// `@tauri-apps/api/window` is the real installed package (not aliased); in
// jsdom `getCurrentWindow()` would throw, which focusMain swallows. To assert
// the focus path is reached, mock the module so show/setFocus become spies.
const showMock = vi.fn(async () => undefined);
const setFocusMock = vi.fn(async () => undefined);
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: showMock, setFocus: setFocusMock }),
}));

const invokeMock = invoke as unknown as import('vitest').Mock;
const emitMock = emit as unknown as import('vitest').Mock;

beforeEach(() => {
  invokeMock.mockClear();
  emitMock.mockClear();
  showMock.mockClear();
  setFocusMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
});

describe('routePetMenuAction', () => {
  it('show-main focuses the main window', async () => {
    await routePetMenuAction('show-main');
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(setFocusMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('hide-pet clears pet mode and invokes toggle_pet_mode', async () => {
    usePetStore.setState({ petModeEnabled: true });
    await routePetMenuAction('hide-pet');
    expect(usePetStore.getState().petModeEnabled).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith('toggle_pet_mode');
  });

  it('set-pet-size persists size, invokes set_pet_size, and emits pet://size-changed', async () => {
    await routePetMenuAction('set-pet-size', '150');
    expect(usePetStore.getState().petSize).toBe('150');
    expect(invokeMock).toHaveBeenCalledWith('set_pet_size', { level: '150' });
    expect(emitMock).toHaveBeenCalledWith('pet://size-changed', { size: '150' });
  });

  it('set-pet-size defaults to 100 when size omitted', async () => {
    await routePetMenuAction('set-pet-size');
    expect(usePetStore.getState().petSize).toBe('100');
    expect(invokeMock).toHaveBeenCalledWith('set_pet_size', { level: '100' });
  });

  it('set-pet-opacity persists opacity and invokes set_pet_opacity', async () => {
    await routePetMenuAction('set-pet-opacity', undefined, '50');
    expect(usePetStore.getState().petOpacity).toBe('50');
    expect(invokeMock).toHaveBeenCalledWith('set_pet_opacity', { level: '50' });
  });

  it('set-pet-opacity defaults to 100 when opacity omitted', async () => {
    await routePetMenuAction('set-pet-opacity');
    expect(usePetStore.getState().petOpacity).toBe('100');
    expect(invokeMock).toHaveBeenCalledWith('set_pet_opacity', { level: '100' });
  });

  it('toggle-pet-click-through flips the flag and invokes set_pet_click_through', async () => {
    usePetStore.setState({ petClickThrough: false });
    await routePetMenuAction('toggle-pet-click-through');
    expect(usePetStore.getState().petClickThrough).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('set_pet_click_through', { enabled: true });
  });

  it('toggle-pet-click-through applies an explicit clickThrough payload', async () => {
    usePetStore.setState({ petClickThrough: true });
    await routePetMenuAction('toggle-pet-click-through', undefined, undefined, false);
    expect(usePetStore.getState().petClickThrough).toBe(false);
    expect(invokeMock).toHaveBeenCalledWith('set_pet_click_through', { enabled: false });
  });

  it('exit-app invokes exit_app', async () => {
    await routePetMenuAction('exit-app');
    expect(invokeMock).toHaveBeenCalledWith('exit_app');
  });

  it('daily-note opens the daily note and focuses main', async () => {
    const spy = vi.spyOn(editorIoService, 'openDailyNote').mockResolvedValue(undefined);
    await routePetMenuAction('daily-note');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(showMock).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('global-search opens the search panel and focuses main', async () => {
    useSearchStore.setState({ isOpen: false });
    await routePetMenuAction('global-search');
    expect(useSearchStore.getState().isOpen).toBe(true);
    expect(showMock).toHaveBeenCalledTimes(1);
  });

  it('clip-from-url focuses main as fallback (panel owns the flow)', async () => {
    await routePetMenuAction('clip-from-url');
    expect(showMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('command-palette toggles the palette and focuses main', async () => {
    useCommandPaletteStore.setState({ isOpen: false });
    await routePetMenuAction('command-palette');
    expect(useCommandPaletteStore.getState().isOpen).toBe(true);
    expect(showMock).toHaveBeenCalledTimes(1);
  });

  it('toggle-theme flips the theme and focuses main', async () => {
    useAppearanceStore.setState({ theme: 'light' });
    await routePetMenuAction('toggle-theme');
    expect(useAppearanceStore.getState().theme).toBe('dark');
    expect(showMock).toHaveBeenCalledTimes(1);
  });

  it('open-ai-settings sets navStore to settings/models and focuses main', async () => {
    useNavStore.setState({ currentPage: 'editor', settingsTab: 'appearance' });
    await routePetMenuAction('open-ai-settings');
    expect(useNavStore.getState().currentPage).toBe('settings');
    expect(useNavStore.getState().settingsTab).toBe('models');
    expect(showMock).toHaveBeenCalledTimes(1);
  });
});

describe('routePetBubbleAction', () => {
  const showSpy = showMock; // alias for readability

  it('focuses main when the event has no target', async () => {
    await routePetBubbleAction({ type: 'navigate' });
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('schedule target navigates to the schedule page and focuses main', async () => {
    useNavStore.setState({ currentPage: 'editor' });
    await routePetBubbleAction({ type: 'navigate', target: { kind: 'schedule', id: 'x' } });
    expect(useNavStore.getState().currentPage).toBe('schedule');
    expect(showSpy).toHaveBeenCalledTimes(1);
  });

  it('chat target switches the pet-panel session and invokes pet_panel_show', async () => {
    useAiStore.setState({ sessions: [{ id: 's1', messages: [] }] as never, activeSessionId: 's1' });
    await routePetBubbleAction({ type: 'navigate', target: { kind: 'chat', id: 's1' } });
    expect(invokeMock).toHaveBeenCalledWith('pet_panel_show');
  });

  it('file target opens the file in the editor and focuses main', async () => {
    const spy = vi.spyOn(editorIoService, 'openFile').mockResolvedValue(undefined);
    await routePetBubbleAction({
      type: 'navigate',
      target: { kind: 'file', id: 'path/to/note.md' },
    });
    expect(spy).toHaveBeenCalledWith('path/to/note.md', 'note.md');
    expect(showSpy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('task target opens the file (same branch as file)', async () => {
    const spy = vi.spyOn(editorIoService, 'openFile').mockResolvedValue(undefined);
    await routePetBubbleAction({
      type: 'action',
      actionId: 'view',
      target: { kind: 'task', id: 'a/b/task.md' },
    });
    expect(spy).toHaveBeenCalledWith('a/b/task.md', 'task.md');
    spy.mockRestore();
  });
});
