/**
 * 「审阅」页：reviews.json 真实记录列表 + 采用/保留操作。
 *
 * 两类记录（KbReviewItem.reason）：
 * - user-edited：目标页被人工编辑，AI 追加内容降级进审阅 → 「正文修订」；
 * - restore-suggestion：提议命中人工删除意图 → 「恢复建议」，「恢复」=
 *   写回内容 + 重编引用 + 解除对应删除意图（applyReview），「保留删除」=
 *   丢弃建议、删除意图保留（discardReview）；
 * - add-ref：重复佐证补引用降级进审阅 → 「补充引用」，「补充引用」= 在既有
 *   结论的标记后补引用与脚注（不改写正文，applyReview），无「编辑后采用」。
 * 建议正文区域可编辑（textarea，初始为建议文本），「编辑后采用」提交用户
 * 改过的文本（refs 照原提议；版本复核逻辑不变）。
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, FileDiff, Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import { activeThemeFs, useKnowledgeStore } from '@/store/knowledgeStore';
import { openFile } from '@/services/editorIoService';
import { parseTopicPage, stripFootnoteDefs } from '@/services/knowledge/topicSynth';
import type { KbReviewItem } from '@/services/knowledge/kbTypes';
import { useVaultStore } from '@/store/vaultStore';
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

  const runAction = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    await action();
    setBusyId(null);
    focusNotice();
  };

  return (
    <div className="kb-page flex-1 min-h-0 min-w-0 overflow-y-auto [scrollbar-width:thin]">
      <div className="kb-page-inner flex flex-col gap-3">
        <header><h1 className="kb-page-title">审阅修订</h1><p className="kb-page-description">核对建议与原文依据，再决定如何更新你的知识。</p></header>
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
              AI 对已被人工编辑过的知识页只提议不覆盖；命中删除意图的内容会以恢复建议出现在这里。
            </span>
          </div>
        ) : (
          reviews.map((r) => (
            <ReviewCard
              key={r.id}
              review={r}
              topicTitle={titleOf(r.topicId)}
              busy={busyId === r.id}
              onApply={() => runAction(r.id, () => applyReviewItem(r.id))}
              onApplyEdited={(body) => runAction(r.id, () => applyReviewItem(r.id, body))}
              onDiscard={() => runAction(r.id, () => discardReviewItem(r.id))}
            />
          ))
        )}
      </div>
    </div>
  );
}

const reviewDrafts = new Map<string, string>();

const REASON_DESC: Record<KbReviewItem['reason'], string> = {
  'user-edited': '正文修订 · 目标页被人工编辑过，AI 以下追加内容未经确认，确认前不改写正文。',
  'restore-suggestion':
    '恢复建议 · 该内容曾被你从知识页删除（删除意图已记录）；新资料再次支持此结论。恢复需确认，保留删除则维持现状。',
  'add-ref':
    '补充引用 · 新资料再次支持下方既有结论（重复佐证）。采用 = 在该结论后补充来源引用，不重复生成正文、不改写正文。',
};

function ReviewCard({
  review,
  topicTitle,
  busy,
  onApply,
  onApplyEdited,
  onDiscard,
}: {
  review: KbReviewItem;
  topicTitle: string;
  busy: boolean;
  onApply: () => Promise<void>;
  onApplyEdited: (body: string) => Promise<void>;
  onDiscard: () => Promise<void>;
}): React.JSX.Element {
  const vaultId = useVaultStore((s) => s.activeVaultId);
  const themeId = useKnowledgeStore((s) => s.activeThemeId);
  const draftKey = `${vaultId}:${themeId}:${review.id}`;
  const sources = useKnowledgeStore((s) => s.sources);
  const [currentBody, setCurrentBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isRestore = review.reason === 'restore-suggestion';
  const isAddRef = review.reason === 'add-ref';
  // 建议正文可编辑（「编辑后采用」）：初始为建议文本，key 保证卡片重挂载时重置。
  const proposalBody = stripFootnoteDefs(parseTopicPage(review.proposedMarkdown).body).trim();
  const [editedBody, setEditedBody] = useState<string>(() => reviewDrafts.get(draftKey) ?? proposalBody);

  // 当前正文（与建议对比用）；读取失败如实显示，不假装成功。
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setCurrentBody(null);
    void activeThemeFs()
      .readFile(review.topicPath)
      .then((c) => {
        if (alive) { setCurrentBody(stripFootnoteDefs(parseTopicPage(c).body)); setLoading(false); }
      })
      .catch(() => {
        if (alive) { setCurrentBody(null); setLoading(false); }
      });
    return () => {
      alive = false;
    };
  }, [review.topicPath, review.id]);

  const created = new Date(review.createdAt).toLocaleString();

  return (
    <div className="border border-brd rounded-[6px] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-3 border-b border-brd bg-hov">
        {isRestore ? (
          <RotateCcw size={13} className="text-[#b48a3f] shrink-0" />
        ) : (
          <FileDiff size={13} className="text-[#b48a3f] shrink-0" />
        )}
        <span className="text-[13px] font-medium text-t1 truncate">{topicTitle}</span>
        <span className="text-[11px] text-t3 truncate" title={review.topicPath}>{review.topicPath}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-t3 break-words">{isRestore ? '恢复建议' : isAddRef ? '补充引用' : '正文修订'} · {created}</span>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2.5 text-[12px]">
        <div className="text-t3 text-[11px]">{REASON_DESC[review.reason]}</div>

        <div className="kb-review-comparison grid grid-cols-1 gap-4">
          <div>
            <div className="text-[11px] font-semibold text-t2 mb-1">当前正文</div>
            {loading ? <div role="status" className="text-[12px] text-t3">正在读取当前正文…</div> : currentBody === null ? (
              <div className="text-[11px] text-[#e05252]">主题页读取失败，无法比较。</div>
            ) : (
              <pre className="whitespace-pre-wrap text-t2 text-[12px] font-mono bg-hov rounded p-2 max-h-[200px] overflow-y-auto [scrollbar-width:thin]">
                {currentBody.trim() || '（空）'}
              </pre>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-t2 mb-1">
              {isRestore ? '建议恢复（可编辑）' : isAddRef ? '将补充引用的既有结论' : '建议追加（可编辑）'}
            </div>
            <textarea
              className="w-full px-2 py-1 rounded border border-brd bg-inp text-t2 text-[12px] font-mono outline-none transition-[border-color,box-shadow] duration-100 focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)] resize-none min-h-[140px] max-h-[260px] overflow-y-auto [scrollbar-width:thin]"
              value={editedBody}
              aria-label="建议正文（可编辑后采用）"
              spellCheck={false}
              readOnly={isAddRef}
              onChange={(e) => { setEditedBody(e.target.value); reviewDrafts.set(draftKey, e.target.value); }}
            />
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
                      className="shrink-0 min-w-[26px] min-h-[26px] flex items-center justify-center rounded border border-brd bg-transparent text-t3 cursor-pointer hover:bg-hov hover:text-t1"
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
          <button
            className={BTN_PRIMARY}
            disabled={busy}
            onClick={() => void onApply()}
            title={isRestore ? '写回内容、重编引用并解除对应删除意图' : isAddRef ? '在既有结论后补充来源引用，不改写正文' : '程序写入并复核目标页版本'}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : isRestore ? <RotateCcw size={12} /> : <Check size={12} />}
            {isRestore ? '恢复' : isAddRef ? '补充引用' : '采用修订'}
          </button>
          <button className={BTN} disabled={busy} onClick={() => void onDiscard()}>
            <Trash2 size={12} />
            {isRestore ? '保留删除（丢弃建议）' : isAddRef ? '丢弃补充引用建议' : '保留原文（丢弃修订）'}
          </button>
          {!isAddRef && (
            <button
              className={BTN}
              disabled={busy || editedBody.trim() === ''}
              title="提交你在上方编辑后的文本；引用照原提议，版本复核逻辑不变"
              onClick={() => void onApplyEdited(editedBody)}
            >
              <Pencil size={12} />
              编辑后采用
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
