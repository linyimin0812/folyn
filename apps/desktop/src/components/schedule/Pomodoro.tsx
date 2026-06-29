import { useScheduleStore } from '@/store/scheduleStore';

export function Pomodoro() {
  const pomo = useScheduleStore((s) => s.pomo);
  const toggle = useScheduleStore((s) => s.pomoToggle);
  const reset = useScheduleStore((s) => s.pomoReset);

  const m = Math.floor(pomo.remaining / 60);
  const s = pomo.remaining % 60;
  const timer = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const mode = pomo.mode === 'work' ? `工作时段 · 第 ${pomo.round} 轮` : `休息 · 第 ${pomo.round} 轮`;

  return (
    <div className="sw-pomo">
      <div className="sw-label">专注番茄</div>
      <div className="sw-timer">{timer}</div>
      <div className="sw-mode">{mode}</div>
      <div className="sw-ctrls">
        <button className="primary" onClick={toggle}>{pomo.running ? '暂停' : '开始'}</button>
        <button onClick={reset}>重置</button>
      </div>
    </div>
  );
}
