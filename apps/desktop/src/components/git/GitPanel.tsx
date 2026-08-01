import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVaultStore } from '@/store/vaultStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { findMatchedPattern } from '@/utils/excludePattern';
import {
  getStatus,
  pullRepo,
  commitAndPush,
  ensureGitignoreEntries,
  resolveAbsPath,
} from '@/services/gitService';

interface GitPanelProps {
  onClose: () => void;
}

type FileKind = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'conflict';

interface ParsedFile {
  path: string;
  kind: FileKind;
}

interface ParsedStatus {
  clean: boolean;
  counts: Record<FileKind, number>;
  total: number;
  files: ParsedFile[];
  raw: string;
}

/**
 * ponytail: parse `git status --short` lines into a plain-language list.
 * XY is the two-char code; the X/Y chars cover the cases Quill vaults
 * actually produce (no rename source detection — `R ` paths are "renamed").
 */
function parseGitStatus(raw: string): ParsedStatus {
  const counts: Record<FileKind, number> = {
    modified: 0, added: 0, deleted: 0, untracked: 0, renamed: 0, conflict: 0,
  };
  const files: ParsedFile[] = [];
  const lines = raw.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  for (const line of lines) {
    if (!line) continue;
    const xy = line.slice(0, 2);
    const path = line.slice(3).trim();
    let kind: FileKind;
    if (xy === '??') kind = 'untracked';
    else if (xy[0] === 'U' || xy[1] === 'U' || xy === 'AA' || xy === 'DD') kind = 'conflict';
    else if (xy[0] === 'A' || xy[1] === 'A') kind = 'added';
    else if (xy[0] === 'D' || xy[1] === 'D') kind = 'deleted';
    else if (xy[0] === 'R' || xy[0] === 'C') kind = 'renamed';
    else kind = 'modified';
    counts[kind] += 1;
    files.push({ path, kind });
  }
  const total = files.length;
  return { clean: total === 0, counts, total, files, raw };
}

const GROUP_ORDER: FileKind[] = [
  'conflict', 'modified', 'added', 'deleted', 'renamed', 'untracked',
];

/**
 * Git panel for the active GitHub vault. Plain-language status summary +
 * Pull / Commit & Push actions. Operations run via `gitService` (shell
 * plugin, scoped to the vault's local clone path).
 *
 * ponytail: modal dialog (dlg-overlay) reuses existing styling — no new
 * panel infrastructure. A side-popover would be nicer but costs more.
 */
export function GitPanel({ onClose }: GitPanelProps) {
  const { t } = useTranslation(['shell', 'common']);
  const currentVault = useVaultStore((s) => s.currentVault);
  const refreshFileTree = useVaultStore((s) => s.refreshFileTree);
  const excludePatternsRaw = useAppearanceStore((s) => s.excludePatterns);

  const [rawStatus, setRawStatus] = useState<string>('');
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<FileKind>>(new Set(['untracked']));
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null);
  const [ignoreBusyPath, setIgnoreBusyPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [absPath, setAbsPath] = useState<string>('');

  const parsed = useMemo(() => parseGitStatus(rawStatus), [rawStatus]);

  const excludePatterns = useMemo(
    () => (excludePatternsRaw || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('#')),
    [excludePatternsRaw],
  );

  const kindLabel = useCallback(
    (k: FileKind) => t(`shell:gitPanel.kind.${k}`),
    [t],
  );

  const refreshStatus = useCallback(async () => {
    if (!absPath) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const out = await getStatus(absPath);
      setRawStatus(out);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
      setRawStatus('');
    } finally {
      setStatusLoading(false);
    }
  }, [absPath]);

  useEffect(() => {
    if (!currentVault) return;
    resolveAbsPath(currentVault.basePath).then((p) => setAbsPath(p));
  }, [currentVault]);

  useEffect(() => {
    if (absPath) void refreshStatus();
  }, [absPath, refreshStatus]);

  // ponytail: auto-hide success info 3s after it's set; new info resets timer.
  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(null), 3000);
    return () => window.clearTimeout(timer);
  }, [info]);

  const handlePull = async () => {
    setBusy('pull');
    setError(null);
    setInfo(null);
    try {
      await pullRepo(absPath);
      setInfo(t('shell:gitPanel.pullDone'));
      await refreshStatus();
      await refreshFileTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleCommitPush = async () => {
    const msg = commitMsg.trim();
    if (!msg) {
      setError(t('shell:gitPanel.emptyCommitMsg'));
      return;
    }
    setBusy('push');
    setError(null);
    setInfo(null);
    try {
      await commitAndPush(absPath, msg);
      setInfo(t('shell:gitPanel.pushDone'));
      setCommitMsg('');
      await refreshStatus();
      await refreshFileTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAddToGitignore = async (filePath: string, pattern: string) => {
    setIgnoreBusyPath(filePath);
    setError(null);
    setInfo(null);
    try {
      await ensureGitignoreEntries(absPath, [pattern]);
      setInfo(t('shell:gitPanel.gitignoreAdded', { pattern }));
      await refreshStatus();
      await refreshFileTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIgnoreBusyPath(null);
    }
  };

  if (!currentVault) return null;

  const summaryParts = (Object.keys(parsed.counts) as FileKind[])
    .filter((k) => parsed.counts[k] > 0)
    .map((k) => `${kindLabel(k)} ${parsed.counts[k]}`);

  return (
    <div className="dlg-overlay" onClick={onClose}>
      <div
        className="dlg"
        onClick={(e) => e.stopPropagation()}
        style={{
          height: '65vh', display: 'flex', flexDirection: 'column',
          width: 'max-content', minWidth: 480, maxWidth: '92vw',
        }}
      >
        <div className="dlg-hd">
          <h3>{t('shell:gitPanel.title', { name: currentVault.name })}</h3>
          <button className="dlg-close" onClick={onClose}>✕</button>
        </div>

        <div className="dlg-body" style={{ overflow: 'auto', flexGrow: 1, minHeight: 0 }}>
          {/* 状态 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            background: 'var(--bg-muted, #f1f5f9)', padding: '4px 8px', borderRadius: 4,
          }}>
            <div className="dlg-label" style={{ margin: 0, fontSize: 13, textTransform: 'none' }}>
              {t('shell:gitPanel.localChanges')}
            </div>
            <button
              className="btn btn-p btn-sm"
              onClick={() => void refreshStatus()}
              disabled={busy !== null}
            >
              {t('shell:gitPanel.refresh')}
            </button>
          </div>
          {statusLoading ? (
            <div style={{ color: 'var(--fg-muted, #888)', padding: '8px 0' }}>
              {t('common:common.loading')}
            </div>
          ) : statusError ? (
            <div className="dlg-error">{statusError}</div>
          ) : parsed.clean ? (
            <div style={{ color: 'var(--ok, #16a34a)', padding: '8px 0' }}>
              {t('shell:gitPanel.clean')}
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowFiles((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                  padding: '4px 0', fontWeight: 500, background: 'none', border: 'none',
                  cursor: 'pointer', color: 'inherit', fontSize: 12,
                }}
              >
                <span>{showFiles ? '▾' : '▸'}</span>
                <span>{t('shell:gitPanel.filesChanged', { total: parsed.total })}</span>
                {summaryParts.length > 0 && (
                  <span style={{ color: 'var(--fg-muted, #888)', fontWeight: 400 }}>
                    （{summaryParts.join(' · ')}）
                  </span>
                )}
              </button>
              {showFiles && (
                <div style={{ margin: '6px 0 0' }}>
                  {GROUP_ORDER
                    .filter((k) => parsed.counts[k] > 0)
                    .map((k) => (
                      <div key={k} style={{ marginBottom: 8 }}>
                        <button
                          onClick={() => setCollapsedGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            return next;
                          })}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                            fontSize: 11, fontWeight: 600, color: 'var(--t2, #475569)',
                            padding: '2px 0', borderBottom: '1px solid var(--brd, #e2e8f0)',
                            background: 'none', border: 'none', borderBottomWidth: 1,
                            borderBottomStyle: 'solid', borderBottomColor: 'var(--brd, #e2e8f0)',
                            cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          <span>{collapsedGroups.has(k) ? '▸' : '▾'}</span>
                          <span>{kindLabel(k)} · {parsed.counts[k]}</span>
                        </button>
                        {!collapsedGroups.has(k) && (
                          <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
                            {parsed.files
                              .filter((f) => f.kind === k)
                              .map((f, i) => {
                                const matchedPattern = findMatchedPattern(f.path, excludePatterns);
                                return (
                                  <li
                                    key={i}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 6,
                                      fontFamily: 'var(--mono, monospace)', fontSize: 11,
                                      padding: '2px 0', wordBreak: 'break-all', color: 'var(--t1, #1e293b)',
                                    }}
                                  >
                                    <span style={{ flex: 1 }}>{f.path}</span>
                                    {matchedPattern && (
                                      <button
                                        className="btn btn-sm"
                                        onClick={() => void handleAddToGitignore(f.path, matchedPattern)}
                                        disabled={busy !== null || ignoreBusyPath === f.path}
                                        style={{
                                          flex: '0 0 auto', fontSize: 10, padding: '1px 6px',
                                          whiteSpace: 'nowrap',
                                        }}
                                        title={t('shell:gitPanel.addToGitignore')}
                                      >
                                        {t('shell:gitPanel.addToGitignore')}
                                      </button>
                                    )}
                                  </li>
                                );
                              })}
                          </ul>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </>
          )}

          {/* 拉取 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 16,
            background: 'var(--bg-muted, #f1f5f9)', padding: '4px 8px', borderRadius: 4,
          }}>
            <div className="dlg-label" style={{ margin: 0, fontSize: 13, textTransform: 'none' }}>
              {t('shell:gitPanel.pull')}
            </div>
            <button
              className="btn btn-p btn-sm"
              onClick={() => void handlePull()}
              disabled={busy !== null}
            >
              {busy === 'pull' ? t('shell:gitPanel.pullBusy') : t('shell:gitPanel.pullBtn')}
            </button>
          </div>
          <div style={{ color: 'var(--fg-muted, #888)', fontSize: 12, marginBottom: 6, marginTop: 4 }}>
            {t('shell:gitPanel.pullHint')}
          </div>

          {/* 提交并推送 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 16,
            background: 'var(--bg-muted, #f1f5f9)', padding: '4px 8px', borderRadius: 4,
          }}>
            <div className="dlg-label" style={{ margin: 0, fontSize: 13, textTransform: 'none' }}>
              {t('shell:gitPanel.commitPush')}
            </div>
            <button
              className="btn btn-p btn-sm"
              onClick={() => void handleCommitPush()}
              disabled={busy !== null}
            >
              {busy === 'push' ? t('shell:gitPanel.pushBusy') : t('shell:gitPanel.commitPushBtn')}
            </button>
          </div>
          <div style={{ color: 'var(--fg-muted, #888)', fontSize: 12, marginBottom: 6, marginTop: 4 }}>
            {t('shell:gitPanel.commitPushHint')}
          </div>
          <textarea
            className="dlg-input"
            style={{
              width: '100%', fontSize: 13, lineHeight: 1.5,
              padding: '8px 12px', boxSizing: 'border-box',
              minHeight: 60, resize: 'vertical', height: 'auto',
              display: 'block',
            }}
            placeholder={t('shell:gitPanel.placeholder')}
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
            rows={3}
          />

          {error && <div className="dlg-error">{error}</div>}
        </div>

        <div className="dlg-ft">
          <button className="btn btn-g btn-sm" onClick={onClose} disabled={busy !== null}>
            {t('common:common.close')}
          </button>
        </div>
      </div>

      {info && (
        <div
          style={{
            position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--panel, #fff)', color: 'var(--t1, #1e293b)',
            padding: '8px 16px', borderRadius: 8, fontSize: 14,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            border: '1px solid var(--brd, #e2e8f0)',
            display: 'flex', alignItems: 'center', gap: 8,
            zIndex: 1000, pointerEvents: 'none',
            animation: 'fadeIn .15s ease',
          }}
        >
          <span style={{ color: 'var(--ok, #16a34a)', fontWeight: 600 }}>✓</span>
          <span>{info}</span>
        </div>
      )}
    </div>
  );
}
