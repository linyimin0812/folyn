import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore, subscribeToFileTree } from '@/store/scheduleStore';
import { dateToString } from '@/features/schedule/dailyScan';
import { useBoardColumns } from '@/features/schedule/columns';
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
  const { t } = useTranslation();
  const [view, setView] = useState<WorkbenchView>('schedule');
  const [modalIntent, setModalIntent] = useState<ModalIntent | null>(null);
  const [planStatus, setPlanStatus] = useState<PlanStatus>({ kind: 'idle' });
  const refresh = useScheduleStore((s) => s.refresh);
  const toast = useScheduleStore((s) => s.toast);
  const { columns: boardColumns } = useBoardColumns();
  // 用戶可能删掉了默認 todo 列；新建任務時取第一個非完成列作為初始列。
  const newTaskCol = boardColumns.find((c) => !c.isDone)?.id ?? 'todo';

  // 进入页面时刷新数据；订阅 fileTree 变化（debounce 300ms）。
  useEffect(() => {
    refresh();
    checkEventNotifications();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToFileTree(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refresh(), 300);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [refresh, checkEventNotifications]);

  // 番茄钟计时
  const pomoRunning = useScheduleStore((s) => s.pomo.running);
  const tickPomo = useScheduleStore((s) => s.tickPomo);
  useEffect(() => {
    if (!pomoRunning) return;
    const id = setInterval(() => tickPomo(), 1000);
    return () => clearInterval(id);
  }, [pomoRunning, tickPomo]);

  // now-line 每分钟刷新（通过 key 重渲染 WeekGrid）；同时检查事件提醒
  const checkEventNotifications = useScheduleStore((s) => s.checkEventNotifications);
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick((n) => n + 1);
      checkEventNotifications();
    }, 60_000);
    return () => clearInterval(id);
  }, [checkEventNotifications]);

  // 快捷键：⌘N 新建，Esc 关闭模态
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setModalIntent({ kind: view === 'board' ? 'task' : 'event', col: newTaskCol, day: dateToString(new Date()), hour: 9 });
      }
      if (e.key === 'Escape') setModalIntent(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, newTaskCol]);

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
          toast(t('schedule:plan.appliedToast', { count: result.applied.length }));
        } else {
          toast(t('schedule:plan.appliedPartialToast', { applied: result.applied.length, failed: result.failed.length }));
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
        onNew={() => setModalIntent({ kind: view === 'board' ? 'task' : 'event', col: newTaskCol, day: dateToString(new Date()), hour: 9 })}
      />

      <main className="sw-main">
        {view === 'schedule' ? (
          <ScheduleView onOpenModal={setModalIntent} />
        ) : (
          <BoardView onOpenModal={setModalIntent} />
        )}
      </main>

      {modalIntent && (
        <ScheduleModal intent={modalIntent} onClose={() => setModalIntent(null)} />
      )}

      {planStatus.kind === 'loading' && (
        <div className="sw-plan-overlay" role="dialog" aria-label={t('schedule:plan.ariaLabel')}>
          <div className="sw-plan-backdrop" />
          <div className="sw-plan-status">
            <span className="sw-plan-spinner" />
            <span>{t('schedule:plan.loading')}</span>
          </div>
        </div>
      )}

      {planStatus.kind === 'error' && (
        <div className="sw-plan-overlay" role="dialog" aria-label={t('schedule:plan.ariaLabel')}>
          <div className="sw-plan-backdrop" onClick={handleReject} />
          <div className="sw-plan-status">
            <p className="sw-plan-error-msg">{planStatus.message}</p>
            <div className="sw-plan-actions">
              <button className="sw-plan-reject" onClick={handleReject}>{t('schedule:plan.errorClose')}</button>
              <button className="sw-plan-accept" onClick={() => void runPlanMyDay()}>{t('schedule:plan.errorRetry')}</button>
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
        <div className="sw-plan-overlay" role="dialog" aria-label={t('schedule:plan.ariaLabel')}>
          <div className="sw-plan-backdrop" onClick={handleReject} />
          <div className="sw-plan-status">
            <p className="sw-plan-result-msg">
              {t('schedule:plan.resultApplied', { applied: planStatus.applied.length })}
              {planStatus.failed.length > 0 && t('schedule:plan.resultFailed', { failed: planStatus.failed.length })}
            </p>
            {planStatus.failed.length > 0 && (
              <ul className="sw-plan-failed">
                {planStatus.failed.map((f, i) => (
                  <li key={i}>{f.item}: {f.error}</li>
                ))}
              </ul>
            )}
            <div className="sw-plan-actions">
              <button className="sw-plan-accept" onClick={handleReject}>{t('schedule:plan.resultDone')}</button>
            </div>
          </div>
        </div>
      )}

      <SwToast />
    </div>
  );
}
