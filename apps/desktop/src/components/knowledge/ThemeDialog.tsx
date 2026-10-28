import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Layers3, Loader2, X } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { expandScope } from '@/services/knowledge/knowledgeBuild';
import { BTN, BTN_PRIMARY, INPUT, buildRows } from './kbUi';
import { ScopePicker } from './ScopePicker';
import { useThemeUiStore } from './themeUiStore';

export function ThemeDialog(): React.JSX.Element {
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
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => buildRows(fileTree), [fileTree]);
  const count = useMemo(() => expandScope(scope, rows).length, [scope, rows]);
  useEffect(() => {
    if (open) {
      setName(''); setGoal(''); setScope([]); setPicker(false); setError('');
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
    if (!name.trim() || !goal.trim()) { setError('请填写主题名称和整理目标。'); return; }
    setSaving(true); setError('');
    const result = await createTheme({ name: name.trim(), goal: goal.trim(), scope });
    setSaving(false);
    if (useVaultStore.getState().activeVaultId !== vaultId) return;
    if (!result.ok) { setError(result.error); return; }
    setOpen(false);
  };
  return <dialog ref={dialog} className="kb-theme-dialog" aria-labelledby="kb-create-title" onCancel={(event) => { if (saving) event.preventDefault(); else setOpen(false); }} onClose={() => { if (!saving) setOpen(false); }}>
    <form onSubmit={(event) => void submit(event)}>
      <header className="kb-dialog-header"><div className="kb-dialog-heading"><span className="kb-dialog-icon"><Layers3 size={20} strokeWidth={1.5} /></span><button type="button" className="kb-icon-action" aria-label="关闭新建主题" disabled={saving} onClick={() => setOpen(false)}><X size={17} /></button></div>
      <h2 id="kb-create-title">新建知识主题</h2><p className="kb-dialog-description">围绕一个方向积累知识。每个主题拥有独立的资料、知识页与问答。</p></header>
      <div className="kb-theme-form-body"><fieldset disabled={saving} className="kb-theme-form">
        <label>主题名称<input ref={nameInput} className={INPUT} required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：桌面应用开发" maxLength={100} /></label>
        <label>整理目标<textarea className={`${INPUT} resize-none min-h-[68px]`} required value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="希望从资料中理解什么、沉淀哪些经验？" /></label>
        <div className="kb-create-sources"><div><span>原始资料</span><span className="text-t3 text-[12px]">{count > 0 ? `已选 ${count} 份` : '可以稍后添加'}</span></div><button type="button" className={BTN} aria-expanded={picker} onClick={() => setPicker((value) => !value)}>{picker ? '收起文件列表' : '选择文件 / 目录'}</button></div>
        {picker && <ScopePicker rows={rows} scope={scope} onChange={setScope} disabled={saving} />}
        {error && <p role="alert" className="kb-form-error">{error}</p>}
      </fieldset></div>
      <footer className="kb-dialog-actions"><button type="button" className={BTN} disabled={saving} onClick={() => setOpen(false)}>取消</button><button type="submit" className={BTN_PRIMARY} disabled={saving}>{saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}创建主题</button></footer>
    </form>
  </dialog>;
}
