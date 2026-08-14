import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { WindowControls } from './WindowControls';
import { isWindowsPlatform } from '@/utils/shellSidecar';

// The component resolves the window API via dynamic `import()`, so the
// window mocks below apply to both the effect and the click handlers.
const {
  minimizeMock,
  toggleMaximizeMock,
  closeMock,
  isMaximizedMock,
  onResizedMock,
} = vi.hoisted(() => ({
  minimizeMock: vi.fn(async () => undefined),
  toggleMaximizeMock: vi.fn(async () => undefined),
  closeMock: vi.fn(async () => undefined),
  isMaximizedMock: vi.fn(async () => false),
  onResizedMock: vi.fn(async () => vi.fn()),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: minimizeMock,
    toggleMaximize: toggleMaximizeMock,
    close: closeMock,
    isMaximized: isMaximizedMock,
    onResized: onResizedMock,
  }),
}));

vi.mock('@/utils/shellSidecar', () => ({
  isWindowsPlatform: vi.fn(),
}));

// test/setup.desktop.ts initializes i18n with the zh locale, so `t()`
// returns the Chinese strings (same convention as Topbar.test.tsx).
const T_MIN = '最小化';
const T_MAX = '最大化';
const T_RESTORE = '还原';
const T_CLOSE = '关闭';

beforeEach(() => {
  vi.mocked(isWindowsPlatform).mockReturnValue(true);
  minimizeMock.mockClear();
  toggleMaximizeMock.mockClear();
  closeMock.mockClear();
  isMaximizedMock.mockClear();
  onResizedMock.mockClear();
  isMaximizedMock.mockResolvedValue(false);
});

afterEach(() => cleanup());

describe('WindowControls', () => {
  it('renders nothing on non-Windows platforms', () => {
    vi.mocked(isWindowsPlatform).mockReturnValue(false);
    render(<WindowControls />);
    expect(screen.queryByTitle(T_MIN)).toBeNull();
    expect(screen.queryByTitle(T_MAX)).toBeNull();
    expect(screen.queryByTitle(T_CLOSE)).toBeNull();
  });

  it('renders minimize / maximize / close buttons on Windows', async () => {
    render(<WindowControls />);
    expect(await screen.findByTitle(T_MIN)).toBeTruthy();
    expect(screen.getByTitle(T_MAX)).toBeTruthy();
    expect(screen.getByTitle(T_CLOSE)).toBeTruthy();
  });

  it('minimize button calls the window minimize API', async () => {
    render(<WindowControls />);
    fireEvent.click(await screen.findByTitle(T_MIN));
    await waitFor(() => expect(minimizeMock).toHaveBeenCalledTimes(1));
  });

  it('maximize button toggles maximize and swaps to the restore icon', async () => {
    render(<WindowControls />);
    fireEvent.click(await screen.findByTitle(T_MAX));
    await waitFor(() => expect(toggleMaximizeMock).toHaveBeenCalledTimes(1));

    // A resize (aero-snap / drag-to-top) while maximized flips the icon
    isMaximizedMock.mockResolvedValue(true);
    const resizeHandler = onResizedMock.mock.calls[0][0];
    await resizeHandler();
    await waitFor(() => expect(screen.getByTitle(T_RESTORE)).toBeTruthy());
  });

  it('close button calls the window close API', async () => {
    render(<WindowControls />);
    fireEvent.click(await screen.findByTitle(T_CLOSE));
    await waitFor(() => expect(closeMock).toHaveBeenCalledTimes(1));
  });
});
