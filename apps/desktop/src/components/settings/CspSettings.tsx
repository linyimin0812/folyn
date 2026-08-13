import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { useCspConfigStore } from '@/store/cspConfigStore';
import { persistNow } from '@/store/settingsPersistence';
import { buildCsp, isValidSource } from '@/utils/csp';

/**
 * 安全策略 (CSP) settings tab — configure which external URLs the app may
 * load. Tauri's own CSP is compile-time only, so Quill applies the policy at
 * runtime via a single `<meta http-equiv="Content-Security-Policy">` tag
 * (see `utils/csp.ts`). The Tauri-required baseline (`ipc:`, `quill-plugin:`,
 * `asset:`, `data:`, `blob:`, …) is fixed and always included; this tab only
 * controls the extra user-facing sources on top of it.
 *
 * A browser only ever *tightens* a CSP within a live document — removing a
 * URL takes effect immediately (stricter), but *adding* a URL (or switching
 * to "allow all") can only take effect on a fresh page. The "应用并刷新"
 * button therefore persists the current config and reloads the webview so
 * the new policy is the only one in effect.
 */
export function CspSettings() {
  const { t } = useTranslation();
  const mode = useCspConfigStore((s) => s.mode);
  const allowedUrls = useCspConfigStore((s) => s.allowedUrls);
  const setMode = useCspConfigStore((s) => s.setMode);
  const addUrl = useCspConfigStore((s) => s.addUrl);
  const removeUrl = useCspConfigStore((s) => s.removeUrl);
  const reset = useCspConfigStore((s) => s.reset);

  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const policy = useMemo(() => buildCsp({ mode, allowedUrls }), [mode, allowedUrls]);

  const commitInput = () => {
    const v = input.trim();
    if (!v) return;
    if (!isValidSource(v)) {
      setError(t('settings:csp.urls.invalid'));
      return;
    }
    addUrl(v);
    setInput('');
    setError(null);
  };

  /** Persist immediately (bypassing the 300ms debounce) then reload so the
   *  freshly added URLs are on disk before the new document hydrates. */
  const handleApply = async () => {
    try {
      await persistNow();
    } catch {
      // Non-fatal — a failed flush still reloads with the persisted state.
    }
    window.location.reload();
  };

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:csp.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:csp.description')}</div>
      </div>

      {/* 模式选择 */}
      <div className="tr flex items-center justify-between py-3.5 border-b border-brd gap-3">
        <div className="tr-info min-w-0">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:csp.mode.label')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:csp.mode.description')}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${mode === 'all' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={() => setMode('all')}
          >{t('settings:csp.mode.all')}</button>
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${mode === 'custom' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={() => setMode('custom')}
          >{t('settings:csp.mode.custom')}</button>
        </div>
      </div>

      {/* 自定义白名单 */}
      {mode === 'custom' && (
        <div className="border-b border-brd">
          <div className="tr flex items-center justify-between py-3.5 gap-3">
            <div className="tr-info min-w-0">
              <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:csp.urls.label')}</h4>
              <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:csp.urls.description')}</p>
            </div>
            <button
              className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-ui cursor-pointer border border-brd2 text-t3 hover:border-acc hover:text-acc transition-all duration-100 bg-transparent shrink-0"
              onClick={reset}
            >
              <RotateCcw size={12} />
              {t('settings:csp.urls.reset')}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-3.5">
            <input
              className="py-[5px] px-2.5 rounded-md text-[11px] font-ui border border-brd2 bg-inp text-t1 outline-none focus:border-acc w-[220px] max-w-full"
              placeholder={t('settings:csp.urls.prompt')}
              value={input}
              onChange={(e) => { setInput(e.target.value); if (error) setError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitInput();
                else if (e.key === 'Escape') { setInput(''); setError(null); }
              }}
              onBlur={commitInput}
            />
            {allowedUrls.length === 0 && (
              <span className="text-[11px] text-t3 italic">{t('settings:csp.urls.empty')}</span>
            )}
            {allowedUrls.map((url) => (
              <span key={url} className="inline-flex items-center gap-1 h-[26px] pl-2.5 pr-1 rounded-md text-[11px] font-ui bg-accdim text-t1 border border-brd2 max-w-full">
                <span className="font-mono leading-none break-all min-w-0">{url}</span>
                <button
                  className="w-[18px] h-[18px] flex items-center justify-center rounded text-t3 hover:text-[#f06a6a] hover:bg-hov transition-colors leading-none shrink-0"
                  onClick={() => removeUrl(url)}
                  aria-label={t('settings:csp.urls.remove')}
                >×</button>
              </span>
            ))}
          </div>
          {error && <p className="text-[11px] text-[#f06a6a] m-0 pb-3">{error}</p>}
        </div>
      )}

      {/* 生效策略预览 */}
      <div className="pt-3.5">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:csp.preview.label')}</h4>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 mb-2 leading-relaxed">
          {t('settings:csp.preview.description')}
        </p>
        <pre className="m-0 p-3 rounded-lg bg-bg border border-brd text-[10.5px] leading-relaxed font-mono text-t2 whitespace-pre-wrap break-all max-w-full">{policy}</pre>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 mt-2 leading-relaxed">{t('settings:csp.baseline.note')}</p>
      </div>

      {/* 应用并刷新 */}
      <div className="flex items-center justify-between gap-3 pt-3.5 mt-3.5 border-t border-brd">
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed min-w-0">{t('settings:csp.apply.note')}</p>
        <button className="btn btn-p btn-sm shrink-0" onClick={handleApply}>
          {t('settings:csp.apply.button')}
        </button>
      </div>
    </div>
  );
}
