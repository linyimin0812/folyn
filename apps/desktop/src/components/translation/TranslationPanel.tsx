import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavStore } from '@/store/navStore';
import { useAiConfigStore, resolvePairConfig, type ProviderModelPair } from '@/store/aiConfigStore';
import { runRigChat } from '@/services/rigChat';
import { MarkdownPreview } from '@/components/file-types/markdown/MarkdownPreview';
import { PairSelector, type Pair } from '@/components/ai/PairSelector';
import { Toggle } from '@/components/settings/primitives';
import { LanguageDropdown } from './LanguageDropdown';
import {
  AUTO_DETECT_ID,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
} from './languages';

function languageLabel(id: string): string {
  const all = SOURCE_LANGUAGES;
  return all.find((l) => l.id === id)?.label ?? id;
}

function buildPrompt(text: string, sourceId: string, targetId: string): string {
  // ponytail: pass full language names, not ISO codes — 'it' reads as the
  // English pronoun and the LLM defaults to English. Names are unambiguous.
  const sourceClause = sourceId === AUTO_DETECT_ID
    ? 'the source language (detect it yourself from the input)'
    : languageLabel(sourceId);
  const targetName = languageLabel(targetId);
  return [
    `You are a professional translator. Translate the user's text from ${sourceClause} into ${targetName}.`,
    'Preserve markdown formatting, code blocks, and inline syntax if present.',
    'Output ONLY the translation — no preamble, no notes, no explanation.',
    'If the text is already in the target language, still output it verbatim.',
    '',
    'TEXT TO TRANSLATE:',
    text,
  ].join('\n');
}

const COPY_SVG = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="9" height="9" rx="1.5" />
    <path d="M11 4V3a1.5 1.5 0 00-1.5-1.5h-6A1.5 1.5 0 002 3v6a1.5 1.5 0 001.5 1.5h.5" />
  </svg>
);
const CHECK_SVG = (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5l3.5 3.5L13 4" />
  </svg>
);

/** Translation page — full-page two-pane view invoked from the ActivityBar
 *  icon. Session-only state; no persistence (no history, no last pair). */
export function TranslationPanel() {
  const { t } = useTranslation();
  const setSettingsTab = useNavStore((s) => s.setSettingsTab);
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);

  // Session-only pair override; defaults to global pluginPair.
  const pluginPair = useAiConfigStore((s) => s.pluginPair);
  const [selectedPair, setSelectedPair] = useState<Pair | null>(
    pluginPair ? { provider: pluginPair.provider, model: pluginPair.model } : null,
  );
  // Re-sync to pluginPair on first appearance (Tauri env hydrates async).
  useEffect(() => {
    if (!selectedPair && pluginPair) {
      setSelectedPair({ provider: pluginPair.provider, model: pluginPair.model });
    }
  }, [selectedPair, pluginPair]);

  const [source, setSource] = useState<string>(AUTO_DETECT_ID);
  const [target, setTarget] = useState<string>('en');
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleTranslate = useCallback(async () => {
    if (streaming) return;
    if (!input.trim()) return;
    const pair: ProviderModelPair | null = selectedPair
      ? { provider: selectedPair.provider, model: selectedPair.model }
      : null;
    const resolved = resolvePairConfig(pair);
    if (!resolved) {
      setError(t('settings:translation.error.noPair'));
      return;
    }
    setError('');
    setResult('');
    setStreaming(true);
    try {
      await runRigChat({
        sessionId: 'translation',
        prompt: buildPrompt(input, source, target),
        provider: resolved.provider,
        model: resolved.model,
        apiKey: resolved.apiKey,
        baseUrl: resolved.baseUrl ? resolved.baseUrl : undefined,
        adapterFamily: resolved.adapterFamily ?? undefined,
        historyMode: 'none',
        onEvent: (e) => {
          if (e.type === 'text') setResult((s) => s + e.content);
          else if (e.type === 'error') setError(e.content ?? 'translation error');
        },
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setStreaming(false);
    }
  }, [streaming, input, selectedPair, source, target, t]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard rejected; surface as error for the user.
      setError(t('settings:translation.error.copy'));
    }
  }, [result, t]);

  const openSettings = useCallback(() => {
    setSettingsTab('plugins');
    setCurrentPage('settings');
  }, [setSettingsTab, setCurrentPage]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-panel">
      {/* Header */}
      <div className="h-[40px] shrink-0 flex items-center gap-2 px-2.5 border-b border-brd">
        <LanguageDropdown
          value={source}
          options={SOURCE_LANGUAGES}
          onChange={setSource}
          title={t('settings:translation.sourceLang')}
        />
        <span className="text-t3">→</span>
        <LanguageDropdown
          value={target}
          options={TARGET_LANGUAGES}
          onChange={setTarget}
          title={t('settings:translation.targetLang')}
        />
        <button
          type="button"
          className="btn btn-p btn-sm"
          disabled={streaming || !input.trim()}
          onClick={handleTranslate}
        >
          {streaming ? t('settings:translation.translating') : t('settings:translation.translate')}
        </button>
        <div className="flex-1" />
        <PairSelector
          value={selectedPair}
          onChange={setSelectedPair}
          onOpenSettings={openSettings}
          i18nPrefix="ai:pairSelector"
        />
        <label className="flex items-center gap-1.5 cursor-pointer text-t2 text-[length:calc(var(--ui-font-size)-2px)]" title={t('settings:translation.markdownPreview')}>
          <span>{t('settings:translation.markdownPreviewLabel')}</span>
          <Toggle value={preview} onChange={setPreview} />
        </label>
      </div>

      {/* Two panes */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: original input */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-brd">
          <textarea
            className="flex-1 w-full resize-none outline-none bg-transparent text-t1 px-6 py-3 font-ui text-[length:calc(var(--ui-font-size)+0px)] leading-[1.6] text-justify"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('settings:translation.inputPlaceholder')}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void handleTranslate();
              }
            }}
          />
        </div>

        {/* Right: result */}
        <div className="group flex-1 flex flex-col overflow-hidden relative">
          <button
            type="button"
            className={`absolute top-1 right-1 z-10 w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-opacity duration-[120ms] hover:bg-hov hover:text-t1 disabled:cursor-not-allowed ${result ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={handleCopy}
            disabled={!result}
            title={t('settings:translation.copy')}
          >
            {copied ? CHECK_SVG : COPY_SVG}
          </button>
          <div className="flex-1 overflow-auto">
            {error ? (
              <div className="px-6 py-3 text-[12px] text-red-600 dark:text-red-400 break-words">{error}</div>
            ) : result ? (
              preview ? (
                <div className="translation-result px-6 py-3" style={{ textAlign: 'justify' }}>
                  <MarkdownPreview content={result} filePath="__translation__.md" vaultRoot="" />
                </div>
              ) : (
                <pre className="px-6 py-3 text-t1 font-ui text-[length:calc(var(--ui-font-size)+0px)] leading-[1.6] whitespace-pre-wrap break-words [text-align:justify]">{result}</pre>
              )
            ) : (
              <div className="px-6 py-3 text-t3 text-[12px]">
                {streaming
                  ? t('settings:translation.streaming')
                  : t('settings:translation.empty')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
