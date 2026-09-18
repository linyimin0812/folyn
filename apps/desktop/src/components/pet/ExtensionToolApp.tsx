/**
 * ExtensionToolApp — the sandbox extension tool popup, pet-panel style.
 *
 * Hosts the `extension-tool-panel` window (statically declared in
 * tauri.conf.json, converted to an NSPanel at setup — the same machinery as
 * the pet panels, which is why it floats over every app/Space like the pet
 * popup does). This route is the window's content:
 *
 *  - a pet-panel-style chrome: borderless window with a rounded body, a
 *    draggable title bar (data-tauri-drag-region), the tool title, and a
 *    close button;
 *  - an `<iframe sandbox="allow-scripts">` loading the extension's tool
 *    entry from `folyn-extension://localhost/<ext>/<entry>` — the same
 *    origin-isolated scheme the dynamic tool windows used, so the
 *    permission-checked fetch-RPC bridge keeps working unchanged (the
 *    `extension-rpc-request` event is global; the MAIN window's listener
 *    dispatches and responds — this window needs no RPC wiring).
 *
 * The window is never destroyed: close → `hide_extension_tool_window`
 * (pet-panel lifecycle); reopening re-surfaces it and swaps the iframe.
 */

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/utils/platform';

/** Payload of the `extension-tool://open` event (Rust → this window). */
interface ExtensionToolOpenPayload {
  extensionId: string;
  toolId: string;
  entry: string;
  title: string;
}

const PANEL_LABEL = 'extension-tool-panel';

/** Desktop-pet-style panel chrome (see PetPanelApp / pet.css for reference).
 *  Fixed colors — this secondary window has no theme CSS variables loaded
 *  (independent realm), so var(--bg) would fall back and read as flat gray. */
const shellStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  overflow: 'hidden',
  background: '#1e1e22',
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.45)',
};

const titleBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  flex: '0 0 auto',
  paddingLeft: 12,
  paddingRight: 8,
  userSelect: 'none',
  borderBottom: '1px solid rgba(128, 128, 128, 0.25)',
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: '#e6e6e9',
};

const iframeStyle: React.CSSProperties = {
  flex: 1,
  width: '100%',
  border: 'none',
  background: 'transparent',
};

export function ExtensionToolApp() {
  const [tool, setTool] = useState<ExtensionToolOpenPayload | null>(null);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let cancelled = false;
    const probe = (msg: string) => {
      void invoke('debug_toolwin_log', { msg }).catch(() => {});
    };
    probe(`mount: loc=${window.location.hash}`);
    // The tool payload arrives via Rust `webview.eval` — a DOM CustomEvent
    // with the payload on `window.__extensionToolOpen` (NOT the Tauri event
    // system: `listen()` in this webview never resolved — see the probe
    // notes in open_extension_tool_window). Handle both orderings: the
    // eval can land before this mount (read the global directly) or after
    // (the CustomEvent).
    const handler = () => {
      const p = (window as unknown as Record<string, unknown>)[
        '__extensionToolOpen'
      ] as ExtensionToolOpenPayload | undefined;
      probe(`dom event: ${JSON.stringify(p ?? null)}`);
      if (p) setTool(p);
    };
    window.addEventListener('extension-tool-open', handler);
    // In case the eval ran before mount:
    const pre = (window as unknown as Record<string, unknown>)[
      '__extensionToolOpen'
    ] as ExtensionToolOpenPayload | undefined;
    if (pre) {
      probe(`pre-set global: ${pre.extensionId}/${pre.entry}`);
      setTool(pre);
    }
    // Mount-time fetch fallback (covers a webview reload that wiped the
    // window global but not the Rust-side cache).
    (async () => {
      try {
        const last = await invoke<ExtensionToolOpenPayload | null>(
          'get_last_extension_tool',
        );
        probe(`fetch last: ${JSON.stringify(last)}`);
        if (!cancelled && last) {
          setTool((prev) => prev ?? last);
        }
      } catch (err) {
        probe(`fetch last FAILED: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('extension-tool-open', handler);
    };
  }, []);

  useEffect(() => {
    if (tool) {
      void invoke('debug_toolwin_log', {
        msg: `tool state set: ${tool.extensionId}/${tool.entry}`,
      }).catch(() => {});
    }
  }, [tool]);

  const close = useCallback(async () => {
    if (!isTauri()) return;
    await invoke('hide_extension_tool_window', { label: PANEL_LABEL }).catch(
      (err: unknown) => {
        console.warn('[extension-tool] hide failed:', err);
      },
    );
  }, []);

  // Same URL shape as the main-window sandbox loader
  // (sandboxLoader.ts): `folyn-extension://localhost/<id>/<entry>`.
  const iframeSrc = tool
    ? `folyn-extension://localhost/${tool.extensionId}/${tool.entry}`
    : undefined;

  return (
    <div style={shellStyle} className="is-extension-tool-window">
      <div style={titleBarStyle} data-tauri-drag-region>
        <span style={titleStyle} data-tauri-drag-region>
          {tool?.title ?? 'Extension Tool'}
        </span>
        <button
          type="button"
          aria-label="Close"
          onClick={() => void close()}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 26,
            height: 26,
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-secondary, #9a9aa3)',
            cursor: 'pointer',
          }}
        >
          <X size={15} />
        </button>
      </div>
      {iframeSrc ? (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          title={tool?.title ?? 'Extension tool'}
          sandbox="allow-scripts"
          style={iframeStyle}
        />
      ) : (
        <div
          style={{
            flex: 1,
            display: 'grid',
            placeItems: 'center',
            fontSize: 12.5,
            color: 'var(--text-secondary, #9a9aa3)',
          }}
        >
          Waiting for a tool…
        </div>
      )}
    </div>
  );
}
