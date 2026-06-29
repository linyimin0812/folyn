import { useEffect, useState } from 'react';
import { useStudyStore, subscribeToFileTree } from '@/store/studyStore';
import { useScheduleStore } from '@/store/scheduleStore';
import { Pomodoro } from '@/components/schedule/Pomodoro';
import { StudyTopicList } from './StudyTopicList';

/**
 * 学习工作台页壳。PR2：主题列表 + Pomodoro 头部 + 占位主区。
 * 对标 ScheduleWorkbenchPage（进入刷新 + subscribeToFileTree debounce 300ms + pomo tick）。
 * PR3 将在主区填资料/计划/笔记/复习四区。
 */
export function StudyWorkbenchPage() {
  const refresh = useStudyStore((s) => s.refresh);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToFileTree(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refresh(), 300);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [refresh]);

  // 番茄钟计时（复用 scheduleStore 的 pomo slice，共享状态可接受）。
  const pomoRunning = useScheduleStore((s) => s.pomo.running);
  const tickPomo = useScheduleStore((s) => s.tickPomo);
  useEffect(() => {
    if (!pomoRunning) return;
    const id = setInterval(() => tickPomo(), 1000);
    return () => clearInterval(id);
  }, [pomoRunning, tickPomo]);

  const activeSlug = useStudyStore((s) => s.activeSlug);
  const topics = useStudyStore((s) => s.topics);
  const active = topics.find((t) => t.slug === activeSlug) ?? null;
  // 主题切换时重置占位区 key，避免复用旧 DOM。
  const [, setTick] = useState(0);

  return (
    <div className="study-workbench schedule-workbench">
      <StudyTopicList onCreated={() => setTick((n) => n + 1)} />

      <main className="sw-main">
        <div className="sw-study-body">
          <Pomodoro />

          {active ? (
            <div className="sw-study-placeholder">
              <h2 className="sw-topbar-title">{active.parsed.frontmatter.title ?? active.slug}</h2>
              <p>选择左侧主题已就绪。资料 / 计划 / 笔记 / 复习四区即将上线（PR3）。</p>
              <p className="sw-empty-hint">可先在编辑器手动编辑 <code>{active.path}</code> 体验 markdown 驱动。</p>
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
