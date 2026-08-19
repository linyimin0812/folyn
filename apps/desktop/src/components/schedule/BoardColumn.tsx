import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScheduleTask } from '@/features/schedule/types';
import { TaskCard } from './TaskCard';
import type { ModalIntent } from './ScheduleModal';

// Tauri WKWebView quirk: getData('text/plain') during onDrop may return empty
// even when setData was called during onDragStart. Module-level fallback.
let __columnDragId: string | null = null;

interface Props {
  id: string;
  name: string;
  color: string;
  isDone: boolean;
  tasks: ScheduleTask[];
  onDropTask: (taskId: string) => void;
  onRename: (name: string) => void;
  onReorderColumns: (fromId: string, toId: string) => void;
  onDelete: () => void;
  onOpenModal: (intent: ModalIntent) => void;
}

const EMPTY_ICON_SVG = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
);

export function BoardColumn({ id, name, color, isDone, tasks, onDropTask, onRename, onReorderColumns, onDelete, onOpenModal }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commitRename = () => {
    const v = draft.trim();
    if (v && v !== name) onRename(v);
    setEditing(false);
  };

  return (
    <div className="sw-col">
      <div
        className="sw-col-head"
        draggable
        onDragStart={(e) => {
          __columnDragId = id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'column', id }));
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          (e.currentTarget as HTMLElement).classList.add('drop-target-col');
        }}
        onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('drop-target-col')}
        onDrop={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove('drop-target-col');
          let fromId: string | null = null;
          const raw = e.dataTransfer.getData('text/plain');
          if (raw) {
            try {
              const payload = JSON.parse(raw) as { kind?: string; id?: string };
              if (payload.kind === 'column' && payload.id) fromId = payload.id;
            } catch { /* fall through to module-level fallback */ }
          }
          if (!fromId) fromId = __columnDragId;
          __columnDragId = null; // always clear
          if (fromId && fromId !== id) {
            onReorderColumns(fromId, id);
            e.stopPropagation();
          }
        }}
        onDragEnd={(e) => {
          (e.currentTarget as HTMLElement).classList.remove('drop-target-col');
          __columnDragId = null;
        }}
      >
        <div className="sw-left">
          <span className="sw-col-dot" style={{ background: color }} />
          {editing ? (
            <input
              className="sw-col-name-input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setDraft(name); setEditing(false); }
              }}
            />
          ) : (
            <span
              className="sw-col-name"
              onDoubleClick={() => { setDraft(name); setEditing(true); }}
              title={t('schedule:boardColumn.renameHint')}
            >{name}</span>
          )}
          <span className="sw-col-count">{tasks.length}</span>
        </div>
        {!isDone && (
          <button
            className="sw-col-del"
            title={t('schedule:boardColumn.deleteColumn')}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >✕</button>
        )}
      </div>
      <div
        className="sw-col-body"
        data-col={id}
        onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).classList.add('drop-target'); }}
        onDragLeave={(e) => (e.currentTarget as HTMLElement).classList.remove('drop-target')}
        onDrop={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove('drop-target');
          const taskId = e.dataTransfer.getData('application/x-task');
          if (taskId) onDropTask(taskId);
        }}
      >
        {tasks.map((t) => <TaskCard key={t.id} task={t} onOpenModal={onOpenModal} />)}
        {tasks.length === 0 && (
          <div className="sw-empty-state">
            <span className="sw-empty-icon">{EMPTY_ICON_SVG}</span>
            <span className="sw-empty-text">{t('schedule:boardColumn.empty')}</span>
            <span className="sw-empty-hint">{t('schedule:boardColumn.emptyHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
