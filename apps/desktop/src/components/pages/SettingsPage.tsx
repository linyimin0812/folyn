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
import { Toggle, NAV_GROUPS } from '@/components/settings/primitives';
import { Lightbulb, Home, Unlock, Sparkles, ClipboardCopy, RefreshCw } from 'lucide-react';

export function SettingsPage() {
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

  const dailyNotesDir = usePrefsStore((s) => s.dailyNotesDir);
  const dailyNoteDateFormat = usePrefsStore((s) => s.dailyNoteDateFormat);
  const shortcuts = usePrefsStore((s) => s.shortcuts);
  const setDailyNotesDir = usePrefsStore((s) => s.setDailyNotesDir);
  const setDailyNoteDateFormat = usePrefsStore((s) => s.setDailyNoteDateFormat);
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

  return (
    <div className="settings-page flex flex-row max-w-none h-full">
      {/* Left navigation */}
      <nav className="sn w-[190px] shrink-0 bg-panel border-r border-brd flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto py-[11px] px-[7px]">
          {NAV_GROUPS.map((group) => (
            <div className="mb-[13px]" key={group.label}>
              <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.12em] px-2 mb-[3px]">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`sn-item flex items-center gap-2 py-[7px] px-[9px] rounded-md cursor-pointer text-[length:calc(var(--ui-font-size)-2px)] transition-all duration-100 border-none w-full text-left font-ui ${settingsTab === item.id ? 'bg-accdim text-acc' : 'text-t2 bg-transparent hover:bg-hov hover:text-t1'}`}
                  onClick={() => setSettingsTab(item.id)}
                >
                  {item.icon} {item.name}
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
            返回编辑器
          </button>
        </div>
      </nav>

      {/* Right panel */}
      <div className="sc2 w-[50vw] overflow-y-auto py-[22px] px-[26px]">
        {/* -- 外观 -- */}
        {settingsTab === 'appearance' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">外观</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">调整界面主题与字体显示</div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">界面主题</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'dark' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('dark')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#0b0d14' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">暗色</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'light' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('light')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#f0f2f8' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">亮色</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'system' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('system')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: 'linear-gradient(135deg, #0b0d14 50%, #f0f2f8 50%)' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">跟随系统</div>
                </div>
              </div>
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">界面字体大小</div>
              <select className="settings-select" style={{ maxWidth: 180 }} value={`${fontSize}px`} onChange={(e) => setFontSize(parseInt(e.target.value))}>
                <option value="12px">12px（紧凑）</option>
                <option value="14px">14px（默认）</option>
                <option value="16px">16px（舒适）</option>
              </select>
            </div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">默认显示 AI 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">打开编辑器时自动展开 AI 对话面板</p></div><Toggle value={showAiPanel} onChange={(v) => setShowAiPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">状态栏</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">底部显示字数、光标位置等信息</p></div><Toggle value={showStatusBar} onChange={(v) => setShowStatusBar(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示隐藏文件</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在文件树中显示以 . 开头的隐藏文件和文件夹</p></div><Toggle value={showHiddenFiles} onChange={(v) => { setShowHiddenFiles(v); import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree()); }} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">Wiki 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示 Wiki 知识库入口</p></div><Toggle value={enableWikiPanel} onChange={(v) => setEnableWikiPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">Clips 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示网页剪藏入口</p></div><Toggle value={enableClipsPanel} onChange={(v) => setEnableClipsPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">项目分析面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示项目分析入口</p></div><Toggle value={enableAnalyzePanel} onChange={(v) => setEnableAnalyzePanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">今日笔记面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示日历与今日笔记入口（禁用后 ⌘D 也不再打开）</p></div><Toggle value={enableDailyPanel} onChange={(v) => setEnableDailyPanel(v)} /></div>
            <div className="mb-3.5 flex flex-col items-stretch gap-1.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">过滤文件/文件夹</div>
              <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>每行一个规则，匹配的文件或文件夹将在文件树中隐藏。支持 * 和 ? 通配符，# 开头为注释。</p>
              <textarea
                className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full"
                rows={6}
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical', lineHeight: 1.6, padding: '8px 10px' }}
                value={excludePatterns}
                onChange={(e) => setExcludePatterns(e.target.value)}
                onBlur={() => import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree())}
                placeholder={'node_modules\n.git\n.DS_Store\n*.log'}
              />
            </div>
          </div>
        )}

        {/* -- 编辑器 -- */}
        {settingsTab === 'editor' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">编辑器</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置编辑器行为与显示选项</div>
            <div className="grid grid-cols-3 gap-3 mb-3.5">
              <div><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">编辑器字体</div><select className="settings-select" value={editorFont} onChange={(e) => setEditorFont(e.target.value)}><option>DM Mono</option><option>JetBrains Mono</option><option>Fira Code</option></select></div>
              <div><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">字体大小</div><select className="settings-select" value={`${editorFontSize}px`} onChange={(e) => setEditorFontSize(parseInt(e.target.value))}><option value="12px">12px</option><option value="13px">13px</option><option value="14px">14px</option><option value="16px">16px</option></select></div>
              <div><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">Tab 大小</div><select className="settings-select" value={tabSize} onChange={(e) => setTabSize(parseInt(e.target.value))}><option value={2}>2 空格</option><option value={4}>4 空格</option></select></div>
            </div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示行号</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在编辑区左侧显示行号</p></div><Toggle value={showLineNumbers} onChange={(v) => setShowLineNumbers(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">自动保存</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">每 30 秒自动保存当前文档</p></div><Toggle value={autoSave} onChange={(v) => setAutoSave(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">链接打开方式</h4>
                <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">点击链接时的默认打开方式</p>
              </div>
              <div className="flex gap-1">
                <button
                  className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${linkOpenMode === 'external' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
                  onClick={() => setLinkOpenMode('external')}
                >外部浏览器</button>
                <button
                  className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${linkOpenMode === 'internal' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
                  onClick={() => setLinkOpenMode('internal')}
                >应用内打开</button>
              </div>
            </div>
          </div>
        )}

        {/* -- 编辑器 -- Daily Notes section (appended below editor settings) */}
        {settingsTab === 'editor' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">Daily Notes</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置每日笔记的存储目录与日期格式</div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">笔记目录</div>
              <input
                className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
                style={{ maxWidth: 240 }}
                value={dailyNotesDir}
                onChange={(e) => setDailyNotesDir(e.target.value)}
                placeholder="daily"
                autoCapitalize="off"
              />
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">日期格式</div>
              <select
                className="settings-select"
                style={{ maxWidth: 240 }}
                value={dailyNoteDateFormat}
                onChange={(e) => setDailyNoteDateFormat(e.target.value)}
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="YYYY.MM.DD">YYYY.MM.DD</option>
                <option value="YYYYMMDD">YYYYMMDD</option>
              </select>
            </div>
          </div>
        )}

        {/* -- 快捷键 -- */}
        {settingsTab === 'shortcuts' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">快捷键</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">点击快捷键区域可重新录入，按下新的组合键即可修改</div>
            {shortcuts.map((shortcut) => (
              <div className="sk-row flex items-center justify-between py-2 border-b border-brd last:border-b-0" key={shortcut.id}>
                <span className="text-xs text-t2">{shortcut.name}</span>
                <ShortcutEditor shortcutId={shortcut.id} currentKeys={shortcut.keys} />
              </div>
            ))}
            <div style={{ marginTop: 14, display: 'flex', gap: 7 }}>
              <button className="btn btn-g btn-sm" onClick={() => resetShortcuts()}>恢复默认</button>
            </div>
          </div>
        )}

        {/* -- AI 工具 -- */}
        {settingsTab === 'ai' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">AI 工具</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置 AI CLI 工具，用于智能编辑文档</div>
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-2 flex items-center gap-1.5">CLI 适配器</div>
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
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">CLI 路径</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc" style={{ flex: 1 }} value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder="claude" autoCapitalize="off" />
                <button
                  className="btn btn-g btn-sm"
                  title="自动检测路径"
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
                >检测</button>
              </div>
              <div className="text-[10.5px] text-t3 mt-1">CLI 可执行文件的路径或命令名，点击"检测"自动查找</div>
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
                      setTestStatus({ testing: false, result: { success: true, message: version || '连接成功' } });
                    } else {
                      setTestStatus({ testing: false, result: { success: false, message: output.stderr.trim() || `退出码 ${output.code}` } });
                    }
                  } catch (err) {
                    setTestStatus({ testing: false, result: { success: false, message: `无法执行 CLI: ${String(err)}` } });
                  }
                  setTimeout(() => setTestStatus((s) => ({ ...s, result: undefined })), 6000);
                }}
              >{testStatus.testing ? '测试中…' : '测试连接'}</button>
              {testStatus.result && (
                <span style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                  {testStatus.result.message}
                </span>
              )}
            </div>
            <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5 mt-4">
              <Lightbulb size={17} className="shrink-0 mt-px text-acc" />
              <div>
                <h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">使用说明</h4>
                <p className="text-[11px] text-t3 leading-normal m-0">AI 工具通过调用本地 CLI（如 Claude Code）来编辑文档。请确保已安装对应的 CLI 工具。修改会以 Diff 形式展示，确认后再应用到文件。</p>
              </div>
            </div>
            {/* -- Chat 模式（rig 直连 LLM）-- */}
            <div className="mt-5 pt-4 border-t border-brd2">
              <div className="text-[length:calc(var(--ui-font-size)-1px)] font-bold text-t1 mb-[3px]">Chat 模式</div>
              <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3">多轮对话，经 rig 直连 LLM（不经过 CLI，无工具/文件访问）。ask/agent 仍用上面的 CLI。</div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Provider</div>
                <select
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatProvider}
                  onChange={(e) => setChatProvider(e.target.value as 'anthropic' | 'openai' | 'openai-compatible')}
                >
                  <option value="anthropic">Anthropic（Claude）</option>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI 兼容（自定义 baseUrl）</option>
                </select>
              </div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">模型</div>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder={chatProvider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.2'}
                  autoCapitalize="off"
                />
              </div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">API Key</div>
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
                    aria-label={showChatKey ? '隐藏 API Key' : '显示 API Key'}
                    title={showChatKey ? '隐藏 API Key' : '显示 API Key'}
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
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Base URL（可选）</div>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatBaseUrl}
                  onChange={(e) => setChatBaseUrl(e.target.value)}
                  placeholder={chatProvider === 'openai-compatible' ? 'http://localhost:11434/v1' : '留空用默认'}
                  autoCapitalize="off"
                />
                <div className="text-[10.5px] text-t3 mt-1">{chatProvider === 'anthropic' ? '官方 Anthropic 留空；Anthropic 兼容端点' : chatProvider === 'openai' ? '官方 OpenAI 留空。' : 'Ollama / vLLM / LM Studio 等必填；不以 /v1 结尾时会自动补 /v1。'}</div>
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
                >{chatTestStatus.testing ? '测试中…' : '测试连接'}</button>
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
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>v0.1.0-alpha · Local-first Markdown Editor</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><Home size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">本地优先</h4><p className="text-[11px] text-t3 leading-normal m-0">数据存储在你的设备上</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><Unlock size={17} className="shrink-0 mt-px text-t2" /><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">开放格式</h4><p className="text-[11px] text-t3 leading-normal m-0">标准 Markdown，无锁定</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><Sparkles size={17} className="shrink-0 mt-px text-acc" /><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">AI 辅助</h4><p className="text-[11px] text-t3 leading-normal m-0">本地 + 云端 LLM</p></div></div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-g btn-sm inline-flex items-center gap-1.5"><ClipboardCopy size={13} /> 复制版本信息</button><button className="btn btn-g btn-sm inline-flex items-center gap-1.5"><RefreshCw size={13} /> 检查更新</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
