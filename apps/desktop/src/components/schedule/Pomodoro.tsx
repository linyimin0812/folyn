import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';

export function Pomodoro() {
  const { t } = useTranslation();
  const pomo = useScheduleStore((s) => s.pomo);
  const toggle = useScheduleStore((s) => s.pomoToggle);
  const reset = useScheduleStore((s) => s.pomoReset);
  const setNotify = useScheduleStore((s) => s.pomoSetNotify);

  const m = Math.floor(pomo.remaining / 60);
  const s = pomo.remaining % 60;
  const timer = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const mode = pomo.mode === 'work' ? t('schedule:pomodoro.work', { round: pomo.round }) : t('schedule:pomodoro.rest', { round: pomo.round });

  return (
    <div className="sw-pomo">
      <div className="sw-pomo-head">
        <div className="sw-label">{t('schedule:pomodoro.label')}</div>
        <label className="sw-pomo-notify" title={t('schedule:pomodoro.notify')}>
          <input type="checkbox" checked={pomo.notify} onChange={(e) => setNotify(e.target.checked)} />
          {t('schedule:pomodoro.notify')}
        </label>
      </div>
      <div className="sw-timer">{timer}</div>
      <div className="sw-mode">{mode}</div>
      <div className="sw-ctrls">
        <button className="primary" onClick={toggle}>{pomo.running ? t('schedule:pomodoro.pause') : t('schedule:pomodoro.start')}</button>
        <button onClick={reset}>{t('schedule:pomodoro.reset')}</button>
      </div>
    </div>
  );
}
