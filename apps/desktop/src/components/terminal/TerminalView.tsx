import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { isTauri } from '@/utils/platform';
import { useTerminalStore } from '@/store/terminalStore';
import { useVaultStore } from '@/store/vaultStore';
import { useResolvedTheme } from '@/hooks/useTheme';

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

/** Read a CSS variable from the app theme (light/dark via `data-theme`). */
function cssVar(name: string): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000000'
  );
}

/**
 * xterm palette derived entirely from the app's theme tokens, so the terminal
 * follows the configured light/dark theme instead of forcing a dark look.
 */
function terminalTheme(): Record<string, string> {
  return {
    background: cssVar('--bg'),
    foreground: cssVar('--t1'),
    cursor: cssVar('--acc'),
    cursorAccent: cssVar('--bg'),
    selectionBackground: cssVar('--accglow'),
    black: cssVar('--t4'),
    red: cssVar('--red'),
    green: cssVar('--green'),
    yellow: cssVar('--amber'),
    blue: cssVar('--acc'),
    magenta: cssVar('--purple'),
    cyan: cssVar('--cyan'),
    white: cssVar('--t2'),
    brightBlack: cssVar('--t3'),
    brightRed: cssVar('--red'),
    brightGreen: cssVar('--green'),
    brightYellow: cssVar('--amber'),
    brightBlue: cssVar('--acc'),
    brightMagenta: cssVar('--purple'),
    brightCyan: cssVar('--cyan'),
    brightWhite: cssVar('--t1'),
  };
}

export function TerminalView({ id, active }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const setStatus = useTerminalStore((s) => s.setStatus);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"DM Mono", Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.2,
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
        // React.StrictMode double-invokes effects in dev: the first pass is
        // cancelled synchronously, so abort before attaching listeners or
        // spawning — otherwise two shells would share one terminal id and
        // their output would interleave (double rc output / double prompts).
        if (cancelled) return;
        unlistenOutput = await listen<{ id: string; data: string }>('terminal-output', (e) => {
          if (e.payload.id !== id || cancelled) return;
          try {
            term.write(base64ToBytes(e.payload.data));
          } catch {
            // ignore malformed chunk
          }
        });
        if (cancelled) {
          unlistenOutput?.();
          unlistenOutput = null;
          return;
        }
        unlistenExit = await listen<{ id: string }>('terminal-exit', (e) => {
          if (e.payload.id !== id) return;
          setStatus(id, 'exited');
        });
        if (cancelled) {
          unlistenOutput?.();
          unlistenExit?.();
          return;
        }

        if (!isTauri()) {
          term.writeln('终端仅在桌面端可用（Tauri 运行时）。');
          setStatus(id, 'exited');
          return;
        }
        const { invoke } = await import('@tauri-apps/api/core');
        if (cancelled) return;
        try {
          fit.fit();
        } catch {
          // container hidden — keep the pty at its default size
        }
        // Start in the current vault root (the terminal's working directory).
        const vaultState = useVaultStore.getState();
        const vaultRoot =
          vaultState.currentVault?.basePath ??
          vaultState.vaults.find((v) => v.id === vaultState.activeVaultId)?.basePath ??
          vaultState.vaults[0]?.basePath ??
          '';
        const shell = await invoke<string>('terminal_create', {
          id,
          cwd: vaultRoot,
          shell: null,
          cols: Math.max(term.cols, 2),
          rows: Math.max(term.rows, 2),
          theme: resolvedTheme,
        });
        if (cancelled) {
          // The effect was torn down while the shell was spawning — kill the
          // fresh pty so it doesn't linger as an orphan.
          invoke('terminal_kill', { id }).catch(() => {});
          return;
        }
        spawnedRef.current = true;
        const shellName = shell.split('/').pop();
        if (shellName) setTitle(id, shellName);
        setStatus(id, 'running');
        try {
          fit.fit();
        } catch {
          // hidden container
        }
        syncPtySize();
      } catch (err) {
        const msg = (typeof err === 'string' ? err : err instanceof Error ? err.message : String(err)).split('\n')[0];
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
  }, [id, setStatus, setTitle]);

  // Keep the xterm palette in sync with the app theme (light/dark/system).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = terminalTheme();
  }, [resolvedTheme]);

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
      className="absolute inset-0 p-2 bg-bg overflow-hidden"
      style={{ display: active ? 'block' : 'none' }}
      onClick={() => termRef.current?.focus()}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}
