import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useScheduleStore } from '@/store/scheduleStore';
import { dueState } from '@/features/schedule/markdown';
import { useBoardColumns } from '@/features/schedule/columns';
import { DayCalAside } from './DayCalAside';
import { BoardColumn } from './BoardColumn';
import type { ModalIntent } from './ScheduleModal';

export function BoardView({ onOpenModal }: { onOpenModal: (intent: ModalIntent) => void }) {
  const { t } = useTranslation();
  const tasks = useScheduleStore((s) => s.tasks);
  const moveTaskStatus = useScheduleStore((s) => s.moveTaskStatus);
  const removeBoardColumn = useScheduleStore((s) => s.removeBoardColumn);
  const addBoardColumn = useScheduleStore((s) => s.addBoardColumn);
  const renameBoardColumn = useScheduleStore((s) => s.renameBoardColumn);
  const reorderBoardColumns = useScheduleStore((s) => s.reorderBoardColumns);
  const { columns: boardColumns, doneId } = useBoardColumns();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [anchor, setAnchor] = useState(() => today);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const isToday = anchor.getTime() === today.getTime();
  const anchorMmDd = `${String(anchor.getMonth() + 1).padStart(2, '0')}-${String(anchor.getDate()).padStart(2, '0')}`;

  const filter = (colId: string) =>
    tasks.filter((t) => {
      if (t.column !== colId) return false;
      // 创建于该日（noteDate 的 MM-DD 部分 === anchorMmDd）
      if (t.noteDate.slice(5) === anchorMmDd) return true;
      // 截止于该日
      if (t.due === anchorMmDd) return true;
      // 今日锚点下，逾期未完成的也显示
      if (isToday && !t.done && t.due && dueState(t.due) === 'over') return true;
      return false;
    });

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) { setAdding(false); setNewName(''); return; }
    addBoardColumn(name);
    setNewName('');
    setAdding(false);
  };

  return (
    <section className="sw-view sw-view-board active">
      <div className="sw-board-layout">
        <DayCalAside anchorDate={anchor} onSelect={setAnchor} />
        <div className="sw-board-scroll">
          <div className="sw-board">
            {boardColumns.map((col) => (
              <BoardColumn
                key={col.id}
                id={col.id}
                name={col.name}
                color={col.color}
                isDone={col.id === doneId}
                tasks={filter(col.id)}
                onDropTask={(taskId) => moveTaskStatus(taskId, col.id)}
                onRename={(name) => renameBoardColumn(col.id, name)}
                onReorderColumns={reorderBoardColumns}
                onDelete={() => removeBoardColumn(col.id)}
                onOpenModal={onOpenModal}
              />
            ))}
            <div className="sw-col sw-col-add">
              {adding ? (
                <input
                  className="sw-col-add-input"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={submitNew}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitNew();
                    if (e.key === 'Escape') { setAdding(false); setNewName(''); }
                  }}
                  placeholder={t('schedule:boardView.columnNamePlaceholder')}
                />
              ) : (
                <button className="sw-col-add-btn" onClick={() => setAdding(true)}>{t('schedule:boardView.addColumn')}</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
