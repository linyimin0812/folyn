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
    <div ref={containerRef} className="sk-keys" onClick={() => setRecording(true)} style={{ cursor: 'pointer' }}>
      {recording ? (
        <span className="key" style={{ background: 'var(--accdim)', borderColor: 'var(--acc)', color: 'var(--acc)' }}>按下快捷键…</span>
      ) : (
        currentKeys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="key-p">+</span>}
            <span className="key">{k}</span>
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
    <div className={`sw2 ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
      <div className="sw2-t" />
    </div>
  );
}


export function SettingsPage() {
  const store = useSettingsStore();
  const { settingsTab, setSettingsTab, setTheme, updateSettings } = store;
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });

  return (
    <div className="settings-page">
      {/* Left navigation */}
      <nav className="sn">
        <div className="sn-nav-body">
          {NAV_GROUPS.map((group) => (
            <div className="sn-grp" key={group.label}>
              <div className="sn-lbl">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`sn-item ${settingsTab === item.id ? 'on' : ''}`}
                  onClick={() => setSettingsTab(item.id)}
                >
                  {item.icon} {item.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="sn-footer">
          <button className="sn-back-btn" onClick={() => store.setCurrentPage('editor')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="10,2 4,8 10,14" />
            </svg>
            返回编辑器
          </button>
        </div>
      </nav>

      {/* Right panel */}
      <div className="sc2">
        {/* ── 外观 ── */}
        {settingsTab === 'appearance' && (
          <div className="ss-sec">
            <div className="ss-title">外观</div>
            <div className="ss-desc">调整界面主题与字体显示</div>
            <div className="fr">
              <div className="fl">界面主题</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div className={`theme-card ${store.theme === 'dark' ? 'curr' : ''}`} onClick={() => setTheme('dark')}>
                  <div className="theme-preview" style={{ background: '#0b0d14' }} />
                  <div className="theme-label">暗色</div>
                </div>
                <div className={`theme-card ${store.theme === 'light' ? 'curr' : ''}`} onClick={() => setTheme('light')}>
                  <div className="theme-preview" style={{ background: '#f0f2f8' }} />
                  <div className="theme-label">亮色</div>
                </div>
                <div className={`theme-card ${store.theme === 'system' ? 'curr' : ''}`} onClick={() => setTheme('system')}>
                  <div className="theme-preview" style={{ background: 'linear-gradient(135deg, #0b0d14 50%, #f0f2f8 50%)' }} />
                  <div className="theme-label">跟随系统</div>
                </div>
              </div>
            </div>
            <div className="fr">
              <div className="fl">界面字体大小</div>
              <select className="fsel" style={{ maxWidth: 180 }} value={`${store.fontSize}px`} onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value) })}>
                <option value="12px">12px（紧凑）</option>
                <option value="14px">14px（默认）</option>
                <option value="16px">16px（舒适）</option>
              </select>
            </div>
            <div className="tr"><div className="tr-info"><h4>默认显示 AI 面板</h4><p>打开编辑器时自动展开 AI 对话面板</p></div><Toggle value={store.showAiPanel} onChange={(v) => updateSettings({ showAiPanel: v })} /></div>
            <div className="tr"><div className="tr-info"><h4>状态栏</h4><p>底部显示字数、光标位置等信息</p></div><Toggle value={store.showStatusBar} onChange={(v) => updateSettings({ showStatusBar: v })} /></div>
            <div className="tr"><div className="tr-info"><h4>显示隐藏文件</h4><p>在文件树中显示以 . 开头的隐藏文件和文件夹</p></div><Toggle value={store.showHiddenFiles} onChange={(v) => { updateSettings({ showHiddenFiles: v }); import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree()); }} /></div>
            <div className="fr" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
              <div className="fl">过滤文件/文件夹</div>
              <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>每行一个规则，匹配的文件或文件夹将在文件树中隐藏。支持 * 和 ? 通配符，# 开头为注释。</p>
              <textarea
                className="fsel"
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

        {/* ── 编辑器 ── */}
        {settingsTab === 'editor' && (
          <div className="ss-sec">
            <div className="ss-title">编辑器</div>
            <div className="ss-desc">配置编辑器行为与显示选项</div>
            <div className="fr2">
              <div className="fr"><div className="fl">编辑器字体</div><select className="fsel" value={store.editorFont} onChange={(e) => updateSettings({ editorFont: e.target.value })}><option>DM Mono</option><option>JetBrains Mono</option><option>Fira Code</option></select></div>
              <div className="fr"><div className="fl">字体大小</div><select className="fsel" value={`${store.editorFontSize}px`} onChange={(e) => updateSettings({ editorFontSize: parseInt(e.target.value) })}><option value="12px">12px</option><option value="13px">13px</option><option value="14px">14px</option><option value="16px">16px</option></select></div>
            </div>
            <div className="fr">
              <div className="fl">Tab 大小</div>
              <select className="fsel" style={{ maxWidth: 180 }} value={store.tabSize} onChange={(e) => updateSettings({ tabSize: parseInt(e.target.value) })}><option value={2}>2 空格</option><option value={4}>4 空格</option></select>
            </div>
            <div className="tr"><div className="tr-info"><h4>显示行号</h4><p>在编辑区左侧显示行号</p></div><Toggle value={store.showLineNumbers} onChange={(v) => updateSettings({ showLineNumbers: v })} /></div>
            <div className="tr"><div className="tr-info"><h4>自动保存</h4><p>每 30 秒自动保存当前文档</p></div><Toggle value={store.autoSave} onChange={(v) => updateSettings({ autoSave: v })} /></div>
            <div className="tr" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div className="tr-info">
                <h4>链接打开方式</h4>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div
                  className={`setting-card${store.linkOpenMode === 'external' ? ' active' : ''}`}
                  onClick={() => updateSettings({ linkOpenMode: 'external' })}
                >
                  <span className="setting-card-icon">🌐</span>
                  <span className="setting-card-label">外部浏览器</span>
                  <span className="setting-card-desc">在系统默认浏览器中打开</span>
                </div>
                <div
                  className={`setting-card${store.linkOpenMode === 'internal' ? ' active' : ''}`}
                  onClick={() => updateSettings({ linkOpenMode: 'internal' })}
                >
                  <span className="setting-card-icon">📌</span>
                  <span className="setting-card-label">应用内打开</span>
                  <span className="setting-card-desc">在应用内嵌窗口中打开</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 快捷键 ── */}
        {settingsTab === 'shortcuts' && (
          <div className="ss-sec">
            <div className="ss-title">快捷键</div>
            <div className="ss-desc">点击快捷键区域可重新录入，按下新的组合键即可修改</div>
            {store.shortcuts.map((shortcut) => (
              <div className="sk-row" key={shortcut.id}>
                <span className="sk-nm">{shortcut.name}</span>
                <ShortcutEditor shortcutId={shortcut.id} currentKeys={shortcut.keys} />
              </div>
            ))}
            <div style={{ marginTop: 14, display: 'flex', gap: 7 }}>
              <button className="btn btn-g btn-sm" onClick={() => store.resetShortcuts()}>恢复默认</button>
            </div>
          </div>
        )}

        {/* ── AI 工具 ── */}
        {settingsTab === 'ai' && (
          <div className="ss-sec">
            <div className="ss-title">AI 工具</div>
            <div className="ss-desc">配置 AI CLI 工具，用于智能编辑文档</div>
            <div className="fl" style={{ marginBottom: 8 }}>CLI 适配器</div>
            <div className="ml">
              {CliAdapterRegistry.getInstance().getAll().map((a) => (
                <div
                  key={a.id}
                  className={`mi ${store.cliAdapter === a.id ? 'on' : ''}`}
                  onClick={() => updateSettings({ cliAdapter: a.id })}
                >
                  <div className="mi-l">
                    <div className="mi-dot" />
                    <div>
                      <div className="mi-nm">{a.displayName}</div>
                      <div className="mi-sub">{a.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="fr" style={{ marginTop: 16 }}>
              <div className="fl">CLI 路径</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="fi2" style={{ flex: 1 }} value={store.cliPath} onChange={(e) => updateSettings({ cliPath: e.target.value })} placeholder="claude" autoCapitalize="off" />
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
              <div className="fh">CLI 可执行文件的路径或命令名，点击"检测"自动查找</div>
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
            <div className="info-c" style={{ marginTop: 16 }}>
              <div className="ic-i">💡</div>
              <div className="ic-b">
                <h4>使用说明</h4>
                <p>AI 工具通过调用本地 CLI（如 Claude Code）来编辑文档。请确保已安装对应的 CLI 工具。修改会以 Diff 形式展示，确认后再应用到文件。</p>
              </div>
            </div>
          </div>
        )}

        {/* ── 关于 ── */}
        {settingsTab === 'about' && (
          <div className="ss-sec">
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
              <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="48" height="48" style={{ borderRadius: 5 }} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.02em' }}>Quill<span style={{ color: 'var(--acc)' }}>.</span></div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>v0.1.0-alpha · Local-first Markdown Editor</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
              <div className="info-c"><div className="ic-i">🏠</div><div className="ic-b"><h4>本地优先</h4><p>数据存储在你的设备上</p></div></div>
              <div className="info-c"><div className="ic-i">🔓</div><div className="ic-b"><h4>开放格式</h4><p>标准 Markdown，无锁定</p></div></div>
              <div className="info-c"><div className="ic-i">✦</div><div className="ic-b"><h4>AI 辅助</h4><p>本地 + 云端 LLM</p></div></div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-g btn-sm">📋 复制版本信息</button><button className="btn btn-g btn-sm">🔄 检查更新</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
