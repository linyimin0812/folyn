import { useState } from 'react';
import { useNavStore } from '@/store/navStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { usePrefsStore } from '@/store/prefsStore';
import { CliSettings } from '@/components/settings/CliSettings';
import { ModelServicesSettings } from '@/components/settings/ModelServicesSettings';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { VoiceSettings, VoiceHotkeyRecorder } from '@/components/settings/VoiceSettings';
import { FileTemplatesSettings } from '@/components/settings/FileTemplatesSettings';
import { PetSettings } from '@/components/settings/PetSettings';
import { NotificationsSettings } from '@/components/settings/NotificationsSettings';
import { CspSettings } from '@/components/settings/CspSettings';
import { StorageSharingSettings } from '@/components/settings/StorageSharingSettings';
import { ShortcutEditor } from '@/components/settings/ShortcutEditor';
import { ScriptRuntimesSettings } from '@/components/settings/ScriptRuntimesSettings';
import { LanguageSwitcher } from '@/components/shell/LanguageSwitcher';
import { Toggle, NAV_GROUPS } from '@/components/settings/primitives';
import { Home, Unlock, Sparkles, Puzzle, Cat, Wrench, Bug } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-[3px] h-[13px] rounded-full bg-t2" />
      <h3 className="text-[13px] font-bold text-t1 m-0 tracking-[-0.005em]">{label}</h3>
    </div>
  );
}

function GroupDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-8">
      <div className="h-px bg-brd2 flex-1" />
      <span className="text-[10.5px] font-bold text-t3 uppercase tracking-[.14em]">{label}</span>
      <div className="h-px bg-brd2 flex-1" />
    </div>
  );
}

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
  const excludePatterns = useAppearanceStore((s) => s.excludePatterns);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const setShowAiPanel = useAppearanceStore((s) => s.setShowAiPanel);
  const setShowStatusBar = useAppearanceStore((s) => s.setShowStatusBar);
  const setShowHiddenFiles = useAppearanceStore((s) => s.setShowHiddenFiles);
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

  const [excludeInput, setExcludeInput] = useState<{ value: string } | null>(null);

  return (
    <div className="settings-page flex flex-row max-w-none h-full relative flex-1">
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

      {/* Right panel: flex-1 min-w-0 so wide tabs (models 2-col, voice inputs,
          templates editor) shrink to fit instead of pushing past viewport.
          cli uses the narrow 50vw column — its cards (input + 2 buttons) are
          compact and don't need full width. overflow-x-hidden clips any
          residual unbreakable content (long URLs, file paths). */}
      <div className={`sc2 overflow-y-auto overflow-x-hidden pt-[22px] pb-2 px-[26px] min-w-0 ${settingsTab === 'models' || settingsTab === 'voice' || settingsTab === 'templates' ? 'flex-1' : 'w-[50vw]'}`}>
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
            <ScriptRuntimesSettings />
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
                  <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t(`settings:shortcuts.items.${shortcut.id}`, { defaultValue: shortcut.name })}</h4>
                </div>
                <ShortcutEditor shortcutId={shortcut.id} currentKeys={shortcut.keys} />
              </div>
            ))}
            {/* Voice global hotkey lives in voiceStore (accelerator string
                keyshape, OS-registered via voice_set_global_hotkey). Shown
                here alongside prefsStore shortcuts so users see all global
                hotkeys in one place. Editor reuses VoiceHotkeyRecorder —
                same capture/Esc-clear/re-register flow as the voice tab. */}
            <div className="tr flex items-center justify-between py-3.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-1">{t('settings:voice.globalHotkey.label')}</h4>
              </div>
              <VoiceHotkeyRecorder />
            </div>
            <div className="flex gap-2 mt-4">
              <button className="btn btn-g btn-sm" onClick={() => resetShortcuts()}>{t('settings:shortcuts.reset')}</button>
            </div>
          </div>
        )}

        {/* -- CLI 工具 -- */}
        {settingsTab === 'cli' && (
          <CliSettings />
        )}

        {/* -- 模型服务 -- */}
        {settingsTab === 'models' && (
          <ModelServicesSettings />
        )}

        {/* -- 文件模板 -- */}
        {/* -- 语音输入 -- */}
        {settingsTab === 'voice' && (
          <VoiceSettings />
        )}

        {settingsTab === 'templates' && (
          <FileTemplatesSettings />
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

        {/* -- 安全策略 -- */}
        {settingsTab === 'csp' && (
          <CspSettings />
        )}

        {/* -- 存储与分享 -- */}
        {settingsTab === 'storage' && (
          <StorageSharingSettings />
        )}

        {/* -- 关于 -- */}
        {settingsTab === 'about' && (
          <div className="mb-[26px] max-w-[640px]">
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 18 }}>
              <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="52" height="52" style={{ borderRadius: 6 }} />
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.02em' }}>Quill.</div>
                <div className="font-mono" style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{t('settings:about.tagline')}</div>
              </div>
            </div>
            <p className="text-[length:calc(var(--ui-font-size)-1px)] text-t2 leading-relaxed m-0 mb-8 max-w-[640px]" style={{ textAlign: 'justify' }}>{t('settings:about.description')}</p>

            <div className="mb-8">
              <SectionHeader label={t('settings:about.philosophy.label')} />
              <div className="space-y-2.5 max-w-[640px]">
                {(['localFirst', 'openFormat', 'extensible', 'privacy'] as const).map((k) => {
                  const text = t(`settings:about.philosophy.${k}`);
                  const [head, ...rest] = text.split(' —— ');
                  return (
                    <div key={k} className="bg-surf2/60 border border-brd2 rounded-lg py-2.5 px-3">
                      <p className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 leading-relaxed m-0" style={{ textAlign: 'justify' }}>
                        <span className="font-bold text-t1">{head} ——</span>{rest.join(' —— ')}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mb-8">
              <SectionHeader label={t('settings:about.features.label') || ''} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }} className="max-w-[640px]">
                <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3.5 px-4 flex gap-2.5"><Home size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-bold text-t1 m-0 mb-0.5">{t('settings:about.features.localFirst.title')}</h4><p className="text-[11px] text-t3 leading-relaxed m-0">{t('settings:about.features.localFirst.description')}</p></div></div>
                <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3.5 px-4 flex gap-2.5"><Unlock size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-bold text-t1 m-0 mb-0.5">{t('settings:about.features.openFormat.title')}</h4><p className="text-[11px] text-t3 leading-relaxed m-0">{t('settings:about.features.openFormat.description')}</p></div></div>
                <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3.5 px-4 flex gap-2.5"><Sparkles size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-bold text-t1 m-0 mb-0.5">{t('settings:about.features.ai.title')}</h4><p className="text-[11px] text-t3 leading-relaxed m-0">{t('settings:about.features.ai.description')}</p></div></div>
                <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3.5 px-4 flex gap-2.5"><Puzzle size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-bold text-t1 m-0 mb-0.5">{t('settings:about.features.plugins.title')}</h4><p className="text-[11px] text-t3 leading-relaxed m-0">{t('settings:about.features.plugins.description')}</p></div></div>
                <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3.5 px-4 flex gap-2.5"><Cat size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-bold text-t1 m-0 mb-0.5">{t('settings:about.features.pet.title')}</h4><p className="text-[11px] text-t3 leading-relaxed m-0">{t('settings:about.features.pet.description')}</p></div></div>
                <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3.5 px-4 flex gap-2.5"><Wrench size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-bold text-t1 m-0 mb-0.5">{t('settings:about.features.builtInTools.title')}</h4><p className="text-[11px] text-t3 leading-relaxed m-0">{t('settings:about.features.builtInTools.description')}</p></div></div>
              </div>
            </div>

            <div className="mb-8">
              <SectionHeader label={t('settings:about.highlights.label')} />
              <div className="bg-surf2/40 border border-brd2 rounded-lg p-4 max-w-[640px]">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 32px' }}>
                  {(['editor', 'preview', 'vault', 'containerPlugins', 'export', 'crossPlatform', 'themes', 'shortcuts', 'i18n'] as const).map((k) => (
                    <div key={k} className="flex gap-2.5">
                      <div className="w-[5px] h-[5px] rounded-full bg-t2 mt-[6px] shrink-0" />
                      <div>
                        <div className="text-[12.5px] font-bold text-t1 mb-0.5">{t(`settings:about.highlights.items.${k}.title`)}</div>
                        <div className="text-[11px] text-t3 leading-relaxed">{t(`settings:about.highlights.items.${k}.description`)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <GroupDivider label={t('settings:about.groups.capabilities')} />

            <div className="mb-8">
              <SectionHeader label={t('settings:about.storageBackends.label')} />
              <div className="bg-surf2/40 border border-brd2 rounded-lg p-4 max-w-[640px]">
                <p className="text-justify text-[length:calc(var(--ui-font-size)-2px)] text-t3 leading-relaxed m-0 mb-4">{t('settings:about.storageBackends.description')}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 32px' }}>
                  {(['localFs', 'github', 's3'] as const).map((k) => (
                    <div key={k} className="flex gap-2.5">
                      <div className="w-[5px] h-[5px] rounded-full bg-t2 mt-[6px] shrink-0" />
                      <div>
                        <div className="text-[12px] font-bold text-t1 mb-0.5">{t(`settings:about.storageBackends.items.${k}.title`)}</div>
                        <div className="text-[11px] text-t3 leading-relaxed">{t(`settings:about.storageBackends.items.${k}.description`)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-8">
              <SectionHeader label={t('settings:about.aiIntegration.label')} />
              <div className="bg-surf2/40 border border-brd2 rounded-lg p-4 max-w-[640px]">
                <p className="text-justify text-[length:calc(var(--ui-font-size)-2px)] text-t3 leading-relaxed m-0 mb-4">{t('settings:about.aiIntegration.description')}</p>
                <div className="text-[11.5px] font-bold text-t2 mb-3">{t('settings:about.aiIntegration.adapters.label')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 32px' }}>
                  {(['claudeCode', 'codex', 'gemini', 'opencode', 'pi', 'qoder'] as const).map((k) => (
                    <div key={k} className="flex gap-2.5">
                      <div className="w-[5px] h-[5px] rounded-full bg-t2 mt-[6px] shrink-0" />
                      <div>
                        <div className="text-[12px] font-bold text-t1 mb-0.5">{t(`settings:about.aiIntegration.adapters.items.${k}.name`)}</div>
                        <div className="text-[11px] text-t3 leading-relaxed">{t(`settings:about.aiIntegration.adapters.items.${k}.description`)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-8">
              <SectionHeader label={t('settings:about.pluginSystem.label')} />
              <div className="bg-surf2/40 border border-brd2 rounded-lg p-4 max-w-[640px] space-y-5">
                <p className="text-justify text-[length:calc(var(--ui-font-size)-2px)] text-t3 leading-relaxed m-0">{t('settings:about.pluginSystem.description')}</p>
                <div>
                  <div className="text-[11.5px] font-bold text-t2 mb-3">{t('settings:about.pluginSystem.tiers.label')}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px 32px' }}>
                    {(['trusted', 'sandbox'] as const).map((k) => (
                      <div key={k} className="flex gap-2.5">
                        <div className="w-[5px] h-[5px] rounded-full bg-t2 mt-[6px] shrink-0" />
                        <div>
                          <div className="text-[12px] font-bold text-t1 mb-0.5">{t(`settings:about.pluginSystem.tiers.${k}.name`)}</div>
                          <div className="text-[11px] text-t3 leading-relaxed">{t(`settings:about.pluginSystem.tiers.${k}.description`)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11.5px] font-bold text-t2 mb-2">{t('settings:about.pluginSystem.containerPlugins.label')}</div>
                  <div className="font-mono text-[11px] text-t3 leading-relaxed bg-surf border border-brd2 rounded-md px-3 py-2.5">{t('settings:about.pluginSystem.containerPlugins.list')}</div>
                </div>
              </div>
            </div>

            <div className="mb-8">
              <SectionHeader label={t('settings:about.fileTypeSupport.label')} />
              <div className="bg-surf2/40 border border-brd2 rounded-lg p-4 max-w-[640px]">
                <p className="text-justify text-[length:calc(var(--ui-font-size)-2px)] text-t3 leading-relaxed m-0 mb-3">{t('settings:about.fileTypeSupport.description')}</p>
                <div className="font-mono text-[11px] text-t3 leading-relaxed bg-surf border border-brd2 rounded-md px-3 py-2.5">{t('settings:about.fileTypeSupport.items')}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 6 }} className="mt-2 mb-4">
              <button type="button" onClick={() => import('@tauri-apps/plugin-shell').then(({ open }) => open('https://github.com/linyimin0812/quill'))} className="btn btn-g btn-sm inline-flex items-center gap-1.5 no-underline text-inherit cursor-pointer"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.02.37-2.45-.49-2.45-.49-.33-.84-.81-1.07-.81-1.07-.66-.45.05-.44.05-.44.73.05 1.11.75 1.11.75.65 1.11 1.71.79 2.12.6.07-.47.26-.79.47-.97-1.6-.18-3.28-.8-3.28-3.56 0-.79.28-1.43.74-1.94-.07-.18-.32-.92.07-1.92 0 0 .6-.19 1.97.74a6.84 6.84 0 0 1 1.79-.24c.61 0 1.22.08 1.79.24 1.37-.93 1.97-.74 1.97-.74.39 1 .14 1.74.07 1.92.46.51.74 1.15.74 1.94 0 2.77-1.69 3.38-3.3 3.56.26.22.49.66.49 1.34 0 .97-.01 1.75-.01 1.99 0 .21.15.46.56.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg> {t('settings:about.viewOnGithub')}</button>
              <button type="button" onClick={() => import('@tauri-apps/plugin-shell').then(({ open }) => open('https://github.com/linyimin0812/quill/issues'))} className="btn btn-g btn-sm inline-flex items-center gap-1.5 no-underline text-inherit cursor-pointer"><Bug size={13} /> {t('settings:about.reportIssue')}</button>
            </div>

            <div className="border-t border-brd2 pt-3 text-[11px] text-t3">
              <span>{t('settings:about.license')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
