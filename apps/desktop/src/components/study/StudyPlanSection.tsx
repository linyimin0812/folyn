import { useState } from 'react';
import type { StudyUnit } from '@/study/types';

interface Props {
  units: StudyUnit[];
  /** 翻转单元 done（[ ]↔[x]）并回写。 */
  onToggle: (unit: StudyUnit) => Promise<void>;
  /** 新增单元（序号自动递增，lineIndex<0 追加到段尾）。 */
  onAdd: (u: StudyUnit) => Promise<void>;
}

/** 计划区：列出 `## 计划` 段的学习单元，勾选写回；手动添加单元（序号递增）。 */
export function StudyPlanSection({ units, onToggle, onAdd }: Props) {
  const [draft, setDraft] = useState('');
  const [est, setEst] = useState('');
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
          {sorted.map((u) => (
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
                </div>
                <div className="sw-progress">
                  <div className="sw-bar"><i style={{ width: `${u.prog}%` }} /></div>
                  <span className="sw-pct">{u.prog}%</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
