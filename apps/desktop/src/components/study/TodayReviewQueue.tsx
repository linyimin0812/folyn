import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStudyStore, collectDueAtoms, type DueAtomEntry } from '@/store/studyStore';
import { reviewAtom } from '@/features/study/sm2';
import { dateToString } from '@/features/schedule/dailyScan';
import type { ReviewAtom, ReviewRating } from '@/features/study/types';

const RATING_KEYS: { rating: ReviewRating; key: string }[] = [
  { rating: 'again', key: 'study:todayReview.ratings.again' },
  { rating: 'hard', key: 'study:todayReview.ratings.hard' },
  { rating: 'good', key: 'study:todayReview.ratings.good' },
  { rating: 'easy', key: 'study:todayReview.ratings.easy' },
];

/** 空态图标（庆祝）。 */
const SPARK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="3" />
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

interface Props {
  /** 切换到主题视图（来源点击时调用，配合 selectTopic 让用户看到对应主题）。 */
  onShowTopic?: () => void;
}

/**
 * 跨主题"今日复习"队列（交错练习）。聚合所有主题到期的复习原子，每条带来源主题标注；
 * 可直接 4 按钮评级（按 slug 定位主题文档并回写）。卡片风格与复习区一致。
 */
export function TodayReviewQueue({ onShowTopic }: Props) {
  const { t } = useTranslation();
  const topics = useStudyStore((s) => s.topics);
  const rateAtomInTopic = useStudyStore((s) => s.rateAtomInTopic);
  const selectTopic = useStudyStore((s) => s.selectTopic);
  const [busyId, setBusyId] = useState<string | null>(null);
  const today = dateToString(new Date());

  const due: DueAtomEntry[] = useMemo(
    () => collectDueAtoms(topics, today),
    [topics, today],
  );

  const rate = async (entry: DueAtomEntry, rating: ReviewRating) => {
    const { atom, topicSlug } = entry;
    setBusyId(atom.id);
    try {
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
      await rateAtomInTopic(topicSlug, atom.id, next);
    } finally {
      setBusyId(null);
    }
  };

  // 排序：按到期日升序，同日按主题 slug 稳定排序（不强行打散，保持可预测顺序）。
  const ordered = useMemo(() => [...due].sort((a, b) => {
    if (a.atom.next !== b.atom.next) return a.atom.next < b.atom.next ? -1 : 1;
    return a.topicSlug.localeCompare(b.topicSlug);
  }), [due]);

  const topicTitle = (slug: string) => {
    const t = topics.find((x) => x.slug === slug);
    return t?.parsed.frontmatter.title ?? slug;
  };

  return (
    <section className="sw-study-section sw-today-review">
      <header className="sw-study-sec-head">
        <h3><span className="sw-sec-icon" aria-hidden="true">{SECTION_ICON}</span>{t('study:todayReview.sectionTitle')}</h3>
        <div className="sw-study-sec-actions">
          <span className="sw-study-count" title={t('study:todayReview.countTitle')}>{t('study:todayReview.dueLabel', { count: ordered.length })}</span>
        </div>
      </header>

      {ordered.length === 0 ? (
        <div className="sw-empty-state sw-empty-celebrate">
          <span className="sw-empty-icon">{SPARK_ICON}</span>
          <span className="sw-empty-text">{t('study:todayReview.empty')}</span>
          <span className="sw-empty-hint">{t('study:todayReview.emptyHint')}</span>
        </div>
      ) : (
        <ul className="sw-study-list">
          {ordered.map((entry) => {
            const { atom, topicSlug } = entry;
            return (
              <li key={`${topicSlug}:${atom.id}`} className="sw-card sw-review-card due">
                <button
                  className="sw-tag dev sw-review-topic"
                  title={t('study:todayReview.fromTitle', { title: topicTitle(topicSlug) })}
                  onClick={() => {
                    selectTopic(topicSlug);
                    onShowTopic?.();
                  }}
                >
                  {topicTitle(topicSlug)}
                </button>
                <div className="sw-study-item-body">
                  <div className="sw-study-item-title">{atom.summary}</div>
                  <div className="sw-card-meta sw-review-meta">
                    <span className="sw-chip sw-due-chip" title={t('study:todayReview.dueChip')}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                      {t('study:todayReview.dueText', { date: atom.next })}
                    </span>
                    <span className="sw-chip" title={t('study:todayReview.repChip')}>rep {atom.rep}</span>
                    <span className="sw-chip" title="ease factor">ef {atom.ef.toFixed(2)}</span>
                    {atom.src && <span className="sw-chip sw-src-chip" title={t('study:todayReview.srcChip')}>{atom.src}</span>}
                  </div>
                </div>
                <div className="sw-review-btns">
                  {RATING_KEYS.map(({ rating, key }) => (
                    <button
                      key={rating}
                      className={`sw-rate ${rating}`}
                      disabled={busyId === atom.id}
                      onClick={() => void rate(entry, rating)}
                      aria-label={t('study:todayReview.ratingAria', { label: t(key) })}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
