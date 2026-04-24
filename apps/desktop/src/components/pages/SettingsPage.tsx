import { useState, useEffect, useRef, useCallback } from 'react';
import { useSettingsStore, type SettingsTab, type LlmProvider } from '@/store/settingsStore';
import { getApiRoot, authHeaders } from '@/utils/authToken';

const MODELS: Record<string, { name: string; sub: string; tag: string; cls: string }[]> = {
  anthropic: [
    { name: 'claude-sonnet-4-6', sub: '200k · 推荐', tag: '智能', cls: 'tag-smart' },
    { name: 'claude-haiku-4-5', sub: '200k · 快速', tag: '快速', cls: 'tag-fast' },
    { name: 'claude-opus-4-6', sub: '200k · 最强', tag: '最强', cls: 'tag-smart' },
  ],
  openai: [
    { name: 'gpt-4.1', sub: '1M · 推荐', tag: '智能', cls: 'tag-smart' },
    { name: 'gpt-4.1-mini', sub: '1M · 快速', tag: '快速', cls: 'tag-fast' },
    { name: 'gpt-4.1-nano', sub: '1M · 极速', tag: '极速', cls: 'tag-fast' },
    { name: 'o3', sub: '200k · 推理', tag: '推理', cls: 'tag-smart' },
    { name: 'o4-mini', sub: '200k · 推理', tag: '推理', cls: 'tag-fast' },
  ],
  google: [
    { name: 'gemini-2.5-pro', sub: '1M · 推荐', tag: '智能', cls: 'tag-smart' },
    { name: 'gemini-2.5-flash', sub: '1M · 快速', tag: '快速', cls: 'tag-fast' },
    { name: 'gemini-2.0-flash', sub: '1M · 极速', tag: '极速', cls: 'tag-fast' },
  ],
  xai: [
    { name: 'grok-3', sub: '131k · 推荐', tag: '智能', cls: 'tag-smart' },
    { name: 'grok-3-mini', sub: '131k · 快速', tag: '快速', cls: 'tag-fast' },
  ],
  mistral: [
    { name: 'mistral-large-latest', sub: '128k · 推荐', tag: '智能', cls: 'tag-smart' },
    { name: 'mistral-medium-latest', sub: '128k · 均衡', tag: '均衡', cls: 'tag-fast' },
    { name: 'mistral-small-latest', sub: '128k · 快速', tag: '快速', cls: 'tag-fast' },
    { name: 'codestral-latest', sub: '256k · 代码', tag: '代码', cls: 'tag-smart' },
  ],
  groq: [
    { name: 'llama-3.3-70b-versatile', sub: '128k · 推荐', tag: '快速', cls: 'tag-fast' },
    { name: 'llama-3.1-8b-instant', sub: '128k · 极速', tag: '极速', cls: 'tag-fast' },
    { name: 'gemma2-9b-it', sub: '8k · 轻量', tag: '轻量', cls: 'tag-fast' },
  ],
  openrouter: [
    { name: 'anthropic/claude-sonnet-4-6', sub: '200k · 聚合', tag: '智能', cls: 'tag-smart' },
    { name: 'openai/gpt-4.1', sub: '1M · 聚合', tag: '智能', cls: 'tag-smart' },
    { name: 'google/gemini-2.5-pro', sub: '1M · 聚合', tag: '智能', cls: 'tag-smart' },
    { name: 'meta-llama/llama-3.3-70b', sub: '128k · 开源', tag: '开源', cls: 'tag-fast' },
    { name: 'xiaomi/mimo-v2-omni', sub: '128k · 开源', tag: '开源', cls: 'tag-fast' },
  ],
};

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
    { id: 'llm' as SettingsTab, icon: '✦', name: 'LLM 配置' },
    { id: 'prompt' as SettingsTab, icon: '💬', name: '提示词' },
  ]},
  { label: '安全', items: [
    { id: 'security' as SettingsTab, icon: '🔒', name: '访问密码' },
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

/** Provider API base URLs for connection testing */
const PROVIDER_TEST_URLS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/models',
  google: 'https://generativelanguage.googleapis.com/v1beta/models',
  xai: 'https://api.x.ai/v1/models',
  mistral: 'https://api.mistral.ai/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

async function testProviderConnection(provider: string, apiKey: string): Promise<{ success: boolean; message: string }> {
  if (!apiKey.trim()) return { success: false, message: '请先填写 API Key' };

  const url = PROVIDER_TEST_URLS[provider];
  if (!url) return { success: false, message: '不支持测试该提供商' };

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      // Anthropic doesn't have a list-models endpoint; send a minimal request
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (response.ok || response.status === 200) return { success: true, message: '连接成功 ✓' };
      if (response.status === 401) return { success: false, message: 'API Key 无效' };
      return { success: false, message: `请求失败 (${response.status})` };
    }

    if (provider === 'google') {
      const response = await fetch(`${url}?key=${apiKey}`);
      if (response.ok) return { success: true, message: '连接成功 ✓' };
      if (response.status === 400 || response.status === 403) return { success: false, message: 'API Key 无效' };
      return { success: false, message: `请求失败 (${response.status})` };
    }

    // OpenAI-compatible providers (openai, xai, mistral, groq, openrouter)
    headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(url, { headers });
    if (response.ok) return { success: true, message: '连接成功 ✓' };
    if (response.status === 401) return { success: false, message: 'API Key 无效' };
    return { success: false, message: `请求失败 (${response.status})` };
  } catch {
    return { success: false, message: '网络错误，无法连接' };
  }
}

export function SettingsPage() {
  const store = useSettingsStore();
  const { settingsTab, setSettingsTab, setTheme, updateSettings } = store;
  const [showApiKey, setShowApiKey] = useState(false);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');

  // Security tab state
  const [authEnabled, setAuthEnabled] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirm, setAuthConfirm] = useState('');
  const [authMessage, setAuthMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const authFetched = useRef(false);

  useEffect(() => {
    if (authFetched.current) return;
    authFetched.current = true;
    fetch(`${getApiRoot()}/auth/status`)
      .then((response) => response.json())
      .then((data: { enabled: boolean }) => setAuthEnabled(data.enabled))
      .catch(() => {});
  }, []);

  const handleSavePassword = useCallback(async () => {
    if (!authPassword.trim()) {
      setAuthMessage({ type: 'error', text: '密码不能为空' });
      return;
    }
    if (authPassword !== authConfirm) {
      setAuthMessage({ type: 'error', text: '两次输入的密码不一致' });
      return;
    }
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      const response = await fetch(`${getApiRoot()}/auth/set-token`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ token: authPassword, enabled: true }),
      });
      if (response.ok) {
        setAuthEnabled(true);
        setAuthPassword('');
        setAuthConfirm('');
        setAuthMessage({ type: 'success', text: '访问密码已设置，下次打开时需要输入密码' });
      } else {
        setAuthMessage({ type: 'error', text: '设置失败，请重试' });
      }
    } catch {
      setAuthMessage({ type: 'error', text: '无法连接到服务器' });
    } finally {
      setAuthLoading(false);
    }
  }, [authPassword, authConfirm]);

  const handleDisableAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthMessage(null);
    try {
      const response = await fetch(`${getApiRoot()}/auth/disable`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      if (response.ok) {
        setAuthEnabled(false);
        setAuthMessage({ type: 'success', text: '访问密码已关闭' });
      } else {
        setAuthMessage({ type: 'error', text: '操作失败，请重试' });
      }
    } catch {
      setAuthMessage({ type: 'error', text: '无法连接到服务器' });
    } finally {
      setAuthLoading(false);
    }
  }, []);

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
            <div className="tr">
              <div className="tr-info">
                <h4>链接打开方式</h4>
                <p>{store.linkOpenMode === 'external' ? '点击链接将在系统默认浏览器中打开' : '点击链接将在应用内嵌窗口中打开'}</p>
              </div>
              <select className="fsel" style={{ maxWidth: 200 }} value={store.linkOpenMode} onChange={(e) => updateSettings({ linkOpenMode: e.target.value as 'external' | 'internal' })}>
                <option value="external">🌐 外部浏览器</option>
                <option value="internal">📌 应用内打开</option>
              </select>
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

        {/* ── LLM 配置 ── */}
        {settingsTab === 'llm' && (
          <div className="ss-sec">
            <div className="ss-title">LLM 配置</div>
            <div className="ss-desc">选择 AI 提供商和模型，配置 API 密钥</div>
            <div className="fr">
              <div className="fl">AI 提供商</div>
              <select className="fsel" style={{ maxWidth: 280 }} value={store.llmProvider} onChange={(e) => updateSettings({ llmProvider: e.target.value as LlmProvider })}>
                <option value="anthropic">⬡ Anthropic（Claude）</option>
                <option value="openai">◉ OpenAI（GPT）</option>
                <option value="google">◆ Google（Gemini）</option>
                <option value="xai">✖ xAI（Grok）</option>
                <option value="mistral">◈ Mistral</option>
                <option value="groq">⚡ Groq（极速推理）</option>
                <option value="openrouter">🔀 OpenRouter（聚合）</option>
                <option value="local">🖥 本地模型（Ollama）</option>
              </select>
            </div>

            {store.llmProvider !== 'local' && (
              <>
                <div className="fr">
                  <div className="fl">API Key <span className="badge">已加密存储</span></div>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <input className="fi2" type={showApiKey ? 'text' : 'password'} value={store.llmApiKey} onChange={(e) => updateSettings({ llmApiKey: e.target.value })} style={{ flex: 1 }} />
                    <button className="btn btn-g btn-sm" onClick={() => setShowApiKey(!showApiKey)}>👁</button>
                  </div>
                </div>
                <div className="fr">
                  <div className="fl">选择模型</div>
                  <div className="ml">
                    {(MODELS[store.llmProvider] || []).map((model) => (
                      <div key={model.name} className={`mi ${store.llmModel === model.name ? 'on' : ''}`} onClick={() => updateSettings({ llmModel: model.name })}>
                        <div className="mi-l"><div className="mi-dot" /><div><div className="mi-nm">{model.name}</div><div className="mi-sub">{model.sub}</div></div></div>
                        <span className={`mi-tag ${model.cls}`}>{model.tag}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="fr2">
                  <div className="fr"><div className="fl">Temperature</div><input className="fi2" type="number" min={0} max={1} step={0.1} value={store.temperature} onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })} /><div className="fh">0 = 确定性 · 1 = 创造性</div></div>
                  <div className="fr"><div className="fl">Max Tokens</div><input className="fi2" type="number" value={store.maxTokens} onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 4 }}>
                  <button
                    className="btn btn-g btn-sm"
                    disabled={testStatus.testing}
                    onClick={async () => {
                      setTestStatus({ testing: true });
                      const result = await testProviderConnection(store.llmProvider, store.llmApiKey);
                      setTestStatus({ testing: false, result });
                      setTimeout(() => setTestStatus((s) => ({ ...s, result: undefined })), 4000);
                    }}
                  >{testStatus.testing ? '⏳ 测试中…' : '🔌 测试连接'}</button>
                  <button
                    className="btn btn-p btn-sm"
                    onClick={() => {
                      updateSettings({});
                      setSaveStatus('saved');
                      setTimeout(() => setSaveStatus('idle'), 2000);
                    }}
                  >{saveStatus === 'saved' ? '✓ 已保存' : '保存'}</button>
                  {testStatus.result && (
                    <span style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                      {testStatus.result.message}
                    </span>
                  )}
                </div>
              </>
            )}

            {store.llmProvider === 'local' && (
              <>
                <div className="fr"><div className="fl">Ollama 服务地址</div><input className="fi2" value={store.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} autoCapitalize="off" /></div>
                <div className="fr">
                  <div className="fl">已下载的本地模型</div>
                  <div className="ml">
                    <div className="mi on"><div className="mi-l"><div className="mi-dot" /><div><div className="mi-nm">qwen3:14b</div><div className="mi-sub">8.2 GB · 已下载</div></div></div><span className="mi-tag tag-local">本地</span></div>
                    <div className="mi"><div className="mi-l"><div className="mi-dot" /><div><div className="mi-nm">llama3.2:3b</div><div className="mi-sub">2.0 GB · 已下载</div></div></div><span className="mi-tag tag-local">本地</span></div>
                  </div>
                </div>
                <div className="fr2">
                  <div className="fr"><div className="fl">Temperature</div><input className="fi2" type="number" min={0} max={1} step={0.1} value={store.temperature} onChange={(e) => updateSettings({ temperature: parseFloat(e.target.value) })} /></div>
                  <div className="fr"><div className="fl">Max Tokens</div><input className="fi2" type="number" value={store.maxTokens} onChange={(e) => updateSettings({ maxTokens: parseInt(e.target.value) })} /></div>
                </div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: 10 }}>
                  <button
                    className="btn btn-g btn-sm"
                    disabled={testStatus.testing}
                    onClick={async () => {
                      setTestStatus({ testing: true });
                      try {
                        const response = await fetch(`${store.ollamaUrl}/api/tags`);
                        if (response.ok) {
                          setTestStatus({ testing: false, result: { success: true, message: 'Ollama 运行中 ✓' } });
                        } else {
                          setTestStatus({ testing: false, result: { success: false, message: `Ollama 响应异常 (${response.status})` } });
                        }
                      } catch {
                        setTestStatus({ testing: false, result: { success: false, message: '无法连接 Ollama，请确认服务已启动' } });
                      }
                      setTimeout(() => setTestStatus((s) => ({ ...s, result: undefined })), 4000);
                    }}
                  >{testStatus.testing ? '⏳ 检测中…' : '🔌 检测 Ollama'}</button>
                  <button
                    className="btn btn-p btn-sm"
                    onClick={() => {
                      updateSettings({});
                      setSaveStatus('saved');
                      setTimeout(() => setSaveStatus('idle'), 2000);
                    }}
                  >{saveStatus === 'saved' ? '✓ 已保存' : '保存'}</button>
                  {testStatus.result && (
                    <span style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                      {testStatus.result.message}
                    </span>
                  )}
                </div>
                <div className="info-c"><div className="ic-i">💡</div><div className="ic-b"><h4>本地模型</h4><p>请确保 Ollama 已安装并运行，可运行 qwen3:14b、llama3 等本地模型。</p></div></div>
              </>
            )}
          </div>
        )}

        {/* ── 提示词 ── */}
        {settingsTab === 'prompt' && (
          <div className="ss-sec">
            <div className="ss-title">提示词配置</div>
            <div className="ss-desc">自定义 AI 助手的行为与写作风格</div>
            <div className="fr"><div className="fl">系统提示词</div><textarea className="fi2" rows={5} value={store.systemPrompt} onChange={(e) => updateSettings({ systemPrompt: e.target.value })} autoCapitalize="off" /><div className="fh">此提示词附加到每次 AI 请求的开头</div></div>
            <div className="fr"><div className="fl">写作风格</div><select className="fsel" value={store.writingStyle} onChange={(e) => updateSettings({ writingStyle: e.target.value })}><option>技术文档</option><option>学术论文</option><option>博客文章</option></select></div>
            <div className="tr"><div className="tr-info"><h4>保留对话上下文</h4><p>AI 对话在同一文档内保持记忆</p></div><Toggle value={store.keepContext} onChange={(v) => updateSettings({ keepContext: v })} /></div>
            <div className="tr"><div className="tr-info"><h4>自动发送文档内容</h4><p>每次对话自动附带当前文档全文</p></div><Toggle value={store.autoSendDoc} onChange={(v) => updateSettings({ autoSendDoc: v })} /></div>
            <button className="btn btn-p btn-sm" style={{ marginTop: 10 }}>保存提示词</button>
          </div>
        )}

        {/* ── 安全 ── */}
        {settingsTab === 'security' && (
          <div className="ss-sec">
            <div className="ss-title">访问密码</div>
            <div className="ss-desc">设置访问密码后，打开应用时需要输入密码才能查看文档内容</div>

            <div className="tr" style={{ marginBottom: 16 }}>
              <div className="tr-info">
                <h4>启用密码保护</h4>
                <p>{authEnabled ? '已启用 — 打开应用时需要输入密码' : '未启用 — 任何人都可以查看文档'}</p>
              </div>
              <div
                className={`sw2 ${authEnabled ? 'on' : ''}`}
                style={{ opacity: authLoading ? 0.5 : 1, cursor: authLoading ? 'not-allowed' : 'pointer' }}
                onClick={() => {
                  if (authLoading) return;
                  if (authEnabled) {
                    handleDisableAuth();
                  } else {
                    // Turning on requires setting a password first — just focus the password input
                    setAuthMessage({ type: 'error', text: '请先设置密码后再启用' });
                  }
                }}
              >
                <div className="sw2-t" />
              </div>
            </div>

            <div className="auth-form-card">
              <div className="auth-form-title">{authEnabled ? '修改密码' : '设置密码'}</div>

              <div className="auth-field">
                <label className="auth-label">新密码</label>
                <div className="auth-input-wrap">
                  <svg className="auth-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <input
                    type={showAuthPassword ? 'text' : 'password'}
                    className="auth-input"
                    placeholder="输入新密码"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    autoCapitalize="off"
                  />
                  <button className="auth-eye-btn" onClick={() => setShowAuthPassword((v) => !v)} title={showAuthPassword ? '隐藏密码' : '显示密码'}>
                    {showAuthPassword ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label">确认密码</label>
                <div className="auth-input-wrap">
                  <svg className="auth-input-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <input
                    type={showAuthPassword ? 'text' : 'password'}
                    className="auth-input"
                    placeholder="再次输入密码"
                    value={authConfirm}
                    onChange={(event) => setAuthConfirm(event.target.value)}
                    autoCapitalize="off"
                  />
                  {authConfirm && authPassword === authConfirm && (
                    <span className="auth-match-icon">✓</span>
                  )}
                </div>
              </div>

              <div className="auth-actions">
                <button
                  className="btn btn-p btn-sm"
                  onClick={handleSavePassword}
                  disabled={authLoading || !authPassword.trim()}
                >
                  {authLoading ? '保存中...' : (authEnabled ? '更新密码' : '设置并启用')}
                </button>
                {authEnabled && (
                  <button
                    className="btn btn-g btn-sm"
                    onClick={handleDisableAuth}
                    disabled={authLoading}
                    style={{ color: 'var(--red)' }}
                  >
                    关闭密码保护
                  </button>
                )}
              </div>

              {authMessage && (
                <div className={`auth-msg ${authMessage.type}`}>
                  {authMessage.type === 'success' ? '✓ ' : '✕ '}{authMessage.text}
                </div>
              )}
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
