import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { createEvent } from '@testing-library/dom';

// Mock @tauri-apps/api/core invoke — provided via vitest.workspace.ts alias.
import { invoke } from '@tauri-apps/api/core';
// The event module is ALSO provided via the workspace alias (shared mock in
// test/mocks/@tauri-apps/api/event.ts). Do NOT vi.mock it: a per-test vi.mock
// of the aliased module only intercepts the first dynamic import, while the
// component registers listeners through several effects. The shared mock
// captures every channel; tests drive them via `__internals.emitTo`.
import { __internals as eventInternals } from '@tauri-apps/api/event';

// Mock @tauri-apps/api/window so the drag-handle handler can be asserted
// without loading the real native bindings. The panel frontend only uses
// `getCurrentWindow().startDragging()` (drag handle) — the show/hide fade is
// driven purely by `pet://panel-fade-in` / `pet://panel-fade-out` events (no
// focus listeners anymore). `vi.hoisted` ensures the spy exists before the
// hoisted `vi.mock` factory captures it.
const { startDraggingMock } = vi.hoisted(() => ({
  startDraggingMock: vi.fn(async () => undefined),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: startDraggingMock,
  }),
}));

// Mock the heavy child components so this test focuses on tab host behavior.
// Each renders a div tagged with its root class name (matches real root).
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
});

afterEach(() => {
  cleanup();
});

describe('PetPanelApp', () => {
  it('defaults to the Chat tab with a search box above the tabs (no Actions tab)', () => {
    const { container } = render(<PetPanelApp />);
    expect(container.querySelector('.ai-panel')).toBeTruthy();
    // The search input sits above the tabs; the Actions tab was removed.
    expect(container.querySelector('.pet-panel-search-input')).toBeTruthy();
    // Only Chat + Inbox remain (tab labels are locale-dependent — index 0
    // is Chat, the default tab).
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('typing in the search box replaces the body with search results', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'readme' } });
    expect(container.querySelector('.pet-panel-search-results')).toBeTruthy();
    expect(container.querySelector('.ai-panel')).toBeNull();
    // Tabs are removed while searching — results take over the body.
    expect(container.querySelector('.pet-panel-tabs')).toBeNull();
  });

  it('search hides the tabs and supports arrow/enter keyboard navigation', async () => {
    const { registerCommand } = await import('@/services/commandRegistry');
    const disposables = [
      registerCommand({
        id: 'pet-test.search-cmd-1',
        title: 'readme helper',
        category: 'action',
        run: async () => undefined,
      }),
      registerCommand({
        id: 'pet-test.search-cmd-2',
        title: 'readme docs',
        category: 'action',
        run: async () => undefined,
      }),
    ];
    const { container } = render(<PetPanelApp />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'readme' } });

    // Tabs are removed while searching — only results remain.
    expect(container.querySelector('.pet-panel-tabs')).toBeNull();
    const items = container.querySelectorAll('.pet-panel-search-item');
    expect(items.length).toBeGreaterThanOrEqual(2);
    // First result is highlighted by default.
    expect(items[0].classList.contains('is-active')).toBe(true);
    expect(items[0].getAttribute('aria-selected')).toBe('true');

    // ArrowDown moves the highlight to the next result.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(items[1].classList.contains('is-active')).toBe(true);
    expect(items[0].classList.contains('is-active')).toBe(false);

    // ArrowUp moves back to the first.
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(items[0].classList.contains('is-active')).toBe(true);

    // Enter activates the highlighted result (hides the panel on pick).
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));

    for (const d of disposables) d.dispose();
  });

  it('clicking the Inbox tab mounts the inbox and unmounts AiPanel', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(container.querySelector('.pet-inbox-empty')).toBeTruthy();
    expect(container.querySelector('.ai-panel')).toBeNull();
    expect(screen.getAllByRole('tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab')[0].getAttribute('aria-selected')).toBe('false');
  });

  it('clicking Chat tab reverses back to the chat', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(container.querySelector('.pet-inbox-empty')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('tab')[0]);
    expect(container.querySelector('.ai-panel')).toBeTruthy();
    expect(container.querySelector('.pet-inbox-empty')).toBeNull();
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
    await fireEvent.pointerDown(screen.getAllByRole('tab')[0], { button: 0 });
    await Promise.resolve();
    expect(startDraggingMock).not.toHaveBeenCalled();
  });

  // ── Show/hide fade via explicit events (decoupled from focus) ──
  // The fade-in is driven by `pet://panel-fade-in` (emitted by
  // `applyPanelFrame` AFTER the post-show re-assert) and the hide-reset by
  // `pet://panel-fade-out` (emitted by `pet_panel_hide` in Rust). The
  // component registers NO focus listeners — `tauri://focus`/blur cannot
  // affect visibility, which is exactly what keeps the file-dialog blur from
  // blanking the panel.
  it('pet://panel-fade-in event sets is-visible (drives the show fade)', async () => {
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(eventInternals.getListeners('pet://panel-fade-in')).toBeDefined());
    const root = container.querySelector('.pet-panel-root')!;
    expect(root.className).not.toContain('is-visible');
    await act(async () => {
      eventInternals.emitTo('pet://panel-fade-in');
    });
    expect(root.className).toContain('is-visible');
  });

  it('pet://panel-fade-out event clears is-visible (hide reset)', async () => {
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(eventInternals.getListeners('pet://panel-fade-in')).toBeDefined());
    const root = container.querySelector('.pet-panel-root')!;
    await act(async () => {
      eventInternals.emitTo('pet://panel-fade-in');
    });
    expect(root.className).toContain('is-visible');
    await act(async () => {
      eventInternals.emitTo('pet://panel-fade-out');
    });
    expect(root.className).not.toContain('is-visible');
  });
});
