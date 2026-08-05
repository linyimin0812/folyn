import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTerminalStore } from './terminalStore';
import { invoke } from '@tauri-apps/api/core';

beforeEach(() => {
  useTerminalStore.setState({ sessions: [], activeId: null });
  invoke.mockClear();
});

describe('useTerminalStore', () => {
  it('addSession creates a spawning session and activates it', () => {
    const id = useTerminalStore.getState().addSession();
    const s = useTerminalStore.getState();
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toMatchObject({ id, status: 'spawning' });
    expect(s.activeId).toBe(id);
  });

  it('setStatus and setTitle update the session', () => {
    const id = useTerminalStore.getState().addSession();
    useTerminalStore.getState().setStatus(id, 'running');
    useTerminalStore.getState().setTitle(id, 'zsh');
    const session = useTerminalStore.getState().sessions[0];
    expect(session.status).toBe('running');
    expect(session.title).toBe('zsh');
  });

  it('closeSession removes the tab and kills the PTY', async () => {
    const id = useTerminalStore.getState().addSession();
    useTerminalStore.getState().closeSession(id);
    expect(useTerminalStore.getState().sessions).toHaveLength(0);
    expect(useTerminalStore.getState().activeId).toBeNull();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('terminal_kill', { id }));
  });

  it('removing the active session activates the last remaining one', () => {
    const a = useTerminalStore.getState().addSession();
    const b = useTerminalStore.getState().addSession();
    useTerminalStore.getState().setActive(a);
    useTerminalStore.getState().removeSession(a);
    expect(useTerminalStore.getState().activeId).toBe(b);
  });
});
