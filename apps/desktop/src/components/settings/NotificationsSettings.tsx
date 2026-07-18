import { usePetStore, type NotificationForm } from '@/store/petStore';

export function NotificationsSettings() {
  const notificationForm = usePetStore((s) => s.notificationForm);
  const setNotificationForm = usePetStore((s) => s.setNotificationForm);
  const options: { value: NotificationForm; label: string }[] = [
    { value: 'bubble', label: '宠物头顶气泡' },
    { value: 'system', label: '系统通知' },
    { value: 'both', label: '两者都发' },
    { value: 'off', label: '关闭' },
  ];
  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">通知</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">选择桌面宠物事件通知的形式</div>
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">通知形式</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">气泡浮于宠物头顶；系统通知走 macOS 通知中心（失焦时仍可见）</p>
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
