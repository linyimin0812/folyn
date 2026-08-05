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
  const lineBufferRef = useRef('');
  const firstCommandSetRef = useRef(false);
  const setStatus = useTerminalStore((s) => s.setStatus);
  const setTitle = useTerminalStore((s) => s.setTitle);
  const resolvedTheme = useResolvedTheme();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Preserve the session's custom title (first command) when the panel is
    // collapsed and reopened: only overwrite with the shell name while the
    // title is still the auto-generated default ("终端 N").
    const sessionTitle = useTerminalStore
      .getState()
      .sessions.find((s) => s.id === id)?.title;
    const hasCustomTitle = !!sessionTitle && !/^终端 \d+$/.test(sessionTitle);
    if (hasCustomTitle) {
      firstCommandSetRef.current = true;
    }

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

    // fit() on a zero-size container (collapsed panel / inactive tab, which
    // are kept mounted with display:none) makes xterm's renderer lose its
    // dimensions; the next write then crashes inside syncScrollArea. Only fit
    // when the container actually has a size.
    const safeFit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      fit.fit();
    };

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
          safeFit();
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
        if (shellName && !hasCustomTitle) setTitle(id, shellName);
        setStatus(id, 'running');
        try {
          safeFit();
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
      // Name the tab after the first command the user runs (like VS Code /
      // iTerm): accumulate the current line and, on the first Enter, replace
      // the shell-name title with the command.
      if (!firstCommandSetRef.current) {
        for (const ch of data) {
          if (ch === '\r' || ch === '\n') {
            const cmd = lineBufferRef.current.trim();
            if (cmd) {
              firstCommandSetRef.current = true;
              setTitle(id, cmd.length > 36 ? `${cmd.slice(0, 36)}…` : cmd);
              lineBufferRef.current = '';
              break;
            }
            lineBufferRef.current = '';
          } else if (ch === '\x7f' || ch === '\b') {
            lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          } else if (ch === '\x15') {
            // Ctrl-U clears the line
            lineBufferRef.current = '';
          } else if (ch >= ' ' && ch < '\x7f') {
            lineBufferRef.current += ch;
          }
        }
      }
      if (isTauri() && spawnedRef.current) {
        void import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('terminal_write', { id, data }).catch(() => {});
        });
      }
    });

    const observer = new ResizeObserver(() => {
      try {
        safeFit();
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
      // NOTE: no terminal_kill here — collapsing the panel only unmounts the
      // xterm view; the PTY session stays alive in the Rust registry so
      // reopening shows the SAME shell. Sessions are killed explicitly via
      // the tab's × (terminalStore.closeSession) or on app exit.
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
        const el = containerRef.current;
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
          fitRef.current?.fit();
        }
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
