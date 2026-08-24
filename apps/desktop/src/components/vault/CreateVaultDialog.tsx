import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import type { BranchStrategy } from '@/services/gitService';
import { isTauri } from '@/utils/platform';
import githubIcon from '@/assets/icons/github.svg';

interface CreateVaultDialogProps {
  onClose: () => void;
}

type ProviderOption = 'tauri' | 'github';
type AuthMethod = 'https-public' | 'https-private' | 'ssh';

const PROVIDER_OPTIONS: { value: ProviderOption; label: string; desc: string }[] = [
  { value: 'tauri', label: '本地文件', desc: '直接操作本地文件系统' },
  { value: 'github', label: 'GitHub 仓库', desc: 'Clone 仓库到本地，后续基于本地文件操作' },
];

/** Repo name from a GitHub URL's last path segment (strips trailing .git). */
function repoNameFromUrl(repoUrl: string): string {
  const trimmed = repoUrl.trim();
  if (!trimmed) return '';
  const last = trimmed.split(/[/:]/).filter(Boolean).pop() ?? '';
  return last.replace(/\.git$/, '');
}

/** Default local clone path `~/folyn/<repo-name>` derived from a repo URL. */
function repoDefaultPath(repoUrl: string): string {
  const name = repoNameFromUrl(repoUrl);
  return name ? `~/folyn/${name}` : '';
}

export function CreateVaultDialog({ onClose }: CreateVaultDialogProps) {
  const addVault = useVaultStore((s) => s.addVault);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [providerType, setProviderType] = useState<ProviderOption>('tauri');
  const [basePath, setBasePath] = useState('');
  const [basePathTouched, setBasePathTouched] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  // GitHub-specific fields
  const [repoUrl, setRepoUrl] = useState('');
  const [auth, setAuth] = useState<AuthMethod>('https-public');
  const [token, setToken] = useState('');
  const [branchMode, setBranchMode] = useState<'default' | 'new-branch'>('default');
  const [branchName, setBranchName] = useState('');

  const isGithub = providerType === 'github';
  const needsToken = isGithub && auth === 'https-private';

  // Auto-derive vault name and clone path from repo URL until the user edits them.
  useEffect(() => {
    if (!isGithub || nameTouched) return;
    const derived = repoNameFromUrl(repoUrl);
    setName(derived);
  }, [repoUrl, isGithub, nameTouched]);

  useEffect(() => {
    if (!isGithub || basePathTouched) return;
    setBasePath(repoDefaultPath(repoUrl));
  }, [repoUrl, isGithub, basePathTouched]);

  const handleBrowse = async () => {
    if (!isTauri()) return;
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false });
    if (!picked || Array.isArray(picked)) return;
    setBasePath(picked as string);
    setBasePathTouched(true);
  };

  const handleCreate = async () => {
    const finalName = name.trim() || (isGithub ? repoNameFromUrl(repoUrl) : '');
    if (!finalName) {
      setError('请输入 Vault 名称');
      return;
    }
    if (isGithub) {
      if (!repoUrl.trim()) {
        setError('请输入 GitHub 仓库 URL');
        return;
      }
      if (needsToken && !token.trim()) {
        setError('私有仓库需要填写 Personal Access Token');
        return;
      }
      if (branchMode === 'new-branch' && !branchName.trim()) {
        setError('请输入新分支名称');
        return;
      }
    }

    setIsCreating(true);
    setError('');
    try {
      const options: Record<string, unknown> | undefined = isGithub
        ? {
            repoUrl: repoUrl.trim(),
            auth,
            token: needsToken ? token.trim() : undefined,
            branchStrategy: {
              mode: branchMode,
              branch: branchMode === 'new-branch' ? branchName.trim() : undefined,
            } satisfies BranchStrategy,
          }
        : undefined;

      await addVault({
        name: finalName,
        providerType,
        basePath: basePath.trim() || (isGithub ? repoDefaultPath(repoUrl) : finalName.toLowerCase().replace(/\s+/g, '-')),
        options,
      });
      onClose();
    } catch (err) {
      let errorMessage = '创建失败';
      if (err instanceof Error) {
        // Extract "message" field from JSON error body if present
        try {
          const parsed = JSON.parse(err.message.replace(/^\d+:\s*/, ''));
          errorMessage = parsed.message || err.message;
        } catch {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="dlg-overlay" onClick={onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-hd">
          <h3>新建 Vault</h3>
          <button className="dlg-close" onClick={onClose}>✕</button>
        </div>

        <div className="dlg-body">
          {/* Vault Name */}
          <label className="dlg-label">Vault 名称</label>
          <input
            className="dlg-input"
            placeholder="如：My Notes、Work Docs（GitHub 类型留空则从 URL 派生）"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            autoCapitalize="off"
          />

          {/* Provider Type */}
          <label className="dlg-label">存储类型</label>
          <div className="dlg-provider-grid">
            {PROVIDER_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                className={`dlg-provider-card ${providerType === opt.value ? 'active' : ''}`}
                onClick={() => setProviderType(opt.value)}
              >
                <div className="dlg-provider-label">
                  {opt.value === 'github'
                    ? <img src={githubIcon} className="dlg-provider-icon" alt="" />
                    : <FolderOpen size={16} className="dlg-provider-icon" />}
                  <span>{opt.label}</span>
                </div>
                <div className="dlg-provider-desc">{opt.desc}</div>
              </div>
            ))}
          </div>

          {isGithub && (
            <>
              <label className="dlg-label">仓库 URL</label>
              <input
                className="dlg-input"
                placeholder="https://github.com/owner/repo  或  git@github.com:owner/repo.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />

              <label className="dlg-label">鉴权方式</label>
              <select
                className="dlg-input"
                value={auth}
                onChange={(e) => setAuth(e.target.value as AuthMethod)}
              >
                <option value="https-public">HTTPS（公开仓库）</option>
                <option value="https-private">HTTPS + PAT（私有仓库）</option>
                <option value="ssh">SSH（本机已配 ssh-agent）</option>
              </select>

              {needsToken && (
                <>
                  <label className="dlg-label">Personal Access Token</label>
                  <input
                    className="dlg-input"
                    type="password"
                    placeholder="ghp_xxx（明文存本地 DB）"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </>
              )}

              <label className="dlg-label">分支策略</label>
              <select
                className="dlg-input"
                value={branchMode}
                onChange={(e) => setBranchMode(e.target.value as 'default' | 'new-branch')}
              >
                <option value="default">默认分支（clone 仓库主干）</option>
                <option value="new-branch">新建分支（clone 后 checkout -b）</option>
              </select>

              {branchMode === 'new-branch' && (
                <>
                  <label className="dlg-label">新分支名称</label>
                  <input
                    className="dlg-input"
                    placeholder="如：feature-notes"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                </>
              )}
            </>
          )}

          {/* Base Path */}
          <label className="dlg-label">{isGithub ? '本地 clone 目录' : '目录路径'}</label>
          <div className="dlg-input-group">
            <input
              className="dlg-input dlg-input-flex"
              placeholder={isGithub ? '留空默认 ~/folyn/<仓库名>' : '如：~/folyn/my-notes'}
              value={basePath}
              onChange={(e) => { setBasePath(e.target.value); setBasePathTouched(true); }}
              autoCapitalize="off"
            />
            <button
              type="button"
              className="dlg-input-btn"
              onClick={handleBrowse}
              disabled={!isTauri()}
              title={isTauri() ? '浏览选择目录' : '仅桌面端可用'}
            >浏览</button>
          </div>

          {error && <div className="dlg-error">{error}</div>}
        </div>

        <div className="dlg-ft">
          <button className="btn btn-g btn-sm" onClick={onClose} disabled={isCreating}>
            取消
          </button>
          <button className="btn btn-p btn-sm" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (isGithub ? '克隆中...' : '创建中...') : (isGithub ? 'Clone 并创建' : '创建 Vault')}
          </button>
        </div>
      </div>
    </div>
  );
}
