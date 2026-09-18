/**
 * ExtensionToolApp — the sandbox extension tool popup, pet-panel style.
 *
 * Hosts the `extension-tool-panel` window (statically declared in
 * tauri.conf.json, converted to an NSPanel at setup — the same machinery as
 * the pet panels, which is why it floats over every app/Space like the pet
 * popup does). This route is the window's content:
 *
 *  - a pet-panel-style chrome: borderless window with a rounded body, a
 *    draggable title bar (pointerdown → `startDragging()`), and the
 *    pet-panel window controls (pin / maximize / close);
 *  - an `<iframe sandbox="allow-scripts">` loading the extension's tool
 *    entry from `folyn-extension://localhost/<ext>/<entry>` — the same
 *    origin-isolated scheme the dynamic tool windows used, so the
 *    permission-checked fetch-RPC bridge keeps working unchanged (the
 *    `extension-rpc-request` event is global; the MAIN window's listener
 *    dispatches and responds — this window needs no RPC wiring).
 *
 * Title-bar semantics mirror PetPanelApp exactly (that's the point — the
 * user asked for "和桌宠弹窗一样"):
 *  - drag: header pointerdown → startDragging, buttons stop propagation;
 *  - pin (置顶): when NOT pinned, a `tauri://blur` (user clicks another
 *    app) hides the popup; pinned keeps it on screen (e.g. diff-viewer
 *    side-by-side use). macOS `surface_extension_tool_panel` makes the
 *    nonactivating panel key WITHOUT activating Folyn, so focus/blur events
 *    flow exactly like the pet panel's. Not persisted across reopens.
 *  - maximize (放大): `toggleMaximize()` with the Square/Copy icon toggle;
 *  - close (×): `hide_extension_tool_window` — never destroyed, reopen
 *    re-surfaces the same window (pet-panel lifecycle).
 *
 * The tool payload arrives via Rust `webview.eval` — a DOM CustomEvent with
 * the payload on `window.__extensionToolOpen` (NOT the Tauri event system:
 * `listen()` for APP events in this webview never resolved — see the probe
 * notes in open_extension_tool_window). Window-scoped events
 * (`tauri://blur`) DO work, so the blur listener below is fine.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Pin, PinOff, Square, Copy } from 'lucide-react';
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

export function ExtensionToolApp() {
  const [tool, setTool] = useState<ExtensionToolOpenPayload | null>(null);
  // Pin (置顶): when pinned, blur (clicking another app) does NOT hide the
  // popup. Mirrors PetPanelApp's isPinned/isPinnedRef pair (ref read inside
  // the blur listener — the closure must see fresh state without re-subscribing).
  const [isPinned, setIsPinned] = useState(false);
  const isPinnedRef = useRef(false);
  // Drives the maximize button icon (Square = maximize, Copy = restore).
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let cancelled = false;
    const probe = (msg: string) => {
      void invoke('debug_toolwin_log', { msg }).catch(() => {});
    };
    // v4 marker: distinguishes THIS frontend from older bundles — a hidden
    // WKWebView gets its web process suspended and MISSES vite HMR updates,
    // so the window can silently run a stale bundle. If the log shows an
    // older marker after a code change, restart dev fully.
    probe(`mount: v4 loc=${window.location.hash}`);
    // v4 diagnostics — dump the render/CSS state right after mount so the
    // log answers, without user input: (a) is the pet.css class styling
    // actually applied (titlebar height 36 vs collapsed)? (b) does the
    // window receive ANY pointer event, and where do clicks land (element
    // + coords)? (c) which element do the "header" clicks hit — if the
    // target is inside the IFRAME the event never reaches us (sandboxed
    // iframe = separate document), meaning the user is clicking the
    // extension's OWN header UI, not our titlebar.
    requestAnimationFrame(() => {
      const tb = document.querySelector('.ext-tool-titlebar');
      const fr = document.querySelector('.ext-tool-iframe');
      const root = document.querySelector('.ext-tool-root');
      probe(
        `css: htmlCls=${document.documentElement.className} ` +
          `rootBg=${root ? getComputedStyle(root).backgroundColor : 'none'} ` +
          `tbH=${tb ? getComputedStyle(tb).height : 'none'} ` +
          `frH=${fr ? getComputedStyle(fr).height : 'none'}`,
      );
    });
    const anyPointer = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      probe(
        `pointer: (${Math.round(e.clientX)},${Math.round(e.clientY)}) ` +
          `target=${t ? t.tagName + (t.className ? '.' + String(t.className).split(' ')[0] : '') : 'null'} ` +
          `button=${e.button}`,
      );
    };
    window.addEventListener('pointerdown', anyPointer, true);
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
    // Window transparency (the pet-panel's own fix for THIS exact bug —
    // gray square corners outside the rounded shell): wry's create-time
    // `drawsBackground=NO` (private KVC on WKWebviewConfiguration) doesn't
    // stick, so the pet-panel calls `pet_make_transparent` on mount, which
    // re-applies NSWindow opaque=NO + backgroundColor=clearColor +
    // WKWebView drawsBackground=NO via the cocoa/objc bridge (the
    // proven-not-to-crash path — do NOT re-implement with objc2
    // `stringWithUTF8String`; see crash #4 in tauri-window-patterns.md).
    // Run AFTER the payload setup — order doesn't matter, but keep it in
    // the same mount effect so a window reload re-applies it.
    (async () => {
      try {
        await invoke('pet_make_transparent', { label: PANEL_LABEL });
        probe('make_transparent: ok');
      } catch (err) {
        probe(`make_transparent FAILED: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener('extension-tool-open', handler);
      window.removeEventListener('pointerdown', anyPointer, true);
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
    void invoke('debug_toolwin_log', { msg: 'close: called' }).catch(() => {});
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

  // Unpinned blur-auto-hide: macOS `surface_extension_tool_panel` makes the
  // nonactivating panel KEY (no app activation), so a user click on another
  // app resigns key → tauri://blur → hide. Pinned: stay on screen. Windows:
  // this window never becomes key there (focus:false, no set_focus path), so
  // no blur fires and the listener is inert — acceptable, the window simply
  // stays until closed.
  useEffect(() => {
    if (!isTauri()) return undefined;
    let unBlur: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const target = { target: { kind: 'Window' as const, label: PANEL_LABEL } };
        const un = await listen('tauri://blur', () => {
          void invoke('debug_toolwin_log', { msg: 'hide: via BLUR' }).catch(
            () => {},
          );
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

  // Esc dismisses the popup (pet-panel parity; works because the surface
  // makes the nonactivating panel KEY and politely ACTIVATES Folyn (no
  // visible jump in float mode) — keydown events land on this document.
  // If focus is inside the sandboxed iframe, the keystroke stays in the
  // iframe realm and this listener won't fire; clicking the titlebar or
  // body re-arms it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // DEBUG-toolwin: any-key trace — proves whether keyboard events reach
      // this webview at all (separates "keyboard routing dead" from
      // "listener dead").
      void invoke('debug_toolwin_log', {
        msg: `key: ${e.key}`,
      }).catch(() => {});
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
  // never moves; the "无法拖动" symptom). The custom command synthesizes a
  // LeftMouseDown at the current mouseLocation (tao's own tablet-branch
  // trick) and enters the native modal drag loop. PetPanelApp keeps
  // startDragging() — its window empirically works there (different event
  // timing); if it ever regresses, it can switch to the same command.
  const headerPointerDown = useCallback(async (e: React.PointerEvent) => {
    if (e.button != null && e.button !== 0) return;
    if (!isTauri()) return;
    // DEBUG-toolwin: drag diagnostics — did the invoke reach Rust and
    // resolve, or was it rejected?
    void invoke('debug_toolwin_log', {
      msg: `drag: pointerdown (button=${e.button ?? 'null'})`,
    }).catch(() => {});
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
      void invoke('debug_toolwin_log', {
        msg: 'drag: start_drag resolved OK',
      }).catch(() => {});
    } catch (err) {
      void invoke('debug_toolwin_log', {
        msg: `drag: start_drag FAILED: ${String(err)}`,
      }).catch(() => {});
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
  // existing `pet_set_cursor` command; on leave, back to the arrow. Buttons
  // keep their own pointer affordance via CSS (the OS cursor overrides
  // visually, accepted: grab-over-the-titlebar is the dominant affordance).
  const titlebarEnter = useCallback(() => {
    void invoke('pet_set_cursor', { kind: 'grab' }).catch(() => {});
  }, []);
  const titlebarLeave = useCallback(() => {
    void invoke('pet_set_cursor', { kind: 'arrow' }).catch(() => {});
  }, []);

  // Same URL shape as the main-window sandbox loader
  // (sandboxLoader.ts): `folyn-extension://localhost/<id>/<entry>`.
  const iframeSrc = tool
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
            controls only, right-aligned; the whole bar is the drag
            handle. */}
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
      {iframeSrc ? (
        <iframe
          key={iframeSrc}
          src={iframeSrc}
          title={tool?.title ?? 'Extension tool'}
          sandbox="allow-scripts"
          className="ext-tool-iframe"
          onLoad={() => {
            // The iframe's document (extension page, often with autofocus
            // or a focus() call of its own) steals the WKWebView's focused
            // DOCUMENT on load — keydown events then route into the iframe
            // realm, and this window's Esc keydown listener never fires
            // ("点 header 才能关": clicking the titlebar — an outer element —
            // pulls focus back). Re-assert the OUTER document's focus right
            // after the iframe settles so Esc works from the start.
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
