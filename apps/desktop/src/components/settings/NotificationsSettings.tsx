import { useTranslation } from 'react-i18next';
import { usePetStore, type NotificationForm } from '@/store/petStore';

export function NotificationsSettings() {
  const { t } = useTranslation();
  const notificationForm = usePetStore((s) => s.notificationForm);
  const setNotificationForm = usePetStore((s) => s.setNotificationForm);
  const options: { value: NotificationForm; label: string }[] = [
    { value: 'bubble', label: t('settings:notifications.options.bubble') },
    { value: 'system', label: t('settings:notifications.options.system') },
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
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
