import { useState } from 'react';
import { useNavStore } from '@/store/navStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { usePrefsStore } from '@/store/prefsStore';
import { listAdapters } from '@quill/cli-adapter';
import { testChatConnection } from '@/services/rigChat';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { VoiceSettings } from '@/components/settings/VoiceSettings';
import { FileTemplatesSettings } from '@/components/settings/FileTemplatesSettings';
import { SkillsSettings } from '@/components/settings/SkillsSettings';
import { PetSettings } from '@/components/settings/PetSettings';
import { NotificationsSettings } from '@/components/settings/NotificationsSettings';
import { ShortcutEditor } from '@/components/settings/ShortcutEditor';
import { LanguageSwitcher } from '@/components/shell/LanguageSwitcher';
import { Toggle, NAV_GROUPS } from '@/components/settings/primitives';
import { Lightbulb, Home, Unlock, Sparkles, ClipboardCopy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function SettingsPage() {
  const { t } = useTranslation();
  const settingsTab = useNavStore((s) => s.settingsTab);
  const setSettingsTab = useNavStore((s) => s.setSettingsTab);
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);

  const theme = useAppearanceStore((s) => s.theme);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const fontSize = useAppearanceStore((s) => s.fontSize);
  const showAiPanel = useAppearanceStore((s) => s.showAiPanel);
  const showStatusBar = useAppearanceStore((s) => s.showStatusBar);
  const showHiddenFiles = useAppearanceStore((s) => s.showHiddenFiles);
  const enableWikiPanel = useAppearanceStore((s) => s.enableWikiPanel);
  const enableClipsPanel = useAppearanceStore((s) => s.enableClipsPanel);
  const enableAnalyzePanel = useAppearanceStore((s) => s.enableAnalyzePanel);
  const enableDailyPanel = useAppearanceStore((s) => s.enableDailyPanel);
  const excludePatterns = useAppearanceStore((s) => s.excludePatterns);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const setShowAiPanel = useAppearanceStore((s) => s.setShowAiPanel);
  const setShowStatusBar = useAppearanceStore((s) => s.setShowStatusBar);
  const setShowHiddenFiles = useAppearanceStore((s) => s.setShowHiddenFiles);
  const setEnableWikiPanel = useAppearanceStore((s) => s.setEnableWikiPanel);
  const setEnableClipsPanel = useAppearanceStore((s) => s.setEnableClipsPanel);
  const setEnableAnalyzePanel = useAppearanceStore((s) => s.setEnableAnalyzePanel);
  const setEnableDailyPanel = useAppearanceStore((s) => s.setEnableDailyPanel);
  const setExcludePatterns = useAppearanceStore((s) => s.setExcludePatterns);
  const linkOpenMode = useAppearanceStore((s) => s.linkOpenMode);
  const setLinkOpenMode = useAppearanceStore((s) => s.setLinkOpenMode);
  const showTrayIcon = useAppearanceStore((s) => s.showTrayIcon);
  const setShowTrayIcon = useAppearanceStore((s) => s.setShowTrayIcon);

  const editorFont = useEditorPrefsStore((s) => s.editorFont);
  const editorFontSize = useEditorPrefsStore((s) => s.editorFontSize);
  const tabSize = useEditorPrefsStore((s) => s.tabSize);
  const showLineNumbers = useEditorPrefsStore((s) => s.showLineNumbers);
  const autoSave = useEditorPrefsStore((s) => s.autoSave);
  const setEditorFont = useEditorPrefsStore((s) => s.setEditorFont);
  const setEditorFontSize = useEditorPrefsStore((s) => s.setEditorFontSize);
  const setTabSize = useEditorPrefsStore((s) => s.setTabSize);
  const setShowLineNumbers = useEditorPrefsStore((s) => s.setShowLineNumbers);
  const setAutoSave = useEditorPrefsStore((s) => s.setAutoSave);

  const shortcuts = usePrefsStore((s) => s.shortcuts);
  const resetShortcuts = usePrefsStore((s) => s.resetShortcuts);

  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const cliPath = useAiConfigStore((s) => s.cliPath);
  const chatProvider = useAiConfigStore((s) => s.chatProvider);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const chatApiKey = useAiConfigStore((s) => s.chatApiKey);
  const chatBaseUrl = useAiConfigStore((s) => s.chatBaseUrl);
  const setCliAdapter = useAiConfigStore((s) => s.setCliAdapter);
  const setCliPath = useAiConfigStore((s) => s.setCliPath);
  const setChatProvider = useAiConfigStore((s) => s.setChatProvider);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);
  const setChatApiKey = useAiConfigStore((s) => s.setChatApiKey);
  const setChatBaseUrl = useAiConfigStore((s) => s.setChatBaseUrl);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  // ponytail: reuse the same state shape as `testStatus` for the Chat-mode ping
  // test. Separate state because both sections render simultaneously inside the
  // AI tab, so sharing one would have the CLI test clear the chat test result
  // (and vice versa) via the auto-clear setTimeout.
  const [chatTestStatus, setChatTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  const [showChatKey, setShowChatKey] = useState(false);
  const [excludeInput, setExcludeInput] = useState<{ value: string } | null>(null);

  return (
    <div className="settings-page flex flex-row max-w-none h-full">
      {/* Left navigation */}
      <nav className="sn w-[190px] shrink-0 bg-panel border-r border-brd flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto py-[11px] px-[7px]">
          {NAV_GROUPS.map((group) => (
            <div className="mb-[13px]" key={group.labelKey}>
              <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.12em] px-2 mb-[3px]">{t(group.labelKey)}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`sn-item flex items-center gap-2 py-[7px] px-[9px] rounded-md cursor-pointer text-[length:calc(var(--ui-font-size)-2px)] transition-all duration-100 border-none w-full text-left font-ui ${settingsTab === item.id ? 'bg-accdim text-acc' : 'text-t2 bg-transparent hover:bg-hov hover:text-t1'}`}
                  onClick={() => setSettingsTab(item.id)}
                >
                  {item.icon} {t(item.nameKey)}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="py-2 px-[7px] border-t border-brd shrink-0">
          <button className="sn-back-btn flex items-center gap-2 py-[7px] px-[9px] rounded-md cursor-pointer text-t2 text-[length:calc(var(--ui-font-size)-2px)] transition-all duration-100 border-none bg-transparent w-full text-left font-ui hover:bg-hov hover:text-t1" onClick={() => setCurrentPage('editor')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="10,2 4,8 10,14" />
            </svg>
            {t('settings:nav.backToEditor')}
          </button>
        </div>
      </nav>

      {/* Right panel */}
      <div className={`sc2 overflow-y-auto py-[22px] px-[26px] ${settingsTab === 'ai' || settingsTab === 'voice' ? 'w-fit min-w-[50vw] shrink-0' : 'w-[50vw]'}`}>
        {/* -- 外观 -- */}
        {settingsTab === 'appearance' && (
          <div className="mb-8">
            <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
              <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:appearance.title')}</div>
              <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:appearance.description')}</div>
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">{t('settings:appearance.theme.label')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'dark' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('dark')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#0b0d14' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">{t('settings:appearance.theme.dark')}</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'light' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('light')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#f0f2f8' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">{t('settings:appearance.theme.light')}</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'system' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('system')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: 'linear-gradient(135deg, #0b0d14 50%, #f0f2f8 50%)' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">{t('settings:appearance.theme.system')}</div>
                </div>
              </div>
            </div>
            <div className="border-t border-brd2 my-3.5" />
            <LanguageSwitcher variant="row" />
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.fontSize.label')}</h4>
              </div>
              <select className="settings-select" style={{ maxWidth: 180 }} value={`${fontSize}px`} onChange={(e) => setFontSize(parseInt(e.target.value))}>
                <option value="12px">{t('settings:appearance.fontSize.compact')}</option>
                <option value="14px">{t('settings:appearance.fontSize.default')}</option>
                <option value="16px">{t('settings:appearance.fontSize.comfortable')}</option>
              </select>
            </div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.ai.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.ai.description')}</p></div><Toggle value={showAiPanel} onChange={(v) => setShowAiPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.statusBar.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.statusBar.description')}</p></div><Toggle value={showStatusBar} onChange={(v) => setShowStatusBar(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.hiddenFiles.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.hiddenFiles.description')}</p></div><Toggle value={showHiddenFiles} onChange={(v) => { setShowHiddenFiles(v); import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree()); }} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.wiki.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.wiki.description')}</p></div><Toggle value={enableWikiPanel} onChange={(v) => setEnableWikiPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.clips.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.clips.description')}</p></div><Toggle value={enableClipsPanel} onChange={(v) => setEnableClipsPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.analyze.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.analyze.description')}</p></div><Toggle value={enableAnalyzePanel} onChange={(v) => setEnableAnalyzePanel(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.daily.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.daily.description')}</p></div><Toggle value={enableDailyPanel} onChange={(v) => setEnableDailyPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.panels.tray.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.panels.tray.description')}</p></div><Toggle value={showTrayIcon} onChange={(v) => setShowTrayIcon(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:appearance.excludePatterns.label')}</h4>
                <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:appearance.excludePatterns.description')}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 py-3.5 border-b border-brd">
              {excludeInput ? (
                <input
                  autoFocus
                  className="py-[5px] px-2.5 rounded-md text-[11px] font-ui border border-acc bg-inp text-t1 outline-none w-[180px]"
                  placeholder={t('settings:appearance.excludePatterns.prompt')}
                  value={excludeInput.value}
                  onChange={(e) => setExcludeInput({ value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = excludeInput.value.trim();
                      if (v) {
                        const next = excludePatterns.trim() ? `${excludePatterns.trimEnd()}\n${v}` : v;
                        setExcludePatterns(next);
                        import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree());
                      }
                      setExcludeInput(null);
                    } else if (e.key === 'Escape') {
                      setExcludeInput(null);
                    }
                  }}
                  onBlur={() => {
                    const v = excludeInput.value.trim();
                    if (v) {
                      const next = excludePatterns.trim() ? `${excludePatterns.trimEnd()}\n${v}` : v;
                      setExcludePatterns(next);
                      import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree());
                    }
                    setExcludeInput(null);
                  }}
                />
              ) : (
                <button
                  className="inline-flex items-center gap-1 h-[26px] px-2.5 rounded-md text-[11px] font-ui cursor-pointer border border-dashed border-brd2 text-t3 hover:border-acc hover:text-acc transition-all duration-100 bg-transparent"
                  onClick={() => setExcludeInput({ value: '' })}
                >+ {t('settings:appearance.excludePatterns.add')}</button>
              )}
              {excludePatterns.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).length === 0 && !excludeInput && (
                <span className="text-[11px] text-t3 italic">{t('settings:appearance.excludePatterns.empty')}</span>
              )}
              {excludePatterns.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')).map((p) => (
                <span key={p} className="inline-flex items-center gap-1 h-[26px] pl-2.5 pr-1 rounded-md text-[11px] font-ui bg-accdim text-t1 border border-brd2">
                  <span className="font-mono leading-none">{p}</span>
                  <button
                    className="w-[18px] h-[18px] flex items-center justify-center rounded text-t3 hover:text-[#f06a6a] hover:bg-hov transition-colors leading-none"
                    onClick={() => {
                      const next = excludePatterns.split('\n').map(s => s.trim()).filter(s => s !== p).join('\n');
                      setExcludePatterns(next);
                      import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree());
                    }}
                    aria-label={t('settings:appearance.excludePatterns.add')}
                  >×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* -- 编辑器 -- */}
        {settingsTab === 'editor' && (
          <div className="mb-8">
            <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
              <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:editor.title')}</div>
              <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:editor.description')}</div>
            </div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:editor.font.label')}</h4></div><select className="settings-select" style={{ maxWidth: 180 }} value={editorFont} onChange={(e) => setEditorFont(e.target.value)}><option>DM Mono</option><option>JetBrains Mono</option><option>Fira Code</option></select></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:editor.fontSize.label')}</h4></div><select className="settings-select" style={{ maxWidth: 180 }} value={`${editorFontSize}px`} onChange={(e) => setEditorFontSize(parseInt(e.target.value))}><option value="12px">12px</option><option value="13px">13px</option><option value="14px">14px</option><option value="16px">16px</option></select></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:editor.tabSize.label')}</h4></div><select className="settings-select" style={{ maxWidth: 180 }} value={tabSize} onChange={(e) => setTabSize(parseInt(e.target.value))}><option value={2}>{t('settings:editor.tabSize.2')}</option><option value={4}>{t('settings:editor.tabSize.4')}</option></select></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:editor.showLineNumbers.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:editor.showLineNumbers.description')}</p></div><Toggle value={showLineNumbers} onChange={(v) => setShowLineNumbers(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:editor.autoSave.label')}</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:editor.autoSave.description')}</p></div><Toggle value={autoSave} onChange={(v) => setAutoSave(v)} /></div>
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:editor.linkOpenMode.label')}</h4>
                <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-relaxed">{t('settings:editor.linkOpenMode.description')}</p>
              </div>
              <div className="flex gap-1">
                <button
                  className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${linkOpenMode === 'external' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
                  onClick={() => setLinkOpenMode('external')}
                >{t('settings:editor.linkOpenMode.external')}</button>
                <button
                  className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${linkOpenMode === 'internal' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
                  onClick={() => setLinkOpenMode('internal')}
                >{t('settings:editor.linkOpenMode.internal')}</button>
              </div>
            </div>
          </div>
        )}

        {/* -- 快捷键 -- */}
        {settingsTab === 'shortcuts' && (
          <div className="mb-8">
            <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
              <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:shortcuts.title')}</div>
              <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:shortcuts.description')}</div>
            </div>
            {shortcuts.map((shortcut) => (
              <div className="tr flex items-center justify-between py-3.5 border-b border-brd" key={shortcut.id}>
                <div className="tr-info">
                  <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{shortcut.name}</h4>
                </div>
                <ShortcutEditor shortcutId={shortcut.id} currentKeys={shortcut.keys} />
              </div>
            ))}
            <div className="flex gap-2 mt-4">
              <button className="btn btn-g btn-sm" onClick={() => resetShortcuts()}>{t('settings:shortcuts.reset')}</button>
            </div>
          </div>
        )}

        {/* -- AI 工具 -- */}
        {settingsTab === 'ai' && (
          <div className="mb-8 whitespace-nowrap">
            <div className="pb-3 mb-5 border-b border-brd2 flex items-baseline gap-2">
              <div className="text-[length:calc(var(--ui-font-size)+3px)] font-bold text-t1 tracking-[-0.01em]">{t('settings:ai.title')}</div>
              <div className="text-[length:calc(var(--ui-font-size)-1px)] text-t3">{t('settings:ai.description')}</div>
            </div>
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-2 flex items-center gap-1.5">{t('settings:ai.cliAdapter')}</div>
            <div className="ml flex flex-col gap-1">
              {listAdapters().map((a) => (
                <div
                  key={a.id}
                  className={`mi flex items-center justify-between py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${cliAdapter === a.id ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
                  onClick={() => setCliAdapter(a.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full border-2 shrink-0 ${cliAdapter === a.id ? 'bg-acc border-acc' : 'border-brd2'}`} />
                    <div>
                      <div className="text-xs font-semibold text-t1 font-mono">{a.displayName}</div>
                      <div className="text-[10px] text-t3 mt-px">{a.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-3.5 mt-4">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">{t('settings:ai.cliPath.label')}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc" style={{ flex: 1 }} value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder="claude" autoCapitalize="off" />
                <button
                  className="btn btn-g btn-sm"
                  title={t('settings:ai.cliPath.detectTitle')}
                  onClick={async () => {
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const adapterCmd = cliAdapter === 'claude' ? 'claude' : cliAdapter;
                      const cmd = Command.create('claude-cli', ['-l', '-c', `which ${adapterCmd}`]);
                      const output = await cmd.execute();
                      const detected = output.stdout.trim().split('\n')[0];
                      if (output.code === 0 && detected) {
                        setCliPath(detected);
                      }
                    } catch {}
                  }}
                >{t('settings:ai.cliPath.detect')}</button>
              </div>
              <div className="text-[10.5px] text-t3 mt-1">{t('settings:ai.cliPath.hint')}</div>
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
              <button
                className="btn btn-g btn-sm"
                disabled={testStatus.testing}
                onClick={async () => {
                  setTestStatus({ testing: true });
                  try {
                    const { Command } = await import('@tauri-apps/plugin-shell');
                    const cliPath = useAiConfigStore.getState().cliPath || 'claude';
                    const cmd = Command.create('claude-cli', ['-l', '-c', `${cliPath} --version`]);
                    const output = await cmd.execute();
                    if (output.code === 0) {
                      const version = output.stdout.trim().split('\n')[0];
                      setTestStatus({ testing: false, result: { success: true, message: version || t('settings:ai.test.success') } });
                    } else {
                      setTestStatus({ testing: false, result: { success: false, message: output.stderr.trim() || t('settings:ai.test.exitCode', { code: output.code }) } });
                    }
                  } catch (err) {
                    setTestStatus({ testing: false, result: { success: false, message: t('settings:ai.test.cannotRun', { error: String(err) }) } });
                  }
                  setTimeout(() => setTestStatus((s) => ({ ...s, result: undefined })), 6000);
                }}
              >{testStatus.testing ? t('settings:ai.test.testing') : t('settings:ai.test.label')}</button>
              {testStatus.result && (
                <span style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                  {testStatus.result.message}
                </span>
              )}
            </div>
            <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5 mt-4">
              <Lightbulb size={17} className="shrink-0 mt-px text-acc" />
              <div>
                <h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">{t('settings:ai.usage.title')}</h4>
                <p className="text-[11px] text-t3 leading-normal m-0">{t('settings:ai.usage.description')}</p>
              </div>
            </div>
            {/* -- Chat 模式（rig 直连 LLM）-- */}
            <div className="mt-5 pt-4 border-t border-brd2">
              <div className="text-[length:calc(var(--ui-font-size)-1px)] font-bold text-t1 mb-[3px]">{t('settings:ai.chat.title')}</div>
              <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3">{t('settings:ai.chat.description')}</div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:ai.chat.provider.label')}</div>
                <select
                  className="fi2 w-full h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatProvider}
                  onChange={(e) => setChatProvider(e.target.value as 'anthropic' | 'openai' | 'openai-compatible')}
                >
                  <option value="anthropic">{t('settings:ai.chat.provider.anthropic')}</option>
                  <option value="openai">{t('settings:ai.chat.provider.openai')}</option>
                  <option value="openai-compatible">{t('settings:ai.chat.provider.openaiCompatible')}</option>
                </select>
              </div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:ai.chat.model.label')}</div>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder={chatProvider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.2'}
                  autoCapitalize="off"
                />
              </div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:ai.chat.apiKey.label')}</div>
                <div className="relative">
                  <input
                    type={showChatKey ? 'text' : 'password'}
                    className="fi2 w-full py-[7px] px-2.5 pr-[34px] rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                    value={chatApiKey}
                    onChange={(e) => setChatApiKey(e.target.value)}
                    placeholder="sk-…"
                    autoCapitalize="off"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={showChatKey ? t('settings:ai.chat.apiKey.hide') : t('settings:ai.chat.apiKey.show')}
                    title={showChatKey ? t('settings:ai.chat.apiKey.hide') : t('settings:ai.chat.apiKey.show')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-[26px] h-[26px] flex items-center justify-center rounded bg-transparent border-none text-t3 cursor-pointer hover:bg-hov hover:text-t1"
                    onClick={() => setShowChatKey((v) => !v)}
                  >
                    {showChatKey ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div className="mb-1">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">{t('settings:ai.chat.baseUrl.label')}</div>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatBaseUrl}
                  onChange={(e) => setChatBaseUrl(e.target.value)}
                  placeholder={chatProvider === 'openai-compatible' ? 'http://localhost:11434/v1' : t('settings:ai.chat.baseUrl.placeholder')}
                  autoCapitalize="off"
                />
                <div className="text-[10.5px] text-t3 mt-1">{chatProvider === 'anthropic' ? t('settings:ai.chat.baseUrl.anthropicHint') : chatProvider === 'openai' ? t('settings:ai.chat.baseUrl.openaiHint') : t('settings:ai.chat.baseUrl.openaiCompatibleHint')}</div>
              </div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
                <button
                  className="btn btn-g btn-sm"
                  disabled={chatTestStatus.testing || !chatApiKey}
                  onClick={async () => {
                    setChatTestStatus({ testing: true });
                    try {
                      const result = await testChatConnection({
                        provider: chatProvider,
                        model: chatModel || (chatProvider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini'),
                        apiKey: chatApiKey,
                        baseUrl: chatBaseUrl || undefined,
                      });
                      setChatTestStatus({ testing: false, result });
                      setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
                    } catch (err) {
                      setChatTestStatus({ testing: false, result: { success: false, message: String(err) } });
                      setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
                    }
                  }}
                >{chatTestStatus.testing ? t('settings:ai.chat.test.testing') : t('settings:ai.chat.test.label')}</button>
                {chatTestStatus.result && (
                  <span style={{ fontSize: 11, color: chatTestStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                    {chatTestStatus.result.success ? '✓ ' : '✗ '}{chatTestStatus.result.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* -- 文件模板 -- */}
        {/* -- 语音输入 -- */}
        {settingsTab === 'voice' && (
          <VoiceSettings />
        )}

        {settingsTab === 'templates' && (
          <FileTemplatesSettings />
        )}

        {/* -- Skills -- */}
        {settingsTab === 'skills' && (
          <SkillsSettings />
        )}

        {/* -- 桌宠 -- */}
        {settingsTab === 'pet' && (
          <PetSettings />
        )}

        {/* -- 通知 -- */}
        {settingsTab === 'notifications' && (
          <NotificationsSettings />
        )}

        {/* -- 插件 -- */}
        {settingsTab === 'plugins' && (
          <PluginsSettings />
        )}

        {/* -- 关于 -- */}
        {settingsTab === 'about' && (
          <div className="mb-[26px]">
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
              <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="48" height="48" style={{ borderRadius: 5 }} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.02em' }}>Quill<span style={{ color: 'var(--acc)' }}>.</span></div>
                <div className="font-mono" style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{t('settings:about.tagline')}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><Home size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">{t('settings:about.features.localFirst.title')}</h4><p className="text-[11px] text-t3 leading-normal m-0">{t('settings:about.features.localFirst.description')}</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><Unlock size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">{t('settings:about.features.openFormat.title')}</h4><p className="text-[11px] text-t3 leading-normal m-0">{t('settings:about.features.openFormat.description')}</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><Sparkles size={17} className="shrink-0 mt-px text-acc" /><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">{t('settings:about.features.ai.title')}</h4><p className="text-[11px] text-t3 leading-normal m-0">{t('settings:about.features.ai.description')}</p></div></div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-g btn-sm inline-flex items-center gap-1.5"><ClipboardCopy size={13} /> {t('settings:about.copyVersion')}</button><button className="btn btn-g btn-sm inline-flex items-center gap-1.5"><RefreshCw size={13} /> {t('settings:about.checkUpdate')}</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
