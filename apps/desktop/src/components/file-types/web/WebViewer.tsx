import { useRef, useState, useCallback, useEffect } from 'react';
import { isTauri } from '@/utils/platform';
import { useEditorStore } from '@/store/editorStore';
import type { EditorProps } from '../types';

type WebviewErrorCode = 'dns' | 'refused' | 'timeout' | 'http' | 'invalid_url' | 'blocked' | 'unknown';
type WebviewError = { code: WebviewErrorCode; status?: number };
type WebviewStatus = 'loading' | 'ready' | { error: WebviewError };

export function WebViewer({ filePath, tabId }: EditorProps) {
  const webViewerRef = useRef<HTMLDivElement>(null);
  const webviewLabelRef = useRef<string | null>(null);
  const [status, setStatus] = useState<WebviewStatus>('loading');

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

  useEffect(() => {
    if (!isTauri() || !filePath) return;

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
        setStatus('ready');
      } catch {
        setStatus({ error: { code: 'unknown' } });
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      const label = webviewLabelRef.current;
      if (label) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('close_webview', { label }).catch(() => {});
        });
        webviewLabelRef.current = null;
      }
    };
  }, [filePath]);

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

  const navigate = (action: 'back' | 'forward') => {
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
    <div className="web-viewer-container" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div className="web-viewer-bar">
        {isTauri() && webviewLabelRef.current && (
          <>
            <button className="web-viewer-nav-btn" title="后退" onClick={() => navigate('back')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="web-viewer-nav-btn" title="前进" onClick={() => navigate('forward')}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
        <span className="web-viewer-url" title={filePath}>🌐 {filePath}</span>
        <button className="web-viewer-open-btn" title="在外部浏览器打开" onClick={openExternal}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
            <path d="M9 2h5v5" />
            <line x1="14" y1="2" x2="7" y2="9" />
          </svg>
        </button>
      </div>

      {status === 'loading' && (
        <div className="web-viewer-status">
          <div className="web-viewer-spinner" />
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
          <div className="web-viewer-status web-viewer-error">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="web-viewer-error-icon">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a14.5 14.5 0 0 1 0 20M12 2a14.5 14.5 0 0 0 0 20M2 12h20" />
              <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" strokeWidth="1.8" stroke="#e05252" />
            </svg>
            <p className="web-viewer-error-title">{info.title}</p>
            <p className="web-viewer-error-desc">{info.desc}</p>
            {info.detail && <p className="web-viewer-error-detail">{info.detail}</p>}
            <div className="web-viewer-error-url">{filePath}</div>
            <button className="web-viewer-error-btn" onClick={openExternal}>
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

      <div ref={webViewerRef} className="web-viewer-body" />
    </div>
  );
}
