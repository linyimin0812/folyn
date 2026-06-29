import { useState } from 'react';
import { useScheduleStore } from '@/store/scheduleStore';

export function QuickAdd() {
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
        placeholder="添加任务，回车提交…"
      />
      <button onClick={submit}>添加</button>
    </div>
  );
}
