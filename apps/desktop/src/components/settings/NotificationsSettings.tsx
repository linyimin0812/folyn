import { useTranslation } from 'react-i18next';
import {
  usePetStore,
  type NotificationForm,
  type Placement,
  type CornerPlacement,
  type CornerTtlMs,
} from '@/store/petStore';

const PLACEMENTS: Placement[] = [
  'top', 'topLeft', 'topRight',
  'bottom', 'bottomLeft', 'bottomRight',
  'left', 'leftTop', 'leftBottom',
  'right', 'rightTop', 'rightBottom',
];

const CORNERS: CornerPlacement[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

const TTL_PRESETS: CornerTtlMs[] = [5000, 10000, 30000, 'never'];

export function NotificationsSettings() {
  const { t } = useTranslation();
  const notificationForm = usePetStore((s) => s.notificationForm);
  const setNotificationForm = usePetStore((s) => s.setNotificationForm);
  const bubblePlacement = usePetStore((s) => s.bubblePlacement);
  const setBubblePlacement = usePetStore((s) => s.setBubblePlacement);
  const cornerPlacement = usePetStore((s) => s.cornerPlacement);
  const setCornerPlacement = usePetStore((s) => s.setCornerPlacement);
  const cornerTtlMs = usePetStore((s) => s.cornerTtlMs);
  const setCornerTtlMs = usePetStore((s) => s.setCornerTtlMs);

  const formOptions: { value: NotificationForm; label: string }[] = [
    { value: 'bubble', label: t('settings:notifications.options.bubble') },
    { value: 'corner', label: t('settings:notifications.options.corner') },
    { value: 'both', label: t('settings:notifications.options.both') },
    { value: 'off', label: t('settings:notifications.options.off') },
  ];

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:notifications.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:notifications.description')}</div>
      </div>
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.form.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.form.desc')}</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={notificationForm}
          onChange={(e) => setNotificationForm(e.target.value as NotificationForm)}
        >
          {formOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.bubblePlacement.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.bubblePlacement.desc')}</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={bubblePlacement}
          onChange={(e) => setBubblePlacement(e.target.value as Placement)}
        >
          {PLACEMENTS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.cornerPlacement.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.cornerPlacement.desc')}</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={cornerPlacement}
          onChange={(e) => setCornerPlacement(e.target.value as CornerPlacement)}
        >
          {CORNERS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">{t('settings:notifications.cornerTtlMs.title')}</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">{t('settings:notifications.cornerTtlMs.desc')}</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={typeof cornerTtlMs === 'number' ? String(cornerTtlMs) : 'never'}
          onChange={(e) => {
            const v = e.target.value;
            setCornerTtlMs(v === 'never' ? 'never' : Number(v));
          }}
        >
          {TTL_PRESETS.map((p) => {
            const value = typeof p === 'number' ? String(p) : 'never';
            const label = typeof p === 'number'
              ? t('settings:notifications.cornerTtlMs.seconds', { seconds: p / 1000 })
              : t('settings:notifications.cornerTtlMs.never');
            return (
              <option key={value} value={value}>{label}</option>
            );
          })}
        </select>
      </div>
    </div>
  );
}
