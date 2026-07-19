import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParsedStudy, ReviewAtom, ReviewRating } from '@/features/study/types';
import { DEFAULT_REVIEW_ATOM } from '@/features/study/types';
import { reviewAtom, isDue } from '@/features/study/sm2';
import { dateToString } from '@/features/schedule/dailyScan';
import { isAiAvailable, openStudyAiAction, buildStudyInstruction } from '@/features/study/scheduleLink';

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

const RATING_KEYS: { rating: ReviewRating; key: string }[] = [
  { rating: 'again', key: 'study:review.ratings.again' },
  { rating: 'hard', key: 'study:review.ratings.hard' },
  { rating: 'good', key: 'study:review.ratings.good' },
  { rating: 'easy', key: 'study:review.ratings.easy' },
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
/** 区段标题图标。 */
const SECTION_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

/** 复习区：列出 `## 复习` 段原子，卡片化 + 到期高亮置顶；4 按钮 SM-2 评级写回；
 *  手动添加；AI 动作：生成自测题（主动检索，答案折叠在 :::callout{type="tip"}）。 */
export function StudyReviewSection({ slug, path, topicName, parsed, onRate, onAdd }: Props) {
  const { t } = useTranslation();
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
        <h3><span className="sw-sec-icon" aria-hidden="true">{SECTION_ICON}</span>{t('study:review.sectionTitle')}</h3>
        <div className="sw-study-sec-actions">
          <span className="sw-study-count" title={t('study:review.dueCount')}>{t('study:review.dueLabel', { count: due.length })}</span>
          <button
            className="primary"
            disabled={!aiAvailable}
            title={aiAvailable ? t('study:review.aiTitle') : t('study:materials.aiDisabled')}
            onClick={() => openStudyAiAction(path, buildStudyInstruction('selftest', { topicName, topicPath: path }))}
          >
            {t('study:review.aiGenerate')}
          </button>
        </div>
      </header>

      <div className="sw-quick-add sw-study-add-form">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={t('study:review.inputPlaceholder')}
        />
        <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder={t('study:review.srcPlaceholder')} />
        <button onClick={submit}>{t('study:review.add')}</button>
      </div>

      {due.length === 0 && upcoming.length === 0 ? (
        <div className="sw-empty-state">
          <span className="sw-empty-icon">{REPEAT_ICON}</span>
          <span className="sw-empty-text">{t('study:review.empty')}</span>
          <span className="sw-empty-hint">{t('study:review.emptyHint')}</span>
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
                      <span className="sw-chip sw-due-chip" title={t('study:review.dueChip')}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                        {t('study:review.dueText', { date: a.next })}
                      </span>
                      <span className="sw-chip" title={t('study:review.repChip')}>rep {a.rep}</span>
                      <span className="sw-chip" title="ease factor">ef {a.ef.toFixed(2)}</span>
                      {a.lapses > 0 && <span className="sw-chip" title={t('study:review.lapseChip')}>lapse {a.lapses}</span>}
                      {a.src && <span className="sw-chip sw-src-chip" title={t('study:review.srcChip')}>{a.src}</span>}
                    </div>
                  </div>
                  <div className="sw-review-btns">
                    {RATING_KEYS.map(({ rating, key }) => (
                      <button
                        key={rating}
                        className={`sw-rate ${rating}`}
                        onClick={() => rate(a, rating)}
                        aria-label={t('study:review.ratingAria', { label: t(key) })}
                      >
                        {t(key)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {upcoming.length > 0 && (
            <details className="sw-review-upcoming">
              <summary>{t('study:review.upcoming', { count: upcoming.length })}</summary>
              <ul className="sw-study-list">
                {upcoming.map((a) => (
                  <li key={a.id} className="sw-card sw-review-card">
                    <div className="sw-study-item-body">
                      <div className="sw-study-item-title">{a.summary}</div>
                      <div className="sw-card-meta sw-review-meta">
                        <span className="sw-chip" title={t('study:review.nextChip')}>{t('study:review.nextText', { date: a.next })}</span>
                        <span className="sw-chip" title={t('study:review.repChip')}>rep {a.rep}</span>
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
