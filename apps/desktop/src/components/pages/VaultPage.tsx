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
      // Already selected -- open editor with first file
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
            className="fe-row flex items-center gap-[9px] py-2 px-[13px] border-b border-brd cursor-pointer transition-[background] duration-100 last:border-b-0 hover:bg-hov"
            onClick={() => entry.type === 'dir' ? handleToggleDir(entry.path) : handleFileClick(entry.path, entry.name)}
            style={{ cursor: 'pointer', paddingLeft: `${13 + depth * 16}px` }}
          >
            <span className="text-[13px] shrink-0">
              <FileIcon filename={entry.name} isDir={entry.type === 'dir'} />
            </span>
            <span className="text-xs text-t2 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
            <span className="text-[10px] text-t3 font-mono shrink-0">
              {entry.type === 'dir'
                ? (isExpanded ? '▾' : '▸')
                : formatDate(entry.lastModified)}
            </span>
          </div>
          {entry.type === 'dir' && isExpanded && children.length > 0 && renderFileEntries(children, depth + 1)}
          {entry.type === 'dir' && isExpanded && children.length === 0 && (
            <div className="fe-row flex items-center gap-[9px] py-2 px-[13px] border-b border-brd last:border-b-0" style={{ paddingLeft: `${13 + (depth + 1) * 16}px`, color: 'var(--t3)', fontSize: 11 }}>
              空文件夹
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="vault-page flex-1 flex flex-col overflow-hidden bg-surf">
      {/* Page header */}
      <div className="ph py-[18px] px-[22px] pb-3.5 border-b border-brd bg-panel shrink-0 flex items-start justify-between gap-3">
        <div>
          <div className="text-[9.5px] font-semibold text-t3 uppercase tracking-[.12em] mb-0.5">存储库</div>
          <h1 className="text-[19px] font-bold text-t1 tracking-[-0.02em] m-0">Vault 管理</h1>
          <p className="text-xs text-t2 mt-[3px]">管理本地知识库，切换工作上下文</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className="btn btn-p btn-sm" onClick={() => setShowCreateDialog(true)}>
            + 新建 Vault
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="py-[18px] px-5 overflow-y-auto flex-1">
        <div className="text-[10px] font-semibold text-t3 uppercase tracking-[.1em] mb-[9px]">我的 VAULT</div>
        <div className="vc-grid grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-[11px] mb-5">
          {vaults.map((vault) => {
            const isCurrent = currentVault?.id === vault.id;
            const icon = PROVIDER_ICONS[vault.providerType] || '📁';
            return (
              <div
                key={vault.id}
                className={`vc bg-card border rounded-[10px] p-[15px] cursor-pointer transition-all duration-100 relative overflow-hidden hover:translate-y-[-1px] hover:shadow-[0_4px_16px_rgba(0,0,0,.12)] ${isCurrent ? 'border-acc hover:border-acc' : 'border-brd2 hover:border-acc'}`}
                onClick={() => handleSwitchOrOpen(vault.id)}
                style={{ cursor: 'pointer' }}
              >
                {isCurrent && <div className="vc-curr-glow absolute inset-0 bg-accglow pointer-events-none rounded-[inherit]" />}
                {isCurrent && <div className="absolute top-2.5 right-2.5 text-[9px] bg-acc text-white py-0.5 px-1.5 rounded-lg font-semibold">当前</div>}
                <div className="flex items-center gap-[9px] mb-2">
                  <div className="w-[30px] h-[30px] rounded-[7px] shrink-0 bg-gradient-to-br from-acc to-acc2 flex items-center justify-center text-[15px]">{icon}</div>
                  <div>
                    <div className="text-[13px] font-semibold text-t1">{vault.name}</div>
                    <div className="text-[10px] text-t3 font-mono overflow-hidden text-ellipsis whitespace-nowrap">{vault.basePath || vault.providerType}</div>
                  </div>
                </div>
                <div className="flex gap-3 mt-2 pt-2 border-t border-brd">
                  <div className="text-[10.5px] text-t3">
                    <strong className="text-t2 font-medium">{vault.providerType}</strong> 类型
                  </div>
                </div>
                <div className="flex gap-[5px] mt-[9px]">
                  {isCurrent && (
                    <button
                      className="btn btn-p btn-sm flex-1"
                      onClick={(e) => { e.stopPropagation(); openEditorWithFirstFile(); }}
                    >
                      打开编辑器
                    </button>
                  )}
                  {!isCurrent && (
                    <button
                      className="btn btn-g btn-sm flex-1"
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
            className="vc bg-card border border-dashed border-brd2 rounded-[10px] flex items-center justify-center flex-col gap-1.5 min-h-[110px] text-t3 cursor-pointer transition-all duration-100 hover:border-acc hover:translate-y-[-1px]"
            onClick={() => setShowCreateDialog(true)}
          >
            <div style={{ fontSize: 24, opacity: 0.3 }}>+</div>
            <div style={{ fontSize: 11 }}>新建 Vault</div>
          </div>
        </div>

        {currentVault && (
          <>
            <div className="text-[10px] font-semibold text-t3 uppercase tracking-[.1em] mb-[9px]">文件浏览 — {currentVault.name}</div>
            <div className="fe bg-card border border-brd2 rounded-[10px] overflow-hidden">
              <div className="fe-hd py-[9px] px-[13px] border-b border-brd flex items-center justify-between bg-panel">
                <div className="font-mono text-[11px] text-t2">
                  <span>{currentVault.providerType}:</span>
                  <em className="text-acc not-italic">{currentVault.basePath || '/'}</em>
                </div>
              </div>
              {fileTree.length === 0 ? (
                <div className="fe-row flex items-center gap-[9px] py-2 px-[13px] justify-center" style={{ color: 'var(--t3)' }}>
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
