import { useWikiStore } from '@/store/wikiStore';

interface WikiToolbarProps {
  onIngest: () => void;
  onLint: () => void;
  onDeepResearch: () => void;
}

export function WikiToolbar({ onIngest, onLint, onDeepResearch }: WikiToolbarProps) {
  const isIngesting = useWikiStore((s) => s.isIngesting);
  const isLinting = useWikiStore((s) => s.isLinting);
  const currentStep = useWikiStore((s) => s.currentIngestStep);
  const progress = useWikiStore((s) => s.ingestProgress);
  const isBusy = isIngesting || isLinting;

  return (
    <div className="wiki-toolbar">
      <button
        className="wiki-toolbar-btn"
        onClick={onIngest}
        disabled={isBusy}
      >
        {isIngesting && <span className="wiki-btn-spinner" />}
        摄入文件
      </button>
      <button
        className="wiki-toolbar-btn"
        onClick={onLint}
        disabled={isBusy}
      >
        {isLinting && <span className="wiki-btn-spinner" />}
        健康检查
      </button>
      <button
        className="wiki-toolbar-btn"
        onClick={onDeepResearch}
        disabled={isBusy}
      >
        深度研究
      </button>
      {isIngesting && (
        <div className="wiki-toolbar-progress">
          <div className="wiki-progress-bar">
            <div className="wiki-progress-fill" style={{ width: currentStep === 2 ? '66%' : '33%' }} />
          </div>
          <span className="wiki-progress-label">Step {currentStep}/2 — {progress}</span>
        </div>
      )}
    </div>
  );
}
