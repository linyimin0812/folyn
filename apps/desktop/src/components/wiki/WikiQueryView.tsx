// ponytail: E2.b — three-section wiki query tab. Virtual path 'wiki-query' (no
// file backing). sessionId/turns/isRunning sourced from useWikiQueryStore so
// they persist per-vault across tab close/reopen (mirror aiStore pattern).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownPreview } from '@/components/file-types/markdown/MarkdownPreview';
import { Loader2, Search } from 'lucide-react';
import { runWikiQuery } from '@/services/wikiQueryService';
import * as editorIoService from '@/services/editorIoService';
import { useVaultStore } from '@/store/vaultStore';
import { useWikiQueryStore } from '@/store/wikiQueryStore';
import { generateId } from '@/utils/idGenerator';
import { WIKI_PREFIX } from '@/types/wiki';
import wikiGraphIcon from '@/assets/icons/wiki_graph.svg';

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

  const sessionId = useWikiQueryStore((s) => s.sessionId);
  const setSessionId = useWikiQueryStore((s) => s.setSessionId);
  const turns = useWikiQueryStore((s) => s.turns);
  const addTurn = useWikiQueryStore((s) => s.addTurn);
  const updateTurn = useWikiQueryStore((s) => s.updateTurn);
  const running = useWikiQueryStore((s) => s.isRunning);
  const setRunning = useWikiQueryStore((s) => s.setRunning);
  const newSession = useWikiQueryStore((s) => s.newSession);
  const prefilledQuery = useWikiQueryStore((s) => s.prefilledQuery);
  const setPrefilledQuery = useWikiQueryStore((s) => s.setPrefilledQuery);

  const [input, setInput] = useState('');
  const [progress, setProgress] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, running]);

  // ponytail: consume transient pre-fill seed once, then clear — lets external
  // callers (contradiction "research") drop a query into the input box without
  // coupling to internal state.
  useEffect(() => {
    if (prefilledQuery) {
      setInput(prefilledQuery);
      setPrefilledQuery(null);
    }
  }, [prefilledQuery, setPrefilledQuery]);

  const handleSubmit = async () => {
    const q = input.trim();
    if (!q || running) return;
    setRunning(true);
    setProgress(t('wiki:query.progress.lookingUp'));
    setError(null);
    // ponytail: sid is a local-format id on the first call (or a stale local id
    // from before commit 73ff3088 after reload) — runWikiQuery UUID-gates
    // --resume so non-UUID ids are treated as fresh start; the CLI then emits a
    // real UUID via system/init, we capture it, and write it back below so the
    // next call resumes correctly.
    const sid = sessionId ?? generateId();
    if (!sessionId) setSessionId(sid);
    // ponytail: stream chunks into the turn as they arrive. onChunk fires per
    // chunk (partial string), so accumulate in the closure and write the whole
    // accumulated buffer each time — keeps store writes one-per-chunk without
    // touching aiStreamUtils' signature.
    const turnId = generateId();
    let accumulated = '';
    addTurn({ id: turnId, query: q, answer: '', hits: [] });
    try {
      const { answer, sessionId: assignedId } = await runWikiQuery(q, sid, (chunk) => {
        accumulated += chunk;
        updateTurn(turnId, { answer: accumulated });
      });
      if (assignedId && assignedId !== sid) setSessionId(assignedId);
      // ponytail: parse hits from citations — avoids duplicating search call.
      const citations = extractCitations(answer);
      const hits = citations.map((path) => ({ path, score: 0, isNeighbor: false }));
      updateTurn(turnId, { answer, hits });
      setInput('');
      setProgress('');
    } catch (err) {
      console.error('[WikiQuery] query failed:', err);
      setError(err instanceof Error ? err.message : String(err));
      setProgress('');
    } finally {
      setRunning(false);
    }
  };

  const handleNewSession = () => {
    newSession();
    setError(null);
    setProgress('');
  };

  const placeholder = useMemo(() => t('wiki:query.input.placeholder'), [t]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surf">
      {/* Top: history + input */}
      <div className="shrink-0 px-4 py-2.5 border-b border-brd flex items-center gap-2">
        <button
          className="btn btn-sm"
          onClick={() => editorIoService.openFile('wiki-graph', 'Wiki Graph')}
          title={t('wiki:query.openGraph')}
        >
          <img src={wikiGraphIcon} alt="" className="w-[13px] h-[13px]" />
        </button>
        <button
          className="btn btn-sm"
          onClick={handleNewSession}
          disabled={running || turns.length === 0}
          title={t('wiki:query.newSession')}
        >
          {t('wiki:query.newSession')}
        </button>
        <div className="flex-1 relative flex items-center">
          <Search size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-t3 pointer-events-none" />
          <input
            className="flex-1 min-w-0 bg-inp border border-brd rounded-md pl-2.5 pr-7 py-1.5 text-[12px] font-ui text-t1 outline-none focus:border-acc"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmit(); } }}
            disabled={running}
          />
        </div>
      </div>

      {/* Middle: answer + recall links */}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-y-auto px-6 py-4">
        {turns.map((turn) => (
          <div key={turn.id} className="mb-6">
            <div className="text-[12px] text-t3 mb-1">{t('wiki:query.userPrefix')}{turn.query}</div>
            {turn.answer.trim() !== '' && (
              <div className="border border-brd2 rounded-lg bg-surf2 p-3">
                <MarkdownPreview content={turn.answer} filePath="" vaultRoot={vaultRoot} />
              </div>
            )}
            {turn.hits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {turn.hits.map((h) => {
                  const name = h.path.split('/').pop()?.replace(/\.md$/, '') ?? h.path;
                  return (
                    <button
                      key={h.path}
                      type="button"
                      className="inline-flex items-center px-1.5 py-0.5 text-[10px] rounded bg-accdim text-t2 border border-brd2 font-mono hover:border-acc hover:text-acc"
                      onClick={() => void editorIoService.openFile(`${WIKI_PREFIX}${h.path}`, name)}
                      title={`wiki://${h.path}`}
                    >
                      wiki://{h.path}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {running && (
          <div className="flex flex-col items-center justify-center gap-2 mt-12">
            <Loader2 size={22} className="animate-spin text-t3" />
            <div className="text-t2 text-[13px]">{t('wiki:query.thinking')}</div>
          </div>
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
