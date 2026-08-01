import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { createEvent } from '@testing-library/dom';

// Mock @tauri-apps/api/core invoke — provided via vitest.workspace.ts alias.
import { invoke } from '@tauri-apps/api/core';

// Mock @tauri-apps/api/window so the drag-handle handler can be asserted
// without loading the real native bindings. The panel frontend only uses
// `getCurrentWindow().startDragging()` (drag handle) + `onFocusChanged` /
// `isVisible()` (fade visibility) — other window mutation goes through custom
// `invoke` commands (mocked above). `vi.hoisted` ensures the spies exist
// before the hoisted `vi.mock` factory captures them. `focusHandler` holds the
// focus callback the component registers so tests can synthesize focus/blur.
// `fadeHandler` holds the `pet://panel-fade-in` listen callback so tests can
// drive the show-fade without touching focus (the fade is decoupled from focus).
const { startDraggingMock, focusHandler, isVisibleMock, fadeHandler } = vi.hoisted(() => ({
  startDraggingMock: vi.fn(async () => undefined),
  focusHandler: { current: null as null | ((e: { payload: boolean }) => void) },
  isVisibleMock: vi.fn(async () => true),
  fadeHandler: { current: null as null | (() => void) },
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: startDraggingMock,
    onFocusChanged: async (cb: (e: { payload: boolean }) => void) => {
      focusHandler.current = cb;
      return () => {
        focusHandler.current = null;
      };
    },
    isVisible: isVisibleMock,
  }),
}));

// Mock @tauri-apps/api/event so the `pet://panel-fade-in` listener can be
// captured. The show-fade is now driven by this event (emitted by
// `applyPanelFrame` after the post-show re-assert) instead of `tauri://focus`.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (channel: string, cb: () => void) => {
    if (channel === 'pet://panel-fade-in') {
      fadeHandler.current = cb;
    }
    return () => {
      if (fadeHandler.current === cb) fadeHandler.current = null;
    };
  }),
  emit: vi.fn(async () => undefined),
}));

// Mock the heavy child components so this test focuses on tab host behavior.
// Each renders a div tagged with its root class name (matches real root).
vi.mock('./PetLauncher', () => ({
  PetLauncher: () => <div className="pet-launcher">launcher</div>,
}));
vi.mock('@/components/ai/AiPanel', () => ({
  AiPanel: () => <div className="ai-panel">chat</div>,
}));

import { PetPanelApp } from './PetPanelApp';

const invokeMock = invoke as unknown as import('vitest').Mock;

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  startDraggingMock.mockClear();
  startDraggingMock.mockResolvedValue(undefined);
  isVisibleMock.mockClear();
  isVisibleMock.mockResolvedValue(true);
  focusHandler.current = null;
  fadeHandler.current = null;
});

afterEach(() => {
  cleanup();
});

describe('PetPanelApp', () => {
  it('defaults to the Chat tab and shows the chat (not launcher)', () => {
    const { container } = render(<PetPanelApp />);
    expect(container.querySelector('.ai-panel')).toBeTruthy();
    expect(container.querySelector('.pet-launcher')).toBeNull();
    const chatTab = screen.getByRole('tab', { name: 'Chat' });
    expect(chatTab.getAttribute('aria-selected')).toBe('true');
  });

  it('clicking the Actions tab mounts PetLauncher and unmounts AiPanel', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
    expect(container.querySelector('.pet-launcher')).toBeTruthy();
    expect(container.querySelector('.ai-panel')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Actions' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Chat tab reverses back to the chat', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
    expect(container.querySelector('.pet-launcher')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }));
    expect(container.querySelector('.ai-panel')).toBeTruthy();
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

  // ── Show-fade via `pet://panel-fade-in` (decoupled from focus) ──
  // The fade-in is now driven by an explicit `pet://panel-fade-in` event
  // emitted by `applyPanelFrame` AFTER the post-show re-assert, NOT by
  // `tauri://focus`. Focus true is a no-op for visibility — only the
  // event sets `is-visible`. The blur→`isVisible()` reset (file-upload
  // blank fix) stays unchanged.
  it('pet://panel-fade-in event sets is-visible (drives the show fade)', async () => {
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(fadeHandler.current).not.toBeNull());
    const root = container.querySelector('.pet-panel-root')!;
    expect(root.className).not.toContain('is-visible');
    await act(async () => {
      fadeHandler.current!();
    });
    expect(root.className).toContain('is-visible');
  });

  it('tauri://focus true alone does NOT set is-visible (fade is decoupled)', async () => {
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(focusHandler.current).not.toBeNull());
    const root = container.querySelector('.pet-panel-root')!;
    await act(async () => {
      focusHandler.current!({ payload: true });
    });
    expect(root.className).not.toContain('is-visible');
  });

  // ── Blur visibility reset (file-upload blank regression) ──
  // The panel is a `nonactivating_panel`; clicking the attach button opens a
  // native NSOpenPanel that steals key window → blur fires while the window is
  // STILL visible. Dropping `is-visible` there would set opacity:0 and, since a
  // nonactivating panel doesn't reliably regain focus, leave the panel blank.
  it('blur while the window is still visible (file dialog stole focus) does NOT blank the panel', async () => {
    isVisibleMock.mockResolvedValue(true); // window still shown — dialog only stole key
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(fadeHandler.current).not.toBeNull());
    const root = container.querySelector('.pet-panel-root')!;
    // Show the panel via the fade-in event (NOT focus — focus is decoupled now).
    await act(async () => {
      fadeHandler.current!();
    });
    expect(root.className).toContain('is-visible');
    // File dialog opens → blur. Window is STILL visible → must stay visible.
    isVisibleMock.mockClear();
    await act(async () => {
      focusHandler.current!({ payload: false });
    });
    await waitFor(() => expect(isVisibleMock).toHaveBeenCalled());
    expect(root.className).toContain('is-visible'); // NOT blanked
  });

  it('blur when the window was actually hidden drops is-visible (fade resets for next show)', async () => {
    isVisibleMock.mockResolvedValue(false); // pet_panel_hide hid the window
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(fadeHandler.current).not.toBeNull());
    const root = container.querySelector('.pet-panel-root')!;
    await act(async () => {
      fadeHandler.current!();
    });
    expect(root.className).toContain('is-visible');
    await act(async () => {
      focusHandler.current!({ payload: false });
    });
    await waitFor(() => expect(root.className).not.toContain('is-visible'));
  });
});
