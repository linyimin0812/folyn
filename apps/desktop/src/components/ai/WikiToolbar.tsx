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
    <div className="flex gap-1.5 py-2 px-3 border-b border-brd shrink-0 flex-wrap items-center">
      <button
        className="py-1 px-2.5 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc"
        onClick={onIngest}
        disabled={isBusy}
      >
        {isIngesting && <span className="wiki-btn-spinner" />}
        摄入文件
      </button>
      <button
        className="py-1 px-2.5 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc"
        onClick={onLint}
        disabled={isBusy}
      >
        {isLinting && <span className="wiki-btn-spinner" />}
        健康检查
      </button>
      <button
        className="py-1 px-2.5 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc"
        onClick={onDeepResearch}
        disabled={isBusy}
      >
        深度研究
      </button>
      {isIngesting && (
        <div className="w-full text-[11px] text-acc mt-1">
          <div className="w-full h-[3px] bg-brd rounded-sm overflow-hidden mb-1">
            <div className="h-full bg-acc rounded-sm transition-[width] duration-[400ms] ease-out" style={{ width: currentStep === 2 ? '66%' : '33%' }} />
          </div>
          <span className="text-[11px] text-t3">Step {currentStep}/2 — {progress}</span>
        </div>
      )}
    </div>
  );
}
