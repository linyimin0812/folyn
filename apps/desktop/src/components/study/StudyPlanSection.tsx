import { useState } from 'react';
import type { StudyUnit } from '@/study/types';
import type { ScheduleLink } from '@/study/scheduleLink';
import { dateToString } from '@/schedule/dailyScan';

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

/** 计划区：列出 `## 计划` 段的学习单元，勾选写回；手动添加单元（序号递增）；
 *  单元可"排到日程"（写 daily note `## 任务` 段，带 study:<slug> unit:<n> 回链）。 */
export function StudyPlanSection({ units, scheduleLinks, onToggle, onAdd, onSchedule }: Props) {
  const [draft, setDraft] = useState('');
  const [est, setEst] = useState('');
  const [schedulingFor, setSchedulingFor] = useState<number | null>(null);
  const [scheduleDate, setScheduleDate] = useState(dateToString(new Date()));
  const sorted = [...units].sort((a, b) => a.order - b.order);
  const nextOrder = sorted.length ? Math.max(...sorted.map((u) => u.order)) + 1 : 1;

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
        <span className="sw-study-count">{sorted.filter((u) => u.done).length}/{sorted.length}</span>
      </header>

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
        <p className="sw-empty-hint">暂无学习单元。添加第一个单元开始计划。</p>
      ) : (
        <ul className="sw-study-list">
          {sorted.map((u) => {
            const link = scheduleLinks.get(u.order);
            return (
              <li key={u.id} className={`sw-study-item sw-unit${u.done ? ' done' : ''}`}>
                <input
                  type="checkbox"
                  checked={u.done}
                  onChange={() => void onToggle({ ...u, done: !u.done })}
                />
                <div className="sw-study-item-body">
                  <div className="sw-study-item-title">
                    <span className="sw-unit-order">{u.order}.</span> {u.title}
                  </div>
                  <div className="sw-study-item-meta">
                    {u.est && <span>估时 {u.est}</span>}
                    {u.dep && u.dep !== '-' && <span> · 依赖 #{u.dep}</span>}
                    {link && (
                      <span className="sw-schedule-link">
                        {' · '}
                        {link.done ? '日程已完成' : `已排期 ${link.noteDate}${link.due ? ` (due ${link.due})` : ''}`}
                      </span>
                    )}
                  </div>
                  <div className="sw-progress">
                    <div className="sw-bar"><i style={{ width: `${u.prog}%` }} /></div>
                    <span className="sw-pct">{u.prog}%</span>
                  </div>
                  {schedulingFor === u.order ? (
                    <div className="sw-quick-add sw-schedule-form">
                      <input
                        type="date"
                        value={scheduleDate}
                        onChange={(e) => setScheduleDate(e.target.value)}
                      />
                      <button onClick={() => void schedule(u)}>排到日程</button>
                      <button className="ghost" onClick={() => setSchedulingFor(null)}>取消</button>
                    </div>
                  ) : (
                    <div className="sw-study-item-actions">
                      <button
                        className="ghost"
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
