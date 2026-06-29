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

interface Props {
  /** 切换到主题视图（来源点击时调用，配合 selectTopic 让用户看到对应主题）。 */
  onShowTopic?: () => void;
}

/**
 * 跨主题"今日复习"队列（交错练习）。聚合所有主题到期的复习原子，每条带来源主题标注；
 * 可直接 4 按钮评级（按 slug 定位主题文档并回写）。
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
  const ordered = [...due].sort((a, b) => {
    if (a.atom.next !== b.atom.next) return a.atom.next < b.atom.next ? -1 : 1;
    return a.topicSlug.localeCompare(b.topicSlug);
  });

  const topicTitle = (slug: string) => {
    const t = topics.find((x) => x.slug === slug);
    return t?.parsed.frontmatter.title ?? slug;
  };

  return (
    <section className="sw-study-section sw-today-review">
      <header className="sw-study-sec-head">
        <h3>今日复习</h3>
        <span className="sw-study-count">{ordered.length} 到期</span>
      </header>

      {ordered.length === 0 ? (
        <p className="sw-empty-hint">今日无到期复习原子。稍后再来，或到各主题添加复习内容。</p>
      ) : (
        <ul className="sw-study-list">
          {ordered.map((entry) => {
            const { atom, topicSlug } = entry;
            return (
              <li key={`${topicSlug}:${atom.id}`} className="sw-study-item sw-review due">
                <span
                  className="sw-tag dev sw-review-topic"
                  title={`来自主题：${topicTitle(topicSlug)}（点击切换）`}
                  onClick={() => {
                    selectTopic(topicSlug);
                    onShowTopic?.();
                  }}
                >
                  {topicTitle(topicSlug)}
                </span>
                <div className="sw-study-item-body">
                  <div className="sw-study-item-title">{atom.summary}</div>
                  <div className="sw-study-item-meta">
                    到期 {atom.next} · rep {atom.rep} · ef {atom.ef.toFixed(2)}
                    {atom.src ? ` · ${atom.src}` : ''}
                  </div>
                </div>
                <div className="sw-review-btns">
                  {RATING_LABEL.map(({ rating, label }) => (
                    <button
                      key={rating}
                      className={`sw-rate ${rating}`}
                      disabled={busyId === atom.id}
                      onClick={() => void rate(entry, rating)}
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
