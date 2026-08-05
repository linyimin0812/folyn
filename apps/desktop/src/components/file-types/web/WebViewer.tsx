import { useRef, useState, useCallback, useEffect } from 'react';
import { isTauri } from '@/utils/platform';
import { useEditorStore } from '@/store/editorStore';
import { openBrowserTab, openFile } from '@/services/editorIoService';
import { useClipStore } from '@/store/clipStore';
import { useBrowserStore } from '@/store/browserStore';
import { useTranslation } from 'react-i18next';
import { Plus, Globe, KeyRound, Cookie, Copy, Lock, Trash2, Download } from 'lucide-react';
import type { EditorProps } from '../types';

type WebviewErrorCode = 'dns' | 'refused' | 'timeout' | 'http' | 'invalid_url' | 'blocked' | 'unknown';
type WebviewError = { code: WebviewErrorCode; status?: number };
type WebviewStatus = 'loading' | 'ready' | { error: WebviewError };

// Module-level cache to persist webview labels across component remounts
export const webviewCache = new Map<string, { label: string; url: string }>();

export function WebViewer({ filePath, tabId }: EditorProps) {
  const { t } = useTranslation();
  const webViewerRef = useRef<HTMLDivElement>(null);
  const webviewLabelRef = useRef<string | null>(null);
  const [status, setStatus] = useState<WebviewStatus>('loading');
  const [clipping, setClipping] = useState(false);
  const [clipError, setClipError] = useState(false);
  const [clipDuplicate, setClipDuplicate] = useState<{ url: string; existingPath: string } | null>(null);
  const [urlInput, setUrlInput] = useState(filePath);
  const [importOpen, setImportOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const passwords = useBrowserStore((s) => s.passwords);
  const passwordImporting = useBrowserStore((s) => s.passwordImporting);
  const cookieImporting = useBrowserStore((s) => s.cookieImporting);
  const importCookies = useBrowserStore((s) => s.importCookies);
  const importPasswords = useBrowserStore((s) => s.importPasswords);
  const loadPasswords = useBrowserStore((s) => s.loadPasswords);
  const removePassword = useBrowserStore((s) => s.removePassword);

  // Check if this web tab was opened from a clip card
  const clipPath = useEditorStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    return tab?.clipPath ?? null;
  });
  const backToClip = useEditorStore((s) => s.backToClip);

  // Track active tab to hide/show webview
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const isActive = activeTabId === tabId;

  // Keep the address bar in sync with in-page navigation.
  useEffect(() => {
    setUrlInput(filePath);
  }, [filePath]);

  useEffect(() => {
    if (!isTauri()) return;
    void loadPasswords();
  }, [loadPasswords]);

  useEffect(() => {
    if (!importOpen) return;
    const handler = (e: MouseEvent) => {
      if (importRef.current && !importRef.current.contains(e.target as Node)) setImportOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [importOpen]);

  useEffect(() => {
    if (!passwordOpen) return;
    const handler = (e: MouseEvent) => {
      if (passwordRef.current && !passwordRef.current.contains(e.target as Node)) setPasswordOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [passwordOpen]);

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  const submitUrl = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const label = webviewLabelRef.current;
    const raw = urlInput.trim();
    if (!label || !raw) return;
    let url = raw;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (!isTauri()) {
      window.location.href = url;
      return;
    }
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('load_url_webview', { label, url }).catch(() => showNotice(t('browser:navigateFailed')));
    });
  }, [urlInput, showNotice, t]);

  const currentHost = (() => {
    try { return new URL(filePath).hostname; } catch { return ''; }
  })();
  const matchingPasswords = passwords.filter((p) => {
    try { return new URL(p.url).hostname === currentHost; } catch { return false; }
  });

  const fillPassword = useCallback(async (username: string, password: string) => {
    const label = webviewLabelRef.current;
    if (!label) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('fill_webview_credentials', { label, username, password });
      showNotice(t('browser:filled'));
      setPasswordOpen(false);
    } catch (err) {
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err);
      showNotice(`${t('browser:fillFailed')} ${msg}`);
    }
  }, [showNotice, t]);

  const copyText = useCallback(async (text: string) => {
    try {
      if (isTauri()) {
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
        await writeText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }
      showNotice(t('browser:copied'));
    } catch {
      showNotice(t('browser:copyFailed'));
    }
  }, [showNotice, t]);

  const handleImportCookies = useCallback(async () => {
    setImportOpen(false);
    await importCookies();
    const notice = useBrowserStore.getState().notice;
    if (notice) showNotice(notice);
  }, [importCookies, showNotice]);

  const handleImportPasswords = useCallback(async () => {
    setImportOpen(false);
    await importPasswords();
    const notice = useBrowserStore.getState().notice;
    if (notice) showNotice(notice);
  }, [importPasswords, showNotice]);

  const handleBackToClip = useCallback(async () => {
    if (!clipPath) return;
    // Hide the webview immediately before switching back to clip
    const cached = webviewCache.get(tabId);
    if (cached && isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_webview_position', {
          label: cached.label,
          x: -10000,
          y: -10000,
          width: 1,
          height: 1,
        });
      } catch {}
    }
    backToClip(tabId);
  }, [clipPath, tabId, backToClip]);

  // Move the native webview off-screen so HTML overlays (e.g. the duplicate
  // clip confirm dialog) are visible. Restored via syncPosition().
  const hideWebview = useCallback(async () => {
    const cached = webviewCache.get(tabId);
    if (cached && isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('set_webview_position', {
          label: cached.label,
          x: -10000,
          y: -10000,
          width: 1,
          height: 1,
        });
      } catch {}
    }
  }, [tabId]);

  const handleClipPage = useCallback(async () => {
    if (!filePath || clipping) return;
    try {
      new URL(filePath);
    } catch {
      return;
    }
    // Duplicate check before clipping.
    await useClipStore.getState().loadClips();
    const existing = useClipStore.getState().findClipByUrl(filePath);
    if (existing) {
      await hideWebview();
      setClipDuplicate({ url: filePath, existingPath: existing });
      return;
    }
    setClipping(true);
    setClipError(false);
    try {
      await useClipStore.getState().clipUrl(filePath);
    } catch (err) {
      console.error('[WebViewer] Clip failed:', err);
      setClipError(true);
      setTimeout(() => setClipError(false), 3000);
    } finally {
      setClipping(false);
    }
  }, [filePath, clipping, hideWebview]);

  const syncPosition = useCallback(async () => {
    const container = webViewerRef.current;
    const label = webviewLabelRef.current;
    if (!container || !label) return;
    try {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_webview_position', {
        label,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    } catch {}
  }, []);

  const handleDuplicateOpen = useCallback(async () => {
    if (!clipDuplicate) return;
    const { existingPath } = clipDuplicate;
    const fileName = existingPath.split('/').pop() || existingPath;
    setClipDuplicate(null);
    await syncPosition();
    try {
      await openFile(existingPath, fileName);
    } catch (err) {
      console.error('[WebViewer] openFile failed:', err);
    }
  }, [clipDuplicate, syncPosition]);

  const handleDuplicateRegenerate = useCallback(async () => {
    if (!clipDuplicate) return;
    const { url } = clipDuplicate;
    setClipDuplicate(null);
    setClipping(true);
    setClipError(false);
    try {
      await useClipStore.getState().clipUrl(url, undefined, undefined, { force: true });
    } catch (err) {
      console.error('[WebViewer] Clip failed:', err);
      setClipError(true);
      setTimeout(() => setClipError(false), 3000);
    } finally {
      setClipping(false);
      await syncPosition();
    }
  }, [clipDuplicate, syncPosition]);

  const handleDuplicateCancel = useCallback(async () => {
    setClipDuplicate(null);
    await syncPosition();
  }, [syncPosition]);

  useEffect(() => {
    if (!isTauri() || !filePath) return;

    // Check if we already have a webview for this tab
    const cached = webviewCache.get(tabId);
    if (cached && cached.url === filePath) {
      // Reuse existing webview
      webviewLabelRef.current = cached.label;
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
      return;
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

        const result = await invoke<{ reachable: boolean; error: string }>('check_url', { url: filePath });
        if (!result.reachable) {
          setStatus({ error: { code: 'unknown' } });
          return;
        }

        const container = webViewerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const label = `wv-${Date.now()}`;
        const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

        await invoke('create_webview', {
          label,
          url: filePath,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          userAgent,
        });

        webviewLabelRef.current = label;
        // Cache the webview for this tab
        webviewCache.set(tabId, { label, url: filePath });
        setStatus('ready');
      } catch {
        setStatus({ error: { code: 'unknown' } });
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      // Hide webview when component unmounts (e.g., switching tabs)
      const label = webviewLabelRef.current;
      if (label) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('set_webview_position', {
            label,
            x: -10000,
            y: -10000,
            width: 1,
            height: 1,
          }).catch(() => {});
        });
        webviewLabelRef.current = null;
      }
    };
  }, [filePath, tabId, syncPosition]);

  useEffect(() => {
    if (!isTauri()) return;
    const container = webViewerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => syncPosition());
    observer.observe(container);
    return () => observer.disconnect();
  }, [syncPosition]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ label: string; url: string; title: string }>('webview-url-changed', (event) => {
        if (event.payload.label === webviewLabelRef.current) {
          useEditorStore.getState().updateWebTabUrl(tabId, event.payload.url, event.payload.title);
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, [tabId]);

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

  const host = (() => { try { return new URL(filePath).hostname; } catch { return filePath; } })();

  return (
    <div className="web-viewer-container flex-1 flex flex-col bg-surf overflow-hidden relative">
      <div className="web-viewer-bar flex items-center gap-2 py-1.5 px-3 bg-panel border-b border-brd shrink-0">
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
        <form className="flex-1 min-w-0 flex items-center" onSubmit={submitUrl}>
          <div className="flex-1 min-w-0 flex items-center gap-1.5 h-[26px] px-2.5 rounded-[6px] bg-bg border border-brd transition-colors duration-150 focus-within:border-acc">
            <Globe size={12} className="text-t3 shrink-0" />
            <input
              className="flex-1 min-w-0 bg-transparent border-none outline-none text-xs text-t2 font-mono placeholder:text-t3"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t('browser:addressPlaceholder')}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
          </div>
        </form>
        {!clipPath && (
          <button className="web-viewer-clip-btn flex items-center justify-center w-7 h-7 border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1 disabled:opacity-50 disabled:cursor-not-allowed" title={clipError ? '剪藏失败，请重试' : '剪藏此页'} onClick={handleClipPage} disabled={clipping}>
            {clipping ? (
              <span className="inline-block w-3.5 h-3.5 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />
            ) : clipError ? (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#e05252" strokeWidth="1.5">
                <circle cx="8" cy="8" r="6" />
                <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2v12l5-3 5 3V2H3z" />
              </svg>
            )}
          </button>
        )}
        <div className="relative" ref={importRef}>
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1"
            title={t('browser:importData')}
            onClick={() => setImportOpen((v) => !v)}
          >
            <Download size={14} />
          </button>
          {importOpen && (
            <div className="absolute top-full right-0 mt-1 z-[120] min-w-[210px] bg-surf border border-brd rounded-[8px] shadow-[0_8px_28px_rgba(0,0,0,0.16)] py-1">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-t2 cursor-pointer border-none bg-transparent transition-colors duration-150 hover:bg-hov hover:text-t1 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleImportCookies}
                disabled={cookieImporting}
              >
                <Cookie size={14} className="text-t3 shrink-0" />
                <span className="flex-1">{t('browser:importCookies')}</span>
                {cookieImporting && <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />}
              </button>
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-t2 cursor-pointer border-none bg-transparent transition-colors duration-150 hover:bg-hov hover:text-t1 disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleImportPasswords}
                disabled={passwordImporting}
              >
                <KeyRound size={14} className="text-t3 shrink-0" />
                <span className="flex-1">{t('browser:importPasswords')}</span>
                {passwordImporting && <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />}
              </button>
            </div>
          )}
        </div>
        <div className="relative" ref={passwordRef}>
          <button
            className="flex items-center justify-center w-7 h-7 border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1"
            title={t('browser:passwords')}
            onClick={() => setPasswordOpen((v) => !v)}
          >
            <Lock size={14} />
          </button>
          {passwordOpen && (
            <div className="absolute top-full right-0 mt-1 z-[120] min-w-[240px] max-w-[320px] max-h-[320px] overflow-y-auto bg-surf border border-brd rounded-[8px] shadow-[0_8px_28px_rgba(0,0,0,0.16)] p-1.5">
              <div className="px-2 py-1 text-[11px] text-t3 truncate">
                {t('browser:passwordsFor')} {currentHost || '—'}
              </div>
              {matchingPasswords.length === 0 && (
                <div className="px-2 py-2.5 text-xs text-t3">{t('browser:noPasswords')}</div>
              )}
              {matchingPasswords.map((p) => (
                <div key={p.id} className="flex items-center gap-1 px-2 py-1.5 rounded-[5px] hover:bg-hov">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-t2 truncate">{p.username || '—'}</div>
                    <div className="text-[10px] text-t3 font-mono">••••••••••</div>
                  </div>
                  <button
                    className="w-[22px] h-[22px] flex items-center justify-center rounded-[4px] border-none bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1 shrink-0"
                    title={t('browser:fill')}
                    onClick={() => fillPassword(p.username, p.password)}
                  >
                    <KeyRound size={12} />
                  </button>
                  <button
                    className="w-[22px] h-[22px] flex items-center justify-center rounded-[4px] border-none bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1 shrink-0"
                    title={t('browser:copyPassword')}
                    onClick={() => copyText(p.password)}
                  >
                    <Copy size={12} />
                  </button>
                  <button
                    className="w-[22px] h-[22px] flex items-center justify-center rounded-[4px] border-none bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-red shrink-0"
                    title={t('browser:removePassword')}
                    onClick={() => removePassword(p.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className="flex items-center justify-center w-7 h-7 border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1"
          title={t('browser:newTab')}
          onClick={() => openBrowserTab()}
        >
          <Plus size={14} />
        </button>
        <button className="web-viewer-open-btn flex items-center justify-center w-7 h-7 border-none rounded-[5px] bg-transparent text-t2 cursor-pointer shrink-0 transition-all duration-150 hover:bg-hov hover:text-t1" title="在外部浏览器打开" onClick={openExternal}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
            <path d="M9 2h5v5" />
            <line x1="14" y1="2" x2="7" y2="9" />
          </svg>
        </button>
      </div>

      {notice && (
        <div className="absolute left-3 bottom-3 z-[130] max-w-[70%] bg-panel border border-brd rounded-[8px] shadow-[0_6px_20px_rgba(0,0,0,0.18)] px-3 py-2 text-xs text-t1 pointer-events-none">
          {notice}
        </div>
      )}

      {clipDuplicate && (
        <div className="web-viewer-duplicate absolute inset-x-0 top-10 bottom-0 flex items-center justify-center bg-surf z-20 p-4">
          <div className="flex flex-col gap-2.5 max-w-[360px] w-full bg-panel border border-brd rounded-[10px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] p-5">
            <div className="text-[14px] font-semibold text-t1">该链接已经剪藏过</div>
            <div className="text-[11px] text-t2 break-all bg-bg rounded-md px-2.5 py-1.5 border border-brd">
              {clipDuplicate.url}
            </div>
            <div className="text-[12px] text-t2 leading-relaxed">是否打开已有笔记，或重新生成并覆盖？</div>
            <div className="flex flex-col gap-1.5">
              <button
                className="py-2 text-[13px] rounded-md bg-acc text-white border-none cursor-pointer hover:opacity-90 transition-opacity font-medium"
                onClick={handleDuplicateOpen}
              >
                打开已有
              </button>
              <button
                className="py-2 text-[13px] rounded-md bg-amber-500 text-white border-none cursor-pointer hover:opacity-90 transition-opacity font-medium"
                onClick={handleDuplicateRegenerate}
              >
                重新生成
              </button>
              <button
                className="py-2 text-[13px] rounded-md bg-bg text-t2 border border-brd cursor-pointer hover:bg-hov transition-colors"
                onClick={handleDuplicateCancel}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div className="web-viewer-status absolute inset-x-0 top-10 bottom-0 flex flex-col items-center justify-center gap-3 bg-surf z-10 text-t2">
          <div className="web-viewer-spinner w-7 h-7 rounded-full border-[2.5px] border-brd border-t-acc animate-spin" />
          <span>正在连接…</span>
        </div>
      )}

      {typeof status === 'object' && (() => {
        const { code, status: httpStatus } = status.error;
        const info: { title: string; desc: string; detail?: string } =
          code === 'invalid_url' ? { title: '无效的网址', desc: `"${filePath}" 不是一个有效的网址，请检查拼写是否正确。` }
          : code === 'blocked' ? { title: '网站拒绝了嵌入显示', desc: `${host} 不允许在应用内打开。`, detail: '该网站设置了安全策略，禁止被其他程序嵌入显示。请在外部浏览器中访问。' }
          : code === 'dns' ? { title: '找不到该网站', desc: `无法解析 ${host} 的地址。`, detail: '请检查网址是否有拼写错误，或者该网站可能已不存在。' }
          : code === 'refused' ? { title: '连接被拒绝', desc: `${host} 拒绝了连接请求。`, detail: '该网站可能暂时停止服务，或者服务器配置了访问限制。' }
          : code === 'timeout' ? { title: '连接超时', desc: `连接 ${host} 超时，服务器没有响应。`, detail: '请检查网络连接是否正常，或稍后再试。' }
          : code === 'http' ? {
              title: `请求失败（${httpStatus}）`,
              desc: httpStatus === 404 ? `找不到页面：${host} 上不存在该内容。`
                : httpStatus === 403 ? `访问被拒绝：无权限访问 ${host}。`
                : httpStatus === 500 ? `服务器内部错误：${host} 出了点问题。`
                : `服务器返回了错误状态 ${httpStatus}。`,
            }
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
            {info.detail && <p className="text-xs text-t3 m-0 text-center max-w-[300px] leading-relaxed">{info.detail}</p>}
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
