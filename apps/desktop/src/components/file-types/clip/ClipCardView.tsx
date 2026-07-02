import { useMemo, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useClipStore } from '@/store/clipStore';
import { useVaultStore } from '@/store/vaultStore';
import { parseClipContent } from '@/features/clips/clipParse';
import { InfographicView } from './InfographicView';
import type { EditorProps } from '../types';

export function ClipCardView({ content, tabId, filePath }: EditorProps) {
  const openWebFromClip = useEditorStore((s) => s.openWebFromClip);
  const updateTabContent = useEditorStore((s) => s.updateTabContent);
  const readFile = useVaultStore((s) => s.readFile);
  const generateInfographic = useClipStore((s) => s.generateInfographic);
  const isGeneratingInfographic = useClipStore((s) => s.isGeneratingInfographic);
  const infographicError = useClipStore((s) => s.infographicError);
  const infographicErrorPath = useClipStore((s) => s.infographicErrorPath);

  const data = useMemo(() => parseClipContent(content), [content]);

  // Detect a `## 信息图` section that exists on disk but failed to parse
  // (corrupt/invalid JSON). `parseInfographic` returns null both when the
  // section is absent and when it is malformed, so we re-check the raw
  // content to distinguish the two and surface a "data corrupted" hint.
  const hasCorruptInfographic = data.infographic === null && /## 信息图\s*\n/.test(content);

  // Convert current clip tab to web tab in-place
  const handleOpenUrl = useCallback(() => {
    if (!data.url) return;
    openWebFromClip(tabId, data.url, filePath, data.title);
  }, [data.url, data.title, filePath, tabId, openWebFromClip]);

  // On-demand infographic generation. After the store action writes the new
  // `## 信息图` section to disk, re-read the file and push the fresh content
  // into the open tab so the infographic renders without a manual reopen.
  // This mirrors how `saveClip`/`openFile` reload content, but for an
  // already-open tab whose content `openFile` would not refresh.
  const handleGenerateInfographic = useCallback(async () => {
    if (!filePath || isGeneratingInfographic) return;
    try {
      await generateInfographic(filePath);
      const fresh = await readFile(filePath);
      updateTabContent(tabId, fresh);
    } catch {
      // Error is surfaced via `infographicError` from the store.
    }
  }, [filePath, tabId, isGeneratingInfographic, generateInfographic, readFile, updateTabContent]);

  return (
    <div className="clip-card-view flex-1 overflow-y-auto p-4">
      <div className="rounded-xl border border-brd bg-panel shadow-[0_2px_12px_rgba(0,0,0,.06)] overflow-hidden">
        {/* Header band */}
        <div className="bg-surf border-b border-brd px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-lg bg-acc/10 flex items-center justify-center mt-0.5">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-acc">
                <path d="M3 2v12l5-3 5 3V2H3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[17px] font-semibold text-t1 m-0 leading-snug break-words">{data.title}</h1>
              {data.hostname && (
                <button
                  className="mt-1 text-[12px] text-acc bg-transparent border-none cursor-pointer p-0 hover:underline inline-flex items-center gap-1"
                  onClick={handleOpenUrl}
                  title={data.url}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12M2 8h12" />
                  </svg>
                  {data.hostname}
                </button>
              )}
            </div>
            {data.clipped && (
              <span className="shrink-0 text-[11px] text-t3 bg-bg border border-brd px-2 py-0.5 rounded-md">{data.clipped}</span>
            )}
          </div>
        </div>

        {/* Tags */}
        {data.tags.length > 0 && (
          <div className="px-5 py-2.5 border-b border-brd flex gap-1.5 flex-wrap">
            {data.tags.map((tag) => (
              <span key={tag} className="text-[11px] text-acc bg-acc/8 border border-acc/15 px-2 py-0.5 rounded-full font-medium">{tag}</span>
            ))}
          </div>
        )}

        {/* Summary */}
        {data.summary && (
          <div className="px-5 py-4 border-b border-brd">
            <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px] mb-2">摘要</div>
            <p className="text-[13px] text-t1 leading-relaxed m-0">{data.summary}</p>
          </div>
        )}

        {/* Key Points */}
        {data.keyPoints.length > 0 && (
          <div className="px-5 py-4 border-b border-brd">
            <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px] mb-2">要点</div>
            <ul className="m-0 pl-0 list-none flex flex-col gap-2">
              {data.keyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-t1 leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-acc/10 text-acc text-[10px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Infographic region */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px]">信息图</div>
            {data.infographic && (
              <button
                className="py-1 px-2 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleGenerateInfographic}
                disabled={isGeneratingInfographic}
                title="基于当前摘要/要点重新生成信息图"
              >
                {isGeneratingInfographic ? (
                  <>
                    <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />
                    重新生成中...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M8 2a6 6 0 1 0 4.5 2M8 2v3M8 2l3 .5" />
                    </svg>
                    重新生成
                  </>
                )}
              </button>
            )}
          </div>

          {data.infographic ? (
            <InfographicView doc={data.infographic} />
          ) : hasCorruptInfographic ? (
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-t3">信息图数据损坏，重新生成可修复</div>
              <button
                className="py-1 px-2.5 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc disabled:opacity-50 disabled:cursor-not-allowed self-start"
                onClick={handleGenerateInfographic}
                disabled={isGeneratingInfographic}
              >
                {isGeneratingInfographic ? (
                  <>
                    <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />
                    重新生成中...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M8 2a6 6 0 1 0 4.5 2M8 2v3M8 2l3 .5" />
                    </svg>
                    重新生成
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <button
                className="py-1 px-2.5 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc disabled:opacity-50 disabled:cursor-not-allowed self-start"
                onClick={handleGenerateInfographic}
                disabled={isGeneratingInfographic}
              >
                {isGeneratingInfographic ? (
                  <>
                    <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />
                    生成中...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 3h12v10H2z M5 6h6 M5 9h4" />
                    </svg>
                    生成信息图
                  </>
                )}
              </button>
              {isGeneratingInfographic && (
                <div className="text-[11px] text-acc">AI 正在基于已剪藏内容生成信息图...</div>
              )}
            </div>
          )}

          {/* Error / retry affordance — surfaced for any generate failure, in
              addition to (not instead of) the existing card content. Gated to
              the file path that produced the error so a failure on clip A does
              not leak onto clip B's card when the user switches tabs. */}
          {infographicError && infographicErrorPath === filePath && !isGeneratingInfographic && (
            <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-red-500">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v4M8 11h.01" />
              </svg>
              <span className="text-[11px] text-red-500 flex-1 break-words">{infographicError}</span>
              <button
                className="py-0.5 px-2 border border-red-500/40 rounded bg-transparent text-red-500 text-[11px] cursor-pointer hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                onClick={handleGenerateInfographic}
                disabled={isGeneratingInfographic}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2a6 6 0 1 0 4.5 2M8 2v3M8 2l3 .5" />
                </svg>
                重试
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
