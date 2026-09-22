import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { createEvent } from '@testing-library/dom';

// Mock @tauri-apps/api/window so the drag-handle handler + the maximize/
// pin controls can be asserted without native bindings. Mirrors the proven
// pattern in WindowControls.test.tsx. No mount-time `getCurrentWindow`
// call exists (the focus/blur auto-hide subscribes via the event API
// instead), so only the click-path accessors are stubbed.
const {
  startDraggingMock,
  toggleMaximizeMock,
  isMaximizedMock,
  scaleFactorMock,
} = vi.hoisted(() => ({
  startDraggingMock: vi.fn(async () => undefined),
  toggleMaximizeMock: vi.fn(async () => undefined),
  isMaximizedMock: vi.fn(async () => false),
  scaleFactorMock: vi.fn(async () => 2),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: startDraggingMock,
    toggleMaximize: toggleMaximizeMock,
    isMaximized: isMaximizedMock,
    scaleFactor: scaleFactorMock,
  }),
}));

// Mock the heavy child components so this test focuses on tab host behavior.
// Each renders a div tagged with its root class name (matches real root).
vi.mock('@/components/ai/AiPanel', () => ({
  AiPanel: () => <div className="ai-panel">chat</div>,
}));

import { PetPanelApp } from './PetPanelApp';
import { useExtensionStore } from '@/store/extensionStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useVaultStore } from '@/store/vaultStore';
import { usePetStore } from '@/store/petStore';

// Resolve the aliased core/event mocks AFTER `vi.mock('@tauri-apps/api/window')`
// is hoisted — importing these statically before the hoisted window mock was
// what desynced Vitest's mock application and let the real `getCurrentWindow`
// (reading `window.__TAURI_INTERNALS__.metadata`) run. WindowControls.test.tsx
// avoids this by importing no Tauri module statically; we follow the same
// discipline and resolve both lazily in `beforeAll`.
let invokeMock!: import('vitest').Mock;
let emitMock!: import('vitest').Mock;
let eventInternals!: { getListeners(c: string): unknown; emitTo(c: string, p?: unknown): void };

beforeAll(async () => {
  const { invoke } = await import('@tauri-apps/api/core');
  invokeMock = invoke as unknown as import('vitest').Mock;
  const eventApi = await import('@tauri-apps/api/event');
  eventInternals = eventApi.__internals;
  emitMock = eventApi.emit as unknown as import('vitest').Mock;
});

beforeEach(() => {
  invokeMock.mockClear();
  invokeMock.mockResolvedValue(undefined);
  startDraggingMock.mockClear();
  startDraggingMock.mockResolvedValue(undefined);
  toggleMaximizeMock.mockClear();
  toggleMaximizeMock.mockResolvedValue(undefined);
  isMaximizedMock.mockClear();
  isMaximizedMock.mockResolvedValue(false);
  scaleFactorMock.mockResolvedValue(2);
});

afterEach(() => {
  cleanup();
});

describe('PetPanelApp', () => {
  it('positions an extension over the pet panel before dispatching its open event', async () => {
    const { emitOpenExtensionTool } = await import('./PetPanelSearchResults');
    await emitOpenExtensionTool('example-extension');
    const placement = invokeMock.mock.calls.findIndex(([command]) => command === 'extension_tool_match_pet_panel');
    expect(placement).toBeGreaterThanOrEqual(0);
    const open = emitMock.mock.calls.findIndex(([event, payload]) =>
      event === 'pet://menu-action' && payload.extensionId === 'example-extension',
    );
    expect(open).toBeGreaterThanOrEqual(0);
    expect(invokeMock.mock.invocationCallOrder[placement]).toBeLessThan(emitMock.mock.invocationCallOrder[open]);
  });
  it('keeps logical size across DPI changes and persists manual resizing only while visible', async () => {
    const intervalSpy = vi.spyOn(window, 'setInterval');
    let physicalSize = { width: 880, height: 1240 };
    let visible = true;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'pet_get_work_area') return { x: 0, y: 25, width: 1680, height: 1025, scale_factor: 2 };
      if (command === 'pet_window_scale') return 2;
      if (command === 'pet_panel_is_visible') return visible;
      if (command === 'pet_panel_get_size') return physicalSize;
      if (command === 'pet_panel_get_position') return { x: 100, y: 100 };
      if (command === 'pet_cursor_probe') return { window_x: 100, window_y: 100 };
    });
    usePetStore.setState({ petPanelWidth: 440, petPanelHeight: 620, petPanelSizeVersion: 1 });
    try {
      render(<PetPanelApp />);
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_set_size', expect.anything()));
      const persist = intervalSpy.mock.calls.find(([, delay]) => delay === 800)?.[0];
      if (typeof persist !== 'function') throw new Error('Panel persistence timer not installed');
      await act(async () => { await persist(); });
      expect(usePetStore.getState().petPanelWidth).toBe(440);

      // Move the same logical window from a 2x screen to a 1x screen.
      scaleFactorMock.mockResolvedValue(1);
      physicalSize = { width: 440, height: 620 };
      await act(async () => { await persist(); });
      expect(usePetStore.getState()).toMatchObject({ petPanelWidth: 440, petPanelHeight: 620 });

      // A real user resize is remembered for the next open.
      physicalSize = { width: 500, height: 700 };
      await act(async () => { await persist(); });
      expect(usePetStore.getState()).toMatchObject({ petPanelWidth: 500, petPanelHeight: 700 });

      // Hidden-window frame changes must not replace the user's choice.
      visible = false;
      physicalSize = { width: 280, height: 360 };
      await act(async () => { await persist(); });
      expect(usePetStore.getState()).toMatchObject({ petPanelWidth: 500, petPanelHeight: 700 });
    } finally {
      intervalSpy.mockRestore();
    }
  });

  it('renders the chat body with a search box and no tab row', () => {
    const { container } = render(<PetPanelApp />);
    expect(container.querySelector('.ai-panel')).toBeTruthy();
    expect(container.querySelector('.pet-panel-search-input')).toBeTruthy();
    // The tab row was removed with the Inbox tab (PRD
    // 09-19-inbox-command-popup) — the inbox opens as the “Open Inbox”
    // command into the extension-tool popup, and Chat is the only body.
    expect(container.querySelector('.pet-panel-tabs')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('typing in the search box replaces the body with search results', () => {
    const { container } = render(<PetPanelApp />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'readme' } });
    expect(container.querySelector('.pet-panel-search-results')).toBeTruthy();
    expect(container.querySelector('.ai-panel')).toBeNull();
  });

  it('search results support arrow/enter keyboard navigation', async () => {
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

    // Results take over the body while searching.
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
  it('fullscreen button calls window.toggleMaximize', async () => {
    const { container } = render(<PetPanelApp />);
    const buttons = container.querySelectorAll('.pet-panel-ctrl');
    await fireEvent.click(buttons[1]);
    await waitFor(() => expect(toggleMaximizeMock).toHaveBeenCalledTimes(1));
  });

  it('window controls render in pin / fullscreen / close order', () => {
    const { container } = render(<PetPanelApp />);
    const buttons = Array.from(container.querySelectorAll('.pet-panel-ctrl'));
    expect(buttons).toHaveLength(3);
    expect(buttons[0].querySelector('svg.lucide-pin')).toBeTruthy();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].querySelector('svg.lucide-square')).toBeTruthy();
    expect(buttons[2].classList.contains('pet-panel-ctrl-close')).toBe(true);
    expect(buttons[2].querySelector('svg.lucide-x')).toBeTruthy();
  });

  // ── Pin control + outside-click auto-hide ──
  it('pin button toggles the pinned state (icon + aria-pressed)', async () => {
    const { container } = render(<PetPanelApp />);
    const pin = Array.from(container.querySelectorAll('.pet-panel-ctrl'))[0];
    // Starts unpinned: Pin icon, aria-pressed false, no is-active.
    expect(pin.querySelector('svg.lucide-pin')).toBeTruthy();
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(pin.classList.contains('is-active')).toBe(false);

    await fireEvent.click(pin);
    // Pinned: PinOff icon, aria-pressed true, is-active highlight.
    expect(pin.querySelector('svg.lucide-pin-off')).toBeTruthy();
    expect(pin.getAttribute('aria-pressed')).toBe('true');
    expect(pin.classList.contains('is-active')).toBe(true);
  });

  it('blur after focus-gained hides the panel when unpinned', async () => {
    render(<PetPanelApp />);
    await waitFor(() => expect(eventInternals.getListeners('tauri://blur')).toBeDefined());
    // Simulate show → focus gained, then user clicks outside → blur.
    await act(async () => {
      eventInternals.emitTo('tauri://focus');
    });
    invokeMock.mockClear();
    await act(async () => {
      eventInternals.emitTo('tauri://blur');
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
  });

  it('blur does NOT hide the panel when pinned', async () => {
    const { container } = render(<PetPanelApp />);
    await waitFor(() => expect(eventInternals.getListeners('tauri://blur')).toBeDefined());
    // Pin the panel, then focus gained → blur while pinned.
    const pin = Array.from(container.querySelectorAll('.pet-panel-ctrl'))[0];
    await fireEvent.click(pin);
    await act(async () => {
      eventInternals.emitTo('tauri://focus');
    });
    invokeMock.mockClear();
    await act(async () => {
      eventInternals.emitTo('tauri://blur');
    });
    // No hide while pinned.
    expect(invokeMock).not.toHaveBeenCalledWith('pet_panel_hide');
  });

  it('transient blur before any focus-gained does NOT hide (show-time guard)', async () => {
    render(<PetPanelApp />);
    await waitFor(() => expect(eventInternals.getListeners('tauri://blur')).toBeDefined());
    invokeMock.mockClear();
    // pet_panel_show's set_focus() can emit a spurious blur before
    // the real focus-gained — must not hide.
    await act(async () => {
      eventInternals.emitTo('tauri://blur');
    });
    expect(invokeMock).not.toHaveBeenCalledWith('pet_panel_hide');
  });

  // ── Drag handle (Fix 2) ──
  it('pointerdown on the header starts a native window drag', async () => {
    render(<PetPanelApp />);
    const header = screen.getByRole('banner');
    await fireEvent.pointerDown(header, { button: 0 });
    await waitFor(() => expect(startDraggingMock).toHaveBeenCalledTimes(1));
  });

  it('pointerdown on the title bar starts a native window drag', async () => {
    const { container } = render(<PetPanelApp />);
    const titlebar = container.querySelector('.pet-panel-titlebar')!;
    expect(titlebar).toBeTruthy();
    await fireEvent.pointerDown(titlebar, { button: 0 });
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

  it('pointerdown on a search row does NOT start a drag (stopPropagation)', async () => {
    render(<PetPanelApp />);
    const searchRow = document.querySelector('.pet-panel-search-row')!;
    expect(searchRow).toBeTruthy();
    await fireEvent.pointerDown(searchRow, { button: 0 });
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
  // The global-shortcut path (`openPetPanelAtCursor` in PetApp.tsx) emits
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

  // ── Translation search rows (PRD: translation popup refactor) ──
  // Searching "翻译" surfaces the builtin:translation row as TWO results:
  // the floating popup (open-extension-tool builtin:translation) first, then
  // the main-app page (run-command panel.translation). The translation TAB
  // was removed — these rows are the only in-panel entry points.
  describe('translation search rows', () => {
    const builtinRow = {
      entry: {
        id: 'builtin:translation',
        name: 'builtin:translation',
        version: '—',
        tier: 'sandbox' as const,
        trusted: true,
        integrity: {},
        enabled: true,
      },
      state: 'active' as const,
      builtin: true,
      nameKey: 'settings:appearance.panels.translation.label',
      descKey: 'settings:appearance.panels.translation.description',
    };

    /** Seed the extension store with ONLY the builtin row (the mount-time
     *  refresh fails benignly in jsdom — `list_extensions` returns undefined
     *  — and leaves the seeded rows intact) and remember the prior rows to
     *  restore after the test. */
    function seedBuiltinRow() {
      const prevRows = useExtensionStore.getState().rows;
      useExtensionStore.setState({ rows: [builtinRow] });
      return () => useExtensionStore.setState({ rows: prevRows });
    }

    afterEach(() => {
      // Belt-and-braces: restore both stores in case a test forgot its own
      // cleanup (appearance flag gates the rows; extension rows drive them).
      useAppearanceStore.getState().setEnableTranslationPanel(true);
      useExtensionStore.setState({ rows: [] });
    });

    it('searching 翻译 renders exactly the two translation rows', () => {
      const restore = seedBuiltinRow();
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '翻译' } });
      const items = container.querySelectorAll('.pet-panel-search-item');
      expect(items).toHaveLength(2);
      // Row A = popup, row B = main app (user preference: popup first).
      expect(items[0].textContent).toContain('翻译（弹窗）');
      expect(items[1].textContent).toContain('翻译（主应用）');
      // Both rows share the built-in row's description as the sub label.
      expect(items[0].textContent).toContain('双栏翻译');
      expect(items[1].textContent).toContain('双栏翻译');
      restore();
    });

    it('clicking the main-app row emits run-command panel.translation', async () => {
      const restore = seedBuiltinRow();
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '翻译' } });
      // The main-app row is the SECOND row (popup renders first).
      await fireEvent.click(container.querySelectorAll('.pet-panel-search-item')[1]);
      // activateItem is async (dynamic import + emit) — wait for the call.
      await waitFor(() =>
        expect(emitMock).toHaveBeenCalledWith('pet://menu-action', {
          action: 'run-command',
          commandId: 'panel.translation',
        }),
      );
      // Picking a result dismisses the panel (onDone → pet_panel_hide).
      await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide'));
      restore();
    });

    it('clicking the popup row emits open-extension-tool builtin:translation', async () => {
      const restore = seedBuiltinRow();
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '翻译' } });
      // The popup row is the FIRST row (user preference: popup first).
      await fireEvent.click(container.querySelectorAll('.pet-panel-search-item')[0]);
      // activateItem is async (dynamic import + emit) — wait for the call.
      await waitFor(() =>
        expect(emitMock).toHaveBeenCalledWith('pet://menu-action', {
          action: 'open-extension-tool',
          extensionId: 'builtin:translation',
        }),
      );
      // Place before the open event, then hide without deactivating the new popup.
      expect(invokeMock).toHaveBeenCalledWith('extension_tool_match_pet_panel');
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide', { restoreFocus: false }),
      );
      restore();
    });

    it('hides both translation rows when enableTranslationPanel is false', () => {
      const restore = seedBuiltinRow();
      useAppearanceStore.getState().setEnableTranslationPanel(false);
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '翻译' } });
      expect(container.querySelectorAll('.pet-panel-search-item')).toHaveLength(0);
      expect(container.querySelector('.pet-panel-search-empty')).toBeTruthy();
      // Restore the appearance flag for the next test (also covered by the
      // afterEach belt-and-braces restore).
      useAppearanceStore.getState().setEnableTranslationPanel(true);
      restore();
    });

    it('keyboard navigation walks the two translation rows (data-search-index 0/1)', async () => {
      const restore = seedBuiltinRow();
      const { container } = render(<PetPanelApp />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: '翻译' } });
      const items = container.querySelectorAll('.pet-panel-search-item');
      expect(items).toHaveLength(2);
      expect(items[0].getAttribute('data-search-index')).toBe('0');
      expect(items[1].getAttribute('data-search-index')).toBe('1');
      // First row is highlighted by default (popup — it renders first).
      expect(items[0].classList.contains('is-active')).toBe(true);
      // ArrowDown moves the highlight to the main-app row.
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(items[1].classList.contains('is-active')).toBe(true);
      expect(items[0].classList.contains('is-active')).toBe(false);
      // ArrowUp moves back to the popup row.
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(items[0].classList.contains('is-active')).toBe(true);
      // Enter on the popup row (index 0) routes to open-extension-tool.
      emitMock.mockClear();
      fireEvent.keyDown(input, { key: 'Enter' });
      await waitFor(() =>
        expect(emitMock).toHaveBeenCalledWith('pet://menu-action', {
          action: 'open-extension-tool',
          extensionId: 'builtin:translation',
        }),
      );
      restore();
    });
  });

  // ── Inbox command row (PRD: 09-19-inbox-command-popup) ──
  // The Inbox tab was removed — the “Open Inbox” command is the in-panel
  // entry point. Searching 收件箱 surfaces it in the Commands group; picking
  // it routes run-command to the main window (which runs the registered
  // action.open-inbox → open_extension_tool_window builtin:inbox) and hides
  // the panel without restoring focus so the popup remains active.
  // The real command is registered by App.tsx's registerBuiltinCommands
  // (not run in tests) — seed a stand-in with the same id/title/keywords.
  describe('inbox command row', () => {
    it('searching 收件箱 surfaces the Open Inbox command row', async () => {
      const { registerCommand } = await import('@/services/commandRegistry');
      const d = registerCommand({
        id: 'action.open-inbox',
        title: 'Open Inbox',
        category: 'action',
        keywords: ['inbox', 'notifications', 'notify', '收件箱', '通知'],
        run: async () => undefined,
      });
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '收件箱' } });
      const items = container.querySelectorAll('.pet-panel-search-item');
      expect(items).toHaveLength(1);
      expect(items[0].textContent).toContain('Open Inbox');
      d.dispose();
    });

    it('picking the row emits run-command action.open-inbox and hides without restoring focus', async () => {
      const { registerCommand } = await import('@/services/commandRegistry');
      const d = registerCommand({
        id: 'action.open-inbox',
        title: 'Open Inbox',
        category: 'action',
        keywords: ['inbox', 'notifications', 'notify', '收件箱', '通知'],
        run: async () => undefined,
      });
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '收件箱' } });
      await fireEvent.click(container.querySelectorAll('.pet-panel-search-item')[0]);
      await waitFor(() =>
        expect(emitMock).toHaveBeenCalledWith('pet://menu-action', {
          action: 'run-command',
          commandId: 'action.open-inbox',
        }),
      );
      // The inbox command follows the same in-place replacement path.
      expect(invokeMock).toHaveBeenCalledWith('extension_tool_match_pet_panel');
      await waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide', { restoreFocus: false }),
      );
      d.dispose();
    });
  });

  // ── All-file-types search (PRD: 09-19-pet-search-all-files) ──
  // The Files group lists EVERY vault file, not just .md — the tree already
  // carries all types; picking a non-markdown row routes through the same
  // pet://bubble-action jump (editorIoService.openFile handles any type).
  describe('all file types search', () => {
    const prevTree = useVaultStore.getState().fileTree;

    afterEach(() => {
      useVaultStore.setState({ fileTree: prevTree });
    });

    it('matches non-markdown files (png/csv) with per-type icons', () => {
      useVaultStore.setState({
        fileTree: [
          { path: 'assets', name: 'assets', type: 'dir', children: [
            { path: 'assets/logo.png', name: 'logo.png', type: 'file' },
            { path: 'assets/data.csv', name: 'data.csv', type: 'file' },
          ] },
          { path: 'readme.md', name: 'readme.md', type: 'file' },
        ],
      });
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'assets/' } });
      const items = container.querySelectorAll('.pet-panel-search-item');
      // Both non-markdown files surface (logo.png + data.csv).
      expect(items).toHaveLength(2);
      expect(items[0].textContent).toContain('logo.png');
      expect(items[1].textContent).toContain('data.csv');
      // Per-type icons (FileIcon) instead of the old hardcoded markdown
      // one: each row renders an icon (ThemeIcon = <img> with the svg data
      // URI; distinct types map to distinct icon files, e.g. image vs
      // spreadsheet).
      const imgs = items[0].querySelectorAll('img');
      expect(imgs.length).toBeGreaterThanOrEqual(1);
      expect(items[1].querySelector('img')).toBeTruthy();
      expect(items[0].querySelector('img')!.getAttribute('src'))
        .not.toBe(items[1].querySelector('img')!.getAttribute('src'));
    });

    it('clicking a non-markdown file emits the same navigate jump', async () => {
      useVaultStore.setState({
        fileTree: [
          { path: 'assets', name: 'assets', type: 'dir', children: [
            { path: 'assets/logo.png', name: 'logo.png', type: 'file' },
          ] },
        ],
      });
      const { container } = render(<PetPanelApp />);
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'logo' } });
      await fireEvent.click(container.querySelectorAll('.pet-panel-search-item')[0]);
      await waitFor(() =>
        expect(emitMock).toHaveBeenCalledWith('pet://bubble-action', {
          type: 'navigate',
          target: { kind: 'file', id: 'assets/logo.png' },
          source: 'pet-panel-search',
        }),
      );
    });
  });
});

// ── 最近使用 recents row (PRD: 09-19-pet-search-recents, reworked to
// extensions) ──
// Focus-gated row of recently used EXTENSION chips (icon + display name)
// below the search box: visible while focus sits in the search area (input
// or chip), hidden when the caret is elsewhere (chat input). Chip click
// re-opens that tool via the same open-extension-tool path as a picked
// search row (emit + panel hide restoring focus). React focus handlers ride
// on focusin/focusout — jsdom needs those dispatched explicitly
// (fireEvent.focus/blur emit non-bubbling native events React's delegation
// doesn't see for container handlers).
describe('search recents row', () => {
  const prevRecents = usePetStore.getState().recentExtensionIds;
  const prevRows = useExtensionStore.getState().rows;

  afterEach(() => {
    usePetStore.setState({ recentExtensionIds: prevRecents });
    useExtensionStore.setState({ rows: prevRows });
  });

  function focusSearch(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>('.pet-panel-search-input')!;
    fireEvent(input, new Event('focusin', { bubbles: true }));
  }

  it('is hidden when the search input is not focused (chat caret case)', () => {
    usePetStore.setState({ recentExtensionIds: ['builtin:translation'] });
    const { container } = render(<PetPanelApp />);
    expect(container.querySelector('.pet-panel-search-recents')).toBeNull();
  });

  it('appears with icon+name chips for recently used extensions', () => {
    usePetStore.setState({ recentExtensionIds: ['builtin:translation', 'builtin:inbox'] });
    // Seed the builtin:translation row so the chip resolves its i18n name.
    useExtensionStore.setState({
      rows: [
        {
          entry: {
            id: 'builtin:translation',
            name: 'builtin:translation',
            version: '—',
            tier: 'sandbox',
            trusted: true,
            integrity: {},
            enabled: true,
          },
          state: 'active',
          builtin: true,
          nameKey: 'settings:appearance.panels.translation.label',
        },
      ],
    });
    const { container } = render(<PetPanelApp />);
    focusSearch(container);
    const row = container.querySelector('.pet-panel-search-recents');
    expect(row).toBeTruthy();
    const chips = row!.querySelectorAll('.pet-panel-search-chip');
    expect(chips).toHaveLength(2);
    // builtin:translation chip resolves its name from the row's nameKey;
    // builtin:inbox (no row) falls back to the static recentsInbox label.
    expect(chips[0].textContent).toContain('翻译');
    expect(chips[1].textContent).toContain('收件箱');
    expect(row!.getAttribute('role')).toBe('toolbar');
  });

  it('hides when focus moves out of the search area (relatedTarget outside)', () => {
    usePetStore.setState({ recentExtensionIds: ['builtin:inbox'] });
    const { container } = render(<PetPanelApp />);
    focusSearch(container);
    expect(container.querySelector('.pet-panel-search-recents')).toBeTruthy();
    const input = container.querySelector<HTMLInputElement>('.pet-panel-search-input')!;
    // Focus lands in the chat body — outside the search area.
    const outside = document.createElement('input');
    container.querySelector('.pet-panel-body')!.appendChild(outside);
    const ev = new Event('focusout', { bubbles: true });
    Object.defineProperty(ev, 'relatedTarget', { value: outside, configurable: true });
    fireEvent(input, ev);
    expect(container.querySelector('.pet-panel-search-recents')).toBeNull();
  });

  it('stays visible when focus moves onto a chip (relatedTarget inside)', () => {
    usePetStore.setState({ recentExtensionIds: ['builtin:inbox'] });
    const { container } = render(<PetPanelApp />);
    focusSearch(container);
    const input = container.querySelector<HTMLInputElement>('.pet-panel-search-input')!;
    const chip = container.querySelector<HTMLButtonElement>('.pet-panel-search-chip')!;
    const ev = new Event('focusout', { bubbles: true });
    Object.defineProperty(ev, 'relatedTarget', { value: chip, configurable: true });
    fireEvent(input, ev);
    expect(container.querySelector('.pet-panel-search-recents')).toBeTruthy();
  });

  it('clicking a chip emits open-extension-tool for that extension and hides without restoring focus', async () => {
    usePetStore.setState({ recentExtensionIds: ['builtin:translation', 'builtin:inbox'] });
    const { container } = render(<PetPanelApp />);
    focusSearch(container);
    // The second chip is builtin:inbox (no row → fallback label).
    const chips = container.querySelectorAll<HTMLButtonElement>('.pet-panel-search-chip');
    fireEvent.click(chips[1]);
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith('pet://menu-action', {
        action: 'open-extension-tool',
        extensionId: 'builtin:inbox',
      }),
    );
    // Recent chips reuse the in-place replacement and preserve popup focus.
    expect(invokeMock).toHaveBeenCalledWith('extension_tool_match_pet_panel');
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('pet_panel_hide', { restoreFocus: false }),
    );
  });

  it('renders no row when there are no recently used extensions', () => {
    usePetStore.setState({ recentExtensionIds: [] });
    const { container } = render(<PetPanelApp />);
    focusSearch(container);
    expect(container.querySelector('.pet-panel-search-recents')).toBeNull();
  });
});

// ── `/` extension browse mode (PRD: 09-19-pet-search-recents follow-up) ──
// A bare `/` lists EVERY extension (fixing the partial match) while files /
// commands keep their normal whole-query substring matching — a bare `/`
// still matches every file inside a directory (its path contains `/`), so
// the scrollable mixed extensions+files list stays (user-confirmed behavior).
// `/xyz` filters extensions by `xyz`; files match the FULL query (`/xyz` in
// name/path — e.g. `assets/logo.png` matches `/logo`).
describe('search `/` extension browse mode', () => {
  const prevRows = useExtensionStore.getState().rows;
  const prevTree = useVaultStore.getState().fileTree;

  const extRow = (id: string, name: string, description?: string) => ({
    entry: {
      id,
      name,
      version: '1.0.0',
      tier: 'sandbox' as const,
      trusted: true,
      integrity: {},
      enabled: true,
    },
    state: 'active' as const,
    description,
  });

  afterEach(() => {
    useExtensionStore.setState({ rows: prevRows });
    useVaultStore.setState({ fileTree: prevTree });
    useAppearanceStore.getState().setEnableTranslationPanel(true);
  });

  it('bare `/` lists every extension AND directory files (mixed list)', () => {
    useVaultStore.setState({
      fileTree: [
        { path: 'assets', name: 'assets', type: 'dir', children: [
          { path: 'assets/logo.png', name: 'logo.png', type: 'file' },
        ] },
        { path: 'readme.md', name: 'readme.md', type: 'file' },
      ],
    });
    useExtensionStore.setState({
      rows: [extRow('carousel', 'Carousel'), extRow('dbml', 'DBML'), extRow('store', 'Store')],
    });
    const { container } = render(<PetPanelApp />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/' } });
    const items = container.querySelectorAll('.pet-panel-search-item');
    // 3 extension rows + the directory file (its path contains `/`).
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('Carousel');
    expect(container.textContent).toContain('logo.png');
    // Root-level files (no `/` in name or path) don't match a bare `/`.
    expect(container.textContent).not.toContain('readme.md');
  });

  it('`/xyz` filters extensions by xyz; files match the full query', () => {
    useVaultStore.setState({
      fileTree: [
        { path: 'assets', name: 'assets', type: 'dir', children: [
          { path: 'assets/car.png', name: 'car.png', type: 'file' },
        ] },
        { path: 'carousel-notes.md', name: 'carousel-notes.md', type: 'file' },
      ],
    });
    useExtensionStore.setState({
      rows: [extRow('carousel', 'Carousel'), extRow('dbml', 'DBML')],
    });
    const { container } = render(<PetPanelApp />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/car' } });
    const items = container.querySelectorAll('.pet-panel-search-item');
    // Carousel (extension filter `car`) + `assets/car.png` (its path
    // contains the literal `/car`). `carousel-notes.md` matches `car` but
    // NOT the full query `/car` — it stays hidden.
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Carousel');
    expect(container.textContent).toContain('car.png');
    expect(container.textContent).not.toContain('carousel-notes.md');
  });

  it('`/` respects the translation panel gate (row hidden when disabled)', () => {
    useAppearanceStore.getState().setEnableTranslationPanel(false);
    useExtensionStore.setState({
      rows: [
        {
          entry: {
            id: 'builtin:translation',
            name: 'builtin:translation',
            version: '—',
            tier: 'sandbox' as const,
            trusted: true,
            integrity: {},
            enabled: true,
          },
          state: 'active' as const,
          builtin: true,
          nameKey: 'settings:appearance.panels.translation.label',
          descKey: 'settings:appearance.panels.translation.description',
        },
        extRow('carousel', 'Carousel'),
      ],
    });
    const { container } = render(<PetPanelApp />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/' } });
    // The gated translation row (which would render TWO rows) is absent;
    // only carousel remains.
    const items = container.querySelectorAll('.pet-panel-search-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Carousel');
  });

  it('a mid-string slash is NOT browse mode (normal substring matching)', () => {
    useVaultStore.setState({
      fileTree: [{ path: 'notes/readme.md', name: 'readme.md', type: 'file' }],
    });
    const { container } = render(<PetPanelApp />);
    // `翻译/` — trailing slash, not a leading one: normal matching (nothing
    // contains that literal string) → empty results.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '翻译/' } });
    expect(container.querySelectorAll('.pet-panel-search-item')).toHaveLength(0);
    expect(container.querySelector('.pet-panel-search-empty')).toBeTruthy();
  });
});
