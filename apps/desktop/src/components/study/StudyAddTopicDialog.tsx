import { useState } from 'react';

interface StudyAddTopicDialogProps {
  onConfirm: (title: string) => void;
  onCancel: () => void;
}

/** 新建学习主题弹窗：标题输入，回车提交，Esc/overlay 取消。复用 dlg-* 类。 */
export function StudyAddTopicDialog({ onConfirm, onCancel }: StudyAddTopicDialogProps) {
  const [title, setTitle] = useState('');

  const trimmed = title.trim();
  const submit = () => {
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <div className="dlg-overlay" onClick={onCancel}>
      <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <div className="dlg-hd">
          <h3>新建学习主题</h3>
          <button className="dlg-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="dlg-body">
          <input
            className="dlg-input"
            placeholder="主题标题…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              if (e.key === 'Escape') { onCancel(); }
            }}
          />
        </div>
        <div className="dlg-footer">
          <button className="dlg-btn" onClick={onCancel}>取消</button>
          <button
            className="dlg-btn primary"
            onClick={submit}
            disabled={!trimmed}
          >
            新建
          </button>
        </div>
      </div>
    </div>
  );
}
