/**
 * Evidence bundle viewer (slice 6) — a readable rendering of a saved
 * capture's records.json: provenance, capture time, completeness, missing
 * list and the selected records verbatim (raw JSONL lines, or the retained
 * excerpt text with its coordinates for range-only selections).
 *
 * Rendered in the MAIN WORK AREA by WorkArea when a locator's live source
 * no longer exists. It NEVER claims the live record still matches — it is
 * the frozen copy from capture time, and the header says so (capture
 * timestamp + completeness). Attachments are listed by name; the note
 * itself already renders them through vault-relative links.
 */
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowLeft, CheckCircle2 } from 'lucide-react';
import type { EvidenceRecord } from '@/services/externalSessions/captureService';

function formatTime(ts: number | null): string {
  if (ts == null || Number.isNaN(ts)) return '';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function EvidenceViewer({
  record,
  onBack,
}: {
  record: EvidenceRecord;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const s = record.source;

  const roleLabel = (role: string) =>
    t(role === 'user' ? 'sessions:note.role.user' : 'sessions:note.role.assistant');

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-panel" data-testid="evidence-viewer">
      {/* Header — AiPanel conventions (34px, matches the editor TabBar). */}
      <div className="flex items-center gap-2 h-[34px] pl-2 pr-3 border-b border-brd shrink-0">
        <button
          type="button"
          className="w-[26px] h-[26px] flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 border-none bg-transparent"
          title={t('sessions:detail.back')}
          aria-label={t('sessions:detail.back')}
          onClick={onBack}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[13px] font-semibold text-t1 truncate flex-1 min-w-0">
          {t('sessions:evidence.title')} · {s.title || s.sessionId}
        </span>
        <span
          className="shrink-0 px-2 py-[1px] rounded-full bg-accdim text-acc text-[11px] font-medium"
          title={s.tool}
        >
          {s.tool}
        </span>
      </div>
      <div className="px-3 py-1 border-b border-brd2 bg-surf2/40 text-[11px] text-t3 truncate shrink-0" data-testid="evidence-capture-time">
        {t('sessions:evidence.capturedAt')}: {formatTime(Date.parse(record.capturedAt))}
      </div>
      <div className="px-3 py-1 text-[11px] text-t3 truncate shrink-0">
        {t('sessions:note.provenance.project')}: {s.cwd ?? t('sessions:note.unknown')}
        {s.branch
          ? ` · ${t('sessions:note.provenance.branch')}: ${s.branch.label || s.branch.id}`
          : ''}
      </div>
      <div className="px-3 pb-1 text-[11px] text-t3 truncate shrink-0" title={s.filePath}>
        {s.filePath}
      </div>
      <div
        className={`mx-3 mb-1.5 flex items-center gap-1.5 px-3 py-[7px] text-[11px] bg-surf border border-brd2 border-l-2 rounded-md shrink-0 ${
          record.complete ? 'border-l-green text-green' : 'border-l-amber text-amber'
        }`}
        data-testid="evidence-completeness"
      >
        {record.complete ? <CheckCircle2 size={12} className="shrink-0" /> : <AlertTriangle size={12} className="shrink-0" />}
        <span className="flex-1 min-w-0">
          {record.complete
            ? t('sessions:note.completeness.complete')
            : t('sessions:note.completeness.incomplete', { count: record.missing.length })}
        </span>
      </div>
      {(record.missing.length > 0 || record.sessionWarnings.length > 0) && (
        <div className="mx-3 mb-1.5 px-3 py-[7px] text-[11px] text-amber bg-surf border border-brd2 border-l-2 border-l-amber rounded-md shrink-0">
          {record.missing.map((m) => (
            <div key={`${m.messageId}-${m.kind}`}>
              {t('sessions:note.missing.item', {
                id: m.messageId,
                kind: t(`sessions:note.missing.kind.${m.kind}`),
                reason: m.reason,
              })}
            </div>
          ))}
          {record.sessionWarnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}

      {/* Verbatim records — centered to a readable measure at full width. */}
      <div className="sb-body flex-1 overflow-y-auto py-2">
        <div className="mx-auto w-full max-w-[860px] px-3">
          <div className="pb-1 text-[11px] text-t3 shrink-0">
            {t('sessions:evidence.records')}
          </div>
          {record.messages.map((m) => (
            <div key={m.id} className="mb-2.5 px-3 py-2.5 bg-surf border border-brd rounded-lg">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-t2">
                {roleLabel(m.role)}
                <span className="font-normal text-t3 font-mono">{m.id}</span>
              </div>
              {m.ranges?.map((r) => (
                <div key={`${r.start}-${r.end}`} className="mt-1">
                  <div className="text-[11px] text-t3">
                    {t('sessions:evidence.excerpt', { coords: `[${r.start}, ${r.end})` })}
                  </div>
                  <pre className="mt-[2px] px-2.5 py-1 bg-inp border border-brd rounded-[5px] text-[12px] text-t1 font-mono whitespace-pre-wrap break-words">
                    {r.text}
                  </pre>
                </div>
              ))}
              {m.rawRecords.length > 0 ? (
                <pre
                  className="mt-1 px-2.5 py-1 bg-inp border border-brd rounded-[5px] text-[11px] text-t1 font-mono whitespace-pre-wrap break-all"
                  data-testid="evidence-raw-records"
                >
                  {m.rawRecords.join('\n')}
                </pre>
              ) : (
                <div className="mt-1 text-[11px] text-t3">
                  {t('sessions:evidence.noRawRecords')}
                </div>
              )}
            </div>
          ))}
          {record.assets.length > 0 && (
            <div className="mb-2.5 px-3 py-2.5 bg-surf border border-brd rounded-lg">
              <div className="text-[11px] font-semibold text-t2">
                {t('sessions:evidence.assets', { count: record.assets.length })}
              </div>
              {record.assets.map((a) => (
                <div key={a.file} className="text-[11px] text-t3 truncate" title={a.file}>
                  {a.file} · {a.digest.slice(0, 12)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
