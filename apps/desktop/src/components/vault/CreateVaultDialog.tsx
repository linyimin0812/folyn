import { useState } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultConfig } from '@quill/vault-provider';

interface CreateVaultDialogProps {
  onClose: () => void;
}

const PROVIDER_OPTIONS: { value: VaultConfig['providerType']; label: string; desc: string }[] = [
  { value: 'tauri', label: '📂 本地文件', desc: '直接操作本地文件系统' },
];

export function CreateVaultDialog({ onClose }: CreateVaultDialogProps) {
  const addVault = useVaultStore((s) => s.addVault);
  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState<VaultConfig['providerType']>('tauri');
  const [basePath, setBasePath] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('请输入 Vault 名称');
      return;
    }

    setIsCreating(true);
    setError('');
    try {
      await addVault({
        name: trimmedName,
        providerType,
        basePath: basePath.trim() || trimmedName.toLowerCase().replace(/\s+/g, '-'),
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
            placeholder="如：My Notes、Work Docs"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
                <div className="dlg-provider-label">{opt.label}</div>
                <div className="dlg-provider-desc">{opt.desc}</div>
              </div>
            ))}
          </div>

          {/* Base Path */}
          <label className="dlg-label">目录路径</label>
          <input
            className="dlg-input"
            placeholder="如：~/quill/my-notes"
            value={basePath}
            onChange={(e) => setBasePath(e.target.value)}
            autoCapitalize="off"
          />

          {error && <div className="dlg-error">{error}</div>}
        </div>

        <div className="dlg-ft">
          <button className="btn btn-g btn-sm" onClick={onClose} disabled={isCreating}>
            取消
          </button>
          <button className="btn btn-p btn-sm" onClick={handleCreate} disabled={isCreating}>
            {isCreating ? '创建中...' : '创建 Vault'}
          </button>
        </div>
      </div>
    </div>
  );
}
