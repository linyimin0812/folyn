import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrefsStore } from '@/store/prefsStore';

export function FileTemplatesSettings() {
  const { t } = useTranslation();
  const fileTemplates = usePrefsStore((s) => s.fileTemplates);
  const setFileTemplates = usePrefsStore((s) => s.setFileTemplates);
  const [editingExt, setEditingExt] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newExt, setNewExt] = useState('');
  const newExtRef = useRef<HTMLInputElement>(null);

  const extensions = Object.keys(fileTemplates).sort();

  const startEdit = useCallback((ext: string) => {
    setEditingExt(ext);
    setEditContent(fileTemplates[ext] || '');
  }, [fileTemplates]);

  const saveEdit = useCallback(() => {
    if (editingExt === null) return;
    setFileTemplates({ ...fileTemplates, [editingExt]: editContent });
    setEditingExt(null);
    setEditContent('');
  }, [editingExt, editContent, fileTemplates, setFileTemplates]);

  const cancelEdit = useCallback(() => {
    setEditingExt(null);
    setEditContent('');
  }, []);

  const addTemplate = useCallback(() => {
    const ext = newExt.trim().replace(/^\./, '').toLowerCase();
    if (!ext || fileTemplates[ext] !== undefined) return;
    setFileTemplates({ ...fileTemplates, [ext]: '' });
    setNewExt('');
    startEdit(ext);
  }, [newExt, fileTemplates, setFileTemplates, startEdit]);

  const removeTemplate = useCallback((ext: string) => {
    const next = { ...fileTemplates };
    delete next[ext];
    setFileTemplates(next);
    if (editingExt === ext) cancelEdit();
  }, [fileTemplates, setFileTemplates, editingExt, cancelEdit]);

  return (
    <div className="mb-8">
      <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
        <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:templates.title')}</div>
        <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:templates.description')}</div>
      </div>

      {/* Template list */}
      <div className="flex flex-col gap-1 mb-3">
        {extensions.map((ext) => (
          <div
            key={ext}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${editingExt === ext ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
            onClick={() => startEdit(ext)}
          >
            <span className="text-xs font-mono font-semibold text-acc shrink-0">.{ext}</span>
            <span className="text-[11px] text-t3 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono">
              {fileTemplates[ext] ? fileTemplates[ext].slice(0, 60).replace(/\n/g, '\\n') : t('settings:templates.empty')}
            </span>
            <button
              className="text-[10px] text-t3 hover:text-[#e53935] shrink-0 bg-transparent border-none cursor-pointer p-1"
              onClick={(e) => { e.stopPropagation(); removeTemplate(ext); }}
              title={t('settings:templates.deleteTitle')}
            >
              ✕
            </button>
          </div>
        ))}
        {extensions.length === 0 && (
          <div className="text-xs text-t3 py-2">{t('settings:templates.emptyState')}</div>
        )}
      </div>

      {/* Add new template */}
      <div className="flex items-center gap-1.5 mb-4">
        <span className="text-xs text-t2">.</span>
        <input
          ref={newExtRef}
          className="fi2 py-[5px] px-2 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
          style={{ width: 100 }}
          value={newExt}
          onChange={(e) => setNewExt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTemplate(); }}
          placeholder={t('settings:templates.extPlaceholder')}
          autoCapitalize="off"
        />
        <button className="btn btn-p btn-sm" onClick={addTemplate}>{t('settings:templates.add')}</button>
      </div>

      {/* Editor */}
      {editingExt !== null && (
        <div className="mb-3">
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">
            {t('settings:templates.editTitle')}: <span className="font-mono text-acc">.{editingExt}</span>
          </div>
          <textarea
            className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
            rows={10}
            style={{ resize: 'vertical', lineHeight: 1.6, tabSize: 2 }}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
          />
          <div className="flex gap-1.5 mt-2">
            <button className="btn btn-p btn-sm" onClick={saveEdit}>{t('settings:templates.save')}</button>
            <button className="btn btn-g btn-sm" onClick={cancelEdit}>{t('settings:templates.cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
