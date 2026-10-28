/**
 * 「提问」页：多轮会话式问答 —— 逐轮渲染 问题 + 回答 + 证据入口，输入框置底。
 *
 * {t('knowledge:ask.stop')}检索在轮边界生效（模型调用中无法中断），已找到的证据不丢（retrievalLoop
 * 程序侧取消，取消轮次也入会话）；无答案/无证据时明确说缺证据并给出出口，不编造。
 * askPhase/askNote 只反映进行中的当前轮；历史轮次的 note 各自随轮展示。
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import remarkGfm from 'remark-gfm';
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';
import { ChevronDown, ChevronRight, Eraser, ExternalLink, Loader2, Search, Square } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import type { KbAskTurn } from '@/services/knowledge/kbAsk';
import { openFile } from '@/services/editorIoService';
import { BTN, BTN_PRIMARY, INPUT } from './kbUi';

function TurnView({
  turn,
  index,
  evidenceOpen,
  onToggleEvidence,
}: {
  turn: KbAskTurn;
  index: number;
  evidenceOpen: boolean;
  onToggleEvidence: (index: number) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const answerNode = useMemo(() => renderMarkdownToReact(turn.answer, { remarkExtensions: [remarkGfm] }), [turn.answer]);
  return (
    <section className="flex flex-col gap-2.5 border border-brd rounded-lg p-4 bg-panel" aria-label={t('knowledge:ask.turnLabel', { index: index + 1 })}>
      <div className="text-[13px] font-medium text-t2 whitespace-pre-wrap">{turn.question}</div>
      {turn.answer !== '' && <div className="kb-md">{answerNode}</div>}
      {turn.note && <div className="text-[11px] text-t3">{turn.note}</div>}
      {turn.evidence.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            className="flex items-center gap-1 text-[12px] font-semibold text-t2 cursor-pointer"
            aria-expanded={evidenceOpen}
            onClick={() => onToggleEvidence(index)}
          >
            {evidenceOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('knowledge:ask.evidenceToggle', { count: turn.evidence.length })}
          </button>
          {evidenceOpen && turn.evidence.map((e, i) => (
            <button
              key={`${e.path}-${e.startLine ?? 0}-${i}`}
              className="text-left px-4 py-3 border border-brd rounded-[5px] bg-transparent cursor-pointer hover:bg-hov"
              title={t('knowledge:ask.openEvidenceTitle', { path: e.path })}
              onClick={() => {
                void openFile(e.path, e.path.split('/').pop() ?? e.path);
                useEditorStore.getState().setActivePanel('files');
              }}
            >
              <div className="text-[12px] text-t2 flex items-center gap-1 flex-wrap">
                <ExternalLink size={10} className="shrink-0" />
                {e.kind === 'topic' ? t('knowledge:ask.evidenceTopic') : t('knowledge:ask.evidenceSource')} · {e.title ?? e.path}
                {e.startLine ? ` L${e.startLine}-L${e.endLine}` : ''}
                {e.versionHash ? ` · ${t('knowledge:ask.version')} ${e.versionHash.slice(0, 8)}` : ''}
                {e.status ? <span className="text-[#b48a3f]">· {e.status}</span> : null}
              </div>
              <div className="mt-2 text-[13px] leading-6 text-t3 line-clamp-3 whitespace-pre-wrap">{e.text.slice(0, 160) || t('knowledge:ask.noText')}</div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function AskView(): React.JSX.Element {
  const { t } = useTranslation();
  const askRunning = useKnowledgeStore((s) => s.askRunning);
  const askPhase = useKnowledgeStore((s) => s.askPhase);
  const askQuestion = useKnowledgeStore((s) => s.askQuestion);
  const askTurns = useKnowledgeStore((s) => s.askTurns);
  const setAskQuestion = useKnowledgeStore((s) => s.setAskQuestion);
  const ask = useKnowledgeStore((s) => s.ask);
  const cancelAskRequested = useKnowledgeStore((s) => s.cancelAskRequested);
  const clearAsk = useKnowledgeStore((s) => s.clearAsk);
  const setPage = useKnowledgeStore((s) => s.setPage);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [openEvidence, setOpenEvidence] = useState<number | null>(null);

  const lastTurn = askTurns.length > 0 ? askTurns[askTurns.length - 1] : null;
  const noEvidence = !askRunning && lastTurn !== null && lastTurn.answer !== '' && lastTurn.evidence.length === 0;

  return (
    <div className="kb-page flex-1 min-h-0 min-w-0 overflow-y-auto [scrollbar-width:thin]">
      <div className="kb-page-inner flex flex-col gap-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="kb-eyebrow">{t('knowledge:ask.eyebrow')}</div>
            <h1 className="kb-page-title">{t('knowledge:ask.title')}</h1>
            <p className="kb-page-description">{t('knowledge:ask.description')}</p>
          </div>
          {askTurns.length > 0 && !askRunning && (
            <button className={BTN} onClick={clearAsk} title={t('knowledge:ask.clearTitle')}>
              <Eraser size={12} />
              {t('knowledge:ask.clear')}
            </button>
          )}
        </header>

        {askTurns.length > 0 && (
          <div className="flex flex-col gap-3" aria-label={t('knowledge:ask.conversationLabel')}>
            {askTurns.map((turn, i) => (
              <TurnView
                key={i}
                turn={turn}
                index={i}
                evidenceOpen={openEvidence === i}
                onToggleEvidence={setOpenEvidence}
              />
            ))}
          </div>
        )}

        {askRunning && (
          <div role="status" className="flex flex-wrap items-center gap-2 px-3 py-3 border border-brd rounded-[5px] text-[12px] text-t2">
            <Loader2 size={13} className="animate-spin text-t3" />
            <span>{askPhase || t('knowledge:ask.defaultPhase')}</span>
            <span className="text-[11px] text-t3">{t('knowledge:ask.stopHint')}</span>
          </div>
        )}

        {noEvidence && (
          <div className="px-3 py-2.5 border border-brd rounded-[6px] text-[12px] text-t2 flex flex-col gap-1.5">
            <span>{t('knowledge:ask.noEvidence')}</span>
            <div className="flex gap-1.5 flex-wrap">
              <button
                className={BTN}
                onClick={() => {
                  inputRef.current?.focus();
                }}
              >
                {t('knowledge:ask.refine')}
              </button>
              <button className={BTN} onClick={() => setPage('sources')}>
                {t('knowledge:ask.moreSources')}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-medium text-t2" htmlFor="kb-ask">{t('knowledge:ask.inputLabel')}</label>
          <div className="flex flex-col gap-3 border border-brd rounded-lg p-3 bg-panel">
            <textarea
              id="kb-ask"
              ref={inputRef}
              className={`${INPUT} resize-none min-h-[92px] border-transparent bg-transparent focus:border-acc leading-7`}
              rows={3}
              aria-describedby="kb-ask-hint"
              placeholder={askTurns.length > 0 ? t('knowledge:ask.placeholderFollow') : t('knowledge:ask.placeholderFirst')}
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !askRunning && askQuestion.trim()) { e.preventDefault(); void ask(); }
              }}
            />
            <div className="flex items-center justify-between gap-3 flex-wrap"><span id="kb-ask-hint" className="text-[11px] text-t3">{t('knowledge:ask.hint')}</span>
            {askRunning ? (
              <button className={BTN} onClick={cancelAskRequested} title={t('knowledge:ask.stopTitle')}>
                <Square size={12} />
                {t('knowledge:ask.stop')}
              </button>
            ) : (
              <button className={BTN_PRIMARY} disabled={askQuestion.trim() === ''} onClick={() => void ask()}>
                <Search size={13} />
                {askTurns.length > 0 ? t('knowledge:ask.askFollow') : t('knowledge:ask.askFirst')}
              </button>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
