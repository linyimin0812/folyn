import { useState } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@quill/vault-provider';

interface IngestDialogProps {
  onConfirm: (filePaths: string[]) => void;
  onCancel: () => void;
}

function flattenMdFiles(entries: VaultEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.path.endsWith('.md')) {
      result.push(entry.path);
    }
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenMdFiles(entry.children));
    }
  }
  return result;
}

export function IngestDialog({ onConfirm, onCancel }: IngestDialogProps) {
  const fileTree = useVaultStore((s) => s.fileTree);
  const allFiles = flattenMdFiles(fileTree);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const filtered = search
    ? allFiles.filter((f) => f.toLowerCase().includes(search.toLowerCase()))
    : allFiles;

  const toggleFile = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(filtered));
  const deselectAll = () => setSelected(new Set());

  return (
    <div className="dlg-overlay" onClick={onCancel}>
      <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <div className="dlg-hd">
          <h3>选择要摄入的文件</h3>
          <button className="dlg-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="dlg-body">
          <input
            className="dlg-input"
            placeholder="搜索文件..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="ingest-select-actions">
            <button onClick={selectAll}>全选</button>
            <button onClick={deselectAll}>全不选</button>
            <span className="ingest-count">已选 {selected.size} / {allFiles.length}</span>
          </div>
          <div className="ingest-file-list">
            {filtered.map((file) => (
              <label key={file} className="ingest-file-item">
                <input
                  type="checkbox"
                  checked={selected.has(file)}
                  onChange={() => toggleFile(file)}
                />
                <span>{file}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="dlg-footer">
          <button className="dlg-btn" onClick={onCancel}>取消</button>
          <button
            className="dlg-btn primary"
            onClick={() => onConfirm(Array.from(selected))}
            disabled={selected.size === 0}
          >
            摄入 ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
