import { useState } from 'react';
import { useStudyStore } from '@/store/studyStore';
import { isDue } from '@/features/study/sm2';
import { dateToString } from '@/features/schedule/dailyScan';

interface StudyTopicListProps {
  /** 新建主题后回调（供页面聚焦主区，PR3 接四区）。 */
  onCreated?: (slug: string) => void;
}

/** 左侧主题列表：新建（inline 输入）/ 切换 / 删除。对标 ScheduleSidebar 的轻量风格。 */
export function StudyTopicList({ onCreated }: StudyTopicListProps) {
  const topics = useStudyStore((s) => s.topics);
  const activeSlug = useStudyStore((s) => s.activeSlug);
  const selectTopic = useStudyStore((s) => s.selectTopic);
  const createTopic = useStudyStore((s) => s.createTopic);
  const deleteTopic = useStudyStore((s) => s.deleteTopic);

  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    const title = draft.trim();
    if (!title) {
      setCreating(false);
      return;
    }
    const slug = await createTopic(title);
    setDraft('');
    setCreating(false);
    if (slug) onCreated?.(slug);
  };

  return (
    <aside className="sw-sidebar">
      <div className="sw-panel-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
        <span>学习主题</span>
        <button className="sw-add-btn" onClick={() => setCreating((v) => !v)} title="新建主题">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {creating && (
        <div className="sw-quick-add">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') { setDraft(''); setCreating(false); }
            }}
            placeholder="主题标题，回车新建…"
          />
          <button onClick={submit}>新建</button>
        </div>
      )}

      <ul className="sw-nav-group">
        {topics.length === 0 && !creating && (
          <li className="sw-empty-hint">暂无学习主题。点上方 + 新建一个。</li>
        )}
        {topics.map((t) => {
          const title = t.parsed.frontmatter.title ?? t.slug;
          const unitCount = t.parsed.units.length;
          const today = dateToString(new Date());
          const dueCount = t.parsed.reviewAtoms.filter((a) => isDue(a.next, today)).length;
          return (
            <li
              key={t.slug}
              className={`sw-nav-item ${t.slug === activeSlug ? 'active' : ''}`}
              onClick={() => selectTopic(t.slug)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
              <span className="sw-topic-title">{title}</span>
              <span className="sw-count">{dueCount > 0 ? `${dueCount} 复习` : `${unitCount} 单元`}</span>
              <button
                className="sw-topic-del"
                title="删除主题"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`删除主题「${title}」？该操作不可撤销。`)) {
                    void deleteTopic(t.slug);
                  }
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
