import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

// Tauri APIs are aliased to vi.fn mocks via vitest.workspace.ts (run from the
// monorepo root so the workspace file is discovered).
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { PetBubbleApp, type PetBubblePayload } from './PetBubbleApp';
import { usePetStore } from '@/store/petStore';

const invokeMock = invoke as unknown as import('vitest').Mock;
const listenMock = listen as unknown as import('vitest').Mock;
const emitMock = emit as unknown as import('vitest').Mock;

type AuthorizeReq = { app: string; launch: { type: string; value: string } };

// `get_pet_position` / `pet_get_work_area` need real-shaped returns so
// `positionAndShowBubble` doesn't throw on `.x` / `.scale_factor` reads.
function stubInvokeResults() {
  invokeMock.mockImplementation(async (cmd: string) => {
    switch (cmd) {
      case 'get_pet_position':
        return { x: 2688, y: 1462 }; // physical px (logical 1344,731 @ sf 2)
      case 'pet_get_work_area':
        return { x: 0, y: 25, width: 1440, height: 875, scale_factor: 2 };
      default:
        return undefined;
    }
  });
}

/** Wait for the component's async mount effect to register the
 *  `pet://bubble-show` listener (the effect awaits a couple of Tauri imports
 *  + `invoke` before calling `listen`, so it lands on a microtask). */
async function waitForListener(): Promise<void> {
  await waitFor(() => {
    expect(listenMock).toHaveBeenCalledWith('pet://bubble-show', expect.any(Function));
  });
}

/** Grab the `pet://bubble-show` listener callback the component registered. */
function getBubbleShowHandler(): (e: { payload: PetBubblePayload }) => void {
  const call = listenMock.mock.calls.find((c: unknown[]) => c[0] === 'pet://bubble-show');
  if (!call) throw new Error('pet://bubble-show listener was not registered');
  return call[1] as (e: { payload: PetBubblePayload }) => void;
}

const samplePayload: PetBubblePayload = {
  title: '提醒',
  text: '这是一条气泡通知示例',
  kind: 'info',
  target: { kind: 'schedule', id: 'demo' },
  actions: [{ id: 'view', label: '查看详情', kind: 'primary' }],
};

function countHideCalls(): number {
  return invokeMock.mock.calls.filter((c: unknown[]) => c[0] === 'pet_bubble_hide').length;
}

describe('PetBubbleApp', () => {
  beforeEach(() => {
    stubInvokeResults();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('registers a pet://bubble-show listener on mount and renders nothing until a payload arrives', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    expect(screen.queryByText('这是一条气泡通知示例')).toBeNull();
  });

  it('renders the card, positions + shows the window on bubble-show', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    expect(screen.getByText('提醒')).toBeTruthy();
    expect(screen.queryByText('这是一条气泡通知示例')).not.toBeNull();
    expect(screen.queryByText('查看详情')).not.toBeNull();
    // Positioned + shown via the custom invoke commands.
    expect(invokeMock).toHaveBeenCalledWith('pet_bubble_set_position', expect.any(Object));
    expect(invokeMock).toHaveBeenCalledWith('pet_bubble_show');
  });

  it('hides the window when the ✕ close button is clicked', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    await act(async () => {
      // The default Cloudia template renders its close with aria-label="Close".
      fireEvent.click(screen.getByLabelText('Close'));
    });
    await waitFor(() => expect(countHideCalls()).toBe(1));
    expect(screen.queryByText('这是一条气泡通知示例')).toBeNull();
  });

  it('emits pet://bubble-action and closes when an action button is clicked', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('查看详情'));
    });
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(
        'pet://bubble-action',
        expect.objectContaining({
          type: 'action',
          actionId: 'view',
          target: { kind: 'schedule', id: 'demo' },
        }),
      ),
    );
    await waitFor(() => expect(countHideCalls()).toBe(1));
    expect(screen.queryByText('这是一条气泡通知示例')).toBeNull();
  });

  it('emits a navigate action when the title (with target) is clicked', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('提醒'));
    });
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(
        'pet://bubble-action',
        expect.objectContaining({
          type: 'navigate',
          target: { kind: 'schedule', id: 'demo' },
        }),
      ),
    );
  });

  it('auto-dismisses after BUBBLE_TTL_MS', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    vi.useFakeTimers();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    expect(screen.getByText('这是一条气泡通知示例')).toBeTruthy();
    expect(countHideCalls()).toBe(0);
    const ttl = usePetStore.getState().cornerTtlMs as number;
    await act(async () => {
      vi.advanceTimersByTime(ttl);
    });
    // Flush the async hideBubble() microtasks the TTL callback scheduled.
    await act(async () => {});
    expect(countHideCalls()).toBe(1);
    expect(screen.queryByText('这是一条气泡通知示例')).toBeNull();
  });

  it('replaces an in-flight bubble on a second bubble-show (no double TTL)', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    vi.useFakeTimers();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    const second: PetBubblePayload = { text: '第二条', kind: 'reminder' };
    await act(async () => {
      handler({ payload: second });
    });
    expect(screen.queryByText('第二条')).not.toBeNull();
    expect(screen.queryByText('这是一条气泡通知示例')).toBeNull();
    expect(countHideCalls()).toBe(0);
    // Advancing past one TTL dismisses the second bubble exactly once — the
    // first TTL was cleared when the second show arrived (no late dismiss).
    const ttl = usePetStore.getState().cornerTtlMs as number;
    await act(async () => {
      vi.advanceTimersByTime(ttl);
    });
    await act(async () => {});
    expect(countHideCalls()).toBe(1);
    expect(screen.queryByText('第二条')).toBeNull();
  });

  it('emits a launch event when payload.launch is set and the body is clicked', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    const payload: PetBubblePayload = {
      text: 'click me',
      kind: 'info',
      launch: { type: 'url', value: 'https://example.com' },
    };
    await act(async () => {
      handler({ payload });
    });
    // Click on the bubble-text (no [data-action]) → top-level launch fires.
    await act(async () => {
      fireEvent.click(screen.getByText('click me'));
    });
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(
        'pet://bubble-action',
        expect.objectContaining({
          type: 'launch',
          launch: { type: 'url', value: 'https://example.com' },
        }),
      ),
    );
  });

  it('shows the authorize UI when pet://bubble-authorize-request arrives', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    // Simulate the main-window emit path: find the registered authorize
    // listener and fire it with an unwhitelisted app.
    const authCall = listenMock.mock.calls.find(
      ([ch]: [string]) => ch === 'pet://bubble-authorize-request',
    );
    expect(authCall).toBeTruthy();
    const authHandler = authCall![1] as (e: { payload: AuthorizeReq }) => void;
    await act(async () => {
      authHandler({
        payload: {
          app: 'Xcode',
          launch: { type: 'app', value: 'Xcode' },
        },
      });
    });
    expect(screen.getByText(/未授权应用/)).toBeTruthy();
    expect(screen.getByText(/Xcode/)).toBeTruthy();
  });

  it('emits authorize with whitelist mode when the user approves', async () => {
    render(<PetBubbleApp />);
    await waitForListener();
    const handler = getBubbleShowHandler();
    await act(async () => {
      handler({ payload: samplePayload });
    });
    const authCall = listenMock.mock.calls.find(
      ([ch]: [string]) => ch === 'pet://bubble-authorize-request',
    );
    const authHandler = authCall![1] as (e: { payload: AuthorizeReq }) => void;
    await act(async () => {
      authHandler({
        payload: {
          app: 'Xcode',
          launch: { type: 'app', value: 'Xcode' },
        },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('允许并加入白名单'));
    });
    await waitFor(() =>
      expect(emitMock).toHaveBeenCalledWith(
        'pet://bubble-action',
        expect.objectContaining({
          type: 'authorize',
          authorize: { app: 'Xcode', mode: 'whitelist' },
          launch: { type: 'app', value: 'Xcode' },
        }),
      ),
    );
  });
});
