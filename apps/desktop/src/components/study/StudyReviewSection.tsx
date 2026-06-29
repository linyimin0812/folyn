import { useState } from 'react';
import type { ParsedStudy, ReviewAtom, ReviewRating } from '@/study/types';
import { DEFAULT_REVIEW_ATOM } from '@/study/types';
import { reviewAtom, isDue } from '@/study/sm2';
import { dateToString } from '@/schedule/dailyScan';
import { isAiAvailable, openStudyAiAction, buildStudyPrompt } from '@/study/scheduleLink';

interface Props {
  slug: string;
  path: string;
  topicName: string;
  parsed: ParsedStudy;
  /** 评级写回：用新 state 更新该 atom 的 next/rep/ef/ivl/lapses 并回写。 */
  onRate: (atom: ReviewAtom, next: ReviewAtom) => Promise<void>;
  /** 新增复习原子（lineIndex<0 追加到段尾）。 */
  onAdd: (atom: ReviewAtom) => Promise<void>;
}

const RATING_LABEL: { rating: ReviewRating; label: string }[] = [
  { rating: 'again', label: '重来' },
  { rating: 'hard', label: '困难' },
  { rating: 'good', label: '良好' },
  { rating: 'easy', label: '简单' },
];

/** 复习区：列出 `## 复习` 段原子，到期高亮；4 按钮 SM-2 评级写回；手动添加；
 *  AI 动作：生成自测题（主动检索，答案折叠在 :::callout{type="tip"}）。 */
export function StudyReviewSection({ slug, path, topicName, parsed, onRate, onAdd }: Props) {
  const [draft, setDraft] = useState('');
  const [src, setSrc] = useState('');
  const today = dateToString(new Date());
  const aiAvailable = isAiAvailable();

  const due = parsed.reviewAtoms.filter((a) => isDue(a.next, today));
  const upcoming = parsed.reviewAtoms.filter((a) => !isDue(a.next, today));

  const submit = async () => {
    const summary = draft.trim();
    if (!summary) return;
    await onAdd({
      id: `#review--1`,
      summary,
      done: false,
      next: today, // 默认今天到期
      ...DEFAULT_REVIEW_ATOM,
      topic: slug,
      src: src.trim() || undefined,
      lineIndex: -1,
    });
    setDraft('');
    setSrc('');
  };

  const rate = (atom: ReviewAtom, rating: ReviewRating) => {
    const result = reviewAtom(
      { rep: atom.rep, ef: atom.ef, ivl: atom.ivl, lapses: atom.lapses },
      rating,
      today,
    );
    const next: ReviewAtom = {
      ...atom,
      next: result.next,
      rep: result.rep,
      ef: result.ef,
      ivl: result.ivl,
      lapses: result.lapses,
    };
    void onRate(atom, next);
  };

  return (
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3>复习</h3>
        <div className="sw-study-sec-actions">
          <span className="sw-study-count">{due.length} 到期</span>
          <button
            className="ghost"
            disabled={!aiAvailable}
            title={aiAvailable ? 'AI 根据 ## 笔记生成 5 道回忆题（答案折叠）' : '未配置 AI 适配器'}
            onClick={() => openStudyAiAction(topicName, path, buildStudyPrompt('selftest', { topicName }))}
          >
            生成自测题
          </button>
        </div>
      </header>

      <div className="sw-quick-add sw-study-add-form">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder="复习原子摘要…"
        />
        <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="来源 [[子文档]]（可选）" />
        <button onClick={submit}>添加</button>
      </div>

      {due.length === 0 && upcoming.length === 0 ? (
        <p className="sw-empty-hint">暂无复习原子。添加一条开始间隔重复。</p>
      ) : (
        <>
          {due.length > 0 && (
            <ul className="sw-study-list">
              {due.map((a) => (
                <li key={a.id} className="sw-study-item sw-review due">
                  <div className="sw-study-item-body">
                    <div className="sw-study-item-title">{a.summary}</div>
                    <div className="sw-study-item-meta">
                      到期 {a.next} · rep {a.rep} · ef {a.ef.toFixed(2)}{a.lapses > 0 ? ` · lapse ${a.lapses}` : ''}
                      {a.src ? ` · ${a.src}` : ''}
                    </div>
                  </div>
                  <div className="sw-review-btns">
                    {RATING_LABEL.map(({ rating, label }) => (
                      <button key={rating} className={`sw-rate ${rating}`} onClick={() => rate(a, rating)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > 0 && (
            <details className="sw-review-upcoming">
              <summary>即将复习（{upcoming.length}）</summary>
              <ul className="sw-study-list">
                {upcoming.map((a) => (
                  <li key={a.id} className="sw-study-item sw-review">
                    <div className="sw-study-item-body">
                      <div className="sw-study-item-title">{a.summary}</div>
                      <div className="sw-study-item-meta">下次 {a.next} · rep {a.rep} · ef {a.ef.toFixed(2)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
