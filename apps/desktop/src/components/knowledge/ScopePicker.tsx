import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, Folder, Minus, Search, X } from 'lucide-react';
import { isSupportedSourcePath } from '@/services/knowledge/knowledgeBuild';
import { isRowInScope, type TreeRow } from './kbUi';
import { FileIcon } from '@/components/icons/FileIcon';
import './ScopePicker.css';

export function ScopePicker({ rows, scope, onChange, disabled = false }: { rows: TreeRow[]; scope: string[]; onChange: (scope: string[]) => void; disabled?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [searchCollapsed, setSearchCollapsed] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const search = query.trim().toLocaleLowerCase();
  const hiddenFolders = search ? searchCollapsed : collapsed;
  const visible = rows.filter((row) => (!search || `${row.name} ${row.path}`.toLocaleLowerCase().includes(search))
    && !Array.from(hiddenFolders).some((path) => row.path.startsWith(`${path}/`)));
  const toggleFolder = (path: string) => (search ? setSearchCollapsed : setCollapsed)((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  return <div className="kb-scope-picker">
    <div className="kb-scope-search">
      <Search size={15} strokeWidth={1.5} aria-hidden="true" />
      <input ref={searchRef} aria-label={t('knowledge:scopePicker.searchLabel')} placeholder={t('knowledge:scopePicker.searchPlaceholder')} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSearchCollapsed(new Set()); }} />
      {query && <button type="button" className="kb-scope-clear" aria-label={t('knowledge:scopePicker.clearSearch')} onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={13} strokeWidth={1.5} /></button>}
    </div>
    <div className="kb-scope-context"><span>{t('knowledge:scopePicker.currentVault')}</span><span>{search ? t('knowledge:scopePicker.matchCount', { count: visible.length }) : t('knowledge:scopePicker.selectableCount', { count: rows.filter((row) => row.type === 'file' && isSupportedSourcePath(row.path)).length })}</span></div>
    <div className="kb-scope-list">
      {rows.length === 0 && <div className="kb-scope-empty"><Folder size={22} strokeWidth={1.5} aria-hidden="true" /><p>{t('knowledge:scopePicker.emptyVaultTitle')}</p><span>{t('knowledge:scopePicker.emptyVaultHint')}</span></div>}
      {visible.length === 0 && rows.length > 0 && <div className="kb-scope-empty"><Search size={22} strokeWidth={1.5} aria-hidden="true" /><p>{t('knowledge:scopePicker.noMatchTitle')}</p><span>{t('knowledge:scopePicker.noMatchHint')}</span><button type="button" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>{t('knowledge:scopePicker.clearSearch')}</button></div>}
      {visible.map((row) => {
        const supported = row.type === 'dir' || isSupportedSourcePath(row.path);
        const selected = supported && isRowInScope(row, scope);
        const parent = scope.find((path) => path !== row.path && row.path.startsWith(`${path}/`));
        const partial = row.type === 'dir' && !selected && scope.some((path) => path.startsWith(`${row.path}/`));
        const meta = !supported ? t('knowledge:scopePicker.unsupported') : parent ? t('knowledge:scopePicker.inherited') : row.type === 'dir' ? t('knowledge:scopePicker.entireDir') : row.name.split('.').pop()?.toUpperCase();
        const Row = row.type === 'dir' ? 'div' : 'label';
        const expanded = !hiddenFolders.has(row.path);
        return <Row key={row.path} title={parent ? t('knowledge:scopePicker.rowInheritedTitle', { path: row.path, parent }) : row.path} className={`kb-scope-row${row.type === 'dir' ? ' is-directory' : ''}${selected ? ' is-selected' : ''}${partial ? ' is-partial' : ''}${!supported ? ' is-unsupported' : ''}${parent ? ' is-inherited' : ''}`} style={{ paddingInlineStart: `${12 + row.depth * 16}px` }}>
          {Array.from({ length: row.depth }, (_, depth) => <span key={depth} className="kb-scope-guide" style={{ insetInlineStart: `${12 + depth * 16 + 7}px` }} aria-hidden="true" />)}
          <span className="kb-scope-check"><input ref={(input) => { if (input) input.indeterminate = partial; }} type="checkbox" aria-label={`${row.name} ${meta}`} checked={selected} disabled={disabled || !supported || !!parent} onChange={() => onChange(scope.includes(row.path) ? scope.filter((p) => p !== row.path) : [...scope.filter((p) => !p.startsWith(`${row.path}/`)), row.path])} /><span aria-hidden="true">{partial ? <Minus size={11} strokeWidth={2} /> : <Check size={11} strokeWidth={2} />}</span></span>
          {row.type === 'dir' ? <button type="button" className="kb-scope-folder" aria-expanded={expanded} onClick={() => toggleFolder(row.path)}>
            {expanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
            <span className="kb-scope-file-icon" aria-hidden="true"><FileIcon filename={row.name} isDir /></span>
            <span className="kb-scope-name">{row.name}</span><span className="kb-scope-meta">{meta}</span>
          </button> : <>
            <span className="kb-scope-file-icon" aria-hidden="true"><FileIcon filename={row.name} /></span>
            <span className="kb-scope-row-copy"><span className="kb-scope-name">{row.name}</span><span className="kb-scope-meta">{meta}</span></span>
          </>}
        </Row>;
      })}
    </div>
    <div className="kb-scope-footer"><span>{t('knowledge:scopePicker.selectedPrefix')} <strong>{scope.length}</strong> {t('knowledge:scopePicker.selectedSuffix')}</span><span>{t('knowledge:scopePicker.dirsInclude')}</span></div>
  </div>;
}
