import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KbLanguage } from '@/services/knowledge/kbTypes';
import { ArrowRight, Layers3, Loader2, X } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { expandScope } from '@/services/knowledge/knowledgeBuild';
import { BTN, BTN_PRIMARY, INPUT, buildRows } from './kbUi';
import { ScopePicker } from './ScopePicker';
import { useThemeUiStore } from './themeUiStore';

export function ThemeDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const open = useThemeUiStore((s) => s.createOpen);
  const setOpen = useThemeUiStore((s) => s.setCreateOpen);
  const createTheme = useKnowledgeStore((s) => s.createTheme);
  const vaultId = useVaultStore((s) => s.activeVaultId);
  const openedVault = useRef(vaultId);
  const fileTree = useVaultStore((s) => s.fileTree);
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [scope, setScope] = useState<string[]>([]);
  const [language, setLanguage] = useState<KbLanguage>('auto');
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => buildRows(fileTree), [fileTree]);
  const count = useMemo(() => expandScope(scope, rows).length, [scope, rows]);
  useEffect(() => {
    if (open) {
      setName(''); setGoal(''); setScope([]); setLanguage('auto'); setPicker(false); setError('');
      if (!dialog.current?.open) dialog.current?.showModal();
      nameInput.current?.focus();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => {
    if (openedVault.current !== vaultId) { openedVault.current = vaultId; setOpen(false); }
  }, [vaultId, setOpen]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!name.trim() || !goal.trim()) { setError(t('knowledge:themeDialog.errorRequired')); return; }
    setSaving(true); setError('');
    const result = await createTheme({ name: name.trim(), goal: goal.trim(), scope, language });
    setSaving(false);
    if (useVaultStore.getState().activeVaultId !== vaultId) return;
    if (!result.ok) { setError(result.error); return; }
    setOpen(false);
  };
  return <dialog ref={dialog} className="kb-theme-dialog" aria-labelledby="kb-create-title" onCancel={(event) => { if (saving) event.preventDefault(); else setOpen(false); }} onClose={() => { if (!saving) setOpen(false); }}>
    <form onSubmit={(event) => void submit(event)}>
      <header className="kb-dialog-header"><div className="kb-dialog-heading"><span className="kb-dialog-icon"><Layers3 size={20} strokeWidth={1.5} /></span><button type="button" className="kb-icon-action" aria-label={t('knowledge:themeDialog.closeAria')} disabled={saving} onClick={() => setOpen(false)}><X size={17} /></button></div>
      <h2 id="kb-create-title">{t('knowledge:themeDialog.title')}</h2><p className="kb-dialog-description">{t('knowledge:themeDialog.description')}</p></header>
      <div className="kb-theme-form-body"><fieldset disabled={saving} className="kb-theme-form">
        <label>{t('knowledge:themeDialog.nameLabel')}<input ref={nameInput} className={INPUT} required value={name} onChange={(event) => setName(event.target.value)} placeholder={t('knowledge:themeDialog.namePlaceholder')} maxLength={100} /></label>
        <label>{t('knowledge:themeDialog.goalLabel')}<textarea className={`${INPUT} resize-none min-h-[68px]`} required value={goal} onChange={(event) => setGoal(event.target.value)} placeholder={t('knowledge:themeDialog.goalPlaceholder')} /></label>
        <label className="text-[12px] text-t2 flex flex-col gap-2">{t('knowledge:language.label')}<select className={INPUT} value={language} onChange={(event) => setLanguage(event.target.value as KbLanguage)}>
          <option value="auto">{t('knowledge:language.auto')}</option>
          <option value="zh">{t('knowledge:language.zh')}</option>
          <option value="en">{t('knowledge:language.en')}</option>
        </select></label>
        <div className="kb-create-sources"><div><span>{t('knowledge:themeDialog.sourcesTitle')}</span><span className="text-t3 text-[12px]">{count > 0 ? t('knowledge:themeDialog.sourcesCount', { count }) : t('knowledge:themeDialog.sourcesLater')}</span></div><button type="button" className={BTN} aria-expanded={picker} onClick={() => setPicker((value) => !value)}>{picker ? t('knowledge:themeDialog.collapse') : t('knowledge:themeDialog.pick')}</button></div>
        {picker && <ScopePicker rows={rows} scope={scope} onChange={setScope} disabled={saving} />}
        {error && <p role="alert" className="kb-form-error">{error}</p>}
      </fieldset></div>
      <footer className="kb-dialog-actions"><button type="button" className={BTN} disabled={saving} onClick={() => setOpen(false)}>{t('knowledge:themeDialog.cancel')}</button><button type="submit" className={BTN_PRIMARY} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}{t('knowledge:themeDialog.create')}</button></footer>
    </form>
  </dialog>;
}
