import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { isTauri } from '@/utils/platform';
import { useTerminalStore } from '@/store/terminalStore';
import { useVaultStore } from '@/store/vaultStore';

interface TerminalViewProps {
  id: string;
  active: boolean;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function TerminalView({ id, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const setStatus = useTerminalStore((s) => s.setStatus);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fitRef.current = fit;

    let cancelled = false;
    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const syncPtySize = () => {
      if (!spawnedRef.current || !isTauri()) return;
      try {
        const cols = term.cols;
        const rows = term.rows;
        void import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('terminal_resize', { id, cols, rows }).catch(() => {});
        });
      } catch {
        // container hidden — dims are 0, skip
      }
    };

    const start = async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlistenOutput = await listen<{ id: string; data: string }>('terminal-output', (e) => {
          if (e.payload.id !== id || cancelled) return;
          try {
            term.write(base64ToBytes(e.payload.data));
          } catch {
            // ignore malformed chunk
          }
        });
        unlistenExit = await listen<{ id: string }>('terminal-exit', (e) => {
          if (e.payload.id !== id) return;
          setStatus(id, 'exited');
        });

        if (!isTauri()) {
          term.writeln('终端仅在桌面端可用（Tauri 运行时）。');
          setStatus(id, 'exited');
          return;
        }
        const { invoke } = await import('@tauri-apps/api/core');
        const vault = useVaultStore.getState().currentVault?.basePath;
        await invoke('terminal_create', {
          id,
          cwd: vault ?? '',
          shell: null,
        });
        if (cancelled) return;
        spawnedRef.current = true;
        setStatus(id, 'running');
        try {
          fit.fit();
        } catch {
          // hidden container
        }
        syncPtySize();
      } catch (err) {
        const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
        term.writeln(`启动终端失败：${msg}`);
        setStatus(id, 'exited');
      }
    };
    void start();

    const dataDisposable = term.onData((data) => {
      if (isTauri() && spawnedRef.current) {
        void import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('terminal_write', { id, data }).catch(() => {});
        });
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        syncPtySize();
      } catch {
        // hidden container
      }
    });
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      if (isTauri() && spawnedRef.current) {
        void import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('terminal_kill', { id }).catch(() => {});
        });
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [id, setStatus]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        if (spawnedRef.current && term && isTauri()) {
          void import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('terminal_resize', { id, cols: term.cols, rows: term.rows }).catch(() => {});
          });
        }
        termRef.current?.focus();
      } catch {
        // ignore
      }
    }, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div
      className="absolute inset-0 p-[6px] bg-[#1e1e2e] overflow-hidden"
      style={{ display: active ? 'block' : 'none' }}
      onClick={() => termRef.current?.focus()}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
