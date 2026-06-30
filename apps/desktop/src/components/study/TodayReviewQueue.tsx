import { useMemo, useState } from 'react';
import { useStudyStore, collectDueAtoms, type DueAtomEntry } from '@/store/studyStore';
import { reviewAtom } from '@/study/sm2';
import { dateToString } from '@/schedule/dailyScan';
import type { ReviewAtom, ReviewRating } from '@/study/types';

const RATING_LABEL: { rating: ReviewRating; label: string }[] = [
  { rating: 'again', label: '重来' },
  { rating: 'hard', label: '困难' },
  { rating: 'good', label: '良好' },
  { rating: 'easy', label: '简单' },
];

/** 空态图标（庆祝）。 */
const SPARK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="3" />
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
        <h3>今日复习</h3>
        <div className="sw-study-sec-actions">
          <span className="sw-study-count" title="今日到期数">{ordered.length} 到期</span>
        </div>
      </header>

      {ordered.length === 0 ? (
        <div className="sw-empty-state sw-empty-celebrate">
          <span className="sw-empty-icon">{SPARK_ICON}</span>
          <span className="sw-empty-text">今天没有到期复习 🎉</span>
          <span className="sw-empty-hint">稍后再来，或到各主题添加复习内容</span>
        </div>
      ) : (
        <ul className="sw-study-list">
          {ordered.map((entry) => {
            const { atom, topicSlug } = entry;
            return (
              <li key={`${topicSlug}:${atom.id}`} className="sw-card sw-review-card due">
                <button
                  className="sw-tag dev sw-review-topic"
                  title={`来自主题：${topicTitle(topicSlug)}（点击切换）`}
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
                    <span className="sw-chip sw-due-chip" title="到期日">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                      到期 {atom.next}
                    </span>
                    <span className="sw-chip" title="连续正确次数">rep {atom.rep}</span>
                    <span className="sw-chip" title="ease factor">ef {atom.ef.toFixed(2)}</span>
                    {atom.src && <span className="sw-chip sw-src-chip" title="来源">{atom.src}</span>}
                  </div>
                </div>
                <div className="sw-review-btns">
                  {RATING_LABEL.map(({ rating, label }) => (
                    <button
                      key={rating}
                      className={`sw-rate ${rating}`}
                      disabled={busyId === atom.id}
                      onClick={() => void rate(entry, rating)}
                      aria-label={`${label}（评级）`}
                    >
                      {label}
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
