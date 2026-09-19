/**
 * ExtensionToolApp — the sandbox extension tool popup, pet-panel style.
 *
 * Hosts the `extension-tool-panel` window (statically declared in
 * tauri.conf.json, converted to an NSPanel at setup — the same machinery as
 * the pet panels, which is why it floats over every app/Space like the pet
 * popup does). This route is the window's content:
 *
 *  - a pet-panel-style chrome: borderless window with a rounded body, a
 *    draggable title bar (pointerdown → `extension_tool_start_drag`), and
 *    the pet-panel window controls (pin / maximize / close);
 *  - for `builtin:translation` (PRD 09-18-translation-popup-refactor):
 *    React content instead of an iframe — `TranslationToolHost` mirrors the
 *    stores this realm needs (providers, settings, locale, theme) and
 *    renders the embedded TranslationPanel. The builtin payload still flows
 *    through the same `extension-tool://open` event / get_last_extension_tool
 *    fallback; all chrome + window behaviors stay shared below;
 *  - otherwise an `<iframe sandbox="allow-scripts">` loading the extension's
 *    tool entry from `folyn-extension://localhost/<ext>/<entry>` — the same
 *    origin-isolated scheme the dynamic tool windows used, so the
 *    permission-checked fetch-RPC bridge keeps working unchanged (the
 *    `extension-rpc-request` event is global; the MAIN window's listener
 *    dispatches and responds — this window needs no RPC wiring).
 *
 * Title-bar semantics mirror PetPanelApp (the user asked for "和桌宠弹窗
 * 一样"):
 *  - drag: header pointerdown → extension_tool_start_drag (tao's
 *    startDragging no-ops from async IPC context; the custom command
 *    synthesizes a LeftMouseDown and enters the native drag loop);
 *  - pin (置顶): when NOT pinned, a `tauri://blur` (user clicks another
 *    app) hides the popup; pinned keeps it on screen (e.g. diff-viewer
 *    side-by-side use). macOS `surface_extension_tool_panel` makes the
 *    nonactivating panel key AND politely activates Folyn (no visible
 *    jump in float mode), so focus/blur events flow like the pet panel's.
 *    Not persisted across reopens.
 *  - maximize (放大): `toggleMaximize()` with the Square/Copy icon toggle;
 *  - close (×): `hide_extension_tool_window` — never destroyed, reopen
 *    re-surfaces the same window (pet-panel lifecycle);
 *  - Esc: document keydown → hide. Keyboard reaches this webview only
 *    while Folyn is the active app (macOS routing) — the surface's polite
 *    activation covers the opened-from-panel path. If focus is inside the
 *    sandboxed iframe the keystroke stays there; clicking the titlebar
 *    re-arms it.
 *
 * The tool payload arrives via Rust `webview.eval` — a DOM CustomEvent with
 * the payload on `window.__extensionToolOpen` (NOT the Tauri app-event
 * system: `listen()` for app events in this webview never resolved).
 * Window-scoped events (`tauri://blur`) DO work. A mount-time
 * `get_last_extension_tool` fetch covers a webview reload that wiped the
 * window global but not the Rust-side cache.
 *
 * Window transparency (pet-panel's own fix): `pet_make_transparent` on
 * mount re-asserts NSWindow opaque=NO + backgroundColor=clearColor +
 * WKWebView drawsBackground=NO — wry's create-time KVC on the
 * WKWebviewConfiguration doesn't stick.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Pin, PinOff, Square, Copy } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/utils/platform';
import { TranslationToolHost } from '@/components/translation/TranslationToolHost';

/** Payload of the `extension-tool://open` event (Rust → this window). */
interface ExtensionToolOpenPayload {
  extensionId: string;
  toolId: string;
  entry: string;
  title: string;
  /** Code-dir change fingerprint (name+size+mtime fold, Rust-side). Keys
   *  the sandboxed iframe: unchanged → re-surface the running page (state
   *  kept, no flicker); changed (re-install / update) → iframe remounts and
   *  the new code loads. Without it the hide-not-destroy lifecycle replays
   *  stale code forever. */
  fingerprint?: string;
}

const PANEL_LABEL = 'extension-tool-panel';

export function ExtensionToolApp() {
  const [tool, setTool] = useState<ExtensionToolOpenPayload | null>(null);
  // Pin (置顶): when pinned, blur (clicking another app) does NOT hide the
  // popup. Unpinned by default — clicking another app dismisses it; the pin
  // button keeps it up (e.g. diff-viewer side-by-side use). Mirrors
  // PetPanelApp's isPinned/isPinnedRef pair (ref read inside the blur
  // listener — the closure must see fresh state without re-subscribing).
  const [isPinned, setIsPinned] = useState(false);
  const isPinnedRef = useRef(false);
  // Drives the maximize button icon (Square = maximize, Copy = restore).
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let cancelled = false;
    // The tool payload arrives via Rust `webview.eval` — a DOM CustomEvent
    // with the payload on `window.__extensionToolOpen`. Handle both
    // orderings: the eval can land before this mount (read the global
    // directly) or after (the CustomEvent).
    const handler = () => {
      const p = (window as unknown as Record<string, unknown>)[
        '__extensionToolOpen'
      ] as ExtensionToolOpenPayload | undefined;
      if (p) setTool(p);
    };
    window.addEventListener('extension-tool-open', handler);
    // In case the eval ran before mount:
    const pre = (window as unknown as Record<string, unknown>)[
      '__extensionToolOpen'
    ] as ExtensionToolOpenPayload | undefined;
    if (pre) {
      setTool(pre);
    }
    // Mount-time fetch fallback (covers a webview reload that wiped the
    // window global but not the Rust-side cache).
    (async () => {
      try {
        const last = await invoke<ExtensionToolOpenPayload | null>(
          'get_last_extension_tool',
        );
        if (!cancelled && last) {
          setTool((prev) => prev ?? last);
        }
      } catch {
        // Non-fatal: the eval/global paths normally carry the payload.
      }
    })();
    // Window transparency (the pet-panel's fix for the gray square corners).
    (async () => {
      try {
        await invoke('pet_make_transparent', { label: PANEL_LABEL });
      } catch {
        // Non-fatal: the open path re-asserts it after every surface.
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('extension-tool-open', handler);
    };
  }, []);

  const close = useCallback(async () => {
    if (!isTauri()) return;
    await invoke('hide_extension_tool_window', { label: PANEL_LABEL }).catch(
      (err: unknown) => {
        console.warn('[extension-tool] hide failed:', err);
      },
    );
  }, []);

  const togglePin = useCallback(() => {
    const next = !isPinnedRef.current;
    isPinnedRef.current = next;
    setIsPinned(next);
  }, []);

  const toggleMaximize = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().toggleMaximize();
      const mx = await getCurrentWindow().isMaximized();
      setIsMaximized(mx);
    } catch (err) {
      console.warn('[extension-tool] toggle-maximize failed:', err);
    }
  }, []);

  // Unpinned blur-auto-hide: a user click on another app resigns key →
  // tauri://blur → hide. Pinned: stay on screen. Windows: this window never
  // becomes key there (focus:false, no set_focus path), so no blur fires
  // and the listener is inert — the window stays until closed.
  useEffect(() => {
    if (!isTauri()) return undefined;
    let unBlur: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const target = { target: { kind: 'Window' as const, label: PANEL_LABEL } };
        const un = await listen('tauri://blur', () => {
          if (!isPinnedRef.current) void close();
        }, target);
        if (disposed) un();
        else unBlur = un;
      } catch (err) {
        console.warn('[extension-tool] blur listener failed:', err);
      }
    })();
    return () => {
      disposed = true;
      unBlur?.();
    };
  }, [close]);

  // Esc dismisses the popup (pet-panel parity; see the header comment for
  // the keyboard-routing caveats).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [close]);

  // ── Drag handle ──
  // Calls the custom `extension_tool_start_drag` command (NOT
  // `getCurrentWindow().startDragging()`): tao's macOS `drag_window`
  // forwards `NSApp.currentEvent` to `performWindowDragWithEvent:`, and by
  // the time the async IPC lands the current event is no longer the
  // mouseDown — performWindowDrag then silently no-ops (returns Ok, window
  // never moves). The custom command synthesizes a LeftMouseDown at the
  // current mouseLocation and enters the native modal drag loop.
  const headerPointerDown = useCallback(async (e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    if (!isTauri()) return;
    // Re-assert the open-hand cursor at press time: the synthesized
    // mouseDown + performWindowDrag modal loop can reset the OS cursor to
    // the arrow — set it AFTER the drag loop returns too (the loop blocks
    // inside `extension_tool_start_drag` until the mouse is released, so
    // the post-invoke set lands after release, restoring grab while the
    // pointer is still over the titlebar).
    void invoke('pet_set_cursor', { kind: 'grab' }).catch(() => {});
    try {
      await invoke('extension_tool_start_drag');
      void invoke('pet_set_cursor', { kind: 'grab' }).catch(() => {});
    } catch (err) {
      console.warn('[extension-tool] start_drag failed:', err);
    }
  }, []);

  const suppressDrag = useCallback((e: React.PointerEvent) => {
    // Prevent the header drag handler from firing on the control buttons.
    e.stopPropagation();
  }, []);

  // ── Hover cursor ──
  // CSS `cursor: grab` flickers on this non-key nonactivating panel (the
  // webview's hover→cursor update is unreliable until the window is key —
  // same root cause documented on `pet_set_cursor`). Belt-and-braces with
  // the CSS: on titlebar enter, set the OS cursor to the open hand via the
  // existing `pet_set_cursor` command; on leave, back to the arrow.
  const titlebarEnter = useCallback(() => {
    void invoke('pet_set_cursor', { kind: 'grab' }).catch(() => {});
  }, []);
  const titlebarLeave = useCallback(() => {
    void invoke('pet_set_cursor', { kind: 'arrow' }).catch(() => {});
  }, []);

  // Same URL shape as the main-window sandbox loader
  // (sandboxLoader.ts): `folyn-extension://localhost/<id>/<entry>`. Only
  // third-party tools load an iframe — the builtin translation popup renders
  // React content (TranslationToolHost), so src stays undefined there.
  const iframeSrc = tool && tool.extensionId !== 'builtin:translation'
    ? `folyn-extension://localhost/${tool.extensionId}/${tool.entry}`
    : undefined;

  return (
    <div className="ext-tool-root">
      <div
        className="ext-tool-titlebar"
        onPointerDown={headerPointerDown}
        onMouseEnter={titlebarEnter}
        onMouseLeave={titlebarLeave}
        role="banner"
      >
        {/* No title text (user request) — pet-panel titlebar layout:
            controls only, right-aligned; the whole bar is the drag handle. */}
        <div
          className="ext-tool-controls"
          onPointerDown={suppressDrag}
        >
          <button
            type="button"
            className={`ext-tool-ctrl${isPinned ? ' is-active' : ''}`}
            aria-label={isPinned ? '取消置顶' : '置顶'}
            title={isPinned ? '取消置顶（点击外部时隐藏）' : '置顶（点击外部时保持显示）'}
            aria-pressed={isPinned}
            onClick={() => togglePin()}
          >
            {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            type="button"
            className="ext-tool-ctrl"
            aria-label={isMaximized ? '还原' : '放大'}
            title={isMaximized ? '还原' : '放大'}
            onClick={() => void toggleMaximize()}
          >
            {isMaximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button
            type="button"
            className="ext-tool-ctrl ext-tool-ctrl-close"
            aria-label="关闭"
            title="关闭"
            onClick={() => void close()}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {tool?.extensionId === 'builtin:translation' ? (
        <TranslationToolHost />
      ) : iframeSrc ? (
        <iframe
          key={`${iframeSrc}#${tool?.fingerprint ?? ''}`}
          src={iframeSrc}
          title={tool?.title ?? 'Extension tool'}
          sandbox="allow-scripts"
          className="ext-tool-iframe"
          onLoad={() => {
            // The iframe's document (extension page, often with autofocus
            // or a focus() call of its own) steals the WKWebView's focused
            // DOCUMENT on load — keydown events then route into the iframe
            // realm, and this window's Esc keydown listener never fires.
            // Re-assert the OUTER document's focus right after the iframe
            // settles so Esc works from the start.
            window.focus();
          }}
        />
      ) : (
        <div className="ext-tool-empty">
          Waiting for a tool…
        </div>
      )}
    </div>
  );
}
