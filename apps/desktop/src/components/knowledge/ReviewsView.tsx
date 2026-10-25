/**
 * 「审阅」页：reviews.json 真实记录列表 + 采用/保留操作。
 *
 * 当前 schema 只有 reason: 'user-edited'（目标页被人工编辑，AI 追加内容降级进
 * 审阅）→ 类型一律显示「正文修订」；冲突/恢复建议类型出现时再分支。
 * 「采用修订」程序写入并复核目标页 hash（过期标记需重新比较）；「保留原文」
 * 丢弃该修订；「编辑后采用」第一版不提供 —— 明确呈现原因，不做假成功。
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, FileDiff, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { openFile } from '@/services/editorIoService';
import { vaultKbFs } from '@/services/knowledge/kbFs';
import { parseTopicPage, stripFootnoteDefs } from '@/services/knowledge/topicSynth';
import type { KbReviewItem } from '@/services/knowledge/kbTypes';
import { BTN, BTN_PRIMARY } from './kbUi';

export function ReviewsView(): React.JSX.Element {
  const reviews = useKnowledgeStore((s) => s.reviews);
  const topics = useKnowledgeStore((s) => s.topics);
  const reviewNotice = useKnowledgeStore((s) => s.reviewNotice);
  const applyReviewItem = useKnowledgeStore((s) => s.applyReviewItem);
  const discardReviewItem = useKnowledgeStore((s) => s.discardReviewItem);
  const [busyId, setBusyId] = useState<string | null>(null);
  // 操作结果的落点：role=status 温和播报；操作后焦点移到这里（被移除的卡片
  // 会带走原焦点，notes「重要结果保留在状态区」）。
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusNotice = () => noticeRef.current?.focus();

  const titleOf = (topicId: string): string => topics.find((t) => t.tpId === topicId)?.title ?? topicId;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
      <div className="max-w-[820px] mx-auto flex flex-col gap-3">
        <div
          ref={noticeRef}
          role="status"
          tabIndex={-1}
          className={`px-3 py-2 border border-brd rounded-[6px] text-[12px] text-t2 outline-none ${reviewNotice ? '' : 'hidden'}`}
        >
          {reviewNotice}
        </div>

        {reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-1 text-t3 text-[13px]">
            <span>没有待审阅的修订。</span>
            <span className="text-[11px]">
              AI 对已被人工编辑过的知识页只提议不覆盖，修订会出现在这里等待确认。
            </span>
          </div>
        ) : (
          reviews.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              topicTitle={titleOf(r.topicId)}
              busy={busyId === r.id}
              onApply={async () => {
                setBusyId(r.id);
                await applyReviewItem(r.id);
                setBusyId(null);
                focusNotice();
              }}
              onDiscard={async () => {
                setBusyId(r.id);
                await discardReviewItem(r.id);
                setBusyId(null);
                focusNotice();
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ReviewCard({
  review,
  topicTitle,
  busy,
  onApply,
  onDiscard,
}: {
  review: KbReviewItem;
  topicTitle: string;
  busy: boolean;
  onApply: () => Promise<void>;
  onDiscard: () => Promise<void>;
}): React.JSX.Element {
  const sources = useKnowledgeStore((s) => s.sources);
  const [currentBody, setCurrentBody] = useState<string | null>(null);

  // 当前正文（与建议对比用）；读取失败如实显示，不假装成功。
  useEffect(() => {
    let alive = true;
    void vaultKbFs()
      .readFile(review.topicPath)
      .then((c) => {
        if (alive) setCurrentBody(stripFootnoteDefs(parseTopicPage(c).body));
      })
      .catch(() => {
        if (alive) setCurrentBody(null);
      });
    return () => {
      alive = false;
    };
  }, [review.topicPath, review.id]);

  const proposalBody = stripFootnoteDefs(parseTopicPage(review.proposedMarkdown).body).trim();
  const created = new Date(review.createdAt).toLocaleString();

  return (
    <div className="border border-brd rounded-[6px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-brd bg-hov">
        <FileDiff size={13} className="text-[#b48a3f] shrink-0" />
        <span className="text-[13px] font-medium text-t1 truncate">{topicTitle}</span>
        <span className="text-[11px] text-t3 truncate" title={review.topicPath}>{review.topicPath}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-t3 shrink-0">{created}</span>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2.5 text-[12px]">
        <div className="text-t3 text-[11px]">
          正文修订 · 目标页被人工编辑过，AI 以下追加内容未经确认，确认前不改写正文。
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div>
            <div className="text-[11px] font-semibold text-t2 mb-1">当前正文</div>
            {currentBody === null ? (
              <div className="text-[11px] text-[#e05252]">主题页读取失败，无法比较。</div>
            ) : (
              <pre className="whitespace-pre-wrap text-t2 text-[11px] font-mono bg-hov rounded p-2 max-h-[200px] overflow-y-auto [scrollbar-width:thin]">
                {currentBody.trim() || '（空）'}
              </pre>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-t2 mb-1">建议追加</div>
            <pre className="whitespace-pre-wrap text-t2 text-[11px] font-mono bg-hov rounded p-2 max-h-[200px] overflow-y-auto [scrollbar-width:thin]">
              {proposalBody || '（空）'}
            </pre>
          </div>
        </div>

        {(review.refs ?? []).length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-t2 mb-1">原文依据</div>
            <div className="flex flex-col gap-1">
              {(review.refs ?? []).map((ref) => {
                const entry = sources[ref.srcId];
                return (
                  <div key={ref.id} className="flex items-center gap-1.5 text-[11px] text-t3">
                    <span className="truncate" title={`${ref.srcId} · ${ref.srcPath ?? ''}`}>
                      {entry?.path ?? ref.srcPath ?? ref.srcId} L{ref.startLine}-L{ref.endLine}
                    </span>
                    <button
                      className="shrink-0 p-0.5 rounded border border-brd bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1"
                      aria-label="打开原文"
                      title={`在编辑器中打开：${entry?.path ?? ref.srcPath ?? ''}`}
                      onClick={() => {
                        const p = entry?.path ?? ref.srcPath;
                        if (!p) return;
                        void openFile(p, p.split('/').pop() ?? p);
                        useEditorStore.getState().setActivePanel('files');
                      }}
                    >
                      <ExternalLink size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          <button className={BTN_PRIMARY} disabled={busy} onClick={() => void onApply()}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            采用修订
          </button>
          <button className={BTN} disabled={busy} onClick={() => void onDiscard()}>
            <Trash2 size={12} />
            保留原文（丢弃修订）
          </button>
          <button
            className={BTN}
            disabled
            title="第一版暂不支持：可先在编辑器手动并入需要的句子，再回来采用整条修订"
          >
            <Pencil size={12} />
            编辑后采用（暂不支持）
          </button>
        </div>
      </div>
    </div>
  );
}
