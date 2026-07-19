import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStudyStore } from '@/store/studyStore';
import { isDue } from '@/features/study/sm2';
import { dateToString } from '@/features/schedule/dailyScan';
import { StudyAddTopicDialog } from './StudyAddTopicDialog';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

interface StudyTopicListProps {
  /** 新建主题后回调（供页面聚焦主区，PR3 接四区）。 */
  onCreated?: (slug: string) => void;
}

/** 左侧主题列表：新建（弹窗）/ 切换 / 删除。对标 ScheduleSidebar 的轻量风格。 */
export function StudyTopicList({ onCreated }: StudyTopicListProps) {
  const { t } = useTranslation();
  const topics = useStudyStore((s) => s.topics);
  const activeSlug = useStudyStore((s) => s.activeSlug);
  const selectTopic = useStudyStore((s) => s.selectTopic);
  const createTopic = useStudyStore((s) => s.createTopic);
  const deleteTopic = useStudyStore((s) => s.deleteTopic);

  const [showAdd, setShowAdd] = useState(false);

  const handleCreate = async (title: string) => {
    const slug = await createTopic(title);
    setShowAdd(false);
    if (slug) onCreated?.(slug);
  };

  return (
    <aside className="sw-sidebar">
      <div className="sw-panel-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
        <span>{t('study:topicList.title')}</span>
        <button className="sw-add-btn" onClick={() => setShowAdd(true)} title={t('study:topicList.new')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {showAdd && (
        <StudyAddTopicDialog
          onConfirm={handleCreate}
          onCancel={() => setShowAdd(false)}
        />
      )}

      <ul className="sw-nav-group">
        {topics.length === 0 && (
          <li className="sw-empty-hint">{t('study:topicList.empty')}</li>
        )}
        {topics.map((tp) => {
          const title = tp.parsed.frontmatter.title ?? tp.slug;
          const unitCount = tp.parsed.units.length;
          const today = dateToString(new Date());
          const dueCount = tp.parsed.reviewAtoms.filter((a) => isDue(a.next, today)).length;
          return (
            <li
              key={tp.slug}
              className={`sw-nav-item ${tp.slug === activeSlug ? 'active' : ''}`}
              onClick={() => selectTopic(tp.slug)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
              </svg>
              <span className="sw-topic-title">{title}</span>
              <span className="sw-count">{dueCount > 0 ? t('study:topicList.reviewCount', { count: dueCount }) : t('study:topicList.unitCount', { count: unitCount })}</span>
              <button
                className="sw-topic-del"
                title={t('study:topicList.delete')}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(t('study:topicList.deleteConfirm', { title }))) {
                    void deleteTopic(tp.slug);
                  }
                }}
              >
                <ThemeIcon name="delete" size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
