import { useState, useCallback } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { CreateVaultDialog } from '../vault/CreateVaultDialog';
import { FileIcon } from '@/components/icons/FileIcon';
import type { VaultEntry } from '@quill/vault-provider';

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="dlg-overlay" onClick={onCancel}>
      <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="dlg-hd">
          <h3>确认删除</h3>
          <button className="dlg-close" onClick={onCancel}>✕</button>
        </div>
        <div className="dlg-body">
          <p style={{ margin: '8px 0', lineHeight: 1.6 }}>{message}</p>
        </div>
        <div className="dlg-ft">
          <button className="btn btn-g btn-sm" onClick={onCancel}>取消</button>
          <button className="btn btn-sm" onClick={onConfirm} style={{ background: 'var(--danger, #e53935)', color: '#fff' }}>删除</button>
        </div>
      </div>
    </div>
  );
}

const PROVIDER_ICONS: Record<string, string> = {
  local: '💾',
  server: '🖥',
  github: '🐙',
  webdav: '☁️',
  s3: '🪣',
  custom: '🔧',
};

function formatDate(date?: Date): string {
  if (!date) return '';
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString();
}

export function VaultPage() {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage);
  const vaults = useVaultStore((s) => s.vaults);
  const currentVault = useVaultStore((s) => s.currentVault);
  const fileTree = useVaultStore((s) => s.fileTree);
  const switchVault = useVaultStore((s) => s.switchVault);
  const removeVault = useVaultStore((s) => s.removeVault);
  const openFile = useEditorStore((s) => s.openFile);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    // Default expand first 3 levels of directories
    const dirs = new Set<string>();
    const collect = (entries: VaultEntry[], depth: number) => {
      if (depth >= 2) return;
      for (const entry of entries) {
        if (entry.type === 'dir') {
          dirs.add(entry.path);
          if (entry.children) collect(entry.children, depth + 1);
        }
      }
    };
    collect(fileTree, 0);
    return dirs;
  });

  const handleDeleteVault = useCallback((id: string) => {
    setDeleteConfirmId(id);
  }, []);

  const confirmDeleteVault = useCallback(() => {
    if (deleteConfirmId) {
      removeVault(deleteConfirmId);
      setDeleteConfirmId(null);
    }
  }, [deleteConfirmId, removeVault]);

  const openEditorWithFirstFile = async () => {
    const { tabs } = useEditorStore.getState();
    if (tabs.length === 0 && fileTree.length > 0) {
      const firstFile = fileTree.find((entry) => entry.type === 'file');
      if (firstFile) {
        await openFile(firstFile.path, firstFile.name);
      }
    }
    setCurrentPage('editor');
  };

  const handleSwitchOrOpen = async (vaultId: string) => {
    if (currentVault?.id === vaultId) {
      // Already selected — open editor with first file
      await openEditorWithFirstFile();
    } else {
      // Switch vault and stay on vault page to browse files
      await switchVault(vaultId);
    }
  };

  const handleFileClick = (filePath: string, fileName: string) => {
    openFile(filePath, fileName);
    setCurrentPage('editor');
  };

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (prev.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const renderFileEntries = (entries: VaultEntry[], depth = 0) => {
    return entries.map((entry) => {
      const isExpanded = expandedDirs.has(entry.path);
      const children = entry.children || [];
      return (
        <div key={entry.path}>
          <div
            className="fe-row"
            onClick={() => entry.type === 'dir' ? handleToggleDir(entry.path) : handleFileClick(entry.path, entry.name)}
            style={{ cursor: 'pointer', paddingLeft: `${13 + depth * 16}px` }}
          >
            <span className="fe-ri">
              <FileIcon filename={entry.name} isDir={entry.type === 'dir'} />
            </span>
            <span className="fe-rn">{entry.name}</span>
            <span className="fe-rm">
              {entry.type === 'dir'
                ? (isExpanded ? '▾' : '▸')
                : formatDate(entry.lastModified)}
            </span>
          </div>
          {entry.type === 'dir' && isExpanded && children.length > 0 && renderFileEntries(children, depth + 1)}
          {entry.type === 'dir' && isExpanded && children.length === 0 && (
            <div className="fe-row" style={{ paddingLeft: `${13 + (depth + 1) * 16}px`, color: 'var(--t3)', fontSize: 11 }}>
              空文件夹
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="vault-page">
      {/* Page header */}
      <div className="ph">
        <div className="ph-l">
          <div className="ph-sup">存储库</div>
          <h1>Vault 管理</h1>
          <p>管理本地知识库，切换工作上下文</p>
        </div>
        <div className="ph-r">
          <button className="btn btn-p btn-sm" onClick={() => setShowCreateDialog(true)}>
            + 新建 Vault
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="vc-wrap">
        <div className="sec-ttl">我的 VAULT</div>
        <div className="vc-grid">
          {vaults.map((vault) => {
            const isCurrent = currentVault?.id === vault.id;
            const icon = PROVIDER_ICONS[vault.providerType] || '📁';
            return (
              <div
                key={vault.id}
                className={`vc ${isCurrent ? 'curr' : ''}`}
                onClick={() => handleSwitchOrOpen(vault.id)}
                style={{ cursor: 'pointer' }}
              >
                {isCurrent && <div className="vc-badge">当前</div>}
                <div className="vc-top">
                  <div className="vc-ic">{icon}</div>
                  <div>
                    <div className="vc-nm">{vault.name}</div>
                    <div className="vc-path">{vault.basePath || vault.providerType}</div>
                  </div>
                </div>
                <div className="vc-stats">
                  <div className="vc-stat">
                    <strong>{vault.providerType}</strong> 类型
                  </div>
                </div>
                <div className="vc-acts">
                  {isCurrent && (
                    <button
                      className="btn btn-p btn-sm"
                      style={{ flex: 1 }}
                      onClick={(e) => { e.stopPropagation(); openEditorWithFirstFile(); }}
                    >
                      打开编辑器
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      className="btn btn-g btn-sm"
                      style={{ flex: 1 }}
                      onClick={(e) => { e.stopPropagation(); handleSwitchOrOpen(vault.id); }}
                    >
                      切换
                    </button>
                  )}
                  <button
                    className="btn btn-g btn-sm"
                    title="删除"
                    onClick={(e) => { e.stopPropagation(); handleDeleteVault(vault.id); }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}

          {/* New vault placeholder */}
          <div
            className="vc"
            style={{
              borderStyle: 'dashed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 6,
              minHeight: 110,
              color: 'var(--t3)',
              cursor: 'pointer',
            }}
            onClick={() => setShowCreateDialog(true)}
          >
            <div style={{ fontSize: 24, opacity: 0.3 }}>+</div>
            <div style={{ fontSize: 11 }}>新建 Vault</div>
          </div>
        </div>

        {currentVault && (
          <>
            <div className="sec-ttl">文件浏览 — {currentVault.name}</div>
            <div className="fe">
              <div className="fe-hd">
                <div className="fe-path">
                  <span>{currentVault.providerType}:</span>
                  <em>{currentVault.basePath || '/'}</em>
                </div>
              </div>
              {fileTree.length === 0 ? (
                <div className="fe-row" style={{ color: 'var(--t3)', justifyContent: 'center' }}>
                  暂无文件，在编辑器中创建新文档
                </div>
              ) : (
                renderFileEntries(fileTree)
              )}
            </div>
          </>
        )}
      </div>

      {showCreateDialog && (
        <CreateVaultDialog onClose={() => setShowCreateDialog(false)} />
      )}

      {deleteConfirmId && (
        <ConfirmDialog
          message={`确定要删除 Vault「${vaults.find((v) => v.id === deleteConfirmId)?.name || ''}」吗？此操作不会删除磁盘上的文件。`}
          onConfirm={confirmDeleteVault}
          onCancel={() => setDeleteConfirmId(null)}
        />
      )}
    </div>
  );
}
