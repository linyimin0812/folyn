import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { createEvent } from '@testing-library/dom';

// Mock @tauri-apps/api/window so the drag-handle handler + the new
// maximize/minimize controls can be asserted without native bindings.
// Mirrors the proven pattern in WindowControls.test.tsx. No mount-time
// `getCurrentWindow` call exists (the component sets state on button click),
// so only the click-path accessors are stubbed.
const {
  startDraggingMock,
  minimizeMock,
  toggleMaximizeMock,
  isMaximizedMock,
} = vi.hoisted(() => ({
  startDraggingMock: vi.fn(async () => undefined),
  minimizeMock: vi.fn(async () => undefined),
  toggleMaximizeMock: vi.fn(async () => undefined),
  isMaximizedMock: vi.fn(async () => false),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: startDraggingMock,
    minimize: minimizeMock,
    toggleMaximize: toggleMaximizeMock,
    isMaximized: isMaximizedMock,
  }),
}));

// Mock the heavy child components so this test focuses on tab host behavior.
// Each renders a div tagged with its root class name (matches real root).
vi.mock('@/components/ai/AiPanel', () => ({
  AiPanel: () => <div className="ai-panel">chat</div>,
}));
// TranslationPanel pulls in MarkdownPreview → ExcalidrawPreview →
// @excalidraw, which crashes under jsdom (canvas-less). The pet-panel host
// test only asserts tab-host behavior, so stub the tab body.
vi.mock('@/components/translation/TranslationPanel', () => ({
  TranslationPanel: () => <div className="translation-panel">translation</div>,
}));

import { PetPanelApp } from './PetPanelApp';

// Resolve the aliased core/event mocks AFTER `vi.mock('@tauri-apps/api/window')`
// is hoisted — importing these statically before the hoisted window mock was
// what desynced Vitest's mock application and let the real `getCurrentWindow`
// (reading `window.__TAURI_INTERNALS__.metadata`) run. WindowControls.test.tsx
// avoids this by importing no Tauri module statically; we follow the same
// discipline and resolve both lazily in `beforeAll`.
let invokeMock!: import('vitest').Mock;
let eventInternals!: { getListeners(c: string): unknown; emitTo(c: string, p?: unknown): void };

beforeAll(async () => {
  const { invoke } = await import('@tauri-apps/api/core');
  invokeMock = invoke as unknown as import('vitest').Mock;
  ({ __internals: eventInternals } = await import('@tauri-apps/api/event'));
});

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  startDraggingMock.mockClear();
  startDraggingMock.mockResolvedValue(undefined);
  minimizeMock.mockClear();
  minimizeMock.mockResolvedValue(undefined);
  toggleMaximizeMock.mockClear();
  toggleMaximizeMock.mockResolvedValue(undefined);
  isMaximizedMock.mockClear();
  isMaximizedMock.mockResolvedValue(false);
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
    const { container } = render(<PetPanelApp />);
    await fireEvent.click(container.querySelector('.pet-panel-ctrl-close')!);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });

  it('Esc hides the panel via pet_panel_hide', async () => {
    render(<PetPanelApp />);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });

  // ── Top-right window controls ──
  it('minimize button calls window.minimize', async () => {
    const { container } = render(<PetPanelApp />);
    const [minimize, _] = container.querySelectorAll('.pet-panel-ctrl');
    await fireEvent.click(minimize);
    await waitFor(() => expect(minimizeMock).toHaveBeenCalledTimes(1));
  });

  it('fullscreen button calls window.toggleMaximize', async () => {
    const { container } = render(<PetPanelApp />);
    const buttons = container.querySelectorAll('.pet-panel-ctrl');
    await fireEvent.click(buttons[1]);
    await waitFor(() => expect(toggleMaximizeMock).toHaveBeenCalledTimes(1));
  });

  it('window controls render in minimize / fullscreen / close order', () => {
    const { container } = render(<PetPanelApp />);
    const buttons = Array.from(container.querySelectorAll('.pet-panel-ctrl'));
    expect(buttons[0].querySelector('svg.lucide-minus')).toBeTruthy();
    expect(buttons[1].querySelector('svg.lucide-maximize-2')).toBeTruthy();
    expect(buttons[2].classList.contains('pet-panel-ctrl-close')).toBe(true);
    expect(buttons[2].querySelector('svg.lucide-x')).toBeTruthy();
  });

  // ── Drag handle (Fix 2) ──
  it('pointerdown on the header starts a native window drag', async () => {
    render(<PetPanelApp />);
    const header = screen.getByRole('banner');
    await fireEvent.pointerDown(header, { button: 0 });
    await waitFor(() => expect(startDraggingMock).toHaveBeenCalledTimes(1));
  });

  it('pointerdown on the drag handle starts a native window drag', async () => {
    const { container } = render(<PetPanelApp />);
    const handle = container.querySelector('.pet-panel-drag-handle')!;
    expect(handle).toBeTruthy();
    await fireEvent.pointerDown(handle, { button: 0 });
    await waitFor(() => expect(startDraggingMock).toHaveBeenCalledTimes(1));
  });

  it('pointerdown on the close button does NOT start a drag (stopPropagation)', async () => {
    const { container } = render(<PetPanelApp />);
    const close = container.querySelector('.pet-panel-ctrl-close')!;
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

  // ── Shortcut-summon: focus the search box ──
  // The global-shortcut path (`openPetPanelCentered` in PetApp.tsx) emits
  // `pet://panel-focus-search` after the panel is shown. The click path
  // does NOT emit it, so this is shortcut-only behavior.
  it('pet://panel-focus-search event focuses the search input', async () => {
    render(<PetPanelApp />);
    await waitFor(() => expect(eventInternals.getListeners('pet://panel-focus-search')).toBeDefined());
    const input = screen.getByRole('textbox');
    expect(document.activeElement).not.toBe(input);
    await act(async () => {
      eventInternals.emitTo('pet://panel-focus-search');
    });
    expect(document.activeElement).toBe(input);
  });
});
