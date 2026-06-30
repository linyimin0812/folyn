import { useEffect, useState } from 'react';
import { useStudyStore, subscribeToFileTree } from '@/store/studyStore';
import { useScheduleStore } from '@/store/scheduleStore';
import { StudyTopicList } from './StudyTopicList';
import { StudyMaterialsSection } from './StudyMaterialsSection';
import { StudyPlanSection } from './StudyPlanSection';
import { StudyNotesSection } from './StudyNotesSection';
import { StudyReviewSection } from './StudyReviewSection';
import { TodayReviewQueue } from './TodayReviewQueue';
import { collectScheduleLinks, type ScheduleLink } from '@/study/scheduleLink';
import type { StudyMaterial, StudyUnit, ReviewAtom } from '@/study/types';

/** 学习工作台视图：主题主区四区，或跨主题今日复习队列（交错练习）。 */
export type StudyView = 'topic' | 'today';

/**
 * 学习工作台页壳。PR3：主题列表 + 四区主视图 + 今日复习切换。
 * 对标 ScheduleWorkbenchPage（进入刷新 + subscribeToFileTree debounce 300ms）。
 */
export function StudyWorkbenchPage() {
  const refresh = useStudyStore((s) => s.refresh);
  const scheduleRefresh = useScheduleStore((s) => s.refresh);
  const [view, setView] = useState<StudyView>('topic');

  useEffect(() => {
    refresh();
    // 同步刷新 schedule 任务缓存，供计划区回链读回（scanScheduleLinks）。
    scheduleRefresh().catch(() => {});
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToFileTree(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refresh(), 300);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [refresh, scheduleRefresh]);

  const activeSlug = useStudyStore((s) => s.activeSlug);
  const topics = useStudyStore((s) => s.topics);
  const saveTopic = useStudyStore((s) => s.saveTopic);
  const scheduleUnitToToday = useStudyStore((s) => s.scheduleUnitToToday);
  const active = topics.find((t) => t.slug === activeSlug) ?? null;

  // 计划区回链状态：扫描 schedule 任务中带 study:<slug> 的条目（只读单向读回）。
  const scheduleTasks = useScheduleStore((s) => s.tasks);
  const scheduleLinks = active
    ? collectScheduleLinks(scheduleTasks, active.slug)
    : new Map<number, ScheduleLink>();

  // ── 写回路径（均走 saveTopic → serializeStudy lineIndex 原地重写，非托管行原样保留）──
  const addMaterial = async (m: StudyMaterial) => {
    if (!active) return;
    const parsed = active.parsed;
    await saveTopic({ ...parsed, materials: [...parsed.materials, m] });
  };
  const toggleUnit = async (unit: StudyUnit) => {
    if (!active) return;
    const parsed = active.parsed;
    const units = parsed.units.map((u) => (u.id === unit.id ? unit : u));
    await saveTopic({ ...parsed, units });
  };
  const addUnit = async (u: StudyUnit) => {
    if (!active) return;
    const parsed = active.parsed;
    await saveTopic({ ...parsed, units: [...parsed.units, u] });
  };
  const rateAtom = async (_prev: ReviewAtom, next: ReviewAtom) => {
    if (!active) return;
    const parsed = active.parsed;
    const reviewAtoms = parsed.reviewAtoms.map((a) =>
      a.lineIndex === next.lineIndex ? { ...a, ...next } : a,
    );
    await saveTopic({ ...parsed, reviewAtoms });
  };
  const addReviewAtom = async (atom: ReviewAtom) => {
    if (!active) return;
    const parsed = active.parsed;
    await saveTopic({ ...parsed, reviewAtoms: [...parsed.reviewAtoms, atom] });
  };
  const onScheduleUnit = async (unit: StudyUnit, noteDate: string) => {
    if (!active) return;
    await scheduleUnitToToday(unit, active.slug, noteDate);
  };

  return (
    <div className="study-workbench schedule-workbench">
      <StudyTopicList onCreated={() => setView('topic')} />

      <main className="sw-main">
        <div className="sw-study-body">
          <div className="sw-study-topbar">
            <div className="sw-study-view-switch">
              <button className={view === 'topic' ? 'active' : ''} onClick={() => setView('topic')}>主题</button>
              <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>今日复习</button>
            </div>
          </div>

          {view === 'today' ? (
            <TodayReviewQueue onShowTopic={() => setView('topic')} />
          ) : active ? (
            <div className="sw-study-grid">
              <h2 className="sw-topbar-title">{active.parsed.frontmatter.title ?? active.slug}</h2>
              <StudyMaterialsSection path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} materials={active.parsed.materials} onAdd={addMaterial} />
              <StudyPlanSection units={active.parsed.units} scheduleLinks={scheduleLinks} onToggle={toggleUnit} onAdd={addUnit} onSchedule={onScheduleUnit} />
              <StudyNotesSection slug={active.slug} path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} parsed={active.parsed} />
              <StudyReviewSection slug={active.slug} path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} parsed={active.parsed} onRate={rateAtom} onAdd={addReviewAtom} />
            </div>
          ) : (
            <div className="sw-study-placeholder">
              <h2 className="sw-topbar-title">学习工作站</h2>
              <p className="sw-empty-hint">选择或新建一个学习主题开始。</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
