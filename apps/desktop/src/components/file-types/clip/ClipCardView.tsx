import { useMemo, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import type { EditorProps } from '../types';

interface ClipData {
  title: string;
  url: string;
  tags: string[];
  clipped: string;
  summary: string;
  keyPoints: string[];
  hostname: string;
}

function parseClipContent(content: string): ClipData {
  const fm: Record<string, string> = {};
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  const body = match ? content.slice(match[0].length) : content;

  if (match) {
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      fm[key] = value;
    }
  }

  let tags: string[] = [];
  const rawTags = fm['tags'] || '';
  if (rawTags.startsWith('[') && rawTags.endsWith(']')) {
    const inner = rawTags.slice(1, -1).trim();
    if (inner) {
      tags = inner.split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
  }

  // Extract summary
  let summary = '';
  const summaryMatch = body.match(/## 摘要\s*\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (summaryMatch) summary = summaryMatch[1].trim();

  // Extract key points
  let keyPoints: string[] = [];
  const pointsMatch = body.match(/## 要点\s*\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (pointsMatch) {
    keyPoints = pointsMatch[1]
      .split('\n')
      .map((l) => l.replace(/^-\s*/, '').trim())
      .filter(Boolean);
  }

  const url = fm['url'] || '';
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch {}

  return {
    title: fm['title'] || 'Untitled',
    url,
    tags,
    clipped: fm['clipped'] || '',
    summary,
    keyPoints,
    hostname,
  };
}

export function ClipCardView({ content, tabId, filePath }: EditorProps) {
  const openWebFromClip = useEditorStore((s) => s.openWebFromClip);
  const data = useMemo(() => parseClipContent(content), [content]);

  // Convert current clip tab to web tab in-place
  const handleOpenUrl = useCallback(() => {
    if (!data.url) return;
    openWebFromClip(tabId, data.url, filePath, data.title);
  }, [data.url, data.title, filePath, tabId, openWebFromClip]);

  return (
    <div className="clip-card-view flex-1 overflow-y-auto p-4">
      <div className="rounded-xl border border-brd bg-panel shadow-[0_2px_12px_rgba(0,0,0,.06)] overflow-hidden">
        {/* Header band */}
        <div className="bg-surf border-b border-brd px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 rounded-lg bg-acc/10 flex items-center justify-center mt-0.5">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-acc">
                <path d="M3 2v12l5-3 5 3V2H3z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[17px] font-semibold text-t1 m-0 leading-snug break-words">{data.title}</h1>
              {data.hostname && (
                <button
                  className="mt-1 text-[12px] text-acc bg-transparent border-none cursor-pointer p-0 hover:underline inline-flex items-center gap-1"
                  onClick={handleOpenUrl}
                  title={data.url}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12M2 8h12" />
                  </svg>
                  {data.hostname}
                </button>
              )}
            </div>
            {data.clipped && (
              <span className="shrink-0 text-[11px] text-t3 bg-bg border border-brd px-2 py-0.5 rounded-md">{data.clipped}</span>
            )}
          </div>
        </div>

        {/* Tags */}
        {data.tags.length > 0 && (
          <div className="px-5 py-2.5 border-b border-brd flex gap-1.5 flex-wrap">
            {data.tags.map((tag) => (
              <span key={tag} className="text-[11px] text-acc bg-acc/8 border border-acc/15 px-2 py-0.5 rounded-full font-medium">{tag}</span>
            ))}
          </div>
        )}

        {/* Summary */}
        {data.summary && (
          <div className="px-5 py-4 border-b border-brd">
            <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px] mb-2">摘要</div>
            <p className="text-[13px] text-t1 leading-relaxed m-0">{data.summary}</p>
          </div>
        )}

        {/* Key Points */}
        {data.keyPoints.length > 0 && (
          <div className="px-5 py-4">
            <div className="text-[11px] text-t3 font-semibold uppercase tracking-[0.5px] mb-2">要点</div>
            <ul className="m-0 pl-0 list-none flex flex-col gap-2">
              {data.keyPoints.map((point, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-t1 leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-acc/10 text-acc text-[10px] font-bold flex items-center justify-center mt-px">{i + 1}</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
