/**
 * 「提问」页：接真实 kbAsk —— 输入 → 检索进度（阶段 + 可停止）→ 答案 + 证据列表。
 *
 * 停止检索在轮边界生效（模型调用中无法中断），已找到的证据不丢（retrievalLoop
 * 程序侧取消）；无答案/无证据时明确说缺证据并给出出口，不编造。
 */

import { useMemo, useRef } from 'react';
import remarkGfm from 'remark-gfm';
import { renderMarkdownToReact } from '@/services/markdown/renderMarkdown';
import { ExternalLink, Loader2, Search, Square } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { openFile } from '@/services/editorIoService';
import { BTN, BTN_PRIMARY, INPUT } from './kbUi';

export function AskView(): React.JSX.Element {
  const askRunning = useKnowledgeStore((s) => s.askRunning);
  const askPhase = useKnowledgeStore((s) => s.askPhase);
  const askQuestion = useKnowledgeStore((s) => s.askQuestion);
  const askAnswer = useKnowledgeStore((s) => s.askAnswer);
  const askEvidence = useKnowledgeStore((s) => s.askEvidence);
  const askNote = useKnowledgeStore((s) => s.askNote);
  const setAskQuestion = useKnowledgeStore((s) => s.setAskQuestion);
  const ask = useKnowledgeStore((s) => s.ask);
  const cancelAskRequested = useKnowledgeStore((s) => s.cancelAskRequested);
  const setPage = useKnowledgeStore((s) => s.setPage);

  const inputRef = useRef<HTMLTextAreaElement>(null);

  const answerNode = useMemo(() => renderMarkdownToReact(askAnswer, { remarkExtensions: [remarkGfm] }), [askAnswer]);

  const noEvidence = !askRunning && askAnswer !== '' && askEvidence.length === 0;

  return (
    <div className="kb-page flex-1 min-h-0 min-w-0 overflow-y-auto [scrollbar-width:thin]">
      <div className="kb-page-inner flex flex-col gap-4">
        <header><div className="kb-eyebrow">基于当前知识库</div><h1 className="kb-page-title">向知识库提问</h1><p className="kb-page-description">从主题与原文中寻找依据，并核对回答引用的证据。</p></header>
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-medium text-t2" htmlFor="kb-ask">问题</label>
          <div className="flex flex-col gap-3 border border-brd rounded-lg p-3 bg-panel">
            <textarea
              id="kb-ask"
              ref={inputRef}
              className={`${INPUT} resize-none min-h-[92px] border-transparent bg-transparent focus:border-acc leading-7`}
              rows={3}
              aria-describedby="kb-ask-hint"
              placeholder="在当前知识库的知识页与原文中查找…"
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229 && !askRunning && askQuestion.trim()) { e.preventDefault(); void ask(); }
              }}
            />
            <div className="flex items-center justify-between gap-3 flex-wrap"><span id="kb-ask-hint" className="text-[11px] text-t3">Enter 提问 · Shift + Enter 换行</span>
            {askRunning ? (
              <button className={BTN} onClick={cancelAskRequested} title="停止后返回已找到的证据">
                <Square size={12} />
                停止
              </button>
            ) : (
              <button className={BTN_PRIMARY} disabled={askQuestion.trim() === ''} onClick={() => void ask()}>
                <Search size={13} />
                查找依据
              </button>
            )}
            </div>
          </div>
        </div>

        {askRunning && (
          <div role="status" className="flex flex-wrap items-center gap-2 px-3 py-3 border border-brd rounded-[5px] text-[12px] text-t2">
            <Loader2 size={13} className="animate-spin text-t3" />
            <span>{askPhase || '检索中…'}</span>
            <span className="text-[11px] text-t3">停止将在当前一轮结束后生效，已找到的证据会保留。</span>
          </div>
        )}

        {askAnswer && (
          <section aria-label="回答"><h2 className="text-[13px] font-semibold text-t2 mb-4">回答</h2><div className="kb-md">{answerNode}</div></section>
        )}

        {noEvidence && (
          <div className="px-3 py-2.5 border border-brd rounded-[6px] text-[12px] text-t2 flex flex-col gap-1.5">
            <span>没有找到足以支持回答的证据。可以：</span>
            <div className="flex gap-1.5 flex-wrap">
              <button
                className={BTN}
                onClick={() => {
                  inputRef.current?.focus();
                }}
              >
                修改问题再问
              </button>
              <button className={BTN} onClick={() => setPage('sources')}>
                收录更多资料
              </button>
            </div>
          </div>
        )}

        {askNote && !askRunning && <div className="text-[11px] text-t3">{askNote}</div>}

        {askEvidence.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[13px] font-semibold text-t2">来源依据（{askEvidence.length}）</div>
            {askEvidence.map((e, i) => (
              <button
                key={`${e.path}-${e.startLine ?? 0}-${i}`}
                className="text-left px-4 py-3 border border-brd rounded-[5px] bg-transparent cursor-pointer hover:bg-hov"
                title={`在编辑器中打开：${e.path}`}
                onClick={() => {
                  void openFile(e.path, e.path.split('/').pop() ?? e.path);
                  useEditorStore.getState().setActivePanel('files');
                }}
              >
                <div className="text-[12px] text-t2 flex items-center gap-1 flex-wrap">
                  <ExternalLink size={10} className="shrink-0" />
                  {e.kind === 'topic' ? '主题' : '原文'} · {e.title ?? e.path}
                  {e.startLine ? ` L${e.startLine}-L${e.endLine}` : ''}
                  {e.versionHash ? ` · 版本 ${e.versionHash.slice(0, 8)}` : ''}
                  {e.status ? <span className="text-[#b48a3f]">· {e.status}</span> : null}
                </div>
                <div className="mt-2 text-[13px] leading-6 text-t3 line-clamp-3 whitespace-pre-wrap">{e.text.slice(0, 160) || '（无正文）'}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
