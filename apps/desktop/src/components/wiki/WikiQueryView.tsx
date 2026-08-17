// ponytail: E2.b — three-section wiki query tab. Virtual path 'wiki-query' (no
// file backing). sessionId is component-local; closing tab clears it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownPreview } from '@/components/file-types/markdown/MarkdownPreview';
import { runWikiQuery, saveToWiki } from '@/services/wikiQueryService';
import { useVaultStore } from '@/store/vaultStore';
import { generateId } from '@/utils/idGenerator';

interface QueryTurn {
  id: string;
  query: string;
  answer: string;
  hits: { path: string; score: number; isNeighbor: boolean }[];
}

function extractCitations(markdown: string): string[] {
  const out = new Set<string>();
  const re = /\[\[wiki:\/\/([^\]]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) out.add(m[1]);
  return [...out];
}

export function WikiQueryView() {
  const { t } = useTranslation();
  const vault = useVaultStore.getState().currentVault;
  const vaultRoot = vault?.basePath ?? '';

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<QueryTurn[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, running]);

  const handleSubmit = async () => {
    const q = input.trim();
    if (!q || running) return;
    setRunning(true);
    setProgress(t('wiki:query.progress.lookingUp'));
    setError(null);
    const sid = sessionId ?? generateId();
    if (!sessionId) setSessionId(sid);
    try {
      const answer = await runWikiQuery(q, sid);
      // ponytail: parse hits from citations — avoids duplicating search call.
      const citations = extractCitations(answer);
      const hits = citations.map((path) => ({ path, score: 0, isNeighbor: false }));
      setTurns((prev) => [...prev, { id: generateId(), query: q, answer, hits }]);
      setInput('');
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress('');
    } finally {
      setRunning(false);
    }
  };

  const handleNewSession = () => {
    setSessionId(null);
    setTurns([]);
    setError(null);
    setProgress('');
  };

  const handleSaveSynthesis = async (turn: QueryTurn) => {
    if (!turn.answer.trim()) return;
    setProgress(t('wiki:query.progress.saving'));
    try {
      const title = turn.query.slice(0, 60);
      const sourcePaths = turn.hits.map((h) => h.path);
      const relatedPages: string[] = [];
      const path = await saveToWiki(title, turn.answer, turn.query, sourcePaths, relatedPages);
      setProgress(t('wiki:query.progress.saved', { path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setProgress(''), 2000);
    }
  };

  const placeholder = useMemo(() => t('wiki:query.input.placeholder'), [t]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surf">
      {/* Top: history + input */}
      <div className="shrink-0 px-4 py-2.5 border-b border-brd flex items-center gap-2">
        <button
          className="btn btn-sm"
          onClick={handleNewSession}
          disabled={running || turns.length === 0}
          title={t('wiki:query.newSession')}
        >
          {t('wiki:query.newSession')}
        </button>
        <div className="flex-1 flex items-center gap-1.5">
          <input
            className="flex-1 bg-inp border border-brd rounded-md px-2.5 py-1.5 text-[12px] font-ui text-t1 outline-none focus:border-acc"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
            disabled={running}
          />
          <button
            className="btn btn-g btn-sm"
            onClick={handleSubmit}
            disabled={running || !input.trim()}
          >
            {t('wiki:query.submit')}
          </button>
        </div>
      </div>

      {/* Middle: answer + recall links */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {turns.length === 0 && !running && (
          <div className="text-center text-t3 text-[13px] mt-12">{t('wiki:query.empty')}</div>
        )}
        {turns.map((turn) => (
          <div key={turn.id} className="mb-6">
            <div className="text-[12px] text-t3 mb-1">{t('wiki:query.userPrefix')}{turn.query}</div>
            <div className="border border-brd2 rounded-lg bg-surf2 p-3">
              <MarkdownPreview content={turn.answer} filePath="" vaultRoot={vaultRoot} />
            </div>
            {turn.hits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {turn.hits.map((h) => (
                  <span key={h.path} className="inline-flex items-center px-1.5 py-0.5 text-[10px] rounded bg-accdim text-t2 border border-brd2 font-mono">
                    wiki://{h.path}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex gap-2">
              <button className="btn btn-sm" onClick={() => void handleSaveSynthesis(turn)} disabled={!turn.answer.trim()}>
                {t('wiki:query.saveAsSynthesis')}
              </button>
            </div>
          </div>
        ))}
        {running && (
          <div className="text-[12px] text-t3 italic">{t('wiki:query.thinking')}</div>
        )}
        {error && (
          <div className="text-[12px] text-[#f06a6a] mt-2">{error}</div>
        )}
      </div>

      {/* Bottom: progress */}
      {progress && (
        <div className="shrink-0 px-4 py-1.5 border-t border-brd text-[11px] text-t3">
          {progress}
        </div>
      )}
    </div>
  );
}
