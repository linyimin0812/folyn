import { useMemo, useState } from 'react';
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

/** 复习空态图标。 */
const REPEAT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

/** 复习区：列出 `## 复习` 段原子，卡片化 + 到期高亮置顶；4 按钮 SM-2 评级写回；
 *  手动添加；AI 动作：生成自测题（主动检索，答案折叠在 :::callout{type="tip"}）。 */
export function StudyReviewSection({ slug, path, topicName, parsed, onRate, onAdd }: Props) {
  const [draft, setDraft] = useState('');
  const [src, setSrc] = useState('');
  const today = dateToString(new Date());
  const aiAvailable = isAiAvailable();

  const { due, upcoming } = useMemo(() => {
    const d = parsed.reviewAtoms.filter((a) => isDue(a.next, today));
    const u = parsed.reviewAtoms.filter((a) => !isDue(a.next, today));
    return { due: d, upcoming: u };
  }, [parsed.reviewAtoms, today]);

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
          <span className="sw-study-count" title="今日到期数">{due.length} 到期</span>
          <button
            className="ghost"
            disabled={!aiAvailable}
            title={aiAvailable ? 'AI 根据 ## 笔记生成 5 道回忆题（答案折叠）' : '未配置 AI 适配器'}
            onClick={() => openStudyAiAction(topicName, path, buildStudyPrompt('selftest', { topicName, topicPath: path }))}
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
        <div className="sw-empty-state">
          <span className="sw-empty-icon">{REPEAT_ICON}</span>
          <span className="sw-empty-text">暂无复习原子</span>
          <span className="sw-empty-hint">添加一条开始间隔重复</span>
        </div>
      ) : (
        <>
          {due.length > 0 && (
            <ul className="sw-study-list">
              {due.map((a) => (
                <li key={a.id} className="sw-card sw-review-card due">
                  <div className="sw-study-item-body">
                    <div className="sw-study-item-title">{a.summary}</div>
                    <div className="sw-card-meta sw-review-meta">
                      <span className="sw-chip sw-due-chip" title="到期日">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                        到期 {a.next}
                      </span>
                      <span className="sw-chip" title="连续正确次数">rep {a.rep}</span>
                      <span className="sw-chip" title="ease factor">ef {a.ef.toFixed(2)}</span>
                      {a.lapses > 0 && <span className="sw-chip" title="遗忘次数">lapse {a.lapses}</span>}
                      {a.src && <span className="sw-chip sw-src-chip" title="来源">{a.src}</span>}
                    </div>
                  </div>
                  <div className="sw-review-btns">
                    {RATING_LABEL.map(({ rating, label }) => (
                      <button
                        key={rating}
                        className={`sw-rate ${rating}`}
                        onClick={() => rate(a, rating)}
                        aria-label={`${label}（评级）`}
                      >
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
                  <li key={a.id} className="sw-card sw-review-card">
                    <div className="sw-study-item-body">
                      <div className="sw-study-item-title">{a.summary}</div>
                      <div className="sw-card-meta sw-review-meta">
                        <span className="sw-chip" title="下次到期">下次 {a.next}</span>
                        <span className="sw-chip" title="连续正确次数">rep {a.rep}</span>
                        <span className="sw-chip" title="ease factor">ef {a.ef.toFixed(2)}</span>
                      </div>
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
