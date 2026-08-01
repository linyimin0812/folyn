import { useCallback, useEffect, useState } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import {
  getStatus,
  pullRepo,
  commitAndPush,
  resolveAbsPath,
} from '@/services/gitService';

interface GitPanelProps {
  onClose: () => void;
}

/**
 * Git operations panel for the active GitHub vault. Shows `git status --short`,
 * plus pull and commit+push actions. All operations run via `gitService`
 * (shell plugin, scoped to the vault's local clone path).
 *
 * ponytail: modal dialog (dlg-overlay) reuses existing styling — no new
 * panel infrastructure. A side-popover would be nicer but costs more.
 */
export function GitPanel({ onClose }: GitPanelProps) {
  const currentVault = useVaultStore((s) => s.currentVault);
  const refreshFileTree = useVaultStore((s) => s.refreshFileTree);

  const [status, setStatus] = useState<string>('加载中…');
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState<'pull' | 'push' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [absPath, setAbsPath] = useState<string>('');

  const refreshStatus = useCallback(async () => {
    if (!absPath) return;
    try {
      const out = await getStatus(absPath);
      setStatus(out);
    } catch (err) {
      setStatus(`获取状态失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [absPath]);

  useEffect(() => {
    if (!currentVault) return;
    resolveAbsPath(currentVault.basePath).then((p) => {
      setAbsPath(p);
    });
  }, [currentVault]);

  useEffect(() => {
    if (absPath) void refreshStatus();
  }, [absPath, refreshStatus]);

  const handlePull = async () => {
    setBusy('pull');
    setError(null);
    setInfo(null);
    try {
      const res = await pullRepo(absPath);
      setInfo(`Pull 完成。${res.stdout ? res.stdout : ''}`.trim());
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
      setError('请输入提交信息');
      return;
    }
    setBusy('push');
    setError(null);
    setInfo(null);
    try {
      const res = await commitAndPush(absPath, msg);
      setInfo(`提交并推送完成。${res.stdout ? res.stdout : ''}`.trim());
      setCommitMsg('');
      await refreshStatus();
      await refreshFileTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (!currentVault) {
    return null;
  }

  return (
    <div className="dlg-overlay" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-hd">
          <h3>Git 操作 — {currentVault.name}</h3>
          <button className="dlg-close" onClick={onClose}>✕</button>
        </div>

        <div className="dlg-body">
          <label className="dlg-label">状态 (git status --short)</label>
          <pre
            className="dlg-input"
            style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', fontFamily: 'var(--mono, monospace)' }}
          >
            {status}
          </pre>
          <button
            className="btn btn-g btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => void refreshStatus()}
            disabled={busy !== null}
          >
            刷新状态
          </button>

          <label className="dlg-label" style={{ marginTop: 12 }}>拉取远程更新 (git pull)</label>
          <button
            className="btn btn-g btn-sm"
            onClick={() => void handlePull()}
            disabled={busy !== null}
          >
            {busy === 'pull' ? 'Pull 中…' : 'Pull'}
          </button>

          <label className="dlg-label" style={{ marginTop: 12 }}>提交并推送 (commit + push -u origin HEAD)</label>
          <input
            className="dlg-input"
            placeholder="提交信息"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            className="btn btn-p btn-sm"
            style={{ marginTop: 6 }}
            onClick={() => void handleCommitPush()}
            disabled={busy !== null}
          >
            {busy === 'push' ? '提交推送中…' : 'Commit & Push'}
          </button>

          {info && <div className="dlg-error" style={{ color: 'var(--ok, #16a34a)' }}>{info}</div>}
          {error && <div className="dlg-error">{error}</div>}
        </div>

        <div className="dlg-ft">
          <button className="btn btn-g btn-sm" onClick={onClose} disabled={busy !== null}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
