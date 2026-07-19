import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';

export function QuickAdd() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const quickAddTask = useScheduleStore((s) => s.quickAddTask);

  const submit = async () => {
    if (!text.trim()) return;
    await quickAddTask(text.trim());
    setText('');
  };

  return (
    <div className="sw-quick-add">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={t('schedule:quickAdd.placeholder')}
      />
      <button onClick={submit}>{t('schedule:quickAdd.submit')}</button>
    </div>
  );
}
