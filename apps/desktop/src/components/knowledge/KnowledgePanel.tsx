import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight, BookOpen, Check, ChevronDown, Layers3, Plus, Settings2 } from 'lucide-react';
import { FileIcon } from '@/components/icons/FileIcon';
import { useVaultStore } from '@/store/vaultStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { startKbAutoBuild, stopKbAutoBuild } from '@/services/knowledge/kbAutoBuild';
import { startKbIntentWatch, stopKbIntentWatch } from '@/services/knowledge/kbIntentWatch';
import { useThemeUiStore } from './themeUiStore';

export function KnowledgePanel(): React.JSX.Element {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const switcherRef = useRef<HTMLDivElement>(null);
  const currentVault = useVaultStore((state) => state.currentVault);
  const loaded = useKnowledgeStore((s) => s.loaded);
  const themes = useKnowledgeStore((s) => s.themes);
  const activeThemeId = useKnowledgeStore((s) => s.activeThemeId);
  const selectTheme = useKnowledgeStore((s) => s.selectTheme);
  const topics = useKnowledgeStore((s) => s.topics);
  const activeTpId = useKnowledgeStore((s) => s.activeTpId);
  const reviews = useKnowledgeStore((s) => s.reviews);
  const page = useKnowledgeStore((s) => s.page);
  const setActiveTopic = useKnowledgeStore((s) => s.setActiveTopic);
  const setPage = useKnowledgeStore((s) => s.setPage);
  const openSourceSettings = useKnowledgeStore((s) => s.openSourceSettings);
  const setCreateOpen = useThemeUiStore((s) => s.setCreateOpen);
  const failedCount = useKnowledgeStore((s) => s.buildItems.filter((item) => item.status === 'error').length);

  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) document.getElementById(`kb-theme-option-${highlighted}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [menuOpen, highlighted]);

  useEffect(() => {
    if (!currentVault) return;
    void useKnowledgeStore.getState().loadFromManifest();
    startKbAutoBuild(); startKbIntentWatch();
    return () => { stopKbAutoBuild(); stopKbIntentWatch(); };
  }, [currentVault]);

  const selectedTheme = themes.find((theme) => theme.id === activeThemeId);
  const openMenu = () => {
    setHighlighted(Math.max(0, themes.findIndex((theme) => theme.id === activeThemeId)));
    setMenuOpen(true);
  };
  const chooseTheme = (index: number) => {
    const theme = themes[index];
    if (!theme) return;
    setMenuOpen(false);
    if (theme.id !== activeThemeId) void selectTheme(theme.id);
  };

  return <div className="kb-sidebar flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
    <div className="kb-theme-switcher">
      <div className="kb-theme-switcher-heading">
        <span id="kb-theme-label">{t('knowledge:panel.themeLabel')}</span>
        <button className="kb-theme-create" aria-label={t('knowledge:panel.createTheme')} title={t('knowledge:panel.createTheme')} onClick={() => setCreateOpen(true)}><Plus size={14} /></button>
      </div>
      <div className="kb-theme-select-wrap" ref={switcherRef}>
        <button type="button" role="combobox" className="kb-theme-select-trigger" aria-labelledby="kb-theme-label kb-theme-value" aria-haspopup="listbox" aria-expanded={menuOpen} aria-controls={menuOpen ? 'kb-theme-options' : undefined} aria-activedescendant={menuOpen && themes[highlighted] ? `kb-theme-option-${highlighted}` : undefined} disabled={!loaded || themes.length === 0} onClick={() => menuOpen ? setMenuOpen(false) : openMenu()} onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) { event.preventDefault(); setMenuOpen(false); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!menuOpen) openMenu();
            else setHighlighted((index) => Math.max(0, Math.min(themes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
          } else if (menuOpen && (event.key === 'Home' || event.key === 'End')) {
            event.preventDefault(); setHighlighted(event.key === 'Home' ? 0 : themes.length - 1);
          } else if (menuOpen && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); chooseTheme(highlighted);
          } else if (event.key === 'Tab') setMenuOpen(false);
        }}>
          <span className="kb-theme-select-icon" aria-hidden="true"><Layers3 size={15} strokeWidth={1.6} /></span>
          <span id="kb-theme-value" className="kb-theme-select-value" title={selectedTheme?.name}>{selectedTheme?.name ?? (loaded ? t('knowledge:panel.noThemes') : t('knowledge:panel.loading'))}</span>
          <ChevronDown className="kb-theme-select-chevron" size={14} aria-hidden="true" />
        </button>
        {menuOpen && <div id="kb-theme-options" className="kb-theme-options" role="listbox" aria-label={t('knowledge:panel.themeLabel')}>
          {themes.map((theme, index) => <div key={theme.id} id={`kb-theme-option-${index}`} role="option" aria-selected={theme.id === activeThemeId} className={`kb-theme-option${index === highlighted ? ' is-highlighted' : ''}${theme.id === activeThemeId ? ' is-selected' : ''}`} onMouseEnter={() => setHighlighted(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseTheme(index)}>
            <span className="kb-theme-option-icon" aria-hidden="true"><Layers3 size={14} strokeWidth={1.6} /></span><span className="kb-theme-option-name" title={theme.name}>{theme.name}</span>{theme.id === activeThemeId && <Check size={14} aria-hidden="true" />}
          </div>)}
        </div>}
      </div>
    </div>
    <nav aria-label={t('knowledge:panel.navLabel')} className="kb-sidebar-nav">
      <button className={`kb-sidebar-overview${page === 'knowledge' && !activeTpId ? ' is-active' : ''}`} disabled={!activeThemeId} onClick={() => { setActiveTopic(null); setPage('knowledge'); }}><BookOpen size={14} strokeWidth={1.5} />{t('knowledge:panel.overview')}<span>{topics.length}</span></button>
      <div className="kb-sidebar-section-label">{t('knowledge:panel.pagesLabel')}</div>
      {!loaded ? <p className="kb-sidebar-hint">{t('knowledge:panel.loading')}</p> : topics.length === 0 ? <p className="kb-sidebar-hint">{activeThemeId ? t('knowledge:panel.hintTopics') : t('knowledge:panel.hintNoTheme')}</p> : <div className="kb-sidebar-pages">{topics.map((topic) => <button key={topic.tpId} className={topic.tpId === activeTpId && page === 'knowledge' ? 'is-active' : ''} title={topic.title} aria-current={topic.tpId === activeTpId && page === 'knowledge' ? 'page' : undefined} onClick={() => setActiveTopic(topic.tpId)}><span className="kb-sidebar-page-icon" aria-hidden="true"><FileIcon filename={topic.path} /></span><span className="kb-sidebar-page-title">{topic.title}</span></button>)}</div>}
      {reviews.length > 0 && <button className="kb-sidebar-task" onClick={() => setPage('reviews')}><span>{t('knowledge:panel.pendingReviews')}</span><span>{reviews.length}<ArrowUpRight size={12} /></span></button>}
      {failedCount > 0 && <button className="kb-sidebar-task" onClick={() => setPage('sources')}><span>{t('knowledge:panel.failedItems')}</span><span>{failedCount}<ArrowUpRight size={12} /></span></button>}
    </nav>
    {activeThemeId && <footer className="kb-sidebar-footer"><button onClick={() => openSourceSettings('settings')}><Settings2 size={14} strokeWidth={1.5} />{t('knowledge:panel.settings')}</button><button onClick={() => openSourceSettings('add')}><Plus size={14} />{t('knowledge:panel.addSources')}</button></footer>}
  </div>;
}
