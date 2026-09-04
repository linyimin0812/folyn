import { useRef, useState, useCallback, useEffect } from 'react';
import { isTauri } from '@/utils/platform';
import { useEditorStore } from '@/store/editorStore';
import { Globe, Copy } from 'lucide-react';
import type { EditorProps } from '../types';

type WebviewError = { code: 'invalid_url' | 'unknown' };
type WebviewStatus = 'loading' | 'ready' | { error: WebviewError };

// Module-level cache to persist webview labels across component remounts
export const webviewCache = new Map<string, { label: string; url: string }>();

/**
 * Height of the native titlebar region (in logical points) that overlaps the
 * main webview but is excluded from its layout viewport.
 *
 * The main window uses the default `Visible` titlebar style, which tao/tauri
 * map to `titlebar_transparent = false` + `fullsize_content_view = true`. The
 * WKWebView physically fills the whole content view (including the titlebar
 * strip behind the traffic lights), so Tauri's `innerSize()` reports the full
 * content height (e.g. 900). But the webview's *layout* viewport
 * (`window.innerHeight`, and the frame of `getBoundingClientRect()`) starts
 * BELOW the titlebar, so it is shorter (e.g. 868). The difference (32) is the
 * titlebar overlap.
 *
 * `set_webview_position` / `add_child` place the child in content-view
 * coordinates whose origin is the window's true top-left (behind the
 * titlebar), while `getBoundingClientRect().top` is relative to the layout
 * viewport (below the titlebar). So the child is placed too high and a gap
 * shows at the bottom equal to the titlebar overlap. We ADD this overlap to
 * the frontend's `y` so the child reaches the true window bottom.
 *
 * No-op (0) off Tauri or when there is no overlap (transparent/hidden titlebar).
 * Recomputed on every call — the overlap changes when the main window
 * toggles native fullscreen (titlebar hidden in fullscreen, visible
 * otherwise), so a session-cached value goes stale and pushes the child
 * webview down by the (now-absent) titlebar height, leaving a top gap in
 * fullscreen. `innerSize()` + `window.innerHeight` are cheap; the callers
 * (syncPosition, load-finished, create) already re-run on resize/active
 * transitions, so a fresh value keeps the child aligned at all times.
 */
async function titlebarOverlap(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    const inner = await win.innerSize(); // physical px, full content height
    const scale = await win.scaleFactor().catch(() => 1);
    const contentLogicalH = inner.height / scale;
    const layoutViewportH = window.innerHeight || 0;
    const overlap = Math.max(0, Math.round(contentLogicalH - layoutViewportH));
    return overlap;
  } catch {
    return 0;
  }
}

/**
 * Every webview label created this session, including labels whose cache
 * entry was replaced by navigation. WorkArea hides ALL of them on tab
 * switches so an orphaned webview can never keep covering other pages.
 */
const allWebviewLabels = new Set<string>();

export function getWebviewLabels(): string[] {
  return Array.from(allWebviewLabels);
}

/** Move a native webview off-screen (x:-10000, 1×1) so HTML overlays can
 *  render above the work area. No-op outside Tauri; swallows errors.
 *  ponytail: one helper for the 4 raw -10000/1/1 duplications. */
async function hideWebviewLabel(label: string): Promise<void> {
  if (!isTauri() || !label) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_webview_position', {
      label,
      x: -10000,
      y: -10000,
      width: 1,
      height: 1,
    });
  } catch {}
}

/** Hide every native webview so an HTML overlay (e.g. the open-files tab
 *  dropdown) can render above the work area. Callers must dispatch
 *  `folyn:overlay-closed` afterwards so the active webview re-syncs. */
export function hideWebviewsForOverlay(): void {
  if (!isTauri()) return;
  const labels = getWebviewLabels();
  if (labels.length === 0) return;
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('hide_all_webviews', { labels }).catch(() => {});
  });
}

export function WebViewer({ filePath, tabId }: EditorProps) {
  const webViewerRef = useRef<HTMLDivElement>(null);
  const webviewLabelRef = useRef<string | null>(null);
  // 10 s timeout — if webview://load-finished doesn't arrive in time,
  // the page failed to load (DNS error, connection refused, etc.).
  // We hide the native webview and show the HTML error overlay.
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the label whose load we're waiting for.
  const loadingLabelRef = useRef<string | null>(null);
  const [status, setStatus] = useState<WebviewStatus>('loading');

  // Check if this web tab was opened from a clip card
  const clipPath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    return tab?.clipPath ?? null;
  });
  const backToClip = useEditorStore((s) => s.backToClip);

  // Track active tab to hide/show webview
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const isActive = activeTabId === tabId;

  // Start a 10 s load-failure timer. If webview://load-finished hasn't
  // arrived by then, the navigation failed silently (wry 0.55.1 does not
  // implement didFailProvisionalNavigation, so there is no failure event).
  // On timeout: hide the native webview (so the HTML error overlay at
  // z-10 is visible — native renders above all DOM) and show the error.
  const startLoadTimeout = useCallback((label: string) => {
    if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    loadingLabelRef.current = label;
    loadTimeoutRef.current = setTimeout(async () => {
      loadTimeoutRef.current = null;
      if (loadingLabelRef.current !== label) return;
      // Before showing an error, check if the webview has visible
      // content — a slow page may have started rendering. If it has
      // content, show it instead of erroring.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<string>('check_webview_content', { label });
        const info = JSON.parse(result);
        if (!info.blank) {
          // Page has content — bring it on-screen.
          const container = webViewerRef.current;
          if (container) {
            const rect = container.getBoundingClientRect();
            const overlap = await titlebarOverlap();
            await invoke('set_webview_position', {
              label, x: Math.round(rect.left),
              y: Math.round(rect.top) + overlap,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }).catch(() => {});
          }
          setStatus('ready');
          return;
        }
      } catch {
        // Check failed — fall through to error.
      }
      hideWebviewLabel(label);
      setStatus({ error: { code: 'unknown' } });
    }, 3000);
  }, []);

  // Clear the load timer (page loaded successfully).
  const clearLoadTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
  }, []);

  // Listen for webview://load-finished from Rust's on_page_load hook.
  // When the page finishes, bring the webview back on-screen (it was
  // hidden off-screen during loading so the spinner was visible) and
  // show it.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ label: string; url: string }>('webview://load-finished', async (event) => {
        if (event.payload.label !== loadingLabelRef.current) return;
        clearLoadTimeout();
        // Bring the webview back on-screen.
        const container = webViewerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const overlap = await titlebarOverlap();
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('set_webview_position', {
              label: event.payload.label,
              x: Math.round(rect.left),
              y: Math.round(rect.top) + overlap,
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }).catch(() => {});
          }
        }
        setStatus('ready');
      }).then((fn) => { unlisten = fn; });
    }).catch(() => {});
    return () => { unlisten?.(); };
  }, [clearLoadTimeout]);



  const handleBackToClip = useCallback(async () => {
    if (!clipPath) return;
    // Hide the webview immediately before switching back to clip
    const cached = webviewCache.get(tabId);
    if (cached) await hideWebviewLabel(cached.label);
    backToClip(tabId);
  }, [clipPath, tabId, backToClip]);

  // Move the native webview off-screen so HTML overlays (e.g. the duplicate
  // clip confirm dialog) are visible. Restored via syncPosition().


  const syncPosition = useCallback(async () => {
    const container = webViewerRef.current;
    const label = webviewLabelRef.current;
    if (!container || !label) return;
    try {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const overlap = await titlebarOverlap();
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_webview_position', {
        label,
        x: Math.round(rect.left),
        // `rect.top` is relative to the layout viewport (below the
        // titlebar), but the child is placed in content-view space (origin
        // behind the titlebar). Add the titlebar overlap so the child
        // reaches the true window bottom instead of stopping short.
        y: Math.round(rect.top) + overlap,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    } catch {}
  }, []);




  useEffect(() => {
    if (!isTauri() || !filePath) return;

    // Check if we already have a webview for this tab
    const cached = webviewCache.get(tabId);
    if (cached && cached.url === filePath) {
      // Reuse existing webview
      webviewLabelRef.current = cached.label;
      allWebviewLabels.add(cached.label);
      setStatus('ready');
      // First hide it, then reposition after layout is ready
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('set_webview_position', {
          label: cached.label,
          x: -10000,
          y: -10000,
          width: 1,
          height: 1,
        }).then(() => {
          setTimeout(() => syncPosition(), 100);
        });
      });
      return () => {
        // Hide the reused webview on unmount (tab switch) — the reuse path
        // previously returned no cleanup, leaving the native webview floating
        // over other pages.
        const label = webviewLabelRef.current;
        if (label) {
          hideWebviewLabel(label);
          webviewLabelRef.current = null;
        }
      };
    }

    // Navigation: the cached webview belongs to a stale URL for this tab.
    // Close it so it can't linger on screen, then create a fresh one below.
    if (cached) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('close_webview', { label: cached.label }).catch(() => {});
      });
      allWebviewLabels.delete(cached.label);
      webviewCache.delete(tabId);
    }

    setStatus('loading');

    try {
      const parsed = new URL(filePath);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    } catch {
      setStatus({ error: { code: 'invalid_url' } });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');

        // Wait for the container to have non-zero size before creating the
        // webview — at mount the tab layout may not be ready yet (0×0), and
        // bailing silently left the spinner stuck on "正在连接…".
        let container = webViewerRef.current;
        if (!container) return;
        let rect = container.getBoundingClientRect();
        let waited = 0;
        while ((rect.width === 0 || rect.height === 0) && waited < 2000) {
          await new Promise((r) => setTimeout(r, 50));
          waited += 50;
          container = webViewerRef.current;
          if (!container) return; // unmounted during wait
          rect = container.getBoundingClientRect();
        }
        if (rect.width === 0 || rect.height === 0) return; // genuinely hidden; give up silently

        const label = `wv-${Date.now()}`;
        const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

        const overlap = await titlebarOverlap();
        await invoke('create_webview', {
          label,
          url: filePath,
          x: Math.round(rect.left),
          // `rect.top` is layout-viewport-relative; add the titlebar overlap
          // so the initial frame matches content-view space (origin behind
          // the titlebar). See titlebarOverlap for the coordinate rationale.
          y: Math.round(rect.top) + overlap,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          userAgent,
        });

        webviewLabelRef.current = label;
        allWebviewLabels.add(label);
        // Cache the webview for this tab
        webviewCache.set(tabId, { label, url: filePath });
        // Hide the webview off-screen while loading so the HTML spinner
        // (z-10) is visible — native WKWebView renders above all DOM.
        // On load-finished the listener brings it back + sets 'ready'.
        // On timeout (10 s) the listener hides it + shows error page.
        hideWebviewLabel(label);
        setStatus('loading');
        startLoadTimeout(label);
      } catch (err) {
        setStatus({ error: { code: 'unknown' } });
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      clearLoadTimeout();
      // Hide webview when component unmounts (e.g., switching tabs)
      const label = webviewLabelRef.current;
      if (label) {
        hideWebviewLabel(label);
        webviewLabelRef.current = null;
      }
    };
  }, [filePath, tabId, syncPosition, startLoadTimeout, clearLoadTimeout]);

  useEffect(() => {
    if (!isTauri()) return;
    const container = webViewerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => { syncPosition(); });
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncPosition]);

  // Clean up webview only when tab is actually closed (not just switched away)
  useEffect(() => {
    return () => {
      const cached = webviewCache.get(tabId);
      if (cached && isTauri()) {
        // Only close the webview if the tab no longer exists in the store
        // (i.e., the tab was closed, not just switched away from)
        const tabStillExists = useEditorStore.getState().tabs.some(t => t.id === tabId);
        if (!tabStillExists) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('close_webview', { label: cached.label }).catch(() => {});
          });
          allWebviewLabels.delete(cached.label);
          webviewCache.delete(tabId);
        }
      }
    };
  }, [tabId]);

  // Show webview when active - hide_all_webviews in WorkArea handles hiding
  useEffect(() => {
    if (!isTauri() || !isActive) return;
    const label = webviewLabelRef.current;
    if (!label || status !== 'ready') return;

    // Wait for layout to be ready, then sync position to show webview
    const timer = setTimeout(() => {
      syncPosition();
    }, 100);

    return () => clearTimeout(timer);
  }, [isActive, status, syncPosition]);

  // Re-show the active webview after an HTML overlay that hid it closes.
  useEffect(() => {
    if (!isTauri()) return;
    const onOverlayClosed = () => {
      if (isActive && webviewLabelRef.current && status === 'ready') {
        syncPosition();
      }
    };
    window.addEventListener('folyn:overlay-closed', onOverlayClosed);
    return () => window.removeEventListener('folyn:overlay-closed', onOverlayClosed);
  }, [isActive, status, syncPosition]);

  const navigate = (action: 'back' | 'forward' | 'reload') => {
    const label = webviewLabelRef.current;
    if (!label) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('navigate_webview', { label, action }).catch(() => {});
    });
  };

  const openExternal = () => {
    if (isTauri()) {
      import('@tauri-apps/plugin-shell').then(({ open }) => { open(filePath); });
    } else {
      window.open(filePath, '_blank', 'noopener,noreferrer');
    }
  };

  const [copied, setCopied] = useState(false);
  const copyUrl = useCallback(() => {
    navigator.clipboard.writeText(filePath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [filePath]);

  return (
    <div className="web-viewer-container flex-1 flex flex-col bg-surf overflow-hidden relative">
      <div className="web-viewer-bar flex items-center gap-1.5 py-1 px-2 bg-panel border-b border-brd shrink-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {clipPath && (
          <button className="web-viewer-nav-btn flex items-center justify-center w-[26px] h-[26px] border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1" title="返回卡片" onClick={handleBackToClip}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <line x1="5" y1="6.5" x2="11" y2="6.5" />
              <line x1="5" y1="9" x2="9" y2="9" />
            </svg>
          </button>
        )}
        {isTauri() && webviewLabelRef.current && (
          <>
            <button className="web-viewer-nav-btn flex items-center justify-center w-[26px] h-[26px] border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1" title="后退" onClick={() => navigate('back')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="web-viewer-nav-btn flex items-center justify-center w-[26px] h-[26px] border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1" title="前进" onClick={() => navigate('forward')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="web-viewer-nav-btn flex items-center justify-center w-[26px] h-[26px] border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1" title="重新加载" onClick={() => navigate('reload')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" strokeLinecap="round" />
                <path d="M13.5 2.5v3h-3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
        <div className="flex-1 min-w-[140px] flex items-center shrink-0">
          <div className="flex-1 min-w-0 flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] bg-bg border border-brd transition-colors duration-150 focus-within:border-acc">
            <Globe size={12} className="text-t3 shrink-0" />
            <input
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-t2 font-mono"
              value={filePath}
              readOnly
            />
          </div>
        </div>
        <button
          className="flex items-center justify-center w-7 h-[26px] border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1"
          title={copied ? '已复制' : '复制链接'}
          onClick={copyUrl}
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 8l3.5 3.5L13 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <Copy size={14} />
          )}
        </button>
        <button className="web-viewer-open-btn flex items-center justify-center w-7 h-[26px] border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1" title="在外部浏览器打开" onClick={openExternal}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
            <path d="M9 2h5v5" />
            <line x1="14" y1="2" x2="7" y2="9" />
          </svg>
        </button>
      </div>



      {status === 'loading' && (
        <div className="web-viewer-status absolute inset-x-0 top-10 bottom-0 flex flex-col items-center justify-center gap-3 bg-surf z-10 text-t2">
          <div className="web-viewer-spinner w-7 h-7 rounded-full border-[2.5px] border-brd border-t-acc animate-spin" />
          <span>正在连接…</span>
        </div>
      )}

      {typeof status === 'object' && (() => {
        const { code } = status.error;
        const info: { title: string; desc: string } =
          code === 'invalid_url'
            ? { title: '无效的网址', desc: `"${filePath}" 不是一个有效的网址，请检查拼写是否正确。` }
            : { title: '页面无法打开', desc: '加载页面时发生了未知错误。' };
        return (
          <div className="web-viewer-status web-viewer-error absolute inset-x-0 top-10 bottom-0 flex flex-col items-center justify-center gap-2 bg-surf z-10 text-t2">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-t3 mb-1 opacity-85">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 1 0 20M12 2a14.5 14.5 0 0 0 0 20M2 12h20" />
              <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" strokeWidth="1.8" stroke="#e05252" />
            </svg>
            <p className="text-[15px] font-semibold text-t1 m-0">{info.title}</p>
            <p className="text-[13px] text-t2 m-0 text-center max-w-[320px] leading-relaxed">{info.desc}</p>
            <div className="text-[11px] font-mono text-t3 bg-bg border border-brd rounded-[5px] py-[3px] px-2.5 max-w-[340px] overflow-hidden text-ellipsis whitespace-nowrap mt-0.5">{filePath}</div>
            <button className="flex items-center gap-1.5 mt-2 py-2 px-5 rounded-[7px] border-none bg-acc text-white text-[13px] font-medium cursor-pointer transition-[opacity,transform] duration-150 hover:opacity-[.88] active:scale-[.97]" onClick={openExternal}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
                <path d="M9 2h5v5" />
                <line x1="14" y1="2" x2="7" y2="9" />
              </svg>
              在外部浏览器打开
            </button>
          </div>
        );
      })()}

      <div ref={webViewerRef} className="web-viewer-body flex-1 relative" />
    </div>
  );
}
