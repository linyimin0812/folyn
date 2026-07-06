import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { createEvent } from '@testing-library/dom';

// Mock @tauri-apps/api/core invoke — provided via vitest.workspace.ts alias.
import { invoke } from '@tauri-apps/api/core';

// Mock @tauri-apps/api/window so the drag-handle handler can be asserted
// without loading the real native bindings. The panel frontend only uses
// `getCurrentWindow().startDragging()` (drag handle) — other window mutation
// goes through custom `invoke` commands (mocked above). `vi.hoisted` ensures
// the spy exists before the hoisted `vi.mock` factory captures it.
const { startDraggingMock } = vi.hoisted(() => ({
  startDraggingMock: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: startDraggingMock }),
}));

// Mock the heavy child components so this test focuses on tab host behavior.
// Each renders a div tagged with its root class name (matches real root).
vi.mock('./PetLauncher', () => ({
  PetLauncher: () => <div className="pet-launcher">launcher</div>,
}));
vi.mock('./PetChat', () => ({
  PetChat: () => <div className="pet-chat">chat</div>,
}));

import { PetPanelApp } from './PetPanelApp';

const invokeMock = invoke as unknown as import('vitest').Mock;

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  startDraggingMock.mockClear();
  startDraggingMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('PetPanelApp', () => {
  it('defaults to the Chat tab and shows the chat (not launcher)', () => {
    const { container } = render(<PetPanelApp />);
    expect(container.querySelector('.pet-chat')).toBeTruthy();
    expect(container.querySelector('.pet-launcher')).toBeNull();
    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    expect(chatTab.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking the Actions tab mounts PetLauncher and unmounts PetChat', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
    expect(container.querySelector('.pet-launcher')).toBeTruthy();
    expect(container.querySelector('.pet-chat')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Chat tab reverses back to the chat', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
    expect(container.querySelector('.pet-launcher')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(container.querySelector('.pet-chat')).toBeTruthy();
    expect(container.querySelector('.pet-launcher')).toBeNull();
  });

  it('close button hides the panel via pet_panel_hide', async () => {
    render(<PetPanelApp />);
    await fireEvent.click(screen.getByLabelText('Close pet panel'));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });

  it('Esc hides the panel via pet_panel_hide', async () => {
    render(<PetPanelApp />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });

  // ── Drag handle (Fix 2) ──
  it('pointerdown on the header starts a native window drag', async () => {
    render(<PetPanelApp />);
    const header = screen.getByRole('banner');
    await fireEvent.pointerDown(header, { button: 0 });
    await waitFor(() => expect(startDraggingMock).toHaveBeenCalledTimes(1));
  });

  it('pointerdown on the close button does NOT start a drag (stopPropagation)', async () => {
    render(<PetPanelApp />);
    const close = screen.getByLabelText('Close pet panel');
    await fireEvent.pointerDown(close, { button: 0 });
    // Give the async drag handler a tick in case it tried to fire.
    await Promise.resolve();
    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  it('right-button pointerdown on the header does NOT start a drag', async () => {
    render(<PetPanelApp />);
    const header = screen.getByRole('banner');
    // jsdom lacks a PointerEvent constructor, so `button` must be stamped on
    // the synthesized Event manually — fireEvent's init is ignored for it.
    const event = createEvent.pointerDown(header, { button: 2 });
    Object.defineProperty(event, 'button', { value: 2, configurable: true });
    fireEvent(header, event);
    await Promise.resolve();
    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  it('clicking a tab button does NOT start a drag', async () => {
    render(<PetPanelApp />);
    await fireEvent.pointerDown(screen.getByRole('tab', { name: 'Chat' }), { button: 0 });
    await Promise.resolve();
    expect(startDraggingMock).not.toHaveBeenCalled();
  });
});
