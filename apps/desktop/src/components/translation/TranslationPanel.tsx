import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavStore } from '@/store/navStore';
import { useAiConfigStore, resolvePairConfig } from '@/store/aiConfigStore';
import { runRigChat } from '@/services/rigChat';
import { MarkdownPreview } from '@/components/file-types/markdown/MarkdownPreview';
import { PairSelector, type Pair } from '@/components/ai/PairSelector';
import { Toggle } from '@/components/settings/primitives';
import { isTauri } from '@/utils/platform';
import { LanguageDropdown } from './LanguageDropdown';
import {
  AUTO_DETECT_ID,
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
} from './languages';

/** Resolve the canonical English name for the LLM prompt. UI locale must not
 *  leak into the prompt — see LanguageOption.name. */
function languageName(id: string): string {
  const found = SOURCE_LANGUAGES.find((l) => l.id === id) ?? TARGET_LANGUAGES.find((l) => l.id === id);
  return found?.name ?? id;
}

function buildPrompt(text: string, sourceId: string, targetId: string): string {
  // ponytail: pass full language names, not ISO codes — 'it' reads as the
  // English pronoun and the LLM defaults to English. Names are unambiguous.
  // Use canonical English names regardless of UI locale; mixing localized
  // names into an English prompt sentence ("Translate into 日语") can make
  // the model default to a related language instead of the requested one.
  const sourceClause = sourceId === AUTO_DETECT_ID
    ? 'the source language (detect it yourself from the input)'
    : languageName(sourceId);
  const targetName = languageName(targetId);
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
 *  icon. Session-only state; no persistence (no history, no last pair).
 *  `embedded` compactifies layout for the pet panel (narrow viewport). */
export function TranslationPanel({ embedded = false }: { embedded?: boolean } = {}) {
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
    // ponytail: selectedPair hydrates async from pluginPair (Tauri store).
    // Falling back to pluginPair avoids a "first click sets noPair error,
    // second click works" race on a freshly mounted panel.
    const fallback = selectedPair ?? (pluginPair ? { provider: pluginPair.provider, model: pluginPair.model } : null);
    const resolved = resolvePairConfig(fallback);
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
  }, [streaming, input, selectedPair, pluginPair, source, target, t]);

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
    if (embedded) {
      // ponytail: the pet panel is a separate Tauri window = separate JS
      // realm; its navStore instance can't touch the main window. Hop
      // through pet://menu-action: open-ai-settings, which the main window
      // routes to Settings → models tab + focuses itself. Same pattern as
      // VoiceOrbApp.openAiSettingsFromOrb.
      if (isTauri()) {
        void import('@tauri-apps/api/event')
          .then(({ emit }) =>
            emit('pet://menu-action', { action: 'open-ai-settings' }),
          )
          .catch(() => {});
      }
      return;
    }
    setSettingsTab('models');
    setCurrentPage('settings');
  }, [embedded, setSettingsTab, setCurrentPage]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-panel">
      {/* Header */}
      <div className={`shrink-0 flex flex-wrap items-center gap-2 ${embedded ? 'px-2 py-1.5' : 'h-[40px] px-2.5'} border-b border-brd`}>
        <LanguageDropdown
          value={source}
          options={SOURCE_LANGUAGES}
          onChange={setSource}
          title={t('settings:translation.sourceLang')}
          compact={embedded}
        />
        <span className="text-t3">→</span>
        <LanguageDropdown
          value={target}
          options={TARGET_LANGUAGES}
          onChange={setTarget}
          title={t('settings:translation.targetLang')}
          compact={embedded}
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
          trigger={embedded ? 'icon' : 'full'}
        />
        <label className="flex items-center gap-1.5 cursor-pointer text-t2 text-[length:calc(var(--ui-font-size)-2px)]" title={t('settings:translation.markdownPreview')}>
          {!embedded && <span>{t('settings:translation.markdownPreviewLabel')}</span>}
          <Toggle value={preview} onChange={setPreview} />
        </label>
      </div>

      {/* Two panes — embedded (pet panel) stacks vertically, full-page side-by-side */}
      <div className={`flex-1 flex overflow-hidden ${embedded ? 'flex-col' : 'flex-row'}`}>
        {/* Input pane */}
        <div className={`flex-1 flex flex-col overflow-hidden ${embedded ? 'border-b' : 'border-r'} border-brd`}>
          <textarea
            className={`flex-1 w-full resize-none outline-none bg-transparent text-t1 font-ui text-[length:calc(var(--ui-font-size)+0px)] leading-[1.6] text-justify ${embedded ? 'px-3 py-2' : 'px-6 py-3'}`}
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

        {/* Result pane */}
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
              <div className={`px-6 py-3 text-[12px] text-red-600 dark:text-red-400 break-words ${embedded ? 'px-3 py-2' : ''}`}>{error}</div>
            ) : result ? (
              preview ? (
                <div className={`translation-result ${embedded ? 'px-3 py-2' : 'px-6 py-3'}`} style={{ textAlign: 'justify' }}>
                  <MarkdownPreview content={result} filePath="__translation__.md" vaultRoot="" />
                </div>
              ) : (
                <pre className={`${embedded ? 'px-3 py-2' : 'px-6 py-3'} text-t1 font-ui text-[length:calc(var(--ui-font-size)+0px)] leading-[1.6] whitespace-pre-wrap break-words [text-align:justify]`}>{result}</pre>
              )
            ) : (
              <div className={`${embedded ? 'px-3 py-2' : 'px-6 py-3'} text-t3 text-[length:calc(var(--ui-font-size)+0px)]`}>
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
