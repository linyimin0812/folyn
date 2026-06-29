import { useEffect, useState } from 'react';
import { useScheduleStore, subscribeToFileTree } from '@/store/scheduleStore';
import { dateToString } from '@/schedule/dailyScan';
import { ScheduleSidebar } from './ScheduleSidebar';
import { ScheduleView } from './ScheduleView';
import { BoardView } from './BoardView';
import { ScheduleModal, type ModalIntent } from './ScheduleModal';
import { SwToast } from './Toast';

export type WorkbenchView = 'schedule' | 'board';

export function ScheduleWorkbenchPage() {
  const [view, setView] = useState<WorkbenchView>('schedule');
  const [modalIntent, setModalIntent] = useState<ModalIntent | null>(null);
  const refresh = useScheduleStore((s) => s.refresh);

  // 进入页面时刷新数据；订阅 fileTree 变化（debounce 300ms）。
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

  // 番茄钟计时
  const pomoRunning = useScheduleStore((s) => s.pomo.running);
  const tickPomo = useScheduleStore((s) => s.tickPomo);
  useEffect(() => {
    if (!pomoRunning) return;
    const id = setInterval(() => tickPomo(), 1000);
    return () => clearInterval(id);
  }, [pomoRunning, tickPomo]);

  // now-line 每分钟刷新（通过 key 重渲染 WeekGrid）
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // 快捷键：⌘N 新建，Esc 关闭模态
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setModalIntent({ kind: view === 'board' ? 'task' : 'event', col: 'todo', day: dateToString(new Date()), hour: 9 });
      }
      if (e.key === 'Escape') setModalIntent(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view]);

  return (
    <div className="schedule-workbench">
      <ScheduleSidebar view={view} onSwitchView={setView} onNew={() => setModalIntent({ kind: view === 'board' ? 'task' : 'event', col: 'todo', day: dateToString(new Date()), hour: 9 })} />

      <main className="sw-main">
        {view === 'schedule' ? (
          <ScheduleView onOpenModal={setModalIntent} />
        ) : (
          <BoardView />
        )}
      </main>

      {modalIntent && (
        <ScheduleModal intent={modalIntent} onClose={() => setModalIntent(null)} />
      )}
      <SwToast />
    </div>
  );
}
