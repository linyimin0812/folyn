import { useState } from 'react';

interface DeepResearchDialogProps {
  initialTopic?: string;
  onConfirm: (topic: string) => void;
  onCancel: () => void;
}

export function DeepResearchDialog({ initialTopic = '', onConfirm, onCancel }: DeepResearchDialogProps) {
  const [topic, setTopic] = useState(initialTopic);

  return (
    <div className="dlg-overlay" onClick={onCancel}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-hd">
          <h3>深度研究</h3>
          <button className="dlg-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="dlg-body">
          <label className="dlg-label">研究主题</label>
          <textarea
            className="dlg-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="输入你想深入研究的主题..."
            rows={3}
            autoFocus
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
          <p style={{ fontSize: 11, color: 'var(--t4)', margin: '4px 0 0' }}>
            AI 将根据此主题搜索网络，并将结果自动摄入到 Wiki。
          </p>
        </div>
        <div className="dlg-footer">
          <button className="dlg-btn" onClick={onCancel}>取消</button>
          <button
            className="dlg-btn primary"
            onClick={() => onConfirm(topic)}
            disabled={!topic.trim()}
          >
            开始研究
          </button>
        </div>
      </div>
    </div>
  );
}
