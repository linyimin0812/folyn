import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore, type SettingsTab } from '@/store/settingsStore';
import { CliAdapterRegistry } from '@quill/cli-adapter';

/** Map keyboard event key to display symbol */
function keyToSymbol(key: string): string {
  const map: Record<string, string> = {
    Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: 'Shift',
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function ShortcutEditor({ shortcutId, currentKeys }: { shortcutId: string; currentKeys: string[] }) {
  const [recording, setRecording] = useState(false);
  const updateShortcut = useSettingsStore((s) => s.updateShortcut);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Ignore lone modifier keys
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;

    const keys: string[] = [];
    if (event.metaKey) keys.push('⌘');
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.altKey) keys.push('⌥');
    if (event.shiftKey) keys.push('Shift');
    keys.push(keyToSymbol(event.key));

    updateShortcut(shortcutId, keys);
    setRecording(false);
  }, [shortcutId, updateShortcut]);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  // Close on click outside
  useEffect(() => {
    if (!recording) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setRecording(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [recording]);

  return (
    <div ref={containerRef} className="sk-keys flex items-center gap-[3px] cursor-pointer" onClick={() => setRecording(true)}>
      {recording ? (
        <span className="key bg-accdim border border-acc text-acc rounded px-1.5 py-0.5 text-[10.5px] font-mono shadow-[0_1px_0_var(--brd2)]">按下快捷键…</span>
      ) : (
        currentKeys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="text-t3 text-[9px]">+</span>}
            <span className="key bg-surf2 border border-brd2 rounded px-1.5 py-0.5 text-[10.5px] font-mono text-t1 shadow-[0_1px_0_var(--brd2)]">{k}</span>
          </span>
        ))
      )}
    </div>
  );
}

const NAV_GROUPS = [
  { label: '通用', items: [
    { id: 'appearance' as SettingsTab, icon: '🖥', name: '外观' },
    { id: 'editor' as SettingsTab, icon: '✏️', name: '编辑器' },
    { id: 'shortcuts' as SettingsTab, icon: '⌨️', name: '快捷键' },
  ]},
  { label: 'AI', items: [
    { id: 'ai' as SettingsTab, icon: '✦', name: 'AI 工具' },
  ]},
  { label: '关于', items: [
    { id: 'about' as SettingsTab, icon: 'ℹ️', name: '关于 Quill' },
  ]},
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`sw2 w-9 h-5 rounded-[10px] cursor-pointer relative transition-[background] duration-200 shrink-0 ${value ? 'bg-acc' : 'bg-brd2'}`} onClick={() => onChange(!value)}>
      <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 left-0.5 transition-transform duration-200 ${value ? 'translate-x-4' : ''}`} />
    </div>
  );
}


export function SettingsPage() {
  const store = useSettingsStore();
  const { settingsTab, setSettingsTab, setTheme, updateSettings } = store;
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });

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
          <button className="sn-back-btn flex items-center gap-2 py-[7px] px-[9px] rounded-md cursor-pointer text-t2 text-[length:calc(var(--ui-font-size)-2px)] transition-all duration-100 border-none bg-transparent w-full text-left font-ui hover:bg-hov hover:text-t1" onClick={() => store.setCurrentPage('editor')}>
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
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${store.theme === 'dark' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('dark')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#0b0d14' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">暗色</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${store.theme === 'light' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('light')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#f0f2f8' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">亮色</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${store.theme === 'system' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('system')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: 'linear-gradient(135deg, #0b0d14 50%, #f0f2f8 50%)' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">跟随系统</div>
                </div>
              </div>
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">界面字体大小</div>
              <select className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full" style={{ maxWidth: 180 }} value={`${store.fontSize}px`} onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}>
                <option value="12px">12px（紧凑）</option>
                <option value="14px">14px（默认）</option>
                <option value="16px">16px（舒适）</option>
              </select>
            </div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">默认显示 AI 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">打开编辑器时自动展开 AI 对话面板</p></div><Toggle value={store.showAiPanel} onChange={(v) => updateSettings({ showAiPanel: v })} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">状态栏</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">底部显示字数、光标位置等信息</p></div><Toggle value={store.showStatusBar} onChange={(v) => updateSettings({ showStatusBar: v })} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示隐藏文件</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在文件树中显示以 . 开头的隐藏文件和文件夹</p></div><Toggle value={store.showHiddenFiles} onChange={(v) => { updateSettings({ showHiddenFiles: v }); import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree()); }} /></div>
            <div className="mb-3.5 flex flex-col items-stretch gap-1.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">过滤文件/文件夹</div>
              <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>每行一个规则，匹配的文件或文件夹将在文件树中隐藏。支持 * 和 ? 通配符，# 开头为注释。</p>
              <textarea
                className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full"
                rows={6}
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical', lineHeight: 1.6, padding: '8px 10px' }}
                value={store.excludePatterns}
                onChange={(e) => updateSettings({ excludePatterns: e.target.value })}
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
            <div className="grid grid-cols-2 gap-3.5 mb-3.5">
              <div className="mb-3.5"><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">编辑器字体</div><select className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full" value={store.editorFont} onChange={(e) => updateSettings({ editorFont: e.target.value })}><option>DM Mono</option><option>JetBrains Mono</option><option>Fira Code</option></select></div>
              <div className="mb-3.5"><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">字体大小</div><select className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full" value={`${store.editorFontSize}px`} onChange={(e) => updateSettings({ editorFontSize: parseInt(e.target.value) })}><option value="12px">12px</option><option value="13px">13px</option><option value="14px">14px</option><option value="16px">16px</option></select></div>
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">Tab 大小</div>
              <select className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full" style={{ maxWidth: 180 }} value={store.tabSize} onChange={(e) => updateSettings({ tabSize: parseInt(e.target.value) })}><option value={2}>2 空格</option><option value={4}>4 空格</option></select>
            </div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示行号</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在编辑区左侧显示行号</p></div><Toggle value={store.showLineNumbers} onChange={(v) => updateSettings({ showLineNumbers: v })} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">自动保存</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">每 30 秒自动保存当前文档</p></div><Toggle value={store.autoSave} onChange={(v) => updateSettings({ autoSave: v })} /></div>
            <div className="tr flex flex-col items-stretch gap-2 py-2.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">链接打开方式</h4>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div
                  className={`setting-card flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-lg border cursor-pointer transition-all duration-150 ${store.linkOpenMode === 'external' ? 'border-acc bg-accdim' : 'border-brd bg-surf hover:border-brd2 hover:bg-hov'}`}
                  onClick={() => updateSettings({ linkOpenMode: 'external' })}
                >
                  <span className="text-xl">🌐</span>
                  <span className="text-xs font-semibold text-t1">外部浏览器</span>
                  <span className="text-[10px] text-t3 text-center">在系统默认浏览器中打开</span>
                </div>
                <div
                  className={`setting-card flex-1 flex flex-col items-center gap-1 py-3 px-2 rounded-lg border cursor-pointer transition-all duration-150 ${store.linkOpenMode === 'internal' ? 'border-acc bg-accdim' : 'border-brd bg-surf hover:border-brd2 hover:bg-hov'}`}
                  onClick={() => updateSettings({ linkOpenMode: 'internal' })}
                >
                  <span className="text-xl">📌</span>
                  <span className="text-xs font-semibold text-t1">应用内打开</span>
                  <span className="text-[10px] text-t3 text-center">在应用内嵌窗口中打开</span>
                </div>
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
                value={store.dailyNotesDir}
                onChange={(e) => updateSettings({ dailyNotesDir: e.target.value })}
                placeholder="daily"
                autoCapitalize="off"
              />
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">日期格式</div>
              <select
                className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full"
                style={{ maxWidth: 240 }}
                value={store.dailyNoteDateFormat}
                onChange={(e) => updateSettings({ dailyNoteDateFormat: e.target.value })}
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
            {store.shortcuts.map((shortcut) => (
              <div className="sk-row flex items-center justify-between py-2 border-b border-brd last:border-b-0" key={shortcut.id}>
                <span className="text-xs text-t2">{shortcut.name}</span>
                <ShortcutEditor shortcutId={shortcut.id} currentKeys={shortcut.keys} />
              </div>
            ))}
            <div style={{ marginTop: 14, display: 'flex', gap: 7 }}>
              <button className="btn btn-g btn-sm" onClick={() => store.resetShortcuts()}>恢复默认</button>
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
              {CliAdapterRegistry.getInstance().getAll().map((a) => (
                <div
                  key={a.id}
                  className={`mi flex items-center justify-between py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${store.cliAdapter === a.id ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
                  onClick={() => updateSettings({ cliAdapter: a.id })}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full border-2 shrink-0 ${store.cliAdapter === a.id ? 'bg-acc border-acc' : 'border-brd2'}`} />
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
                <input className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc" style={{ flex: 1 }} value={store.cliPath} onChange={(e) => updateSettings({ cliPath: e.target.value })} placeholder="claude" autoCapitalize="off" />
                <button
                  className="btn btn-g btn-sm"
                  title="自动检测路径"
                  onClick={async () => {
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const adapterCmd = store.cliAdapter === 'claude' ? 'claude' : store.cliAdapter;
                      const cmd = Command.create('claude-cli', ['-l', '-c', `which ${adapterCmd}`]);
                      const output = await cmd.execute();
                      const detected = output.stdout.trim().split('\n')[0];
                      if (output.code === 0 && detected) {
                        updateSettings({ cliPath: detected });
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
                    const cliPath = store.cliPath || 'claude';
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
              <div className="text-[17px] shrink-0 mt-px">💡</div>
              <div>
                <h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">使用说明</h4>
                <p className="text-[11px] text-t3 leading-normal m-0">AI 工具通过调用本地 CLI（如 Claude Code）来编辑文档。请确保已安装对应的 CLI 工具。修改会以 Diff 形式展示，确认后再应用到文件。</p>
              </div>
            </div>
          </div>
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
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><div className="text-[17px] shrink-0 mt-px">🏠</div><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">本地优先</h4><p className="text-[11px] text-t3 leading-normal m-0">数据存储在你的设备上</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><div className="text-[17px] shrink-0 mt-px">🔓</div><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">开放格式</h4><p className="text-[11px] text-t3 leading-normal m-0">标准 Markdown，无锁定</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><div className="text-[17px] shrink-0 mt-px">✦</div><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">AI 辅助</h4><p className="text-[11px] text-t3 leading-normal m-0">本地 + 云端 LLM</p></div></div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-g btn-sm">📋 复制版本信息</button><button className="btn btn-g btn-sm">🔄 检查更新</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
