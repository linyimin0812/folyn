import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import type { Capability } from '@/services/modelRegistry/types';
import { CAPABILITY_PILL } from '@/components/icons/capabilityIcons';
import { askModelCapabilities } from '@/services/askModelCapabilitiesService';
import type { StreamEvent } from '@/services/aiStreamUtils';

const EDITABLE_CAPABILITIES: Capability[] = [
  'reasoning',
  'function-call',
  'vision',
  'web-search',
  'embedding',
  'rerank',
];

export function CapabilityEditModal({
  modelId,
  providerName,
  initialCapabilities,
  onClose,
  onSave,
}: {
  modelId: string;
  providerName: string;
  initialCapabilities: readonly Capability[];
  onClose: () => void;
  onSave: (capabilities: Capability[]) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<Capability>>(() => new Set(initialCapabilities));
  const [askAILoading, setAskAILoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamThinking, setStreamThinking] = useState('');
  const [streamOpen, setStreamOpen] = useState(true);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggested, setAiSuggested] = useState<Capability[] | null>(null);
  const streamRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelected(new Set(initialCapabilities));
  }, [initialCapabilities]);

  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [streamText, streamThinking]);

  const toggle = (c: Capability) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const applySuggested = (c: Capability) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.add(c);
      return next;
    });
    setAiSuggested((prev) => (prev ? prev.filter((x) => x !== c) : prev));
  };

  const applyAllSuggested = () => {
    if (!aiSuggested) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of aiSuggested) next.add(c);
      return next;
    });
    setAiSuggested(null);
  };

  const handleAskAI = async () => {
    if (askAILoading) return;
    setAskAILoading(true);
    setStreamText('');
    setStreamThinking('');
    setAiError(null);
    setAiSuggested(null);
    setStreamOpen(true);
    try {
      const { capabilities } = await askModelCapabilities(
        modelId,
        providerName,
        (chunk) => {
          setStreamText((prev) => prev + chunk);
        },
        (event: StreamEvent) => {
          if (event.kind === 'thinking') {
            setStreamThinking((prev) => prev + event.content);
          } else if (event.kind === 'text') {
            // text chunks also arrive via onEvent in some adapter paths;
            // concat into streamText to avoid duplicates.
            setStreamText((prev) => prev + event.content);
          }
        },
      );
      setAiSuggested(capabilities);
    } catch (e) {
      const msg = typeof e === 'object' && e && 'detail' in e
        ? String((e as { detail: unknown }).detail ?? e)
        : String(e);
      setAiError(msg);
    } finally {
      setAskAILoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-brd rounded-md w-[460px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {t('settings:models.editCapabilities.title')}
          </div>
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] text-t3 mt-0.5 truncate">
            {modelId}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />

        {/* AI suggestion tag bar — clickable labels. */}
        {aiSuggested !== null && (
          <div className="mx-4 mt-3 px-3 py-2 bg-accdim rounded-md">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-acc mb-1">
              {aiSuggested.length > 0
                ? t('settings:models.askAI.suggestedLabel')
                : t('settings:models.askAI.noSuggestion')}
            </div>
            {aiSuggested.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {aiSuggested.map((c) => {
                  const pill = CAPABILITY_PILL[c];
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => applySuggested(c)}
                      title={t('settings:models.askAI.clickToApply')}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold hover:opacity-80 transition-opacity"
                      style={{ background: pill?.bg ?? '#eee', color: pill?.color ?? '#333' }}
                    >
                      {pill && <pill.Icon size={11} />}
                      {t(`settings:models.capability.${c}`)}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={applyAllSuggested}
                  className="ml-1 text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-acc hover:underline"
                >
                  {t('settings:models.askAI.applyAll')}
                </button>
              </div>
            )}
            <div className="mt-1 text-[length:calc(var(--ui-font-size)-3px)] text-t3">
              {t('settings:models.askAI.suggestedHint')}
            </div>
          </div>
        )}

        <div className="px-4 py-4 flex flex-col gap-2 overflow-y-auto">
          {EDITABLE_CAPABILITIES.map((c) => {
            const pill = CAPABILITY_PILL[c];
            const isOn = selected.has(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggle(c)}
                className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${
                  isOn
                    ? 'border-acc bg-accdim'
                    : 'border-brd bg-transparent hover:bg-hov'
                }`}
              >
                <span className="flex items-center gap-2">
                  {pill && (
                    <span
                      className="inline-flex items-center justify-center rounded-[5px]"
                      style={{ width: 18, height: 18, background: pill.bg, color: pill.color }}
                    >
                      <pill.Icon size={11} />
                    </span>
                  )}
                  <span className="text-[length:calc(var(--ui-font-size)-2px)] font-ui text-t1">
                    {t(`settings:models.capability.${c}`)}
                  </span>
                </span>
                <span
                  className={`text-[10px] font-bold px-1.5 h-[14px] inline-flex items-center rounded-full ${
                    isOn ? 'text-white bg-acc' : 'text-t3 bg-hov'
                  }`}
                >
                  {isOn ? 'ON' : 'OFF'}
                </span>
              </button>
            );
          })}
        </div>

        {/* Streaming area — text + thinking (italic gray). Collapsible. */}
        {(streamText || streamThinking || askAILoading || aiError) && (
          <div className="mx-4 mb-2 border border-brd rounded-md">
            <button
              type="button"
              onClick={() => setStreamOpen((v) => !v)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 hover:bg-hov"
            >
              {streamOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>{askAILoading ? t('settings:models.askAI.thinking') : t('settings:models.askAI.streamTitle')}</span>
              {askAILoading && (
                <svg className="animate-spin ml-1" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
            </button>
            {streamOpen && (
              <div
                ref={streamRef}
                className="px-3 pb-2 max-h-[120px] overflow-y-auto text-[length:calc(var(--ui-font-size)-3px)] text-t3 font-mono whitespace-pre-wrap break-words"
              >
                {streamThinking && (
                  <div className="italic text-t3 opacity-70 whitespace-pre-wrap">{streamThinking}</div>
                )}
                {streamText && (
                  <div className="text-t2 whitespace-pre-wrap">{streamText}</div>
                )}
                {aiError && (
                  <div className="text-[var(--red,#f06a6a)]">[error] {aiError}</div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="h-px bg-brd mx-4" />
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            className="btn btn-g btn-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-wait"
            onClick={() => { void handleAskAI(); }}
            disabled={askAILoading}
            title={t('settings:models.askAI.tooltip')}
          >
            {askAILoading ? (
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <Sparkles size={14} />
            )}
            {t('settings:models.askAI.label')}
          </button>
          <div className="flex gap-2">
            <button className="btn btn-g btn-sm" onClick={onClose}>
              {t('settings:models.cancel')}
            </button>
            <button
              className="btn btn-p btn-sm"
              onClick={() => onSave(Array.from(selected))}
            >
              {t('settings:models.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
