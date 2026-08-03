import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultEntry } from '@quill/vault-provider';
import { FileIcon } from '@/components/icons/FileIcon';

interface SaveMessageDialogProps {
  fileTree: VaultEntry[];
  defaultFilename: string;
  onCancel: () => void;
  onConfirmVault: (path: string) => Promise<void>;
  onConfirmExternal: (absolutePath: string) => Promise<void>;
}

interface DirRow {
  path: string;
  name: string;
  depth: number;
}

function collectDirs(entries: VaultEntry[], depth = 0, acc: DirRow[] = []): DirRow[] {
  for (const entry of entries) {
    if (entry.type === 'dir') {
      acc.push({ path: entry.path, name: entry.name, depth });
      if (entry.children) collectDirs(entry.children, depth + 1, acc);
    }
  }
  return acc;
}

export function SaveMessageDialog({
  fileTree,
  defaultFilename,
  onCancel,
  onConfirmVault,
  onConfirmExternal,
}: SaveMessageDialogProps) {
  const [selectedDir, setSelectedDir] = useState<string>('');
  const [filename, setFilename] = useState<string>(defaultFilename);
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();

  const dirs = useMemo(() => collectDirs(fileTree), [fileTree]);

  const trimmedName = filename.trim();
  const canConfirmVault = Boolean(trimmedName) && !saving && !trimmedName.includes('/');

  const handleConfirmVault = useCallback(async () => {
    if (!canConfirmVault) return;
    const path = trimmedName && selectedDir ? `${selectedDir}/${trimmedName}` : trimmedName;
    setSaving(true);
    try {
      await onConfirmVault(path);
    } finally {
      setSaving(false);
    }
  }, [canConfirmVault, trimmedName, selectedDir, onConfirmVault]);

  const handlePickExternal = useCallback(async () => {
    setSaving(true);
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const target = await save({
        defaultPath: defaultFilename,
        filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'Text', extensions: ['txt'] }],
      });
      if (!target) return;
      await onConfirmExternal(target);
    } catch (err) {
      console.warn('[ai] external save dialog failed:', err);
    } finally {
      setSaving(false);
    }
  }, [defaultFilename, onConfirmExternal]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center" onClick={onCancel}>
      <div
        className="bg-panel rounded-[10px] py-5 px-6 min-w-[360px] max-w-[460px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[15px] font-semibold text-t1 mb-3">{t('ai:panel.saveDialog.title')}</div>

        <div className="flex gap-1 mb-3 border border-brd rounded-md p-0.5">
          <button
            type="button"
            className="flex-1 py-1 px-2 text-[12px] rounded-[5px] transition-colors bg-act text-t1"
          >
            {t('ai:panel.saveDialog.tabVault')}
          </button>
          <button
            type="button"
            className="flex-1 py-1 px-2 text-[12px] rounded-[5px] transition-colors text-t3 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={saving}
            onClick={() => void handlePickExternal()}
          >
            {saving ? t('ai:panel.saveDialog.saving') : t('ai:panel.saveDialog.tabExternal')}
          </button>
        </div>

        <div className="max-h-[42vh] overflow-y-auto py-1 mb-3 border border-brd rounded-md">
          <button
            type="button"
            className={`w-full text-left py-1 px-3 text-[12px] cursor-pointer border-none ${selectedDir === '' ? 'bg-act text-t1' : 'text-t2 hover:bg-hov hover:text-t1'}`}
            style={{ paddingLeft: '12px' }}
            onClick={() => setSelectedDir('')}
          >
            <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}><FileIcon filename="" isDir /></span>
            {t('ai:panel.saveDialog.vaultRoot')}
          </button>
          {dirs.map((d) => (
            <button
              key={d.path}
              type="button"
              className={`w-full text-left py-1 px-3 text-[12px] cursor-pointer border-none ${selectedDir === d.path ? 'bg-act text-t1' : 'text-t2 hover:bg-hov hover:text-t1'}`}
              style={{ paddingLeft: `${12 + d.depth * 14}px` }}
              onClick={() => setSelectedDir(d.path)}
            >
              <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}><FileIcon filename="" isDir /></span>
              {d.name}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-1 mb-4">
          <label className="text-[11px] text-t3">{t('ai:panel.saveDialog.filename')}</label>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleConfirmVault(); } }}
            placeholder="file.md"
            className="py-1.5 px-2.5 text-[13px] bg-surf border border-brd rounded-md text-t1 outline-none focus:border-acc"
            autoFocus
          />
          <div className="text-[10px] text-t3">
            {selectedDir
              ? `${t('ai:panel.saveDialog.pathPrefix')}：${selectedDir}/${trimmedName}`
              : `${t('ai:panel.saveDialog.pathPrefix')}：${trimmedName}`}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov" onClick={onCancel}>{t('ai:panel.saveDialog.cancel')}</button>
          <button
            className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-acc font-ui transition-all duration-[140ms] bg-acc text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!canConfirmVault}
            onClick={() => void handleConfirmVault()}
          >
            {saving ? t('ai:panel.saveDialog.saving') : t('ai:panel.saveDialog.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
