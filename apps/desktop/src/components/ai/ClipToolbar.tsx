import { useState } from 'react';
import { useClipStore } from '@/store/clipStore';

interface ClipToolbarProps {
  onClip: (url: string) => Promise<void>;
}

export function ClipToolbar({ onClip }: ClipToolbarProps) {
  const [url, setUrl] = useState('');
  const isClipping = useClipStore((s) => s.isClipping);
  const error = useClipStore((s) => s.error);

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed || isClipping) return;
    try {
      await onClip(trimmed);
      setUrl('');
    } catch {
      // Error is shown below from store
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col gap-1.5 py-2 px-3 border-b border-brd shrink-0">
      <div className="flex items-center gap-1.5">
        <input
          type="url"
          className="flex-1 py-1 px-2 rounded-md border border-brd bg-inp text-t1 text-[11px] outline-none transition-[border-color] duration-150 font-ui focus:border-acc placeholder:text-t3"
          placeholder="粘贴 URL 开始剪藏..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isClipping}
        />
        <button
          className="py-1 px-2.5 border border-brd rounded-md bg-surf text-t2 text-[11px] cursor-pointer transition-all duration-150 inline-flex items-center gap-1 hover:bg-hov hover:text-t1 hover:border-acc disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleSubmit}
          disabled={!url.trim() || isClipping}
        >
          {isClipping ? (
            <>
              <span className="inline-block w-3 h-3 rounded-full border-[1.5px] border-brd border-t-acc animate-spin" />
              剪藏中...
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 2v12l5-3 5 3V2H3z" />
              </svg>
              剪藏
            </>
          )}
        </button>
      </div>
      {isClipping && (
        <div className="text-[11px] text-acc">正在获取页面内容并生成摘要...</div>
      )}
      {error && !isClipping && (
        <div className="text-[11px] text-red">{error}</div>
      )}
    </div>
  );
}
