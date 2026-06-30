import { useCallback, useEffect, useState } from 'react';
import { useScheduleStore, subscribeToFileTree } from '@/store/scheduleStore';
import { dateToString } from '@/schedule/dailyScan';
import { ScheduleSidebar } from './ScheduleSidebar';
import { ScheduleView } from './ScheduleView';
import { BoardView } from './BoardView';
import { ScheduleModal, type ModalIntent } from './ScheduleModal';
import { SwToast } from './Toast';
import { PlanMyDayPreview } from './PlanMyDayPreview';
import {
  gatherPlanContext,
  generatePlan,
  applyPlan,
  type Plan,
  type PlanAcceptance,
  type ApplyResult,
} from '@/services/planMyDayService';
import { setPlanMyDayStarter } from '@/services/planMyDayBridge';

export type WorkbenchView = 'schedule' | 'board';

type PlanStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; plan: Plan; targetDate: string }
  | { kind: 'result'; applied: string[]; failed: { item: string; error: string }[] };

export function ScheduleWorkbenchPage() {
  const [view, setView] = useState<WorkbenchView>('schedule');
  const [modalIntent, setModalIntent] = useState<ModalIntent | null>(null);
  const [planStatus, setPlanStatus] = useState<PlanStatus>({ kind: 'idle' });
  const refresh = useScheduleStore((s) => s.refresh);
  const toast = useScheduleStore((s) => s.toast);

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

  // Run the plan-my-day flow: gather today's context → call the AI → preview.
  // Targets TODAY (gatherPlanContext is today-only; multi-day is out of scope).
  const runPlanMyDay = useCallback(async () => {
    setPlanStatus({ kind: 'loading' });
    try {
      const ctx = gatherPlanContext();
      const plan = await generatePlan(ctx);
      // Empty plan (AI returned nothing useful) → show the empty hint inside
      // the preview rather than a separate state, so the user can still see
      // the notes / dismiss. Distinguish via plan emptiness.
      setPlanStatus({ kind: 'preview', plan, targetDate: ctx.today });
    } catch (err) {
      setPlanStatus({ kind: 'error', message: String(err) });
    }
  }, []);

  // Register the bridge starter so the ⌘P command can trigger this flow.
  useEffect(() => {
    setPlanMyDayStarter(() => {
      void runPlanMyDay();
    });
    return () => setPlanMyDayStarter(null);
  }, [runPlanMyDay]);

  const handleAccept = useCallback(
    async (accepted: PlanAcceptance) => {
      if (planStatus.kind !== 'preview') return;
      try {
        const result: ApplyResult = await applyPlan(planStatus.plan, accepted);
        setPlanStatus({ kind: 'result', applied: result.applied, failed: result.failed });
        if (result.failed.length === 0) {
          toast(`已应用 ${result.applied.length} 项计划`);
        } else {
          toast(`应用 ${result.applied.length} 项，失败 ${result.failed.length} 项`);
        }
      } catch (err) {
        setPlanStatus({ kind: 'error', message: String(err) });
      }
    },
    [planStatus, toast],
  );

  const handleReject = useCallback(() => {
    setPlanStatus({ kind: 'idle' });
  }, []);

  return (
    <div className="schedule-workbench">
      <ScheduleSidebar
        view={view}
        onSwitchView={setView}
        onNew={() => setModalIntent({ kind: view === 'board' ? 'task' : 'event', col: 'todo', day: dateToString(new Date()), hour: 9 })}
      />

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

      {planStatus.kind === 'loading' && (
        <div className="sw-plan-overlay" role="dialog" aria-label="AI 规划今日">
          <div className="sw-plan-backdrop" />
          <div className="sw-plan-status">
            <span className="sw-plan-spinner" />
            <span>AI 正在规划今日…</span>
          </div>
        </div>
      )}

      {planStatus.kind === 'error' && (
        <div className="sw-plan-overlay" role="dialog" aria-label="AI 规划今日">
          <div className="sw-plan-backdrop" onClick={handleReject} />
          <div className="sw-plan-status">
            <p className="sw-plan-error-msg">{planStatus.message}</p>
            <div className="sw-plan-actions">
              <button className="sw-plan-reject" onClick={handleReject}>关闭</button>
              <button className="sw-plan-accept" onClick={() => void runPlanMyDay()}>重试</button>
            </div>
          </div>
        </div>
      )}

      {planStatus.kind === 'preview' && (
        <PlanMyDayPreview
          plan={planStatus.plan}
          targetDate={planStatus.targetDate}
          onAccept={(a) => void handleAccept(a)}
          onReject={handleReject}
        />
      )}

      {planStatus.kind === 'result' && (
        <div className="sw-plan-overlay" role="dialog" aria-label="AI 规划今日">
          <div className="sw-plan-backdrop" onClick={handleReject} />
          <div className="sw-plan-status">
            <p className="sw-plan-result-msg">
              已应用 {planStatus.applied.length} 项
              {planStatus.failed.length > 0 && `，失败 ${planStatus.failed.length} 项`}
            </p>
            {planStatus.failed.length > 0 && (
              <ul className="sw-plan-failed">
                {planStatus.failed.map((f, i) => (
                  <li key={i}>{f.item}: {f.error}</li>
                ))}
              </ul>
            )}
            <div className="sw-plan-actions">
              <button className="sw-plan-accept" onClick={handleReject}>完成</button>
            </div>
          </div>
        </div>
      )}

      <SwToast />
    </div>
  );
}
