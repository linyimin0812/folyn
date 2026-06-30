import { useMemo, useState } from 'react';
import type { StudyUnit } from '@/study/types';
import type { ScheduleLink } from '@/study/scheduleLink';
import { dateToString } from '@/schedule/dailyScan';
import { computePlanProgress } from '@/study/progress';

interface Props {
  units: StudyUnit[];
  /** 各单元在 schedule 的排期/完成回链（只读单向读回）。 */
  scheduleLinks: Map<number, ScheduleLink>;
  /** 翻转单元 done（[ ]↔[x]）并回写。 */
  onToggle: (unit: StudyUnit) => Promise<void>;
  /** 新增单元（序号自动递增，lineIndex<0 追加到段尾）。 */
  onAdd: (u: StudyUnit) => Promise<void>;
  /** 把单元排到目标日期的 daily note（单向排期 + 回链）。 */
  onSchedule: (unit: StudyUnit, noteDate: string) => Promise<void>;
}

/** 计划空态图标。 */
const LIST_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </svg>
);
/** 已排期图标。 */
const CALENDAR_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);
/** 已完成图标。 */
const CHECK_CIRCLE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4 12 14.01l-3-3" /></svg>
);

/** 计划区：列出 `## 计划` 段的学习单元，卡片行展示序号/估时/依赖/进度；
 *  勾选写回；手动添加单元；单元可"排到日程"（带 study:<slug> 回链）。 */
export function StudyPlanSection({ units, scheduleLinks, onToggle, onAdd, onSchedule }: Props) {
  const [draft, setDraft] = useState('');
  const [est, setEst] = useState('');
  const [schedulingFor, setSchedulingFor] = useState<number | null>(null);
  const [scheduleDate, setScheduleDate] = useState(dateToString(new Date()));
  const sorted = useMemo(() => [...units].sort((a, b) => a.order - b.order), [units]);
  const nextOrder = sorted.length ? Math.max(...sorted.map((u) => u.order)) + 1 : 1;
  const progress = useMemo(() => computePlanProgress(units), [units]);

  const submit = async () => {
    const title = draft.trim();
    if (!title) return;
    await onAdd({
      id: `#units--1`,
      order: nextOrder,
      title,
      done: false,
      est: est.trim() || undefined,
      dep: '-',
      prog: 0,
      lineIndex: -1,
    });
    setDraft('');
    setEst('');
  };

  const schedule = async (unit: StudyUnit) => {
    await onSchedule(unit, scheduleDate);
    setSchedulingFor(null);
  };

  return (
    <section className="sw-study-section">
      <header className="sw-study-sec-head">
        <h3>计划</h3>
        <div className="sw-study-sec-actions">
          <span className="sw-study-progress-summary" title="已完成 / 总数">
            <span className="sw-study-progress-summary-pct">{progress.percent}%</span>
            <span className="sw-study-count">{progress.done}/{progress.total}</span>
          </span>
        </div>
      </header>

      <div className="sw-study-overall-progress" title="总体进度">
        <div className="sw-bar"><i style={{ width: `${progress.percent}%` }} /></div>
      </div>

      <div className="sw-quick-add sw-study-add-form">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={`第 ${nextOrder} 单元名…`}
        />
        <input value={est} onChange={(e) => setEst(e.target.value)} placeholder="估时 2h" />
        <button onClick={submit}>添加</button>
      </div>

      {sorted.length === 0 ? (
        <div className="sw-empty-state">
          <span className="sw-empty-icon">{LIST_ICON}</span>
          <span className="sw-empty-text">暂无学习单元</span>
          <span className="sw-empty-hint">添加第一个单元开始计划</span>
        </div>
      ) : (
        <ul className="sw-study-list">
          {sorted.map((u) => {
            const link = scheduleLinks.get(u.order);
            const scheduled = !!link;
            return (
              <li key={u.id} className={`sw-card sw-unit-card${u.done ? ' done' : ''}`}>
                <label className="sw-unit-check" title={u.done ? '标记未完成' : '标记完成'}>
                  <input
                    type="checkbox"
                    checked={u.done}
                    onChange={() => void onToggle({ ...u, done: !u.done })}
                  />
                </label>
                <div className="sw-study-item-body">
                  <div className="sw-study-item-title">
                    <span className="sw-unit-order" title="单元序号">{u.order}</span>
                    <span className="sw-unit-title">{u.title}</span>
                  </div>
                  <div className="sw-card-meta sw-unit-meta">
                    {u.est && (
                      <span className="sw-chip" title="估时">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                        {u.est}
                      </span>
                    )}
                    {u.dep && u.dep !== '-' && (
                      <span className="sw-chip" title="依赖单元">依赖 #{u.dep}</span>
                    )}
                    {scheduled && (
                      <span className={`sw-chip sw-schedule-link ${link!.done ? 'done' : 'due'}`} title={`排期于 ${link!.noteDate}`}>
                        {link!.done ? CHECK_CIRCLE_ICON : CALENDAR_ICON}
                        {link!.done ? '日程已完成' : `已排期 ${link!.noteDate}${link!.due ? ` (due ${link!.due})` : ''}`}
                      </span>
                    )}
                  </div>
                  <div className="sw-progress sw-unit-progress">
                    <div className="sw-bar"><i style={{ width: `${u.prog}%` }} /></div>
                    <span className="sw-pct">{u.prog}%</span>
                  </div>
                  {schedulingFor === u.order ? (
                    <div className="sw-quick-add sw-schedule-form">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                        aria-label="排期日期"
                      />
                      <button onClick={() => void schedule(u)}>排到日程</button>
                      <button className="ghost" onClick={() => setSchedulingFor(null)}>取消</button>
                    </div>
                  ) : (
                    <div className="sw-card-actions">
                      <button
                        className="sw-card-action"
                        title="把该单元写入目标日期 daily note 的任务段（带 study 回链）"
                        onClick={() => {
                          setScheduleDate(dateToString(new Date()));
                          setSchedulingFor(u.order);
                        }}
                      >
                        排到日程
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
