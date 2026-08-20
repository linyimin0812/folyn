import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import {
  usePetStore,
  type NotificationForm,
  type CornerPlacement,
  type CornerTtlMs,
} from '@/store/petStore';
import { isTauri } from '@/utils/platform';
import { invoke } from '@tauri-apps/api/core';
import { BUILT_IN_TEMPLATES, type BubbleTemplate } from '@/components/pet/bubbleTemplate';
import { BubbleTemplateAIChatModal } from './BubbleTemplateAIChatModal';

const CORNERS: CornerPlacement[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

const TTL_PRESETS: CornerTtlMs[] = [5000, 10000, 30000, 'never'];

export function NotificationsSettings() {
  const { t } = useTranslation();
  const notificationForm = usePetStore((s) => s.notificationForm);
  const setNotificationForm = usePetStore((s) => s.setNotificationForm);
  const cornerPlacement = usePetStore((s) => s.cornerPlacement);
  const setCornerPlacement = usePetStore((s) => s.setCornerPlacement);
  const cornerTtlMs = usePetStore((s) => s.cornerTtlMs);
  const setCornerTtlMs = usePetStore((s) => s.setCornerTtlMs);

  const formOptions: { value: NotificationForm; label: string }[] = [
    { value: 'bubble', label: t('settings:notifications.options.bubble') },
    { value: 'corner', label: t('settings:notifications.options.corner') },
    { value: 'off', label: t('settings:notifications.options.off') },
  ];

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:notifications.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:notifications.description')}</div>
      </div>
      <PetExternalApiBlock />
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.form.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.form.desc')}</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={notificationForm}
          onChange={(e) => setNotificationForm(e.target.value as NotificationForm)}
        >
          {formOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      {notificationForm === 'corner' && (
        <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
          <div className="tr-info">
            <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.cornerPlacement.title')}</h4>
            <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.cornerPlacement.desc')}</p>
          </div>
          <select
            className="settings-select"
            style={{ maxWidth: 200 }}
            value={cornerPlacement}
            onChange={(e) => setCornerPlacement(e.target.value as CornerPlacement)}
          >
            {CORNERS.map((c) => (
              <option key={c} value={c}>{t(`settings:notifications.cornerPlacement.options.${c}`)}</option>
            ))}
          </select>
        </div>
      )}
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.cornerTtlMs.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.cornerTtlMs.desc')}</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={typeof cornerTtlMs === 'number' ? String(cornerTtlMs) : 'never'}
          onChange={(e) => {
            const v = e.target.value;
            setCornerTtlMs(v === 'never' ? 'never' : Number(v));
          }}
        >
          {TTL_PRESETS.map((p) => {
            const value = typeof p === 'number' ? String(p) : 'never';
            const label = typeof p === 'number'
              ? t('settings:notifications.cornerTtlMs.seconds', { seconds: p / 1000 })
              : t('settings:notifications.cornerTtlMs.never');
            return (
              <option key={value} value={value}>{label}</option>
            );
          })}
        </select>
      </div>

      <BubbleTemplateBlock />
      <BubbleAppWhitelistBlock />
    </div>
  );
}

interface PetApiInfo {
  enabled: boolean;
  port: number | null;
  endpoints: string[];
}

// ponytail: one canonical sample body — used by both the test button (fetch)
// and the curl snippet, and shown verbatim in the API doc modal. Showcases
// every field build_notify accepts so users can copy a working example.
const SAMPLE_NOTIFY_BODY =
  '{"action":"notify","kind":"reminder","title":"任务待处理","source":"quill","text":"测试通知已送达","actions":[{"id":"ok","label":"知道了","launch":{"type":"url","value":"https://example.com"}}]}';

function PetExternalApiBlock() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<PetApiInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showDoc, setShowDoc] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke<PetApiInfo>('get_pet_api_info');
        if (!cancelled) setInfo(res);
      } catch {
        // Non-fatal — block stays hidden (info null).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ponytail: compute curl inline + useCallback must run before the early
  // return (Rules of Hooks). When info is null the values are inert.
  const port = info?.enabled ? info.port : null;
  const curl =
    port != null
      ? `curl -XPOST 127.0.0.1:${port}/pet/action -d '${SAMPLE_NOTIFY_BODY}'`
      : '';
  const handleCopy = useCallback(async () => {
    if (!curl) return;
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Non-fatal — the inline text remains selectable.
    }
  }, [curl]);

  // ponytail: no-cors fetch — we only need to fire the request, the pet
  // bubble is the visual feedback. Opaque response is fine. Avoids adding
  // CORS support to the tiny_http server or a Tauri HTTP plugin.
  const handleTest = useCallback(async () => {
    if (!port) return;
    setTesting(true);
    try {
      await fetch(`http://127.0.0.1:${port}/pet/action`, {
        method: 'POST',
        mode: 'no-cors',
        body: SAMPLE_NOTIFY_BODY,
      });
    } catch {
      // Network error — still surface the test-done state; the pet may or
      // may not have shown. The user can retest.
    } finally {
      setTimeout(() => setTesting(false), 1500);
    }
  }, [port]);

  if (!info || !info.enabled || info.port == null) return null;

  return (
    <div className="tr flex items-center justify-between py-3.5 border-b border-brd mt-3.5">
      <div className="tr-info">
        <div className="flex items-center gap-1.5 mb-1">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0">{t('settings:pet.api.title')}</h4>
          <button
            className="text-t3 hover:text-t1 transition-colors p-0.5"
            aria-label={t('settings:pet.api.doc')}
            onClick={() => setShowDoc(true)}
          >
            <Info size={13} />
          </button>
        </div>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">
          {t('settings:pet.api.desc', { port: info.port })}
        </p>
        <code className="block mt-1.5 text-[10.5px] text-t3 bg-surf2 rounded px-1.5 py-1 break-all">{curl}</code>
      </div>
      <div className="flex flex-col gap-1.5 items-center shrink-0">
        <button
          className="btn btn-g btn-sm w-full justify-center"
          onClick={() => void handleTest()}
          disabled={testing}
        >{testing ? t('settings:pet.api.testing') : t('settings:pet.api.test')}</button>
        <button
          className="btn btn-g btn-sm w-full justify-center"
          onClick={() => void handleCopy()}
        >{copied ? t('settings:pet.api.copied') : t('settings:pet.api.copy')}</button>
      </div>
      {showDoc && <PetApiDocModal port={info.port} onClose={() => setShowDoc(false)} />}
    </div>
  );
}

// ponytail: doc modal mirrors ConsentModal's overlay pattern. Field table is
// inline zh prose — this is API documentation, not UI chrome, so per-line
// i18n would be churn. Add an en variant only if a non-zh user asks.
// `depth` controls indentation: 0 = top-level field, 1 = sub-field of parent.
const PET_API_FIELDS: Array<{ field: string; desc: string; depth: 0 | 1 }> = [
  { field: 'action', desc: '"notify" (必填; show/hide 保留未实现)', depth: 0 },
  { field: 'kind', desc: 'info | reminder | message | event (默认 info)', depth: 0 },
  { field: 'title', desc: '可选, 非空, 标题文字', depth: 0 },
  { field: 'source', desc: '可选, 非空, 来源标识 (≤128 字符)', depth: 0 },
  { field: 'text', desc: '必填, 非空, 正文 (≤4096 字符)', depth: 0 },
  { field: 'target', desc: '可选, 内部实体跳转 (与 launch 互斥用途: 跳到 schedule/chat/task/file)', depth: 0 },
  { field: 'kind', desc: 'schedule | chat | task | file', depth: 1 },
  { field: 'id', desc: 'string, 实体 id (路径 / sessionId 等)', depth: 1 },
  { field: 'actions', desc: '可选, 按钮数组 (最多 2 个)', depth: 0 },
  { field: 'id', desc: 'string, 按钮标识 (点击时回传)', depth: 1 },
  { field: 'label', desc: 'string, 按钮显示文字', depth: 1 },
  { field: 'launch', desc: '可选, 同下方 launch, 点击该按钮时触发跳转', depth: 1 },
  { field: 'launch', desc: '可选, 气泡主体点击跳转', depth: 0 },
  { field: 'type', desc: '"url" | "app"', depth: 1 },
  { field: 'value', desc: 'url: http(s) 链接; app: 应用名 [A-Za-z0-9 .-]+ (≤512 字符)', depth: 1 },
];

function PetApiDocModal({ port, onClose }: { port: number; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-lg p-4 max-w-lg w-[90vw] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-2">
          {t('settings:pet.api.title')}
        </div>
        <code className="block text-[11px] text-t2 bg-surf2 rounded px-2 py-1.5 mb-3 break-all">
          POST 127.0.0.1:{port}/pet/action
        </code>
        <div className="text-[11px] font-semibold text-t2 mb-1.5">字段</div>
        <div className="bg-surf2 border border-brd2 rounded-md p-2 mb-3">
          <table className="text-[11px] text-t2 w-full">
            <tbody>
              {PET_API_FIELDS.map((f, i) => (
                <tr key={i}>
                  <td className={`align-top py-0.5 pr-2 font-mono text-t1 whitespace-nowrap ${f.depth === 1 ? 'pl-4 text-t2' : ''}`}>{f.field}</td>
                  <td className="align-top py-0.5 leading-relaxed">{f.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] font-semibold text-t2 mb-1.5">示例 payload</div>
        <pre className="text-[10.5px] text-t2 bg-surf2 border border-brd2 rounded-md p-2 mb-3 whitespace-pre-wrap break-all overflow-x-auto">{SAMPLE_NOTIFY_BODY}</pre>
        <div className="flex justify-end">
          <button className="btn btn-g btn-sm" onClick={onClose}>
            {t('settings:pet.api.docClose')}
          </button>
        </div>
      </div>
    </div>
  );
}

function BubbleTemplateBlock() {
  const { t } = useTranslation();
  const userTemplates = usePetStore((s) => s.bubbleUserTemplates);
  const activeTemplateId = usePetStore((s) => s.bubbleActiveTemplateId);
  const addTemplate = usePetStore((s) => s.addBubbleUserTemplate);
  const removeTemplate = usePetStore((s) => s.removeBubbleUserTemplate);
  const setActive = usePetStore((s) => s.setBubbleActiveTemplateId);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const [aiOpen, setAiOpen] = useState(false);

  const allTemplates = [...BUILT_IN_TEMPLATES, ...userTemplates];

  const emitPreview = useCallback(async (tplId: string) => {
    if (!isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://bubble-show', {
        text: t('settings:pet.templates.previewSample.text'),
        title: t('settings:pet.templates.previewSample.title'),
        kind: 'info',
        template: tplId,
        actions: [{ id: 'view', label: t('settings:pet.templates.previewSample.actionLabel'), kind: 'primary' }],
      });
    } catch {
      // Non-fatal — preview just doesn't fire.
    }
  }, [t]);

  const handleImportFile = useCallback(async () => {
    setError('');
    if (!isTauri()) {
      setError(t('settings:pet.templates.invalidJson'));
      return;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const picked = await open({
        filters: [{ name: 'JSON', extensions: ['json'] }],
        multiple: false,
      });
      if (!picked || Array.isArray(picked)) return;
      const text = await readTextFile(picked as string);
      tryImport(text);
    } catch {
      setError(t('settings:pet.templates.invalidJson'));
    }
  }, [t]);

  const parseTemplate = useCallback((text: string): { ok: true; tpl: BubbleTemplate } | { ok: false; error: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: t('settings:pet.templates.invalidJson') };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: t('settings:pet.templates.missingFields') };
    }
    const o = parsed as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string' ||
        typeof o.html !== 'string' || typeof o.css !== 'string') {
      return { ok: false, error: t('settings:pet.templates.missingFields') };
    }
    return {
      ok: true,
      tpl: {
        id: o.id,
        name: o.name,
        html: o.html,
        css: o.css,
        fields: Array.isArray(o.fields) ? o.fields.filter((f) => typeof f === 'string') : undefined,
      },
    };
  }, [t]);

  const tryImport = useCallback((text: string): { ok: boolean; error?: string } => {
    setError('');
    const r = parseTemplate(text);
    if (!r.ok) {
      setError(r.error);
      return { ok: false, error: r.error };
    }
    const collision = BUILT_IN_TEMPLATES.some((b) => b.id === r.tpl.id);
    addTemplate(r.tpl);
    if (collision) {
      const msg = t('settings:pet.templates.idCollision');
      setError(msg);
    }
    setPasteOpen(false);
    setPasteText('');
    return { ok: true };
  }, [parseTemplate, addTemplate, t]);

  // ponytail: preview fires pet://bubble-show with templateDraft so the pet
  // window renders the unsaved template without polluting userTemplates.
  // Reuses parseTemplate — same validation as import, just diverges at the end.
  const handlePreview = useCallback((text: string): { ok: boolean; error?: string } => {
    setError('');
    const r = parseTemplate(text);
    if (!r.ok) {
      setError(r.error);
      return { ok: false, error: r.error };
    }
    if (!isTauri()) return { ok: true };
    (async () => {
      try {
        const { emit } = await import('@tauri-apps/api/event');
        await emit('pet://bubble-show', {
          text: t('settings:pet.templates.previewSample.text'),
          title: t('settings:pet.templates.previewSample.title'),
          kind: 'info',
          templateDraft: r.tpl,
          actions: [{ id: 'view', label: t('settings:pet.templates.previewSample.actionLabel'), kind: 'primary' }],
        });
      } catch {
        // Non-fatal — preview just doesn't fire.
      }
    })();
    return { ok: true };
  }, [parseTemplate, t]);

  return (
    <div className="tr flex flex-col gap-3 py-3.5 border-b border-brd mt-3.5">
      <div className="tr-info">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:pet.templates.title')}</h4>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:pet.templates.desc')}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {allTemplates.map((tpl) => {
          const isActive = activeTemplateId === tpl.id;
          const isBuiltin = BUILT_IN_TEMPLATES.some((b) => b.id === tpl.id);
          return (
            <div
              key={tpl.id}
              className={`rounded-md border p-2 text-[11px] flex flex-col gap-1.5 ${isActive ? 'border-acc bg-accdim' : 'border-brd bg-surf'}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-ui font-semibold text-t1">{tpl.nameKey ? t(tpl.nameKey) : tpl.name}</span>
                <span className="text-[9px] px-1 rounded bg-surf2 text-t3">
                  {isBuiltin ? t('settings:pet.templates.builtin') : t('settings:pet.templates.custom')}
                </span>
              </div>
              <div className="flex gap-1">
                {!isActive && (
                  <button
                    className="btn btn-g btn-sm flex-1 justify-center"
                    onClick={() => setActive(tpl.id)}
                  >{t('settings:pet.templates.activate')}</button>
                )}
                {isActive && (
                  <span className="text-[10px] text-acc flex-1 text-center self-center">{t('settings:pet.templates.active')}</span>
                )}
                <button
                  className="btn btn-g btn-sm"
                  onClick={() => void emitPreview(tpl.id)}
                >{t('settings:pet.templates.preview')}</button>
                {!isBuiltin && (
                  <button
                    className="btn btn-g btn-sm"
                    onClick={() => removeTemplate(tpl.id)}
                  >{t('settings:pet.templates.delete')}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button className="btn btn-g btn-sm" onClick={() => void handleImportFile()}>
          {t('settings:pet.templates.importFile')}
        </button>
        <button
          className="btn btn-g btn-sm"
          onClick={() => { setPasteOpen(!pasteOpen); setError(''); }}
        >{t('settings:pet.templates.importPaste')}</button>
        <button
          className="btn btn-g btn-sm"
          onClick={() => { setAiOpen(true); setError(''); }}
        >{t('settings:pet.templates.ai.generate')}</button>
      </div>
      {pasteOpen && (
        <div className="flex flex-col gap-2">
          <textarea
            className="border border-brd rounded p-2 text-[11px] font-mono h-24 bg-surf"
            placeholder={t('settings:pet.templates.pastePlaceholder')}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="btn btn-g btn-sm"
              onClick={() => tryImport(pasteText)}
            >{t('settings:pet.templates.import')}</button>
            <button
              className="btn btn-g btn-sm"
              onClick={() => { setPasteOpen(false); setPasteText(''); setError(''); }}
            >{t('settings:pet.templates.cancel')}</button>
          </div>
        </div>
      )}
      {error && <div className="text-[11px] text-[#e53935]">{error}</div>}
      <BubbleTemplateAIChatModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onImport={(jsonText) => tryImport(jsonText)}
        onPreview={(jsonText) => handlePreview(jsonText)}
      />
    </div>
  );
}

function BubbleAppWhitelistBlock() {
  const { t } = useTranslation();
  const whitelist = usePetStore((s) => s.bubbleAppWhitelist);
  const add = usePetStore((s) => s.addBubbleAppToWhitelist);
  const remove = usePetStore((s) => s.removeBubbleAppFromWhitelist);
  const [input, setInput] = useState('');

  const handleAdd = () => {
    if (!input.trim()) return;
    add(input);
    setInput('');
  };

  return (
    <div className="tr flex flex-col gap-2 py-3.5 border-b border-brd">
      <div className="tr-info">
        <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:pet.whitelist.title')}</h4>
        <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:pet.whitelist.desc')}</p>
      </div>
      <div className="flex h-[32px]">
        <input
          type="text"
          className="flex-1 border border-brd border-r-0 rounded-l px-2.5 text-[length:calc(var(--ui-font-size)-2px)] bg-inp focus:outline-none focus:border-acc h-full"
          placeholder={t('settings:pet.whitelist.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
        />
        <button
          className="rounded-r px-3 text-[length:calc(var(--ui-font-size)-2px)] bg-acc text-white hover:opacity-90 transition-colors h-full"
          onClick={handleAdd}
        >
          {t('settings:pet.whitelist.add')}
        </button>
      </div>
      {whitelist.length === 0 ? (
        <div className="text-[11px] text-t3">{t('settings:pet.whitelist.empty')}</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {whitelist.map((app) => (
            <div
              key={app}
              className="flex items-center gap-1 rounded border border-brd bg-surf2 px-1.5 py-0.5 text-[11px]"
            >
              <span>{app}</span>
              <button
                className="text-t3 hover:text-[#e53935] text-[10px] leading-none"
                onClick={() => remove(app)}
                aria-label={t('settings:pet.whitelist.remove')}
              >×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
